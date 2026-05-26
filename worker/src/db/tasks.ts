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
  status: TaskStatus
  output_images: string | null
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