import { NextResponse } from 'next/server';
import { requireCurrentUser } from '@/lib/db/auth';
import { mysqlPool } from '@/lib/db/mysql';
import { ensurePlaygroundSchema } from '@/lib/db/schema';
import { handleApiError } from '@/lib/api-error';
import { RowDataPacket } from 'mysql2';
import type { PoolConnection } from 'mysql2/promise';
import { APIMART_PROVIDER_DEFINITION, APIMART_PROVIDER_ID } from '@/lib/apiProfiles';
import { syncTaskImageRefs } from '@/lib/db/task-images';
import { assertDailyImageLimit, isDailyImageLimitError } from '@/lib/db/daily-limit';

export const runtime = 'nodejs';

function parseJson(str: string | null): any {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function rowToTaskRecord(row: any) {
  const apiProfileSnapshot = parseJson(row.api_profile_snapshot);
  const apiProvider = row.api_provider || apiProfileSnapshot?.provider || (row.custom_task_id && row.api_model === 'gpt-image-2' ? APIMART_PROVIDER_ID : undefined);
  return {
    id: row.id,
    prompt: row.prompt,
    params: parseJson(row.params),
    apiProvider,
    apiProfileId: row.api_profile_id || apiProfileSnapshot?.id,
    apiProfileName: row.api_profile_name || apiProfileSnapshot?.name,
    apiMode: row.api_mode || apiProfileSnapshot?.apiMode,
    apiModel: row.api_model,
    apiProfileSnapshot,
    customProviderSnapshot: parseJson(row.custom_provider_snapshot) || (apiProvider === APIMART_PROVIDER_ID ? APIMART_PROVIDER_DEFINITION : undefined),
    falRequestId: row.fal_request_id,
    falEndpoint: row.fal_endpoint,
    falRecoverable: row.fal_recoverable === 1,
    customTaskId: row.custom_task_id,
    customRecoverable: row.custom_recoverable === 1,
    actualParams: parseJson(row.actual_params),
    actualParamsByImage: parseJson(row.actual_params_by_image),
    revisedPromptByImage: parseJson(row.revised_prompt_by_image),
    inputImageIds: parseJson(row.input_image_ids) || [],
    maskTargetImageId: row.mask_target_image_id,
    maskImageId: row.mask_image_id,
    outputImages: parseJson(row.output_images) || [],
    outputImagesPending: parseJson(row.output_images_pending) || undefined,
    streamPartialImageIds: parseJson(row.stream_partial_image_ids),
    rawImageUrls: parseJson(row.raw_image_urls),
    rawResponsePayload: row.raw_response_payload,
    status: row.status,
    error: row.error,
    createdAt: Number(row.created_at),
    finishedAt: row.finished_at ? Number(row.finished_at) : null,
    elapsed: row.elapsed,
    isFavorite: row.is_favorite === 1,
    groupId: row.group_id || undefined,
    ownerFingerprint: row.owner_fingerprint,
    cost: row.cost !== null && row.cost !== undefined ? Number(row.cost) : null,
  };
}

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const searchParams = new URL(request.url).searchParams;
    const groupId = searchParams.get('groupId');
    const favorite = searchParams.get('favorite');
    const pageVal = Number(searchParams.get('page')) || 1;
    const limitVal = Number(searchParams.get('limit')) || 20;

    const page = Math.max(1, pageVal);
    const limit = Math.max(1, Math.min(100, limitVal));
    const offset = (page - 1) * limit;

    let query = `SELECT * FROM playground_tasks WHERE user_id = ?`;
    const params: any[] = [user.id];

    if (groupId) {
      if (groupId === 'unassigned') {
        query += ` AND group_id IS NULL`;
      } else {
        query += ` AND group_id = ?`;
        params.push(groupId);
      }
    }

    if (favorite === 'true') {
      query += ` AND is_favorite = 1`;
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit + 1, offset);

    const pool = await mysqlPool();
    const [rows] = await pool.query<RowDataPacket[]>(query, params);

    const hasMore = rows.length > limit;
    const records = hasMore ? rows.slice(0, limit) : rows;
    const tasks = records.map(rowToTaskRecord);

    return NextResponse.json({
      success: true,
      data: tasks,
      pagination: {
        page,
        limit,
        hasMore,
      }
    });
  } catch (error) {
    return handleApiError(error, '获取任务列表');
  }
}

