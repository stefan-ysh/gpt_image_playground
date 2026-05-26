import { mysqlPool, mysqlQuery } from './mysql';
import { uploadBufferToCos } from './cos';
import { RowDataPacket } from 'mysql2';
import crypto from 'crypto';
import mime from 'mime';
import { syncTaskImageRefs } from './task-images';

// 重试间隔配置（单位：毫秒）
const RETRY_INTERVALS = [
  10 * 1000,           // 10s
  30 * 1000,           // 30s
  2 * 60 * 1000,       // 2min
  5 * 60 * 1000,       // 5min
  10 * 60 * 1000,      // 10min
];

const MAX_RETRY_COUNT = 15;
const TEMP_URL_RETENTION_DAYS = 3;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface PendingImageTransfer {
  id: string;
  taskId: string;
  userId: string;
  tempUrl: string;
  transferStatus: 'pending' | 'transferred' | 'failed';
  retryCount: number;
  lastRetryAt?: number;
  errorMessage?: string;
  transferredImageId?: string;
}

/**
 * 添加待转存的临时图片到队列
 */
export async function enqueuePendingImageTransfer(
  taskId: string,
  userId: string,
  tempUrl: string,
  position: number = 0
): Promise<string> {
  const pool = await mysqlPool();
  const id = `transfer-${taskId}-${position}-${Date.now()}`;
  
  const now = Date.now();
  await pool.query(
    `INSERT INTO playground_pending_image_transfers 
     (id, task_id, user_id, temp_url, transfer_status, retry_count, created_at)
     VALUES (?, ?, ?, ?, 'pending', 0, ?)`,
    [id, taskId, userId, tempUrl, now]
  );
  
  return id;
}

/**
 * 获取需要重试的待转存任务
 */
