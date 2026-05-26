import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import crypto from 'node:crypto';

type TaskImageRole = 'input' | 'mask-target' | 'mask' | 'output' | 'partial';

export interface TaskImageRef {
  imageId: string;
  role: TaskImageRole;
}

export function getTaskImageIdHash(imageId: string): string {
  return crypto.createHash('sha256').update(imageId).digest('hex');
}

function addImageRefs(target: TaskImageRef[], role: TaskImageRole, value: unknown) {
  if (typeof value === 'string' && value) {
    target.push({ imageId: value, role });
  }
}

function addImageRefList(target: TaskImageRef[], role: TaskImageRole, value: unknown) {
  if (!Array.isArray(value)) return;
  for (const item of value) addImageRefs(target, role, item);
}

export function collectTaskImageRefs(task: Record<string, unknown>): TaskImageRef[] {
  const refs: TaskImageRef[] = [];
  addImageRefList(refs, 'input', task.inputImageIds);
  addImageRefs(refs, 'mask-target', task.maskTargetImageId);
  addImageRefs(refs, 'mask', task.maskImageId);
  addImageRefList(refs, 'output', task.outputImages);
  addImageRefList(refs, 'output', task.outputImagesPending);
  addImageRefList(refs, 'partial', task.streamPartialImageIds);

  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.role}\0${ref.imageId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseJsonImageIdList(value: unknown): string[] {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item))
      : [];
  } catch {
    return [];
  }
}

export function collectTaskRowImageRefs(row: RowDataPacket | Record<string, unknown>): TaskImageRef[] {
  return collectTaskImageRefs({
    inputImageIds: parseJsonImageIdList(row.input_image_ids),
    maskTargetImageId: row.mask_target_image_id,
    maskImageId: row.mask_image_id,
    outputImages: parseJsonImageIdList(row.output_images),
    outputImagesPending: parseJsonImageIdList(row.output_images_pending),
    streamPartialImageIds: parseJsonImageIdList(row.stream_partial_image_ids),
  });
}

export async function syncTaskImageRefs(
  pool: Pool | PoolConnection,
  taskId: string,
  userId: string,
  task: Record<string, unknown>,
) {
  const refs = collectTaskImageRefs(task);
  const now = Date.now();

  await pool.query(
    `DELETE FROM playground_task_images WHERE task_id = ? AND user_id = ?`,
    [taskId, userId],
  );

  if (refs.length === 0) return;

  await pool.query(
    `INSERT IGNORE INTO playground_task_images (task_id, user_id, image_id, image_id_hash, role, created_at)
     VALUES ?`,
    [refs.map((ref) => [taskId, userId, ref.imageId, getTaskImageIdHash(ref.imageId), ref.role, now])],
  );

  for (const ref of refs) {
    await pool.query(
      `INSERT IGNORE INTO playground_image_owners (image_id, user_id, created_at)
       SELECT id, ?, ? FROM playground_images WHERE id = ?`,
      [userId, now, ref.imageId],
    );
  }
}
