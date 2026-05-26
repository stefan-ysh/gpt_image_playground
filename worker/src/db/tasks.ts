import { pool } from './pool.js'
import type { TaskStatus } from '../types.js'

export interface DbTask {
  id: string
  user_id: string
  prompt: string
  params: string | null
  api_provider: string | null
  api_model: string | null
  api_mode: string | null
  api_profile_snapshot: string | null
  custom_provider_snapshot: string | null

  provider_task_id: string | null
  provider_result_raw: string | null
  provider_status: string | null
  last_provider_payload: string | null
  last_provider_error: string | null

  input_image_ids: string | null
  mask_target_image_id: string | null
  mask_image_id: string | null

  status: TaskStatus
  output_images: string | null
  output_images_pending: string | null
  raw_image_urls: string | null
  raw_response_payload: string | null

  cost: number | null
  created_at: number
  finished_at: number | null
  elapsed: number | null

  poll_attempts: number
  next_poll_at: number | null
  worker_id: string | null
  locked_until: number | null
}

export async function pickRunnableTasks(limit = 5) {
  const now = Date.now()

  const [rows] = await pool.query(
    `
    SELECT *
    FROM playground_tasks
    WHERE status IN (
      'created',
      'queued',
      'submit_unknown',
      'polling',
      'polling_retryable',
      'succeeded_raw',
      'transfer_pending'
    )
    AND (
      next_poll_at IS NULL
      OR next_poll_at <= ?
    )
    AND (
      locked_until IS NULL
      OR locked_until < ?
    )
    ORDER BY created_at ASC
    LIMIT ?
    `,
    [now, now, limit],
  )

  return rows as DbTask[]
}

export async function lockTask(
  taskId: string,
  workerId: string,
  lockUntil: number,
) {
  const now = Date.now()

  const [result] = await pool.query(
    `
    UPDATE playground_tasks
    SET worker_id = ?,
        locked_until = ?
    WHERE id = ?
      AND (
        locked_until IS NULL
        OR locked_until < ?
      )
    `,
    [workerId, lockUntil, taskId, now],
  )

  return (result as any).affectedRows > 0
}

export async function releaseTask(taskId: string, workerId: string) {
  await pool.query(
    `
    UPDATE playground_tasks
    SET worker_id = NULL,
        locked_until = NULL
    WHERE id = ?
      AND worker_id = ?
    `,
    [taskId, workerId],
  )
}

export async function updateTask(
  taskId: string,
  patch: Record<string, unknown>,
) {
  const entries = Object.entries(patch)

  if (entries.length === 0) return

  const fields = entries.map(([key]) => `${key} = ?`)
  const values = entries.map(([, value]) => value)

  await pool.query(
    `
    UPDATE playground_tasks
    SET ${fields.join(', ')}
    WHERE id = ?
    `,
    [...values, taskId],
  )
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  patch: Record<string, unknown> = {},
) {
  await updateTask(taskId, {
    ...patch,
    status,
  })
}

export async function getTaskById(taskId: string) {
  const [rows] = await pool.query(
    `
    SELECT *
    FROM playground_tasks
    WHERE id = ?
    LIMIT 1
    `,
    [taskId],
  )

  return (rows as DbTask[])[0] ?? null
}

function isDirectImageValue(value: string) {
  return (
    value.startsWith('data:') ||
    /^https?:\/\//i.test(value) ||
    value.startsWith('/api/files/cos/') ||
    value.startsWith('uploads/')
  )
}

export async function getImageDataUrlsByIds(imageIds: string[]) {
  if (imageIds.length === 0) return []

  const directValues = imageIds.filter(isDirectImageValue)
  const dbIds = imageIds.filter((id) => !isDirectImageValue(id))

  if (dbIds.length === 0) {
    return directValues
  }

  const placeholders = dbIds.map(() => '?').join(',')

  const [rows] = await pool.query(
    `
    SELECT id, data_url
    FROM playground_images
    WHERE id IN (${placeholders})
    `,
    dbIds,
  )

  const map = new Map(
    (rows as Array<{ id: string; data_url: string }>).map((row) => [
      row.id,
      row.data_url,
    ]),
  )

  const resolvedDbUrls = dbIds
    .map((id) => map.get(id))
    .filter((url): url is string => {
      return typeof url === 'string' && url.trim().length > 0
    })

  return [...directValues, ...resolvedDbUrls]
}