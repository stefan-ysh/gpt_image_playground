import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import mime from 'mime';
import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool, mysqlQuery } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { uploadBufferToCos } from '@/lib/db/cos';
import { enqueuePendingImageTransfer } from '@/lib/db/imageTransferQueue';
import { handleApiError } from '@/lib/api-error';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

const MAX_STORED_IMAGE_BYTES = 60 * 1024 * 1024;
const EXTERNAL_FETCH_TIMEOUT_MS = 15000;
const MAX_EXTERNAL_REDIRECTS = 3;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function normalizeContentType(value: string | null | undefined): string {
  return (value || 'image/png').split(';')[0].trim().toLowerCase();
}

function isAllowedImageType(contentType: string) {
  return ALLOWED_IMAGE_TYPES.has(normalizeContentType(contentType));
}

function isPrivateIp(host: string): boolean {
  const version = net.isIP(host);
  if (version === 4) {
    const parts = host.split('.').map(Number);
    const [a, b] = parts;
    return a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
  }
  if (version === 6) {
    const normalized = host.toLowerCase();
    return normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized === '::';
  }
  return false;
}

async function assertPublicImageUrl(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http/https 图片链接');
  }
  if (url.username || url.password) {
    throw new Error('图片链接不能包含认证信息');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || isPrivateIp(url.hostname)) {
    throw new Error('不允许下载本地或内网图片地址');
  }

  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('不允许下载解析到内网的图片地址');
  }
}

function parseBase64(dataUrl: string): { buffer: Buffer; contentType: string; ext: string } | null {
  if (!dataUrl.startsWith('data:')) return null;
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex === -1) return null;

  const meta = dataUrl.slice(0, commaIndex); // e.g. "data:image/png;base64"
  const base64Data = dataUrl.slice(commaIndex + 1);

  const isBase64 = meta.endsWith(';base64');
  if (!isBase64) return null;

  const contentType = normalizeContentType(meta.slice(5, meta.length - 7)); // Get "image/png" by removing "data:" (5 chars) and ";base64" (7 chars)
  if (!isAllowedImageType(contentType)) return null;
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) return null;
  const ext = mime.getExtension(contentType) || 'png';
  return { buffer, contentType, ext };
}

async function fetchPublicUrl(url: string, signal: AbortSignal, redirectsRemaining = MAX_EXTERNAL_REDIRECTS): Promise<Response> {
  await assertPublicImageUrl(url);
  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    signal,
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectsRemaining <= 0) throw new Error('图片链接重定向次数过多');
    const location = response.headers.get('location');
    if (!location) throw new Error('图片链接重定向无效');
    const nextUrl = new URL(location, url).toString();
    return fetchPublicUrl(nextUrl, signal, redirectsRemaining - 1);
  }

  return response;
}

async function fetchExternal(url: string): Promise<{ buffer: Buffer; contentType: string; ext: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), EXTERNAL_FETCH_TIMEOUT_MS);
  const response = await fetchPublicUrl(url, controller.signal).finally(() => clearTimeout(timeoutId));
  if (!response.ok) {
    throw new Error('下载第三方图片失败');
  }
  const contentType = normalizeContentType(response.headers.get('content-type'));
  if (!isAllowedImageType(contentType)) {
    throw new Error('链接返回的不是受支持的图片格式');
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片文件过大');
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片文件过大');
  }
  const ext = mime.getExtension(contentType) || 'png';
  return { buffer, contentType, ext };
}

