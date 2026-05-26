import COS from 'cos-nodejs-sdk-v5'
import { config } from '../config.js'

function assertCosConfig() {
  if (
    !config.cos.secretId ||
    !config.cos.secretKey ||
    !config.cos.bucket ||
    !config.cos.region
  ) {
    throw new Error(
      'COS 配置不完整，请检查 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION',
    )
  }
}

function getCosInstance() {
  assertCosConfig()

  return new COS({
    SecretId: config.cos.secretId,
    SecretKey: config.cos.secretKey,
  })
}

export function isCosConfigured() {
  return Boolean(
    config.cos.secretId &&
      config.cos.secretKey &&
      config.cos.bucket &&
      config.cos.region,
  )
}

export async function uploadBufferToCos(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<string> {
  assertCosConfig()

  const cos = getCosInstance()

  await new Promise<void>((resolve, reject) => {
    cos.putObject(
      {
        Bucket: config.cos.bucket,
        Region: config.cos.region,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      },
      (err) => {
        if (err) {
          reject(err)
          return
        }

        resolve()
      },
    )
  })

  if (config.cos.publicBaseUrl.trim()) {
    return `${config.cos.publicBaseUrl.replace(/\/+$/, '')}/${key}`
  }

  return `/api/files/cos/${key}`
}

export async function readBufferFromCos(key: string): Promise<Buffer> {
  assertCosConfig()

  const cos = getCosInstance()

  const data = await new Promise<{ Body?: Buffer | string | Uint8Array }>(
    (resolve, reject) => {
      cos.getObject(
        {
          Bucket: config.cos.bucket,
          Region: config.cos.region,
          Key: key,
        },
        (err, result) => {
          if (err) {
            reject(err)
            return
          }

          resolve(result)
        },
      )
    },
  )

  const body = data.Body

  if (!body) {
    throw new Error(`COS 对象为空：${key}`)
  }

  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body)
  return Buffer.from(body)
}

export function extractCosKeyFromUrl(value: string): string | null {
  if (!value || typeof value !== 'string') return null

  if (value.startsWith('/api/files/cos/')) {
    return decodeURIComponent(value.replace(/^\/api\/files\/cos\//, ''))
  }

  if (value.startsWith('uploads/')) {
    return value
  }

  if (config.cos.publicBaseUrl && value.startsWith(config.cos.publicBaseUrl)) {
    const base = config.cos.publicBaseUrl.replace(/\/+$/, '')
    return decodeURIComponent(value.slice(base.length).replace(/^\/+/, ''))
  }

  try {
    const url = new URL(value)

    const pathname = decodeURIComponent(url.pathname.replace(/^\/+/, ''))

    const uploadsIndex = pathname.indexOf('uploads/')
    if (uploadsIndex >= 0) {
      return pathname.slice(uploadsIndex)
    }

    return null
  } catch {
    return null
  }
}