import { NextResponse } from 'next/server'
import { RowDataPacket } from 'mysql2'
import { requireCurrentUser } from '@/lib/db/auth'
import { mysqlPool } from '@/lib/db/mysql'
import { ensurePlaygroundSchema } from '@/lib/db/schema'
import { handleApiError } from '@/lib/api-error'
import type { TaskRecord } from '@/types'

export const runtime = 'nodejs'

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function rowToTask(row: RowDataPacket): TaskRecord {
  return {
    id: row.id,
    prompt: row.prompt,
    params: safeJsonParse(row.params, {
      size: 'auto',
      resolution: '1k',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
    }),

    apiProvider: row.api_provider ?? undefined,
    apiProfileId: row.api_profile_id ?? undefined,
    apiProfileName: row.api_profile_name ?? undefined,
    apiMode: row.api_mode ?? undefined,
    apiModel: row.api_model ?? undefined,
    apiProfileSnapshot: safeJsonParse(row.api_profile_snapshot, undefined),
    customProviderSnapshot: safeJsonParse(row.custom_provider_snapshot, undefined),

    falRequestId: row.fal_request_id ?? undefined,
    falEndpoint: row.fal_endpoint ?? undefined,
    falRecoverable: Boolean(row.fal_recoverable),
    customTaskId: row.custom_task_id ?? undefined,
    customRecoverable: Boolean(row.custom_recoverable),

    providerTaskId: row.provider_task_id ?? null,
    providerStatus: row.provider_status ?? null,
    submitStatus: row.submit_status ?? null,
    runAttempt: Number(row.run_attempt ?? 1),
    pollAttempts: Number(row.poll_attempts ?? 0),
    manualSyncAttempts: Number(row.manual_sync_attempts ?? 0),
    lastPollAt: row.last_poll_at == null ? null : Number(row.last_poll_at),
    nextPollAt: row.next_poll_at == null ? null : Number(row.next_poll_at),
    submittedAt: row.submitted_at == null ? null : Number(row.submitted_at),
    providerFinishedAt:
      row.provider_finished_at == null ? null : Number(row.provider_finished_at),
    externalTaskExpiresAt:
      row.external_task_expires_at == null
        ? null
        : Number(row.external_task_expires_at),
    workerId: row.worker_id ?? null,
    lockedUntil: row.locked_until == null ? null : Number(row.locked_until),
    lastProviderPayload: row.last_provider_payload ?? null,
    lastProviderError: row.last_provider_error ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    providerResultRaw: row.provider_result_raw ?? null,
    copiedFromTaskId: row.copied_from_task_id ?? null,

    actualParams: safeJsonParse(row.actual_params, undefined),
    actualParamsByImage: safeJsonParse(row.actual_params_by_image, undefined),
    revisedPromptByImage: safeJsonParse(row.revised_prompt_by_image, undefined),

    inputImageIds: safeJsonParse(row.input_image_ids, []),
    maskTargetImageId: row.mask_target_image_id ?? null,
    maskImageId: row.mask_image_id ?? null,

    outputImages: safeJsonParse(row.output_images, []),
    outputImagesPending: safeJsonParse(row.output_images_pending, undefined),
    streamPartialImageIds: safeJsonParse(row.stream_partial_image_ids, undefined),
    rawImageUrls: safeJsonParse(row.raw_image_urls, undefined),
    rawResponsePayload: row.raw_response_payload ?? undefined,

    status: row.status,
    error: row.error ?? null,
    createdAt: Number(row.created_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    elapsed: row.elapsed == null ? null : Number(row.elapsed),
    isFavorite: Boolean(row.is_favorite),
    groupId: row.group_id ?? undefined,
    ownerFingerprint: row.owner_fingerprint ?? undefined,
    cost: row.cost == null ? undefined : Number(row.cost),
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  try {
    const user = await requireCurrentUser()
    await ensurePlaygroundSchema()

    const params = await Promise.resolve(context.params)
    const taskId = params.id

    const pool = await mysqlPool()

    const [rows] = await pool.query<RowDataPacket[]>(
      `
      SELECT *
      FROM playground_tasks
      WHERE id = ?
        AND user_id = ?
      LIMIT 1
      `,
      [taskId, user.id],
    )

    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: '任务不存在',
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      success: true,
      data: rowToTask(rows[0]),
    })
  } catch (error) {
    return handleApiError(error, '读取任务')
  }
}