export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const { dataUrl, source, thumbnailDataUrl, taskId } = await request.json();
    if (!dataUrl) {
      return NextResponse.json({ success: false, error: '缺少图片内容' }, { status: 400 });
    }

    let buffer: Buffer;
    let contentType: string;
    let ext: string;

    if (dataUrl.startsWith('data:')) {
      const parsed = parseBase64(dataUrl);
      if (!parsed) {
        return NextResponse.json({ success: false, error: '无效的 base64 格式' }, { status: 400 });
      }
      buffer = parsed.buffer;
      contentType = parsed.contentType;
      ext = parsed.ext;
    } else if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
      // 第三方图片链接
      try {
        const fetched = await fetchExternal(dataUrl);
        buffer = fetched.buffer;
        contentType = fetched.contentType;
        ext = fetched.ext;
      } catch (err: any) {
        console.error('下载外部图片出错:', err);
        // 如果提供了 taskId，则将临时 URL 保存到任务的 output_images_pending，并入队异步重试转存
        if (taskId) {
          try {
            const pool = await mysqlPool();
            const [rows] = await pool.query<RowDataPacket[]>(
              `SELECT output_images_pending FROM playground_tasks WHERE id = ? LIMIT 1`,
              [taskId]
            );
            let pending: string[] = [];
            if (rows.length > 0 && rows[0].output_images_pending) {
              try {
                pending = JSON.parse(rows[0].output_images_pending);
              } catch (e) {
                pending = [];
              }
            }
            if (!pending.includes(dataUrl)) {
              pending.push(dataUrl);
              await pool.query(
                `UPDATE playground_tasks SET output_images_pending = ? WHERE id = ?`,
                [JSON.stringify(pending), taskId]
              );
            }

            // 将待转存记录加入队列（位置为当前 pending 长度-1）
            await enqueuePendingImageTransfer(taskId, user.id, dataUrl, Math.max(0, pending.length - 1));

            return NextResponse.json({ success: true, data: { id: dataUrl, dataUrl } });
          } catch (queueErr) {
            console.error('将临时图片入队失败:', queueErr);
            return NextResponse.json({ success: false, error: `下载图片失败: ${err.message}` }, { status: 500 });
          }
        }

        return NextResponse.json({ success: false, error: `下载图片失败: ${err.message}` }, { status: 500 });
      }
    } else {
      // 已经是相对路径（如代理的路径），无需重复处理，直接返回
      return NextResponse.json({ success: true, data: { id: dataUrl, dataUrl } });
    }

    // 计算哈希作为主键 id
    const id = crypto.createHash('sha256').update(buffer).digest('hex');

    // 根据 source 来源精准细化子目录分类结构，确保参考图、遮罩图和结果大图落户符合最新物理归口定义的子目录
    let subFolder = 'images';
    if (source === 'upload' || source === 'reference') {
      subFolder = 'reference/images';
    } else if (source === 'mask') {
      subFolder = 'reference/mask';
    } else if (source === 'generated') {
      subFolder = 'images';
    }

    // 检查是否已存入数据库
    const pool = await mysqlPool();
    const [existingImages] = await pool.query<RowDataPacket[]>(
      `SELECT data_url FROM playground_images WHERE id = ? LIMIT 1`,
      [id]
    );

    // 否则上传到 COS - 路径以 taskid 隔离，确保每个任务的图片存储在对应id的文件夹内
    let cosUrl: string;
    const key = taskId
      ? `uploads/${taskId}/${subFolder}/${id}.${ext}`
      : `uploads/${subFolder}/${id}.${ext}`;

    if (existingImages.length > 0) {
      // 图片已存在，但如果有 taskId，需要在任务隔离目录中创建副本
      if (taskId) {
        // 上传到任务隔离目录
        cosUrl = await uploadBufferToCos(buffer, key, contentType);
      } else {
        // 没有 taskId，直接使用已存储的 URL
        cosUrl = existingImages[0].data_url;
      }
      await mysqlQuery`
        INSERT IGNORE INTO playground_image_owners (image_id, user_id, created_at)
        VALUES (${id}, ${user.id}, ${Date.now()})
      `;
      
      // 获取缩略图
      const [existingThumbnails] = await pool.query<RowDataPacket[]>(
        `SELECT thumbnail_data_url FROM playground_thumbnails WHERE id = ? LIMIT 1`,
        [id]
      );
      let dbThumbUrl = existingThumbnails[0]?.thumbnail_data_url || existingImages[0].data_url;
      
      // 如果有 taskId 和新的缩略图数据，为缩略图创建任务隔离的副本
      if (taskId && thumbnailDataUrl && thumbnailDataUrl.startsWith('data:')) {
        const parsedThumb = parseBase64(thumbnailDataUrl);
        if (parsedThumb) {
          const thumbKey = `uploads/${taskId}/thumbnails/${id}.${parsedThumb.ext}`;
          dbThumbUrl = await uploadBufferToCos(parsedThumb.buffer, thumbKey, parsedThumb.contentType);
        }
      }
      
      return NextResponse.json({
        success: true,
        data: { id, dataUrl: cosUrl, thumbnailDataUrl: dbThumbUrl }
      });
    }

    // 新图片，上传到 COS
    cosUrl = await uploadBufferToCos(buffer, key, contentType);

    // 写入 playground_images 表。hash 去重下可能出现并发重复保存，必须幂等处理。
    const now = Date.now();
    await pool.query(
      `INSERT IGNORE INTO playground_images (id, data_url, created_at, source)
       VALUES (?, ?, ?, ?)`,
      [id, cosUrl, now, source || 'upload']
    );
    await mysqlQuery`
      INSERT IGNORE INTO playground_image_owners (image_id, user_id, created_at)
      VALUES (${id}, ${user.id}, ${now})
    `;

    // 处理缩略图 - 路径以 taskid 隔离
    let cosThumbUrl = cosUrl;
    if (thumbnailDataUrl && thumbnailDataUrl.startsWith('data:')) {
      const parsedThumb = parseBase64(thumbnailDataUrl);
      if (parsedThumb) {
        const thumbKey = taskId
          ? `uploads/${taskId}/thumbnails/${id}.${parsedThumb.ext}`
          : `uploads/thumbnails/${id}.${parsedThumb.ext}`;
        cosThumbUrl = await uploadBufferToCos(parsedThumb.buffer, thumbKey, parsedThumb.contentType);
        // 只在该缩略图第一次被创建时保存到数据库
        await pool.query(
          `INSERT IGNORE INTO playground_thumbnails (id, thumbnail_data_url, thumbnail_version)
           VALUES (?, ?, ?)`,
          [id, cosThumbUrl, 2]
        );
      }
    } else {
      // 如果没有传缩略图，则直接将原图地址存作缩略图
      await pool.query(
        `INSERT IGNORE INTO playground_thumbnails (id, thumbnail_data_url, thumbnail_version)
         VALUES (?, ?, ?)`,
        [id, cosUrl, 2]
      );
    }

    const [storedImages] = await pool.query<RowDataPacket[]>(
      `SELECT data_url FROM playground_images WHERE id = ? LIMIT 1`,
      [id]
    );
    const [storedThumbnails] = await pool.query<RowDataPacket[]>(
      `SELECT thumbnail_data_url FROM playground_thumbnails WHERE id = ? LIMIT 1`,
      [id]
    );
    const storedDataUrl = storedImages[0]?.data_url || cosUrl;
    const storedThumbUrl = storedThumbnails[0]?.thumbnail_data_url || storedDataUrl;

    return NextResponse.json({
      success: true,
      data: { id, dataUrl: storedDataUrl, thumbnailDataUrl: storedThumbUrl }
    });
  } catch (error) {
    return handleApiError(error, '存储图片');
  }
}
