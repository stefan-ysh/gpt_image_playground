import type {
  ProviderAdapter,
  ProviderPollingResult,
  ProviderSubmitResult,
  ProviderTaskInput,
} from './types.js'
import { config } from '../config.js'

function buildUrl(baseUrl: string, path: string) {
  const base = baseUrl.replace(/\/+$/, '')
  const cleanPath = path.replace(/^\/+/, '')
  return `${base}/${cleanPath}`
}

async function readJsonResponse(response: Response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : null
  } catch {
    return {
      rawText: text,
    }
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback

  const record = payload as Record<string, any>

  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  if (typeof record.error?.message === 'string') return record.error.message
  if (typeof record.data?.error?.message === 'string') {
    return record.data.error.message
  }

  return fallback
}

function normalizeStatus(status: unknown): 'pending' | 'success' | 'failed' {
  const value = typeof status === 'string' ? status.toLowerCase() : ''

  if (value === 'completed' || value === 'complete' || value === 'success' || value === 'succeeded' || value === 'done') {
    return 'success'
  }

  if (value === 'failed' || value === 'error' || value === 'cancelled' || value === 'canceled') {
    return 'failed'
  }

  return 'pending'
}

function extractTaskId(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    throw new Error('服务商提交响应为空')
  }

  const record = payload as Record<string, any>

  const candidates = [
    record.task_id,
    record.id,
    record.data?.task_id,
    record.data?.id,
    Array.isArray(record.data) ? record.data[0]?.task_id : undefined,
    Array.isArray(record.data) ? record.data[0]?.id : undefined,
  ]

  const taskId = candidates.find((item) => {
    return typeof item === 'string' && item.trim()
  })

  if (!taskId) {
    throw new Error(`服务商提交响应中未找到 task_id: ${JSON.stringify(payload)}`)
  }

  return taskId
}

function extractImages(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []

  const record = payload as Record<string, any>

  const imageItems = record.data?.result?.images

  if (!Array.isArray(imageItems)) return []

  const urls: string[] = []

  for (const item of imageItems) {
    if (!item) continue

    if (typeof item === 'string') {
      urls.push(item)
      continue
    }

    if (typeof item.url === 'string') {
      urls.push(item.url)
      continue
    }

    if (Array.isArray(item.url)) {
      for (const url of item.url) {
        if (typeof url === 'string' && url.trim()) {
          urls.push(url)
        }
      }
    }
  }

  return urls
}

function createSubmitPayload(task: ProviderTaskInput) {
  const params = task.params || {}

  const payload: Record<string, unknown> = {
    model: task.apiModel || params.model || 'gpt-image-2',
    prompt: task.prompt,
    n: 1,
    size: params.size || '1:1',
    resolution: params.resolution || '2k',
  }

  if (typeof params.official_fallback === 'boolean') {
    payload.official_fallback = params.official_fallback
  }

  const inputImages = task.inputImageUrls?.filter(Boolean) || []

  if (inputImages.length > 0) {
    payload.image_urls = inputImages.slice(0, 16)
  }

  return payload
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export class GptImage2AsyncProvider implements ProviderAdapter {
  async submit(task: ProviderTaskInput): Promise<ProviderSubmitResult> {
    if (!task.apiBaseUrl) {
      throw new Error('缺少 apiBaseUrl')
    }

    if (!task.apiKey) {
      throw new Error('缺少 apiKey')
    }

    const url = buildUrl(task.apiBaseUrl, 'images/generations')

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${task.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(createSubmitPayload(task)),
    }, config.providerSubmitTimeoutMs)

    const payload = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          payload,
          `提交任务失败：HTTP ${response.status}`,
        ),
      )
    }

    const taskId = extractTaskId(payload)

    return {
      providerTaskId: taskId,
      raw: payload,
    }
  }

  async poll(task: ProviderTaskInput): Promise<ProviderPollingResult> {
    if (!task.apiBaseUrl) {
      throw new Error('缺少 apiBaseUrl')
    }

    if (!task.apiKey) {
      throw new Error('缺少 apiKey')
    }

    if (!task.providerTaskId) {
      throw new Error('缺少 providerTaskId')
    }

    const url = buildUrl(
      task.apiBaseUrl,
      `tasks/${encodeURIComponent(task.providerTaskId)}`,
    )

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${task.apiKey}`,
      },
    }, config.providerPollTimeoutMs)

    const payload = await readJsonResponse(response)

    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          payload,
          `查询任务失败：HTTP ${response.status}`,
        ),
      )
    }

    const data =
      payload && typeof payload === 'object'
        ? (payload as Record<string, any>).data
        : null

    const status = normalizeStatus(data?.status)
    const progress =
      typeof data?.progress === 'number'
        ? data.progress
        : null

    const cost =
      typeof data?.cost === 'number'
        ? data.cost
        : null

    if (status === 'failed') {
      return {
        status: 'failed',
        progress,
        cost,
        error: getErrorMessage(payload, '服务商任务失败'),
        raw: payload,
      }
    }

    if (status === 'success') {
      const images = extractImages(payload)

      if (images.length === 0) {
        return {
          status: 'failed',
          progress,
          cost,
          error: '服务商任务已完成，但未返回图片 URL',
          raw: payload,
        }
      }

      return {
        status: 'success',
        images,
        progress,
        cost,
        raw: payload,
      }
    }

    return {
      status: 'pending',
      progress,
      cost,
      raw: payload,
    }
  }
}
