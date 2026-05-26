import crypto from 'node:crypto'
import net from 'node:net'
import { lookup } from 'node:dns/promises'
import mime from 'mime'
import { pool } from '../db/pool.js'
import { uploadBufferToCos } from './cos-client.js'

const MAX_STORED_IMAGE_BYTES = 60 * 1024 * 1024
const EXTERNAL_FETCH_TIMEOUT_MS = 15000
const MAX_EXTERNAL_REDIRECTS = 3

const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export type StoredImageSource = 'upload' | 'reference' | 'mask' | 'generated'

export interface StoreImageForTaskInput {
  taskId: string
  userId: string
  dataUrl: string
  source: StoredImageSource
  role?: 'input' | 'mask-target' | 'mask' | 'output'
}

export interface StoreImageForTaskResult {
  id: string
  dataUrl: string
  thumbnailDataUrl: string
}

function normalizeContentType(value: string | null | undefined): string {
  return (value || 'image/png').split(';')[0].trim().toLowerCase()
}

function isAllowedImageType(contentType: string) {
  return ALLOWED_IMAGE_TYPES.has(normalizeContentType(contentType))
}

function isPrivateIp(host: string): boolean {
  const version = net.isIP(host)

  if (version === 4) {
    const parts = host.split('.').map(Number)
    const [a, b] = parts

    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0
    )
  }

  if (version === 6) {
    const normalized = host.toLowerCase()

    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized === '::'
    )
  }

  return false
}

async function assertPublicImageUrl(input: string) {
  const url = new URL(input)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('仅支持 http/https 图片链接')
  }

  if (url.username || url.password) {
    throw new Error('图片链接不能包含认证信息')
  }

  if (
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    isPrivateIp(url.hostname)
  ) {
    throw new Error('不允许下载本地或内网图片地址')
  }

  const addresses = await lookup(url.hostname, {
    all: true,
    verbatim: true,
  })

  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('不允许下载解析到内网的图片地址')
  }
}

export function parseBase64Image(dataUrl: string): {
  buffer: Buffer
  contentType: string
  ext: string
} | null {
  if (!dataUrl.startsWith('data:')) return null

  const commaIndex = dataUrl.indexOf(',')
  if (commaIndex === -1) return null

  const meta = dataUrl.slice(0, commaIndex)
  const base64Data = dataUrl.slice(commaIndex + 1)

  if (!meta.endsWith(';base64')) return null

  const contentType = normalizeContentType(meta.slice(5, meta.length - 7))

  if (!isAllowedImageType(contentType)) return null

  const buffer = Buffer.from(base64Data, 'base64')

  if (buffer.byteLength <= 0) return null
  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) return null

  const ext = mime.getExtension(contentType) || 'png'

  return {
    buffer,
    contentType,
    ext,
  }
}

async function fetchPublicUrl(
  url: string,
  signal: AbortSignal,
  redirectsRemaining = MAX_EXTERNAL_REDIRECTS,
): Promise<Response> {
  await assertPublicImageUrl(url)

  const response = await fetch(url, {
    cache: 'no-store',
    redirect: 'manual',
    signal,
  })

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectsRemaining <= 0) {
      throw new Error('图片链接重定向次数过多')
    }

    const location = response.headers.get('location')

    if (!location) {
      throw new Error('图片链接重定向无效')
    }

    const nextUrl = new URL(location, url).toString()

    return fetchPublicUrl(nextUrl, signal, redirectsRemaining - 1)
  }

  return response
}

export async function fetchExternalImage(url: string): Promise<{
  buffer: Buffer
  contentType: string
  ext: string
}> {
  const controller = new AbortController()
  const timeoutId = setTimeout(
    () => controller.abort(),
    EXTERNAL_FETCH_TIMEOUT_MS,
  )

  const response = await fetchPublicUrl(url, controller.signal).finally(() => {
    clearTimeout(timeoutId)
  })

  if (!response.ok) {
    throw new Error(`下载第三方图片失败：HTTP ${response.status}`)
  }

  const contentType = normalizeContentType(response.headers.get('content-type'))

  if (!isAllowedImageType(contentType)) {
    throw new Error('链接返回的不是受支持的图片格式')
  }

  const contentLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(contentLength) && contentLength > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片文件过大')
  }

  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (buffer.byteLength <= 0) {
    throw new Error('图片内容为空')
  }

  if (buffer.byteLength > MAX_STORED_IMAGE_BYTES) {
    throw new Error('图片文件过大')
  }

  const ext = mime.getExtension(contentType) || 'png'

  return {
    buffer,
    contentType,
    ext,
  }
}

function getSubFolder(source: StoredImageSource) {
  if (source === 'upload' || source === 'reference') {
    return 'reference/images'
  }

  if (source === 'mask') {
    return 'reference/mask'
  }

  return 'images'
}

export function getTaskImageIdHash(imageId: string) {
  return crypto.createHash('sha256').update(imageId).digest('hex')
}

