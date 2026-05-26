export type TaskStatus =
  | 'created'
  | 'queued'
  | 'submitting'
  | 'submitted'
  | 'polling'
  | 'polling_retryable'
  | 'succeeded_raw'
  | 'storing_images'
  | 'transfer_pending'
  | 'done'
  | 'provider_failed'
  | 'submit_unknown'
  | 'cancelled'

export interface TaskRecord {
  id: string
  status: TaskStatus
  api_provider: string
  provider_task_id?: string | null
  prompt: string
  params_json: string
  created_at: number
  updated_at: number
  poll_attempts: number
  next_poll_at?: number | null
  worker_id?: string | null
  locked_until?: number | null
}