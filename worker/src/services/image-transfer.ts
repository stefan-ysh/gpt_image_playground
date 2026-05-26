import type { DbTask } from '../db/tasks.js'
import { updateTaskStatus } from '../db/tasks.js'
import { notifyTaskUpdated } from './notifier.js'
import { storeImageForTask } from './image-store.js'

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback

  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function extractImages(task: DbTask): string[] {
  const raw = safeJsonParse<any>(task.provider_result_raw, null)

  if (!raw) return []

  if (Array.isArray(raw.images)) {
    return raw.images.filter((item: unknown): item is string => {
      return typeof item === 'string' && item.trim().length > 0
    })
  }

  if (raw.immediateSuccess && Array.isArray(raw.images)) {
    return raw.images.filter((item: unknown): item is string => {
      return typeof item === 'string' && item.trim().length > 0
    })
  }

  if (Array.isArray(raw.payload?.data?.result?.images)) {
    const urls: string[] = []

    for (const item of raw.payload.data.result.images) {
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

  return []
}

export async function processSucceededRawTask(task: DbTask) {
  await updateTaskStatus(task.id, 'storing_images', {
    last_provider_error: null,
  })
  await notifyTaskUpdated(task.id, 'storing_images')

  try {
    const images = extractImages(task)

    if (images.length === 0) {
      throw new Error('Provider success result does not contain images')
    }

    const outputImageIds: string[] = []

    for (const imageUrl of images) {
      const stored = await storeImageForTask({
        taskId: task.id,
        userId: task.user_id,
        dataUrl: imageUrl,
        source: 'generated',
        role: 'output',
      })

      outputImageIds.push(stored.id)
    }

    const now = Date.now()

    await updateTaskStatus(task.id, 'done', {
      output_images: JSON.stringify(outputImageIds),
      output_images_pending: null,
      raw_image_urls: JSON.stringify(images),
      raw_response_payload: task.provider_result_raw,
      finished_at: now,
      elapsed: now - Number(task.created_at),
      error: null,
      last_provider_error: null,
    })

    await notifyTaskUpdated(task.id, 'done')
  } catch (error) {
    await updateTaskStatus(task.id, 'transfer_pending', {
      last_provider_error:
        error instanceof Error ? error.message : String(error),
      next_poll_at: Date.now() + 60000,
    })

    await notifyTaskUpdated(task.id, 'transfer_pending')
  }
}