async function insertTaskImageRef(params: {
  taskId: string
  userId: string
  imageId: string
  role: 'input' | 'mask-target' | 'mask' | 'output'
}) {
  await pool.query(
    `
    INSERT IGNORE INTO playground_task_images
      (task_id, user_id, image_id, image_id_hash, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      params.taskId,
      params.userId,
      params.imageId,
      getTaskImageIdHash(params.imageId),
      params.role,
      Date.now(),
    ],
  )
}

async function insertImageOwner(imageId: string, userId: string) {
  await pool.query(
    `
    INSERT IGNORE INTO playground_image_owners
      (image_id, user_id, created_at)
    VALUES (?, ?, ?)
    `,
    [imageId, userId, Date.now()],
  )
}

async function saveImageRecord(params: {
  id: string
  dataUrl: string
  source: StoredImageSource
}) {
  await pool.query(
    `
    INSERT IGNORE INTO playground_images
      (id, data_url, created_at, source)
    VALUES (?, ?, ?, ?)
    `,
    [params.id, params.dataUrl, Date.now(), params.source],
  )
}

async function saveThumbnailRecord(params: {
  id: string
  thumbnailDataUrl: string
}) {
  await pool.query(
    `
    INSERT IGNORE INTO playground_thumbnails
      (id, thumbnail_data_url, thumbnail_version)
    VALUES (?, ?, ?)
    `,
    [params.id, params.thumbnailDataUrl, 2],
  )
}

async function getExistingImage(id: string): Promise<{
  dataUrl: string
  thumbnailDataUrl?: string
} | null> {
  const [rows] = await pool.query(
    `
    SELECT
      i.data_url,
      t.thumbnail_data_url
    FROM playground_images i
    LEFT JOIN playground_thumbnails t ON t.id = i.id
    WHERE i.id = ?
    LIMIT 1
    `,
    [id],
  )

  const row = (rows as Array<{
    data_url: string
    thumbnail_data_url?: string | null
  }>)[0]

  if (!row) return null

  return {
    dataUrl: row.data_url,
    thumbnailDataUrl: row.thumbnail_data_url || row.data_url,
  }
}

function isRelativeCosProxyPath(value: string) {
  return value.startsWith('/api/files/cos/') || value.startsWith('uploads/')
}

function normalizeRelativeCosUrl(value: string) {
  if (value.startsWith('/api/files/cos/')) return value

  if (value.startsWith('uploads/')) {
    return `/api/files/cos/${value}`
  }

  return value
}

export async function readImageInput(dataUrl: string): Promise<{
  buffer: Buffer
  contentType: string
  ext: string
}> {
  if (dataUrl.startsWith('data:')) {
    const parsed = parseBase64Image(dataUrl)

    if (!parsed) {
      throw new Error('无效的 base64 图片格式')
    }

    return parsed
  }

  if (/^https?:\/\//i.test(dataUrl)) {
    return fetchExternalImage(dataUrl)
  }

  if (isRelativeCosProxyPath(dataUrl)) {
    throw new Error('不能通过 image-store 重新转存相对 COS 路径，请使用 input-images 从 COS 读取')
  }

  throw new Error('不支持的图片输入格式')
}

export async function storeImageForTask(
  input: StoreImageForTaskInput,
): Promise<StoreImageForTaskResult> {
  const { taskId, userId, dataUrl, source } = input

  if (!dataUrl || typeof dataUrl !== 'string') {
    throw new Error('缺少图片内容')
  }

  if (isRelativeCosProxyPath(dataUrl)) {
    const normalized = normalizeRelativeCosUrl(dataUrl)

    return {
      id: normalized,
      dataUrl: normalized,
      thumbnailDataUrl: normalized,
    }
  }

  const { buffer, contentType, ext } = await readImageInput(dataUrl)
  const id = crypto.createHash('sha256').update(buffer).digest('hex')

  const existing = await getExistingImage(id)
  const subFolder = getSubFolder(source)
  const key = taskId
    ? `uploads/${taskId}/${subFolder}/${id}.${ext}`
    : `uploads/${subFolder}/${id}.${ext}`

  let cosUrl: string

  if (existing && taskId) {
    // 与前端 /api/images/store 保持一致：
    // 图片全局 hash 已存在时，仍在当前 task 目录下创建一份任务隔离副本。
    cosUrl = await uploadBufferToCos(buffer, key, contentType)
  } else if (existing) {
    cosUrl = existing.dataUrl
  } else {
    cosUrl = await uploadBufferToCos(buffer, key, contentType)

    await saveImageRecord({
      id,
      dataUrl: cosUrl,
      source,
    })
  }

  await insertImageOwner(id, userId)

  const thumbnailDataUrl = existing?.thumbnailDataUrl || cosUrl

  // Worker 端暂不生成小图，先用原图作为缩略图，保证前端可显示。
  await saveThumbnailRecord({
    id,
    thumbnailDataUrl,
  })

  await insertTaskImageRef({
    taskId,
    userId,
    imageId: id,
    role: input.role || (source === 'generated' ? 'output' : 'input'),
  })

  return {
    id,
    dataUrl: cosUrl,
    thumbnailDataUrl,
  }
}