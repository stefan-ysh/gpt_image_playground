import WebSocket from 'ws'
import type {
  ProviderAdapter,
  ProviderPollingResult,
  ProviderSubmitResult,
  ProviderTaskInput,
} from './types.js'

type SignerResponse = {
  prompt: string
  ts: number
  sig: string
}

type JobResponse = {
  job_id: string
  res_prompt?: string
  status?: string
}

type WsMessage = {
  type?: string
  message?: string
  image_data?: string
  [key: string]: unknown
}

const SUPPORTED_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
const FREEGEN_FETCH_TIMEOUT_MS = 20_000

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

function getRatioId(size: unknown) {
  const normalized = typeof size === 'string' ? size.trim() : ''
  if (!normalized || normalized === 'auto') return '1:1'
  if ((SUPPORTED_RATIOS as readonly string[]).includes(normalized)) return normalized

  const parsed = parseRatio(normalized)
  if (parsed) return nearestSupportedRatio(parsed.width / parsed.height)

  const sizeMatch = normalized.match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!sizeMatch) return '1:1'

  const width = Number(sizeMatch[1])
  const height = Number(sizeMatch[2])
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? nearestSupportedRatio(width / height)
    : '1:1'
}

function normalizeImageData(imageData: string) {
  const trimmed = imageData.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('data:') || /^https?:\/\//i.test(trimmed)) return trimmed
  return `data:image/png;base64,${trimmed}`
}

function sanitizeWsMessage(data: WsMessage): WsMessage {
  if (typeof data.image_data !== 'string') return data
  return {
    ...data,
    image_data: '[omitted]',
    image_data_length: data.image_data.length,
  }
}

async function readJsonSafe(response: Response) {
  const text = await response.text()

  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const record = payload as Record<string, any>
  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  if (typeof record.error?.message === 'string') return record.error.message
  return fallback
}

async function fetchFreegenUpstream(label: string, input: string, init: RequestInit) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FREEGEN_FETCH_TIMEOUT_MS)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${label}请求超时，请稍后重试。`)
    }

    throw new Error(`${label}连接失败，请稍后重试。`)
  } finally {
    clearTimeout(timeoutId)
  }
}

async function createWebSocketAuth(jobId: string) {
  const timestamp = Math.floor(Date.now() / 1000)
  const message = jobId + timestamp
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(message),
  )
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const authPrefix = Buffer.from(hashHex).toString('base64').substring(0, 20)
  return `${authPrefix}:${timestamp}`
}

async function waitImageFromWebSocket(jobId: string) {
  const auth = await createWebSocketAuth(jobId)

  return new Promise<{ imageData?: string; logs: WsMessage[] }>((resolve) => {
    const logs: WsMessage[] = []
    const ws = new WebSocket('wss://websocket-bridge.freegen.app/ws')
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      logs.push({
        type: 'timeout',
        message: '60 秒内没有收到 result',
      })
      ws.close()
      resolve({ logs })
    }, 60_000)

    function finish(imageData: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ws.close()
      resolve({
        imageData: normalizeImageData(imageData),
        logs,
      })
    }

    ws.on('open', () => {
      const payload = {
        type: 'subscribe',
        job_id: jobId,
        auth,
      }
      logs.push({
        type: 'client_subscribe',
        payload,
      })
      ws.send(JSON.stringify(payload))
    })

    ws.on('message', (raw) => {
      try {
        const rawText = typeof raw === 'string' ? raw : raw.toString('utf-8')
        let data: WsMessage

        try {
          data = JSON.parse(rawText) as WsMessage
        } catch {
          data = {
            type: 'raw_message',
            message: rawText,
          }
        }

        logs.push(sanitizeWsMessage(data))

        if (data.type === 'result' && typeof data.image_data === 'string') {
          finish(data.image_data)
        }
      } catch (error) {
        logs.push({
          type: 'message_parse_error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })

    ws.on('error', () => {
      logs.push({
        type: 'ws_error',
        message: 'WebSocket error',
      })
    })

    ws.on('close', () => {
      logs.push({ type: 'ws_close' })
    })
  })
}

async function createSignedJob(task: ProviderTaskInput) {
  const inputImages = task.inputImageUrls?.filter(Boolean) || []
  if (inputImages.length > 1) {
    throw new Error('z-image 目前最多只支持 1 张参考图，请移除多余图片后重试。')
  }

  const signerResponse = await fetchFreegenUpstream('Freegen 签名接口', 'https://prompt-signer.freegen.app/', {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      origin: 'https://freegen.app',
      referer: 'https://freegen.app/',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome Safari/537.36',
    },
    body: JSON.stringify({ prompt: task.prompt }),
  })
  const signerPayload = await readJsonSafe(signerResponse) as SignerResponse

  if (!signerResponse.ok || !signerPayload?.ts || !signerPayload?.sig) {
    throw new Error(getErrorMessage(signerPayload, `Freegen 签名失败：HTTP ${signerResponse.status}`))
  }

  const generatorPayload: Record<string, unknown> = {
    prompt: task.prompt,
    ts: signerPayload.ts,
    sig: signerPayload.sig,
    ratio_id: getRatioId(task.params.size),
  }

  if (inputImages[0]) {
    generatorPayload.image_data = inputImages[0]
  }

  const jobResponse = await fetchFreegenUpstream('Freegen 生成接口', 'https://image-generator.freegen.app/', {
    method: 'POST',
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      origin: 'https://freegen.app',
      referer: 'https://freegen.app/',
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome Safari/537.36',
    },
    body: JSON.stringify(generatorPayload),
  })
  const jobPayload = await readJsonSafe(jobResponse) as JobResponse

  if (!jobResponse.ok || !jobPayload?.job_id) {
    throw new Error(getErrorMessage(jobPayload, `Freegen 创建任务失败：HTTP ${jobResponse.status}`))
  }

  return jobPayload.job_id
}

export class FreegenZImageProvider implements ProviderAdapter {
  async submit(task: ProviderTaskInput): Promise<ProviderSubmitResult> {
    const jobId = await createSignedJob(task)
    const result = await waitImageFromWebSocket(jobId)

    if (!result.imageData) {
      throw new Error('Freegen WebSocket 没有返回图片结果')
    }

    return {
      providerTaskId: jobId,
      raw: {
        immediateSuccess: true,
        provider: 'freegen-z-image',
        job_id: jobId,
        images: [result.imageData],
        logs: result.logs,
      },
    }
  }

  async poll(): Promise<ProviderPollingResult> {
    return {
      status: 'failed',
      error: 'z-image 结果通过 WebSocket 同步返回，不支持单独轮询。',
      raw: null,
    }
  }
}
