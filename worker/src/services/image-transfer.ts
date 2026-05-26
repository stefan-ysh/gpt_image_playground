import crypto from 'node:crypto'
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

  return []
}

function createRemoteImageId(url: string) {
  return `remote-${crypto.createHash('sha256').update(url).digest('hex')}`
}

export async function processSucceededRawTask(task: DbTask) {
  await updateTaskStatus(task.id, 'storing_images')
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
      })

      outputImageIds.push(stored.id)
    }

    await updateTaskStatus(task.id, 'done', {
      output_images: JSON.stringify(outputImageIds),
      raw_image_urls: JSON.stringify(images),
      finished_at: Date.now(),
      elapsed: Date.now() - Number(task.created_at),
      error: null,
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