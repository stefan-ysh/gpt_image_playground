import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

const FREEGEN_FETCH_TIMEOUT_MS = 20_000

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function readJsonSafe(res: Response) {
  const text = await res.text()

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function fetchFreegenUpstream(label: string, input: string, init: RequestInit) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FREEGEN_FETCH_TIMEOUT_MS)

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
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

function normalizeFreegenImageData(imageData: string) {
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

  return new Promise<{ image_data?: string; logs: WsMessage[] }>((resolve) => {
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

      try {
        ws.close()
      } catch {
        // ignore close errors
      }

      resolve({ logs })
    }, 60_000)

    function finishSuccess(imageData: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)

      try {
        ws.close()
      } catch {
        // ignore close errors
      }

      resolve({
        image_data: normalizeFreegenImageData(imageData),
        logs,
      })
    }

    ws.addEventListener('open', () => {
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

    ws.addEventListener('message', (event) => {
      try {
        const rawText =
          typeof event.data === 'string'
            ? event.data
            : Buffer.from(event.data as ArrayBuffer).toString('utf-8')

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
          finishSuccess(data.image_data)
        }
      } catch (error) {
        logs.push({
          type: 'message_parse_error',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    })

    ws.addEventListener('error', () => {
      logs.push({
        type: 'ws_error',
        message: 'WebSocket error',
      })
    })

    ws.addEventListener('close', () => {
      logs.push({
        type: 'ws_close',
      })
    })
  })
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return json({ ok: false, error: '请求 JSON 无效' }, 400)
    }

    const prompt = String(body.prompt || '').trim()
    const ratioId = String(body.ratio_id || '1:1')
    const mode = String(body.mode || 'text-to-image')
    const image = typeof body.image === 'string' ? body.image : ''

    if (!prompt) {
      return json({ ok: false, error: 'prompt 不能为空' }, 400)
    }

    const signerRes = await fetchFreegenUpstream('z-image 签名接口', 'https://prompt-signer.freegen.app/', {
      method: 'POST',
      headers: {
        accept: '*/*',
        'content-type': 'application/json',
        origin: 'https://freegen.app',
        referer: 'https://freegen.app/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome Safari/537.36',
      },
      body: JSON.stringify({ prompt }),
    })

    const signerData = (await readJsonSafe(signerRes)) as SignerResponse

    if (!signerRes.ok || !signerData?.ts || !signerData?.sig) {
      return json(
        {
          ok: false,
          step: 'signer',
          status: signerRes.status,
          response: signerData,
        },
        502,
      )
    }

    const generatorPayload: Record<string, unknown> = {
      prompt,
      ts: signerData.ts,
      sig: signerData.sig,
      ratio_id: ratioId,
    }

    if (mode === 'image-to-image' && image) {
      generatorPayload.image_data = image
    }

    const jobRes = await fetchFreegenUpstream('z-image 生成接口', 'https://image-generator.freegen.app/', {
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

    const jobData = (await readJsonSafe(jobRes)) as JobResponse

    if (!jobRes.ok || !jobData?.job_id) {
      return json(
        {
          ok: false,
          step: 'create_job',
          status: jobRes.status,
          response: jobData,
        },
        502,
      )
    }

    const result = await waitImageFromWebSocket(jobData.job_id)

    if (!result.image_data) {
      return json(
        {
          ok: false,
          step: 'websocket',
          job_id: jobData.job_id,
          error: 'WebSocket 没有返回图片结果',
          logs: result.logs,
        },
        504,
      )
    }

    return json({
      ok: true,
      job_id: jobData.job_id,
      image_data: result.image_data,
      logs: result.logs,
    })
  } catch (error) {
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
}