export async function getPendingTransfersForRetry(): Promise<PendingImageTransfer[]> {
  const pool = await mysqlPool();
  const now = Date.now();
  
  // 获取所有待转存或失败的记录
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM playground_pending_image_transfers 
     WHERE transfer_status IN ('pending', 'failed') 
     AND retry_count < ?
     AND (last_retry_at IS NULL OR last_retry_at + ? <= ?)
     ORDER BY last_retry_at ASC, created_at ASC
     LIMIT 100`,
    [MAX_RETRY_COUNT, getNextRetryDelay(0) * 1.5, now]
  );
  
  return rows as PendingImageTransfer[];
}

/**
 * 根据重试次数获取下次重试的延迟时间
 */
function getNextRetryDelay(retryCount: number): number {
  if (retryCount >= RETRY_INTERVALS.length) {
    return RETRY_INTERVALS[RETRY_INTERVALS.length - 1]; // 最后一个间隔一直重复
  }
  return RETRY_INTERVALS[retryCount];
}

/**
 * 尝试转存单个图片
 */
export async function attemptImageTransfer(transfer: PendingImageTransfer): Promise<{
  success: boolean;
  transferredImageId?: string;
  error?: string;
}> {
  try {
    // 校验 URL 格式
    if (!transfer.tempUrl.startsWith('http://') && !transfer.tempUrl.startsWith('https://')) {
      return {
        success: false,
        error: 'Invalid URL format',
      };
    }

    // 下载图片
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(transfer.tempUrl, {
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}`,
      };
    }

    const contentType = (response.headers.get('content-type') || 'image/png').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return {
        success: false,
        error: `Unsupported image type: ${contentType}`,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 计算图片 hash 作为 ID
    const imageId = crypto.createHash('sha256').update(buffer).digest('hex');

    // 获取文件扩展名
    const ext = mime.getExtension(contentType) || 'png';

    // 上传到 COS - 使用 taskId 隔离目录
    const key = `uploads/${transfer.taskId}/images/${imageId}.${ext}`;
    const cosUrl = await uploadBufferToCos(buffer, key, contentType);

    // 保存到 playground_images 表
    const pool = await mysqlPool();
    const now = Date.now();
    await pool.query(
      `INSERT IGNORE INTO playground_images (id, data_url, created_at, source)
       VALUES (?, ?, ?, 'generated')`,
      [imageId, cosUrl, now]
    );

    // 记录图片归属关系
    await pool.query(
      `INSERT IGNORE INTO playground_image_owners (image_id, user_id, created_at)
       VALUES (?, ?, ?)`,
      [imageId, transfer.userId, now]
    );

    await pool.query(
      `INSERT IGNORE INTO playground_thumbnails (id, thumbnail_data_url, thumbnail_version)
       VALUES (?, ?, ?)`,
      [imageId, cosUrl, 2]
    );

    return {
      success: true,
      transferredImageId: imageId,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 更新转存状态
 */
export async function updateTransferStatus(
  transferId: string,
  status: 'pending' | 'transferred' | 'failed',
  transferredImageId?: string,
  errorMessage?: string
): Promise<void> {
  const pool = await mysqlPool();
  
  await pool.query(
    `UPDATE playground_pending_image_transfers 
     SET transfer_status = ?, 
         transferred_image_id = ?,
         error_message = ?,
         last_retry_at = ?,
         retry_count = retry_count + 1
     WHERE id = ?`,
    [status, transferredImageId || null, errorMessage || null, Date.now(), transferId]
  );
}

/**
 * 替换任务中的临时 URL 为转存后的 hash ID
 */
export async function replaceTemporaryUrlsInTask(
  taskId: string,
  urlToIdMapping: Record<string, string>
): Promise<void> {
  const pool = await mysqlPool();

  // 获取当前任务
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, user_id, params, input_image_ids, mask_target_image_id, mask_image_id, output_images, output_images_pending, raw_image_urls, stream_partial_image_ids, actual_params_by_image, revised_prompt_by_image, status, error, created_at, finished_at, elapsed
     FROM playground_tasks WHERE id = ?`,
    [taskId]
  );

  if (rows.length === 0) return;

  const task = rows[0];
  const outputImagesPending = task.output_images_pending ? JSON.parse(task.output_images_pending) : [];
  const outputImages = task.output_images ? JSON.parse(task.output_images) : [];
  const rawImageUrls = task.raw_image_urls ? JSON.parse(task.raw_image_urls) : [];
  let actualParamsByImage = task.actual_params_by_image ? JSON.parse(task.actual_params_by_image) : {};
  let revisedPromptByImage = task.revised_prompt_by_image ? JSON.parse(task.revised_prompt_by_image) : {};

  // 替换临时 URL
  let hasChanges = false;
  for (const [tempUrl, imageId] of Object.entries(urlToIdMapping)) {
    const pendingIdx = outputImagesPending.indexOf(tempUrl);
    const outputIdx = outputImages.indexOf(tempUrl);
    const rawIdx = rawImageUrls.indexOf(tempUrl);
    if (pendingIdx >= 0 || outputIdx >= 0 || rawIdx >= 0) {
      if (pendingIdx >= 0) outputImagesPending.splice(pendingIdx, 1);
      if (outputIdx >= 0) outputImages[outputIdx] = imageId;
      else if (!outputImages.includes(imageId)) outputImages.push(imageId);
      if (rawIdx >= 0) rawImageUrls.splice(rawIdx, 1);
      hasChanges = true;

      // 迁移 actualParamsByImage 和 revisedPromptByImage
      if (actualParamsByImage[tempUrl]) {
        actualParamsByImage[imageId] = actualParamsByImage[tempUrl];
        delete actualParamsByImage[tempUrl];
      }
      if (revisedPromptByImage[tempUrl]) {
        revisedPromptByImage[imageId] = revisedPromptByImage[tempUrl];
        delete revisedPromptByImage[tempUrl];
      }
    }
  }

  if (!hasChanges) return;

  // 更新任务
  await pool.query(
    `UPDATE playground_tasks 
     SET output_images = ?, 
         output_images_pending = ?,
         raw_image_urls = ?,
         actual_params_by_image = ?,
         revised_prompt_by_image = ?,
         status = IF(status = 'error', 'done', status),
         error = IF(status = 'error', NULL, error),
         finished_at = IF(finished_at IS NULL, ?, finished_at),
         elapsed = IF(elapsed IS NULL, ? - created_at, elapsed)
     WHERE id = ?`,
    [
      JSON.stringify(outputImages),
      outputImagesPending.length > 0 ? JSON.stringify(outputImagesPending) : null,
      rawImageUrls.length > 0 ? JSON.stringify(rawImageUrls) : null,
      Object.keys(actualParamsByImage).length > 0 ? JSON.stringify(actualParamsByImage) : null,
      Object.keys(revisedPromptByImage).length > 0 ? JSON.stringify(revisedPromptByImage) : null,
      Date.now(),
      Date.now(),
      taskId,
    ]
  );

  await syncTaskImageRefs(pool, taskId, task.user_id, {
    inputImageIds: task.input_image_ids ? JSON.parse(task.input_image_ids) : [],
    maskTargetImageId: task.mask_target_image_id,
    maskImageId: task.mask_image_id,
    outputImages,
    outputImagesPending,
    streamPartialImageIds: task.stream_partial_image_ids ? JSON.parse(task.stream_partial_image_ids) : [],
  });
}

/**
 * 清理过期的待转存记录（转存失败或已转存超过保留期限的记录）
 */
export async function cleanupExpiredTransfers(): Promise<void> {
  const pool = await mysqlPool();
  const expirationTime = Date.now() - TEMP_URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;

  // 删除已转存的记录（超过保留期）
  await pool.query(
    `DELETE FROM playground_pending_image_transfers 
     WHERE transfer_status = 'transferred' 
     AND created_at < ?`,
    [expirationTime]
  );

  // 删除失败次数过多的记录
  await pool.query(
    `DELETE FROM playground_pending_image_transfers 
     WHERE transfer_status = 'failed' 
     AND retry_count >= ?
     AND created_at < ?`,
    [MAX_RETRY_COUNT, expirationTime]
  );
}

/**
 * 获取任务中的所有待转存临时 URL
 */
export async function getPendingUrlsForTask(taskId: string): Promise<string[]> {
  const pool = await mysqlPool();

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT output_images_pending FROM playground_tasks WHERE id = ?`,
    [taskId]
  );

  if (rows.length === 0 || !rows[0].output_images_pending) {
    return [];
  }

  return JSON.parse(rows[0].output_images_pending);
}

/**
 * 在删除任务时清理相关的待转存记录
 */
export async function cleanupPendingTransfersForTask(taskId: string): Promise<void> {
  const pool = await mysqlPool();

  await pool.query(
    `DELETE FROM playground_pending_image_transfers WHERE task_id = ?`,
    [taskId]
  );
}
