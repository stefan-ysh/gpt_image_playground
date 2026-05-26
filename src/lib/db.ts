import type { TaskRecord, StoredImage, StoredImageThumbnail } from '../types'

const THUMBNAIL_MAX_SIZE = 720
const THUMBNAIL_QUALITY = 0.9
const THUMBNAIL_VERSION = 2

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

// ===== App State (Zustand Async SQL storage) =====

export async function getAppState(key: string): Promise<{ id: string; value: unknown } | undefined> {
  try {
    const res = await fetch(`/api/state?key=${encodeURIComponent(key)}`, {
      credentials: 'include',
    })
    const json = await res.json()
    if (json.success && json.data !== null) {
      return { id: key, value: json.data }
    }
  } catch (e) {
    console.error('Failed to get app state:', e)
  }
  return undefined
}

export async function putAppState(key: string, value: unknown): Promise<string> {
  const res = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
    credentials: 'include',
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Failed to save state')
  return key
}

export async function deleteAppState(key: string): Promise<undefined> {
  try {
    await fetch(`/api/state?key=${encodeURIComponent(key)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
  } catch (e) {
    console.error('Failed to delete app state:', e)
  }
  return undefined
}

// ===== Tasks =====

export async function getAllTasks(): Promise<TaskRecord[]> {
  try {
    const res = await fetch('/api/tasks', {
      credentials: 'include',
    })
    const json = await res.json()
    if (json.success) return json.data
  } catch (e) {
    console.error('Failed to get tasks:', e)
  }
  return []
}

export async function putTask(task: TaskRecord): Promise<string> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task }),
    credentials: 'include',
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Failed to put task')
  return task.id
}

export async function deleteTask(id: string, protectedImageIds: string[] = []): Promise<undefined> {
  try {
    await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ protectedImageIds }),
      credentials: 'include',
    })
  } catch (e) {
    console.error('Failed to delete task:', e)
  }
  return undefined
}

export async function clearTasks(): Promise<undefined> {
  try {
    const tasks = await getAllTasks()
    await Promise.all(tasks.map((task) => deleteTask(task.id)))
  } catch (e) {
    console.error('Failed to clear tasks:', e)
  }
  return undefined
}

// ===== Images =====

function normalizeCosUrlToProxy(url: string): string {
  if (typeof url !== 'string') return url
  const match = url.match(/(uploads\/.+)$/)
  if (match) {
    return `/api/files/cos/${match[1]}`
  }
  return url
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  if (typeof id === 'string' && (/^https?:\/\//i.test(id) || id.startsWith('/') || id.includes('uploads/'))) {
    return { id, dataUrl: normalizeCosUrlToProxy(id), source: 'generated' }
  }
  try {
    const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
      credentials: 'include',
    })
    const json = await res.json()
    if (json.success) {
      return {
        ...json.data,
        dataUrl: normalizeCosUrlToProxy(json.data.dataUrl)
      }
    }
  } catch (e) {
    console.error('Failed to get image:', e)
  }
  return undefined
}

export async function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  if (typeof id === 'string' && (/^https?:\/\//i.test(id) || id.startsWith('/') || id.includes('uploads/'))) {
    return { id, thumbnailDataUrl: normalizeCosUrlToProxy(id), thumbnailVersion: THUMBNAIL_VERSION }
  }
  try {
    const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
      credentials: 'include',
    })
    const json = await res.json()
    if (json.success) {
      return {
        id,
        thumbnailDataUrl: normalizeCosUrlToProxy(json.data.thumbnailDataUrl),
        width: json.data.width,
        height: json.data.height,
        thumbnailVersion: json.data.thumbnailVersion,
      }
    }
  } catch (e) {
    console.error('Failed to get image thumbnail:', e)
  }
  return undefined
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export async function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<string> {
  // 缩略图由 storeImage API 统一处理上传，此处空实现
  return thumbnail.id
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return getStoredImageThumbnail(id)
}

export async function getAllImages(): Promise<StoredImage[]> {
  return []
}

export async function getAllImageIds(): Promise<string[]> {
  return []
}

export async function putImage(image: StoredImage): Promise<string> {
  return storeImage(image.dataUrl, image.source || 'upload')
}

export async function deleteImage(id: string): Promise<undefined> {
  // 图片去重共享存储，通常无需在前端做显式物理删除
  return undefined
}

export async function clearImages(): Promise<undefined> {
  return undefined
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id。
 */
export async function storeImage(
  dataUrl: string,
  source: NonNullable<StoredImage['source']> = 'upload',
  taskId?: string
): Promise<string> {
  return (await storeImageDetailed(dataUrl, source, taskId)).id
}

export async function storeImageDetailed(
  dataUrl: string,
  source: NonNullable<StoredImage['source']> = 'upload',
  taskId?: string
): Promise<{ id: string; persisted: boolean; error?: string }> {
  if (typeof dataUrl === 'string' && /^https?:\/\//i.test(dataUrl)) {
    // 外部链接也交由后端统一存入 COS 桶
    const res = await fetch('/api/images/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, source, taskId }),
      credentials: 'include',
    })
    const json = await res.json()
    if (json.success) return { id: json.data.id, persisted: json.data.id !== dataUrl }
    return { id: dataUrl, persisted: false, error: json.error || 'Failed to store remote image' }
  }

  // 本地 base64 形式，优先在客户端生成缩略图，减小后端 CPU 运算
  const thumbnail = await safeCreateImageThumbnail(dataUrl)
  const res = await fetch('/api/images/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dataUrl,
      source,
      thumbnailDataUrl: thumbnail.thumbnailDataUrl,
      taskId,
    }),
    credentials: 'include',
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Failed to store image')
  return { id: json.data.id, persisted: true }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}
