import type { ApiProfile } from '../types'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import { getApiErrorMessage, MIME_MAP, normalizeBase64Image } from './imageApiShared'
import { formatImageRatio } from './size'

const SUPPORTED_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const

type FreegenGenerateResponse = {
  ok: boolean
  image_data?: string
  job_id?: string
  step?: string
  error?: string
  status?: number
  response?: unknown
  logs?: unknown[]
}

function parseRatio(value: string): { width: number; height: number } | null {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null
}

function nearestSupportedRatio(ratio: number) {
  return SUPPORTED_RATIOS
    .map((label) => {
      const parsed = parseRatio(label)
      const value = parsed ? parsed.width / parsed.height : 1
      return {
        label,
        delta: Math.abs(ratio - value) / value,
      }
    })
    .sort((a, b) => a.delta - b.delta)[0]?.label ?? '1:1'
}

export function getFreegenRatioId(size: string) {
  const normalized = size.trim()
  if (!normalized || normalized === 'auto') return '1:1'
  if ((SUPPORTED_RATIOS as readonly string[]).includes(normalized)) return normalized

  const parsed = parseRatio(normalized)
  if (parsed) return nearestSupportedRatio(parsed.width / parsed.height)

  const sizeMatch = normalized.match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!sizeMatch) return '1:1'

  const width = Number(sizeMatch[1])
  const height = Number(sizeMatch[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1:1'

  const friendlyRatio = formatImageRatio(width, height).replace(/^≈/, '')
  if ((SUPPORTED_RATIOS as readonly string[]).includes(friendlyRatio)) return friendlyRatio
  return nearestSupportedRatio(width / height)
}

function getNestedMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, any>
  const candidates = [
    record.error,
    record.message,
    record.detail,
    record.error?.message,
    record.data?.error,
    record.data?.error?.message,
    record.data?.message,
  ]
  const found = candidates.find((item) => typeof item === 'string' && item.trim())
  return found ? String(found).trim() : ''
}

export function getFreegenGenerateErrorMessage(data: Partial<FreegenGenerateResponse> | null | undefined) {
  if (!data || typeof data !== 'object') return 'z-image 请求失败'
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()

  const responseMessage = getNestedMessage(data.response)
  if (responseMessage) return responseMessage

  const lastLogMessage = Array.isArray(data.logs)
    ? data.logs
      .slice()
      .reverse()
      .map(getNestedMessage)
      .find(Boolean)
    : ''
  if (lastLogMessage) return lastLogMessage

  if (data.step === 'signer') return `z-image 签名失败${data.status ? `：HTTP ${data.status}` : ''}`
  if (data.step === 'create_job') return `z-image 创建任务失败${data.status ? `：HTTP ${data.status}` : ''}`
  if (data.step === 'websocket') return 'z-image WebSocket 没有返回图片结果'
  return 'z-image 未返回图片结果'
}

export async function callFreegenImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  if (opts.inputImageDataUrls.length > 1) {
    throw new Error('z-image 目前最多只支持 1 张参考图，请移除多余图片后重试。')
  }

  if (opts.maskDataUrl) {
    throw new Error('z-image 目前不支持单独的 mask 文件；请先在参考图上绘制并保存为一张图片后再生成。')
  }

  const mime = MIME_MAP[opts.params.output_format] || 'image/png'
  const ratioId = getFreegenRatioId(opts.params.size)
  let response: Response

  try {
    response = await fetch('/api/freegen/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        prompt: opts.prompt,
        ratio_id: ratioId,
        mode: opts.inputImageDataUrls.length > 0 ? 'image-to-image' : 'text-to-image',
        image: opts.inputImageDataUrls[0],
      }),
    })
  } catch {
    throw new Error('z-image 请求失败，请检查网络或稍后重试。')
  }

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response))
  }

  const data = await response.json().catch(() => null) as FreegenGenerateResponse | null
  if (!data || typeof data !== 'object') {
    throw new Error('z-image 返回格式异常，请稍后重试。')
  }

  if (!data.ok || !data.image_data) {
    throw new Error(getFreegenGenerateErrorMessage(data))
  }

  return {
    images: [normalizeBase64Image(data.image_data, mime)],
    actualParams: {
      size: ratioId,
      n: 1,
    },
    actualParamsList: [{
      size: ratioId,
      n: 1,
    }],
  }
}
