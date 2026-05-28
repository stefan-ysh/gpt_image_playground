import { NextResponse } from 'next/server';
import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const searchParams = new URL(request.url).searchParams;
    const idsStr = searchParams.get('ids');
    if (!idsStr) {
      return NextResponse.json({ success: true, data: [] });
    }

    const ids = idsStr
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    if (ids.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const pool = await mysqlPool();

    // 1. 批量查询图片所有权及大图基础数据
    const [images] = await pool.query<RowDataPacket[]>(
      `SELECT i.id, i.data_url, i.source, i.created_at, i.width, i.height
       FROM playground_images i
       INNER JOIN playground_image_owners o ON o.image_id = i.id AND o.user_id = ?
       WHERE i.id IN (?)`,
      [user.id, ids]
    );

    if (images.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 拿到可访问的图片实体的 ids，避免越权查询不属于该用户的缩略图
    const allowedIds = images.map((img) => img.id);

    // 2. 批量查询缩略图缓存数据
    const [thumbnails] = await pool.query<RowDataPacket[]>(
      `SELECT id, thumbnail_data_url, width, height, thumbnail_version 
       FROM playground_thumbnails 
       WHERE id IN (?)`,
      [allowedIds]
    );

    const thumbMap = new Map<string, RowDataPacket>();
    for (const thumb of thumbnails) {
      thumbMap.set(thumb.id, thumb);
    }

    // 3. 配对并格式化返回
    const result = images.map((img) => {
      const thumb = thumbMap.get(img.id);
      return {
        id: img.id,
        dataUrl: img.data_url,
        createdAt: img.created_at,
        source: img.source,
        width: img.width || thumb?.width,
        height: img.height || thumb?.height,
        thumbnailDataUrl: thumb?.thumbnail_data_url || img.data_url,
        thumbnailVersion: thumb?.thumbnail_version || 2,
      };
    });

    return NextResponse.json({
      success: true,
      data: result,
    });
  } catch (error) {
    return handleApiError(error, '批量获取图片');
  }
}
