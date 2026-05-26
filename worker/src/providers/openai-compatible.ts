import type {
  ProviderAdapter,
  ProviderPollingResult,
  ProviderSubmitResult,
  ProviderTaskInput,
} from './types.js'
import { getAllByPath, getByPath } from '../utils/json-path.js'

function assertString(value: unknown, message: string): string {
  if (typeof value === 'string' && value.trim()) return value
  throw new Error(message)
}

function toStringArray(values: unknown[]): string[] {
  return values.filter((item): item is string => {
    return typeof item === 'string' && item.trim().length > 0
  })
}

function normalizeProviderStatus(value: unknown) {
  const status = typeof value === 'string' ? value.toLowerCase() : ''

  if (
    status === 'success' ||
    status === 'succeeded' ||
    status === 'completed' ||
    status === 'done'
  ) {
    return 'success' as const
  }

  if (
    status === 'failed' ||
    status === 'error' ||
    status === 'cancelled' ||
    status === 'canceled'
  ) {
    return 'failed' as const
  }

  return 'pending' as const
}

function buildUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const cleanPath = path.replace(/^\/+/, '')
  return `${base}/${cleanPath}`
}

function readCustomPath(
  snapshot: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
) {
  const value = snapshot?.[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function readCustomJsonPath(
  snapshot: Record<string, unknown> | null | undefined,
  key: string,
  fallback: string,
) {
  const value = snapshot?.[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function createHeaders(task: ProviderTaskInput) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${task.apiKey}`,
  }
}

function createSubmitPayload(task: ProviderTaskInput) {
  return {
    model: task.apiModel || task.params.model || 'gpt-image-2',
    prompt: task.prompt,
    ...task.params,
    client_task_id: task.id,
    idempotency_key: `${task.id}:1`,
  }
}

export class OpenAICompatibleProvider implements ProviderAdapter {
  async submit(task: ProviderTaskInput): Promise<ProviderSubmitResult> {
    const submitPath = readCustomPath(
      task.customProviderSnapshot,
      'submitPath',
      'images/generations',
    )

    const taskIdPath = readCustomJsonPath(
      task.customProviderSnapshot,
      'taskIdPath',
      'task_id',
    )

    const imagePath = readCustomJsonPath(
      task.customProviderSnapshot,
      'imagePath',
      'data.*.url',
    )

    const url = buildUrl(task.apiBaseUrl, submitPath)

    const response = await fetch(url, {
      method: 'POST',
      headers: createHeaders(task),
      body: JSON.stringify(createSubmitPayload(task)),
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(
        `Provider submit failed: ${response.status} ${JSON.stringify(payload)}`,
      )
    }

    const taskId = getByPath(payload, taskIdPath)

    if (typeof taskId === 'string' && taskId.trim()) {
      return {
        providerTaskId: taskId,
        raw: payload,
      }
    }

    // 兼容同步返回图片的 Images API。
    const images = toStringArray(getAllByPath(payload, imagePath))

    if (images.length > 0) {
      return {
        providerTaskId: `sync:${task.id}`,
        raw: {
          immediateSuccess: true,
          images,
          payload,
        },
      }
    }

    // 常见 fallback
    const fallbackTaskId =
      getByPath(payload, 'id') ||
      getByPath(payload, 'data.task_id') ||
      getByPath(payload, 'data.id')

    return {
      providerTaskId: assertString(
        fallbackTaskId,
        'Provider submit response does not contain task id or image result',
      ),
      raw: payload,
    }
  }

  async poll(task: ProviderTaskInput): Promise<ProviderPollingResult> {
    if (!task.providerTaskId) {
      throw new Error('Missing providerTaskId')
    }

    if (task.providerTaskId.startsWith('sync:')) {
      return {
        status: 'success',
        images: [],
        raw: {
          sync: true,
        },
      }
    }

    const pollPathTemplate = readCustomPath(
      task.customProviderSnapshot,
      'pollPath',
      'tasks/{task_id}',
    )

    const statusPath = readCustomJsonPath(
      task.customProviderSnapshot,
      'statusPath',
      'status',
    )

    const imagePath = readCustomJsonPath(
      task.customProviderSnapshot,
      'resultImagePath',
      'data.images.*',
    )

    const errorPath = readCustomJsonPath(
      task.customProviderSnapshot,
      'errorPath',
      'error',
    )

    const pollPath = pollPathTemplate.replace(
      /\{task_id\}/g,
      encodeURIComponent(task.providerTaskId),
    )

    const response = await fetch(buildUrl(task.apiBaseUrl, pollPath), {
      method: 'GET',
      headers: createHeaders(task),
    })

    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      throw new Error(
        `Provider polling failed: ${response.status} ${JSON.stringify(payload)}`,
      )
    }

    const status = normalizeProviderStatus(getByPath(payload, statusPath))
    const images = toStringArray(getAllByPath(payload, imagePath))

    const errorRaw = getByPath(payload, errorPath)
    const error =
      typeof errorRaw === 'string'
        ? errorRaw
        : errorRaw
          ? JSON.stringify(errorRaw)
          : undefined

    if (status === 'success') {
      return {
        status: 'success',
        images,
        raw: payload,
      }
    }

    if (status === 'failed') {
      return {
        status: 'failed',
        error,
        raw: payload,
      }
    }

    return {
      status: 'pending',
      raw: payload,
    }
  }
}