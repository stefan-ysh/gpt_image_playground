import mime from 'mime'
import { pool } from '../db/pool.js'
import type { DbTask } from '../db/tasks.js'
import { extractCosKeyFromUrl, readBufferFromCos } from './cos-client.js'
import { fetchExternalImage, parseBase64Image } from './image-store.js'

const MAX_PROVIDER_REFERENCE_IMAGES = 16
const MAX_PROVIDER_REFERENCE_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_PROVIDER_REFERENCE_TOTAL_BYTES = 40 * 1024 * 1024

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function isDirectImageValue(value: string) {
  return (
    value.startsWith('data:') ||
    /^https?:\/\//i.test(value) ||
    value.startsWith('/api/files/cos/') ||
    value.startsWith('uploads/')
  )
}

function guessContentTypeFromKey(key: string) {
  return mime.getType(key) || 'image/png'
}

function toDataUrl(buffer: Buffer, contentType: string) {
  return `data:${contentType};base64,${buffer.toString('base64')}`
}

async function getImageDataUrlsByIds(imageIds: string[]) {
  if (imageIds.length === 0) return []

  const directValues = imageIds.filter(isDirectImageValue)
  const dbIds = imageIds.filter((id) => !isDirectImageValue(id))

  if (dbIds.length === 0) {
    return directValues
  }

  const placeholders = dbIds.map(() => '?').join(',')

  const [rows] = await pool.query(
    `
    SELECT id, data_url
    FROM playground_images
    WHERE id IN (${placeholders})
    `,
    dbIds,
  )

  const map = new Map(
    (rows as Array<{ id: string; data_url: string }>).map((row) => [
      row.id,
      row.data_url,
    ]),
  )

  const resolvedDbUrls = dbIds
    .map((id) => map.get(id))
    .filter((url): url is string => {
      return typeof url === 'string' && url.trim().length > 0
    })

  return [...directValues, ...resolvedDbUrls]
}

function assertReferenceImageSize(buffer: Buffer, label: string) {
  if (buffer.byteLength > MAX_PROVIDER_REFERENCE_IMAGE_BYTES) {
    throw new Error(
      `${label} 过大：${Math.ceil(buffer.byteLength / 1024 / 1024)}MB，单张参考图最大允许 15MB`,
    )
  }
}

async function resolveImageValueToDataUrl(value: string): Promise<{
  dataUrl: string
  bytes: number
}> {
  if (value.startsWith('data:')) {
    const parsed = parseBase64Image(value)

    if (!parsed) {
      throw new Error('参考图 base64 格式无效')
    }

    assertReferenceImageSize(parsed.buffer, '参考图')

    return {
      dataUrl: value,
      bytes: parsed.buffer.byteLength,
    }
  }

  const cosKey = extractCosKeyFromUrl(value)

  if (cosKey) {
    const buffer = await readBufferFromCos(cosKey)

    assertReferenceImageSize(buffer, `参考图 ${cosKey}`)

    return {
      dataUrl: toDataUrl(buffer, guessContentTypeFromKey(cosKey)),
      bytes: buffer.byteLength,
    }
  }

  if (/^https?:\/\//i.test(value)) {
    const fetched = await fetchExternalImage(value)

    assertReferenceImageSize(fetched.buffer, '参考图')

    return {
      dataUrl: toDataUrl(fetched.buffer, fetched.contentType),
      bytes: fetched.buffer.byteLength,
    }
  }

  throw new Error(`无法解析参考图：${value}`)
}

export async function resolveTaskInputImageDataUrls(task: DbTask) {
  const inputImageIds = safeJsonParse<string[]>(task.input_image_ids, [])
    .filter((item): item is string => {
      return typeof item === 'string' && item.trim().length > 0
    })
    .slice(0, MAX_PROVIDER_REFERENCE_IMAGES)

  if (inputImageIds.length === 0) return []

  const imageValues = await getImageDataUrlsByIds(inputImageIds)

  const result: string[] = []
  let totalBytes = 0

  for (const imageValue of imageValues.slice(0, MAX_PROVIDER_REFERENCE_IMAGES)) {
    const resolved = await resolveImageValueToDataUrl(imageValue)

    totalBytes += resolved.bytes

    if (totalBytes > MAX_PROVIDER_REFERENCE_TOTAL_BYTES) {
      throw new Error(
        `参考图总体积过大：${Math.ceil(totalBytes / 1024 / 1024)}MB，最多允许 40MB`,
      )
    }

    result.push(resolved.dataUrl)
  }

  return result
}