import { NextResponse } from 'next/server';
import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { deleteCosObjects } from '@/lib/db/cos';
import { collectTaskRowImageRefs } from '@/lib/db/task-images';
import { RowDataPacket } from 'mysql2';

export const runtime = 'nodejs';

function addTaskImageReferences(target: Set<string>, task: RowDataPacket) {
  for (const ref of collectTaskRowImageRefs(task)) target.add(ref.imageId);
}

function addAppStateImageReferences(target: Set<string>, value: unknown) {
  if (!value || typeof value !== 'object') return;
  const state = value as { inputImages?: unknown; galleryInputDraft?: { inputImages?: unknown } };
  const addInputImages = (images: unknown) => {
    if (!Array.isArray(images)) return;
    for (const image of images) {
      if (image && typeof image === 'object' && typeof (image as { id?: unknown }).id === 'string') {
        target.add((image as { id: string }).id);
      }
    }
  };
  addInputImages(state.inputImages);
  addInputImages(state.galleryInputDraft?.inputImages);
}

function getCosKey(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const apiPrefix = '/api/files/cos/';
  if (value.startsWith(apiPrefix)) return decodeURIComponent(value.slice(apiPrefix.length));
  const uploadIndex = value.indexOf('/uploads/');
  if (uploadIndex >= 0) return decodeURIComponent(value.slice(uploadIndex + 1).split(/[?#]/)[0]);
  if (value.startsWith('uploads/')) return decodeURIComponent(value.split(/[?#]/)[0]);
  return null;
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少任务 ID' }, { status: 400 });
    }

    const pool = await mysqlPool();
    let protectedImageIds: string[] = [];
    try {
      const body = await request.json();
      protectedImageIds = Array.isArray(body?.protectedImageIds)
        ? body.protectedImageIds.filter((item: unknown): item is string => typeof item === 'string')
        : [];
    } catch {
      protectedImageIds = [];
    }

    const [taskImageRows] = await pool.query<RowDataPacket[]>(
      `SELECT image_id FROM playground_task_images WHERE task_id = ? AND user_id = ?`,
      [id, user.id]
    );

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT input_image_ids, mask_target_image_id, mask_image_id, output_images, output_images_pending, stream_partial_image_ids
       FROM playground_tasks WHERE id = ? AND user_id = ? LIMIT 1`,
      [id, user.id]
    );

    const candidateImageIds = new Set<string>(taskImageRows.map((row) => String(row.image_id)));
    if (rows.length > 0) {
      addTaskImageReferences(candidateImageIds, rows[0]);
    }

    if (candidateImageIds.size > 0) {
      const referencedImageIds = new Set(protectedImageIds);
      const [referencedRows] = await pool.query<RowDataPacket[]>(
        `SELECT image_id FROM playground_task_images WHERE user_id = ? AND task_id <> ?`,
        [user.id, id]
      );
      for (const row of referencedRows) referencedImageIds.add(String(row.image_id));

      const [taskRows] = await pool.query<RowDataPacket[]>(
        `SELECT input_image_ids, mask_target_image_id, mask_image_id, output_images, output_images_pending, stream_partial_image_ids
         FROM playground_tasks WHERE user_id = ? AND id <> ?`,
        [user.id, id]
      );
      for (const task of taskRows) addTaskImageReferences(referencedImageIds, task);

      const [stateRows] = await pool.query<RowDataPacket[]>(
        `SELECT value FROM playground_app_state WHERE id = ? AND user_id = ? LIMIT 1`,
        ['gpt-image-playground', user.id]
      );
      if (stateRows.length > 0) {
        try {
          addAppStateImageReferences(referencedImageIds, JSON.parse(stateRows[0].value));
        } catch {
          // Ignore corrupted persisted state; protectedImageIds from the client still cover the active UI.
        }
      }

      const removableImageIds = Array.from(candidateImageIds).filter((imageId) => !referencedImageIds.has(imageId));
      if (removableImageIds.length > 0) {
        await pool.query(
          `DELETE FROM playground_image_owners WHERE user_id = ? AND image_id IN (?)`,
          [user.id, removableImageIds]
        );
        const [ownerRows] = await pool.query<RowDataPacket[]>(
          `SELECT image_id FROM playground_image_owners WHERE image_id IN (?)`,
          [removableImageIds]
        );
        const stillOwnedImageIds = new Set(ownerRows.map((row) => String(row.image_id)));
        const physicallyRemovableImageIds = removableImageIds.filter((imageId) => !stillOwnedImageIds.has(imageId));
        if (physicallyRemovableImageIds.length === 0) {
          await pool.query(
            `DELETE FROM playground_tasks WHERE id = ? AND user_id = ?`,
            [id, user.id]
          );
          return NextResponse.json({ success: true });
        }
        const [imageRows] = await pool.query<RowDataPacket[]>(
          `SELECT i.id, i.data_url, t.thumbnail_data_url
           FROM playground_images i
           LEFT JOIN playground_thumbnails t ON t.id = i.id
           WHERE i.id IN (?)`,
          [physicallyRemovableImageIds]
        );
        const cosKeys = imageRows
          .flatMap((image) => [getCosKey(image.data_url), getCosKey(image.thumbnail_data_url)])
          .filter((key): key is string => Boolean(key));

        await pool.query(`DELETE FROM playground_images WHERE id IN (?)`, [physicallyRemovableImageIds]);
        await pool.query(`DELETE FROM playground_thumbnails WHERE id IN (?)`, [physicallyRemovableImageIds]);
        await deleteCosObjects(cosKeys);
      }
    }

    await pool.query(
      `DELETE FROM playground_tasks WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, '删除任务');
  }
}
