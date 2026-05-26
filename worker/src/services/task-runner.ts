import type { DbTask } from '../db/tasks.js'
import { updateTaskStatus } from '../db/tasks.js'
import { getProvider } from '../providers/index.js'
import { getNextBackoffMs } from '../utils/backoff.js'
import { notifyTaskUpdated } from './notifier.js'
import { processSucceededRawTask } from './image-transfer.js'
import { getImageDataUrlsByIds } from '../db/tasks.js'

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function getApiProfile(task: DbTask) {
  return safeJsonParse<Record<string, unknown>>(task.api_profile_snapshot, {})
}

function getCustomProviderSnapshot(task: DbTask) {
  return safeJsonParse<Record<string, unknown>>(
    task.custom_provider_snapshot,
    {},
  )
}

function normalizeProviderInputImageUrl(url: string) {
  if (url.startsWith('data:')) return url
  if (/^https?:\/\//i.test(url)) return url

  if (url.startsWith('/api/files/cos/')) {
    const publicBase = process.env.PUBLIC_APP_ORIGIN || process.env.NEXT_PUBLIC_APP_ORIGIN
    if (!publicBase) {
      throw new Error('参考图是相对路径，但缺少 PUBLIC_APP_ORIGIN，无法提供给服务商访问')
    }
    return `${publicBase.replace(/\/+$/, '')}${url}`
  }

  return url
}

async function toProviderTaskInput(task: DbTask) {
  const params = safeJsonParse<Record<string, unknown>>(task.params, {})
  const profile = getApiProfile(task)

  const apiBaseUrl =
    typeof profile.baseUrl === 'string'
      ? profile.baseUrl
      : typeof profile.base_url === 'string'
        ? profile.base_url
        : ''

  const apiKey =
    typeof profile.apiKey === 'string'
      ? profile.apiKey
      : typeof profile.api_key === 'string'
        ? profile.api_key
        : ''

  const inputImageIds = safeJsonParse<string[]>(task.input_image_ids, [])
  const inputImageUrls = (await getImageDataUrlsByIds(inputImageIds))
  .map(normalizeProviderInputImageUrl)

  return {
    id: task.id,
    prompt: task.prompt,
    params,
    apiProvider: task.api_provider || 'custom',
    apiModel: task.api_model,
    apiMode: task.api_mode,
    apiBaseUrl,
    apiKey,
    providerTaskId: task.provider_task_id,
    customProviderSnapshot: getCustomProviderSnapshot(task),
    inputImageUrls,
  }
}

function isSubmitStatus(status: string) {
  return status === 'created' || status === 'queued' || status === 'submit_unknown'
}

export async function runTask(task: DbTask) {
  if (task.status === 'done' || task.status === 'provider_failed') {
    return
  }

  if (isSubmitStatus(task.status) && !task.provider_task_id) {
    await submitProviderTask(task)
    return
  }

  if (task.status === 'polling' || task.status === 'polling_retryable') {
    await pollProviderTask(task)
    return
  }

  if (task.status === 'succeeded_raw' || task.status === 'transfer_pending') {
    await processSucceededRawTask(task)
  }
}

async function submitProviderTask(task: DbTask) {
  const provider = getProvider(task.api_provider || 'openai')
  const input = await toProviderTaskInput(task)

  await updateTaskStatus(task.id, 'submitting', {
    last_provider_error: null,
  })
  await notifyTaskUpdated(task.id, 'submitting')

  try {
    const result = await provider.submit(input)

    const rawString = JSON.stringify(result.raw)

    const immediateRaw =
      result.raw &&
        typeof result.raw === 'object' &&
        'immediateSuccess' in result.raw
        ? (result.raw as any)
        : null

    if (immediateRaw?.immediateSuccess) {
      await updateTaskStatus(task.id, 'succeeded_raw', {
        provider_task_id: result.providerTaskId,
        provider_result_raw: rawString,
        last_provider_payload: rawString,
        submitted_at: Date.now(),
      })

      await notifyTaskUpdated(task.id, 'succeeded_raw')
      return
    }

    await updateTaskStatus(task.id, 'polling', {
      provider_task_id: result.providerTaskId,
      submitted_at: Date.now(),
      last_provider_payload: rawString,
      poll_attempts: 0,
      next_poll_at: Date.now() + 3000,
    })

    await notifyTaskUpdated(task.id, 'polling')
  } catch (error) {
    await updateTaskStatus(task.id, 'submit_unknown', {
      last_provider_error:
        error instanceof Error ? error.message : String(error),
      next_poll_at: Date.now() + 30000,
    })

    await notifyTaskUpdated(task.id, 'submit_unknown')
  }
}

async function pollProviderTask(task: DbTask) {
  const provider = getProvider(task.api_provider || 'openai')
  const input = await toProviderTaskInput(task)

  try {
    const result = await provider.poll(input)
    const rawString = JSON.stringify(result.raw)

    if (result.status === 'pending') {
      const attempts = Number(task.poll_attempts || 0) + 1

      await updateTaskStatus(task.id, 'polling', {
        poll_attempts: attempts,
        last_poll_at: Date.now(),
        next_poll_at: Date.now() + getNextBackoffMs(attempts),
        last_provider_payload: rawString,
      })

      await notifyTaskUpdated(task.id, 'polling')
      return
    }

    if (result.status === 'failed') {
      await updateTaskStatus(task.id, 'provider_failed', {
        last_poll_at: Date.now(),
        finished_at: Date.now(),
        elapsed: Date.now() - Number(task.created_at),
        last_provider_error: result.error || 'Provider failed',
        last_provider_payload: rawString,
        raw_response_payload: rawString,
      })

      await notifyTaskUpdated(task.id, 'provider_failed')
      return
    }

    if (result.status === 'success') {
      await updateTaskStatus(task.id, 'succeeded_raw', {
        last_poll_at: Date.now(),
        provider_finished_at: Date.now(),
        cost: result.cost ?? null,
        provider_result_raw: JSON.stringify({
          images: result.images || [],
          cost: result.cost ?? null,
          progress: result.progress ?? null,
          payload: result.raw,
        }),
        last_provider_payload: rawString,
      })

      await notifyTaskUpdated(task.id, 'succeeded_raw')
    }
  } catch (error) {
    const attempts = Number(task.poll_attempts || 0) + 1

    await updateTaskStatus(task.id, 'polling_retryable', {
      poll_attempts: attempts,
      last_poll_at: Date.now(),
      next_poll_at: Date.now() + getNextBackoffMs(attempts),
      last_provider_error:
        error instanceof Error ? error.message : String(error),
    })

    await notifyTaskUpdated(task.id, 'polling_retryable')
  }
}