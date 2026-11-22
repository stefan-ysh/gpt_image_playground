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

// DragonCode 文档支持的 size 取值：auto + 13 种固定比例
const DRAGON_SUPPORTED_RATIOS: Array<[string, number, number]> = [
  ['1:1', 1, 1],
  ['3:2', 3, 2],
  ['2:3', 2, 3],
  ['4:3', 4, 3],
  ['3:4', 3, 4],
  ['5:4', 5, 4],
  ['4:5', 4, 5],
  ['16:9', 16, 9],
  ['9:16', 9, 16],
  ['2:1', 2, 1],
  ['1:2', 1, 2],
  ['21:9', 21, 9],
  ['9:21', 9, 21],
]

/** 把像素尺寸（1024x1536）/比例字符串/auto 转成文档要求的 size 取值，不在支持列表时吸附到最近比例 */
function toDragonRatioSize(size: string | null | undefined): string {
  const trimmed = (size ?? '').trim()
  if (!trimmed) return '1:1'
  if (trimmed.toLowerCase() === 'auto') return 'auto'
  const match = trimmed.match(/^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/)
  if (!match) return '1:1'
  const target = Number(match[1]) / Number(match[2])
  if (!Number.isFinite(target) || target <= 0) return '1:1'
  let bestLabel = '1:1'
  let bestDelta = Number.POSITIVE_INFINITY
  for (const [label, w, h] of DRAGON_SUPPORTED_RATIOS) {
    const delta = Math.abs(w / h - target) / target
    if (delta < 1e-9) return label
    if (delta < bestDelta) {
      bestDelta = delta
      bestLabel = label
    }
  }
  return bestLabel
}

/** 提交 DragonCode 用的 size：优先使用任务里已换算的 sizeRatio，缺失时（存量任务）自行转换 */
export function resolveDragonSize(params: Record<string, unknown>): string {
  const sizeRatio = params.sizeRatio
  if (typeof sizeRatio === 'string' && sizeRatio.trim()) return sizeRatio.trim()
  const size = typeof params.size === 'string' ? params.size : ''
  return toDragonRatioSize(size)
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
    size: resolveDragonSize(params),
    resolution: params.resolution || '1k',
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

/** 服务商明确拒绝（HTTP 4xx）：请求未被执行、不会创建任务，可安全地直接判失败 */
export class ProviderSubmitRejectedError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'ProviderSubmitRejectedError'
    this.statusCode = statusCode
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
      const message = getErrorMessage(payload, `提交任务失败：HTTP ${response.status}`)
      if (response.status >= 400 && response.status < 500) {
        throw new ProviderSubmitRejectedError(message, response.status)
      }
      throw new Error(message)
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