export async function POST(request: Request) {
  let conn: PoolConnection | null = null;
  try {
    const user = await requireCurrentUser();
    await ensurePlaygroundSchema();

    const { task } = await request.json();
    if (!task || !task.id) {
      return NextResponse.json({ success: false, error: '无效的任务数据' }, { status: 400 });
    }

    const pool = await mysqlPool();
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [existingRows] = await conn.query<RowDataPacket[]>(
      `SELECT id
       FROM playground_tasks
       WHERE id = ? AND user_id = ?
       LIMIT 1
       FOR UPDATE`,
      [task.id, user.id]
    );
    const existingTask = existingRows[0];

    if (
      !existingTask &&
      (
        task.status === 'running' ||
        task.status === 'created' ||
        task.status === 'queued' ||
        task.status === 'submitting' ||
        task.status === 'submitted' ||
        task.status === 'polling' ||
        task.status === 'polling_retryable' ||
        task.status === 'succeeded_raw' ||
        task.status === 'storing_images' ||
        task.status === 'transfer_pending' ||
        task.status === 'submit_unknown'
      )
    ) {
      await assertDailyImageLimit(conn, user, task);
    }

    await conn.query(
      `INSERT INTO playground_tasks (
        id, user_id, prompt, params, api_provider, api_profile_id, api_profile_name,
        api_mode, api_model, api_profile_snapshot, custom_provider_snapshot,
        fal_request_id, fal_endpoint, fal_recoverable, custom_task_id, custom_recoverable,
        actual_params, actual_params_by_image, revised_prompt_by_image, input_image_ids,
        mask_target_image_id, mask_image_id, output_images, output_images_pending, stream_partial_image_ids,
        raw_image_urls, raw_response_payload, status, error, created_at, finished_at, elapsed,
        is_favorite, group_id, owner_fingerprint, cost
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        prompt = VALUES(prompt),
        params = VALUES(params),
        api_provider = VALUES(api_provider),
        api_profile_id = VALUES(api_profile_id),
        api_profile_name = VALUES(api_profile_name),
        api_mode = VALUES(api_mode),
        api_model = VALUES(api_model),
        api_profile_snapshot = VALUES(api_profile_snapshot),
        custom_provider_snapshot = VALUES(custom_provider_snapshot),
        fal_request_id = VALUES(fal_request_id),
        fal_endpoint = VALUES(fal_endpoint),
        fal_recoverable = VALUES(fal_recoverable),
        custom_task_id = VALUES(custom_task_id),
        custom_recoverable = VALUES(custom_recoverable),
        actual_params = VALUES(actual_params),
        actual_params_by_image = VALUES(actual_params_by_image),
        revised_prompt_by_image = VALUES(revised_prompt_by_image),
        input_image_ids = VALUES(input_image_ids),
        mask_target_image_id = VALUES(mask_target_image_id),
        mask_image_id = VALUES(mask_image_id),
        output_images = VALUES(output_images),
        output_images_pending = VALUES(output_images_pending),
        stream_partial_image_ids = VALUES(stream_partial_image_ids),
        raw_image_urls = VALUES(raw_image_urls),
        raw_response_payload = VALUES(raw_response_payload),
        status = VALUES(status),
        error = VALUES(error),
        finished_at = VALUES(finished_at),
        elapsed = VALUES(elapsed),
        is_favorite = VALUES(is_favorite),
        group_id = VALUES(group_id),
        owner_fingerprint = VALUES(owner_fingerprint),
        cost = VALUES(cost)`,
      [
        task.id,
        user.id,
        task.prompt,
        JSON.stringify(task.params),
        task.apiProvider || task.apiProfileSnapshot?.provider || null,
        task.apiProfileId || task.apiProfileSnapshot?.id || null,
        task.apiProfileName || task.apiProfileSnapshot?.name || null,
        task.apiMode || task.apiProfileSnapshot?.apiMode || null,
        task.apiModel || null,
        task.apiProfileSnapshot ? JSON.stringify(task.apiProfileSnapshot) : null,
        task.customProviderSnapshot ? JSON.stringify(task.customProviderSnapshot) : null,
        task.falRequestId || null,
        task.falEndpoint || null,
        task.falRecoverable ? 1 : 0,
        task.customTaskId || null,
        task.customRecoverable ? 1 : 0,
        task.actualParams ? JSON.stringify(task.actualParams) : null,
        task.actualParamsByImage ? JSON.stringify(task.actualParamsByImage) : null,
        task.revisedPromptByImage ? JSON.stringify(task.revisedPromptByImage) : null,
        JSON.stringify(task.inputImageIds),
        task.maskTargetImageId || null,
        task.maskImageId || null,
        JSON.stringify(task.outputImages),
        task.outputImagesPending?.length ? JSON.stringify(task.outputImagesPending) : null,
        task.streamPartialImageIds ? JSON.stringify(task.streamPartialImageIds) : null,
        task.rawImageUrls ? JSON.stringify(task.rawImageUrls) : null,
        task.rawResponsePayload || null,
        task.status,
        task.error || null,
        task.createdAt,
        task.finishedAt || null,
        task.elapsed || null,
        task.isFavorite ? 1 : 0,
        task.groupId || null,
        task.ownerFingerprint || null,
        task.cost !== undefined ? task.cost : null
      ]
    );

    await syncTaskImageRefs(conn, task.id, user.id, task as Record<string, unknown>);
    await conn.commit();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (rollbackError) {
        console.error('回滚任务保存事务失败:', rollbackError);
      }
    }
    if (isDailyImageLimitError(error)) {
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error('保存任务出错:', error);
    return handleApiError(error, '保存任务');
  } finally {
    conn?.release();
  }
}
