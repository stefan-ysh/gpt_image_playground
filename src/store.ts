import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  StateStorage,
} from 'zustand/middleware'
import type {
  ApiMode,
  ApiProfile,
  AppSettings,
  CustomProviderDefinition,
  TaskParams,
  InputImage,
  TaskRecord,
  TaskGroup,
  UserInfo,
} from './types'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS, getActiveApiProfile, getCustomProviderDefinition, normalizeSettings, validateApiProfile } from './lib/apiProfiles'
import { dismissAllTooltips } from './lib/tooltipDismiss'
import { remapImageMentionsForOrder, replaceImageMentionsForApi } from './lib/promptImageMentions'
import {
  CURRENT_THUMBNAIL_VERSION,
  getAllTasks,
  putTask,
  deleteTask as dbDeleteTask,
  getImage,
  getImageThumbnail,
  getStoredFreshImageThumbnail,
  getAllImageIds,
  putImage,
  getAppState,
  putAppState,
  deleteAppState,
  deleteImage,
  storeImage,
  storeImageDetailed,
} from './lib/db'
import { callImageApi } from './lib/api'
import { IMAGE_FETCH_CORS_HINT, isDataUrl } from './lib/imageApiShared'
import { getFalErrorMessage, getFalQueuedImageResult } from './lib/falAiImageApi'
import { getCustomQueuedImageResult, queryCustomQueuedImageResult } from './lib/openaiCompatibleImageApi'
import { getChangedParams, normalizeParamsForSettings } from './lib/paramCompatibility'
import { normalizeResolution } from './lib/resolution'
import { zipSync, strToU8 } from 'fflate'

// ===== Image cache =====
// 内存缓存，id → dataUrl。只保留少量最近使用图片，避免大量 4K data URL 常驻内存。

const imageCache = new Map<string, string>()
const thumbnailCache = new Map<string, { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number }>()
const thumbnailBackfillIds = new Map<string, 'visible' | 'background'>()
const thumbnailBackfillRunningIds = new Set<string>()
const thumbnailSubscribers = new Map<string, Set<(thumbnail: { dataUrl: string; width?: number; height?: number }) => void>>()
let thumbnailBackfillScheduled = false
const MAX_IMAGE_CACHE_ENTRIES = 8
const MAX_THUMBNAIL_CACHE_ENTRIES = 80
const MAX_THUMBNAIL_BACKFILL_CONCURRENT = 4
const FAL_RECOVERY_POLL_MS = 10_000
const CUSTOM_RECOVERY_POLL_MS = 10_000
const SUPPORT_PROMPT_IMAGE_THRESHOLD = 50
const falRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const customRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const imageTransferRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const imageTransferRetryAttempts = new Map<string, number>()
const OPENAI_INTERRUPTED_ERROR = '请求中断'
const ERROR_TOAST_MAX_LENGTH = 80
const IMAGE_TRANSFER_RETRY_DELAYS = [10_000, 30_000, 120_000, 300_000, 600_000]
type ToastType = 'info' | 'success' | 'error'
type InputDraft = {
  prompt: string
  inputImages: InputImage[]
  maskEditorImageId: string | null
  updatedAt?: number
}

export function getErrorToastMessage(message: string): string {
  const text = message.trim()
  if (!text) return '操作失败'

  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  const separatorIndex = firstLine.search(/[：:]/)
  if (separatorIndex > 0) {
    const title = firstLine.slice(0, separatorIndex).trim()
    if (isErrorToastTitle(title)) return title
  }

  if (firstLine.length > ERROR_TOAST_MAX_LENGTH) return '操作失败，请查看详情'
  return firstLine || '操作失败'
}

function getToastMessage(message: string, type: ToastType): string {
  return type === 'error' ? getErrorToastMessage(message) : message
}

function isErrorToastTitle(title: string): boolean {
  return /(?:失败|错误|异常|报错|无法|不能|超时|中断|断开|请先|请输入|已达上限|不存在|已丢失)$/.test(title)
}

export type SettingsTab = 'general' | 'data' | 'about'

const TIMEOUT_STREAMING_HINT = '也可尝试打开「流式传输」，并提高「请求中间步骤图像数」来维持连接。'
const TIMEOUT_PARTIAL_IMAGES_ZERO_HINT = '官方流式接口不发送心跳，当前「请求中间步骤图像数」为 0，连接可能因无数据传输而断开。建议提高到 2 或 3。'
const TIMEOUT_PARTIAL_IMAGES_LOW_HINT = '也可尝试提高「请求中间步骤图像数」来维持连接，避免长时间无数据传输导致断开。'

type TimeoutStreamingHintProfile = Pick<ApiProfile, 'provider' | 'streamImages' | 'streamPartialImages'>

function getTimeoutStreamingHint(profile?: TimeoutStreamingHintProfile | null) {
  if (profile?.provider !== 'openai') return ''
  const partialImages = profile.streamPartialImages ?? DEFAULT_SETTINGS.streamPartialImages ?? 0
  if (profile.streamImages !== true) return TIMEOUT_STREAMING_HINT
  if (partialImages === 0) return TIMEOUT_PARTIAL_IMAGES_ZERO_HINT
  return partialImages < 3 ? TIMEOUT_PARTIAL_IMAGES_LOW_HINT : ''
}

function createOpenAITimeoutError(timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  return `请求超时：超过 ${timeoutSeconds} 秒仍未完成，请稍后重试或提高超时时间。${getTimeoutStreamingHint(profile)}`
}

export function getCachedImage(id: string): string | undefined {
  const dataUrl = imageCache.get(id)
  if (dataUrl) {
    imageCache.delete(id)
    imageCache.set(id, dataUrl)
  }
  return dataUrl
}

function cacheImage(id: string, dataUrl: string) {
  imageCache.delete(id)
  imageCache.set(id, dataUrl)
  while (imageCache.size > MAX_IMAGE_CACHE_ENTRIES) {
    const oldestKey = imageCache.keys().next().value
    if (oldestKey == null) break
    imageCache.delete(oldestKey)
  }
}

function isRemoteHttpImageId(id: string | undefined | null): id is string {
  return typeof id === 'string' && /^https?:\/\//i.test(id)
}

function getImageTransferRetryKey(taskId: string, imageUrl: string) {
  return `${taskId}\0${imageUrl}`
}

function replaceTaskImageKeyedMap<T>(
  value: Record<string, T> | undefined,
  oldId: string,
  newId: string,
): Record<string, T> | undefined {
  if (!value || !(oldId in value)) return value
  const next = { ...value }
  next[newId] = next[oldId]
  delete next[oldId]
  return next
}

function replaceTaskOutputImageId(task: TaskRecord, oldId: string, newId: string): TaskRecord {
  const outputImages = task.outputImages.includes(oldId)
    ? task.outputImages.map((id) => id === oldId ? newId : id)
    : task.outputImages.includes(newId)
      ? task.outputImages
      : [...task.outputImages, newId]
  const outputImagesPending = task.outputImagesPending?.filter((id) => id !== oldId)
  const rawImageUrls = task.rawImageUrls?.filter((id) => id !== oldId)

  return {
    ...task,
    outputImages,
    outputImagesPending: outputImagesPending?.length ? outputImagesPending : undefined,
    rawImageUrls: rawImageUrls?.length ? rawImageUrls : undefined,
    actualParamsByImage: replaceTaskImageKeyedMap(task.actualParamsByImage, oldId, newId),
    revisedPromptByImage: replaceTaskImageKeyedMap(task.revisedPromptByImage, oldId, newId),
    status: task.status === 'error' ? 'done' : task.status,
    error: task.status === 'error' ? null : task.error,
    finishedAt: task.finishedAt ?? Date.now(),
    elapsed: task.elapsed ?? (Date.now() - task.createdAt),
  }
}

async function persistRemoteTaskImage(taskId: string, imageUrl: string, showResultToast = false): Promise<boolean> {
  const result = await storeImageDetailed(imageUrl, 'generated', taskId)
  if (!result.persisted || result.id === imageUrl) {
    if (showResultToast && result.error) useStore.getState().showToast(`转存失败: ${result.error}`, 'error')
    return false
  }

  const stored = await getImage(result.id)
  const dataUrl = stored?.dataUrl ?? imageUrl
  cacheImage(result.id, dataUrl)
  cacheImage(imageUrl, dataUrl)

  const { tasks, setTasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (task && (
    task.outputImages.includes(imageUrl) ||
    (task.outputImagesPending ?? []).includes(imageUrl) ||
    (task.rawImageUrls ?? []).includes(imageUrl)
  )) {
    const updatedTask = replaceTaskOutputImageId(task, imageUrl, result.id)
    setTasks(tasks.map((item) => item.id === taskId ? updatedTask : item))
    await putTask(updatedTask)
  } else {
    const allTasks = await getAllTasks()
    const dbTask = allTasks.find((item) => item.id === taskId)
    if (dbTask && (
      dbTask.outputImages.includes(imageUrl) ||
      (dbTask.outputImagesPending ?? []).includes(imageUrl) ||
      (dbTask.rawImageUrls ?? []).includes(imageUrl)
    )) {
      await putTask(replaceTaskOutputImageId(dbTask, imageUrl, result.id))
    }
  }

  const retryKey = getImageTransferRetryKey(taskId, imageUrl)
  const timer = imageTransferRetryTimers.get(retryKey)
  if (timer) clearTimeout(timer)
  imageTransferRetryTimers.delete(retryKey)
  imageTransferRetryAttempts.delete(retryKey)
  if (showResultToast) useStore.getState().showToast('图片已重新转存到 COS', 'success')
  return true
}

function scheduleImageTransferRetry(taskId: string, imageUrl: string, delayMs?: number) {
  if (!isRemoteHttpImageId(imageUrl)) return
  const key = getImageTransferRetryKey(taskId, imageUrl)
  if (imageTransferRetryTimers.has(key)) return

  const attempt = imageTransferRetryAttempts.get(key) ?? 0
  const nextDelay = delayMs ?? IMAGE_TRANSFER_RETRY_DELAYS[Math.min(attempt, IMAGE_TRANSFER_RETRY_DELAYS.length - 1)]
  const timer = setTimeout(() => {
    imageTransferRetryTimers.delete(key)
    void (async () => {
      try {
        const success = await persistRemoteTaskImage(taskId, imageUrl)
        if (!success) {
          imageTransferRetryAttempts.set(key, attempt + 1)
          scheduleImageTransferRetry(taskId, imageUrl)
        }
      } catch (err) {
        console.warn('后台转存图片失败，将继续重试:', err)
        imageTransferRetryAttempts.set(key, attempt + 1)
        scheduleImageTransferRetry(taskId, imageUrl)
      }
    })()
  }, nextDelay)
  imageTransferRetryTimers.set(key, timer)
}

function scheduleTaskRemoteImageTransfers(task: TaskRecord, delayMs?: number) {
  const imageUrls = [
    ...task.outputImages,
    ...(task.outputImagesPending ?? []),
    ...(task.rawImageUrls ?? []),
  ]
  for (const imageUrl of imageUrls) {
    if (isRemoteHttpImageId(imageUrl)) scheduleImageTransferRetry(task.id, imageUrl, delayMs)
  }
}

export async function retryTaskImageTransfers(task: TaskRecord): Promise<{ attempted: number; succeeded: number }> {
  const remoteUrls = Array.from(new Set([
    ...task.outputImages.filter(isRemoteHttpImageId),
    ...(task.outputImagesPending ?? []).filter(isRemoteHttpImageId),
    ...(task.rawImageUrls ?? []).filter(isRemoteHttpImageId),
  ]))
  let succeeded = 0
  for (const imageUrl of remoteUrls) {
    try {
      if (await persistRemoteTaskImage(task.id, imageUrl)) succeeded += 1
      else scheduleImageTransferRetry(task.id, imageUrl)
    } catch (err) {
      console.warn('手动转存图片失败，将继续后台重试:', err)
      scheduleImageTransferRetry(task.id, imageUrl)
    }
  }
  return { attempted: remoteUrls.length, succeeded }
}

async function persistGeneratedImage(dataUrl: string, taskId: string): Promise<string> {
  const result = await storeImageDetailed(dataUrl, 'generated', taskId)
  if (result.persisted) {
    const stored = await getImage(result.id)
    cacheImage(result.id, stored?.dataUrl ?? dataUrl)
    return result.id
  }

  if (isRemoteHttpImageId(result.id)) {
    // 缓存以便界面立即显示
    cacheImage(result.id, result.id)

    // 尝试调用后端入队 API，将临时 URL 加入持久化队列
    try {
      await fetch('/api/images/enqueue-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ taskId, tempUrls: [result.id] }),
      })

      // 更新本地任务状态，添加 output_images_pending
      const { tasks, setTasks } = useStore.getState()
      const task = tasks.find((t) => t.id === taskId)
      if (task) {
        const pending = Array.isArray(task.outputImagesPending) ? [...task.outputImagesPending] : []
        if (!pending.includes(result.id)) pending.push(result.id)
        const updated = { ...task, outputImagesPending: pending }
        setTasks(tasks.map((t) => t.id === taskId ? updated : t))
        await putTask(updated)
      } else {
        // 保底：若本地没有该任务，尝试更新数据库记录（以防页面刷新不同步）
        try {
          const all = await getAllTasks()
          const dbTask = all.find((t) => t.id === taskId)
          if (dbTask) {
            const pending = Array.isArray(dbTask.outputImagesPending) ? [...dbTask.outputImagesPending] : []
            if (!pending.includes(result.id)) pending.push(result.id)
            await putTask({ ...dbTask, outputImagesPending: pending })
          }
        } catch {}
      }

      return result.id
    } catch (err) {
      // 如果调用入队失败，则回退为原有的内存重试机制
      console.warn('将临时图片入队失败，回退到内存重试:', err)
      scheduleImageTransferRetry(taskId, result.id, 0)
      return result.id
    }
  }

  throw new Error(result.error || '图片转存失败')
}

function getCachedThumbnail(id: string) {
  const thumbnail = thumbnailCache.get(id)
  if (thumbnail?.thumbnailVersion === CURRENT_THUMBNAIL_VERSION) {
    thumbnailCache.delete(id)
    thumbnailCache.set(id, thumbnail)
    return thumbnail
  }
  if (thumbnail) {
    thumbnailCache.delete(id)
  }
  return undefined
}

function cacheThumbnail(id: string, thumbnail: { dataUrl: string; width?: number; height?: number; thumbnailVersion?: number }) {
  if (thumbnail.thumbnailVersion !== CURRENT_THUMBNAIL_VERSION) return
  thumbnailCache.delete(id)
  thumbnailCache.set(id, thumbnail)
  while (thumbnailCache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
    const oldestKey = thumbnailCache.keys().next().value
    if (oldestKey == null) break
    thumbnailCache.delete(oldestKey)
  }
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  const cached = getCachedImage(id)
  if (cached) return cached

  // 如果 id 是以 http 开头的外部链接，后台触发自动转存
  if (typeof id === 'string' && /^https?:\/\//i.test(id)) {
    try {
      const localHashId = await storeImage(id, 'upload')
      if (localHashId && localHashId !== id) {
        const rec = await getImage(localHashId)
        if (rec) {
          cacheImage(id, rec.dataUrl)
          return rec.dataUrl
        }
      }
    } catch (err) {
      console.error('自动转存外部图片失败:', err)
    }
    return id
  }

  const rec = await getImage(id)
  if (rec) {
    cacheImage(id, rec.dataUrl)
    return rec.dataUrl
  }
  return undefined
}

/**
 * 获取图片在腾讯云 COS 桶中的绝对公网可访问 URL（用于传递给云端外部服务商 API 供其下载）。
 * 绕过 normalizeCosUrlToProxy 转换，直接从数据库提取原始绝对公网地址。
 */
export async function getCosAbsoluteUrl(id: string): Promise<string> {
  if (typeof id === 'string' && (/^https?:\/\//i.test(id) || id.startsWith('/') || id.includes('uploads/'))) {
    return id
  }
  try {
    const res = await fetch(`/api/images/${encodeURIComponent(id)}`, {
      credentials: 'include',
    })
    const json = await res.json()
    if (json.success && json.data?.dataUrl) {
      return json.data.dataUrl
    }
  } catch (e) {
    console.error('Failed to get cos absolute url:', e)
  }
  return id
}

export async function ensureImageThumbnailCached(id: string): Promise<{ dataUrl: string; width?: number; height?: number } | undefined> {
  const cached = getCachedThumbnail(id)
  if (cached) return cached

  const rec = await getStoredFreshImageThumbnail(id)
  if (!rec?.thumbnailDataUrl) {
    scheduleThumbnailBackfill([id], 'visible')
    return undefined
  }

  const thumbnail = {
    dataUrl: rec.thumbnailDataUrl,
    width: rec.width,
    height: rec.height,
    thumbnailVersion: rec.thumbnailVersion,
  }
  cacheThumbnail(id, thumbnail)
  return thumbnail
}

export function subscribeImageThumbnail(id: string, callback: (thumbnail: { dataUrl: string; width?: number; height?: number }) => void) {
  let subscribers = thumbnailSubscribers.get(id)
  if (!subscribers) {
    subscribers = new Set()
    thumbnailSubscribers.set(id, subscribers)
  }
  subscribers.add(callback)
  return () => {
    subscribers?.delete(callback)
    if (subscribers?.size === 0) thumbnailSubscribers.delete(id)
  }
}

function notifyImageThumbnail(id: string, thumbnail: { dataUrl: string; width?: number; height?: number }) {
  thumbnailSubscribers.get(id)?.forEach((callback) => callback(thumbnail))
}

function scheduleThumbnailBackfill(ids: Iterable<string>, priority: 'visible' | 'background' = 'background') {
  for (const id of ids) {
    if (getCachedThumbnail(id) || thumbnailBackfillRunningIds.has(id)) continue
    const currentPriority = thumbnailBackfillIds.get(id)
    if (!currentPriority || priority === 'visible') thumbnailBackfillIds.set(id, priority)
  }
  scheduleThumbnailBackfillTick()
}

function scheduleThumbnailBackfillTick() {
  if (thumbnailBackfillScheduled || thumbnailBackfillIds.size === 0) return
  thumbnailBackfillScheduled = true

  const run = () => {
    thumbnailBackfillScheduled = false
    void processNextThumbnailBackfill()
  }

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 2_000 })
  } else {
    globalThis.setTimeout(run, 250)
  }
}

async function processNextThumbnailBackfill() {
  if (thumbnailBackfillRunningIds.size > 0) return

  const ids = await getNextThumbnailBackfillBatch()
  for (const id of ids) startThumbnailBackfill(id)

  if (thumbnailBackfillIds.size > 0) scheduleThumbnailBackfillTick()
}

async function getNextThumbnailBackfillBatch() {
  const candidates = getOrderedThumbnailBackfillIds().slice(0, MAX_THUMBNAIL_BACKFILL_CONCURRENT)
  if (candidates.length === 0) return []

  const sizes = await Promise.all(candidates.map(async (id) => {
    const image = await getImage(id)
    return { width: image?.width, height: image?.height }
  }))
  const concurrency = getThumbnailConcurrencyForBatch(sizes)
  const selected = candidates.slice(0, concurrency)
  for (const id of selected) thumbnailBackfillIds.delete(id)
  return selected
}

function getOrderedThumbnailBackfillIds() {
  const visible: string[] = []
  const background: string[] = []
  for (const [id, priority] of thumbnailBackfillIds) {
    if (priority === 'visible') visible.push(id)
    else background.push(id)
  }
  return [...visible, ...background]
}

function getThumbnailConcurrencyForBatch(sizes: Array<{ width?: number; height?: number }>) {
  let maxMegapixels = 0
  for (const { width, height } of sizes) {
    if (!width || !height) return 1
    maxMegapixels = Math.max(maxMegapixels, (width * height) / 1_000_000)
  }
  const megapixels = maxMegapixels
  if (megapixels >= 8) return 1
  if (megapixels >= 4) return 2
  if (megapixels >= 2) return 3
  return 4
}

function startThumbnailBackfill(id: string) {
  thumbnailBackfillRunningIds.add(id)

  void (async () => {
    if (getCachedThumbnail(id)) return

    const thumbnail = await getImageThumbnail(id)
    if (thumbnail?.thumbnailDataUrl) {
      cacheThumbnail(id, {
        dataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: thumbnail.thumbnailVersion,
      })
      notifyImageThumbnail(id, {
        dataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
      })
    }
  })().catch(() => {
    // Keep thumbnail generation best-effort; cards remain on placeholders if it fails.
  }).finally(() => {
    thumbnailBackfillRunningIds.delete(id)
    scheduleThumbnailBackfillTick()
  })
}


function countSuccessfulOutputImages(tasks: TaskRecord[]) {
  return tasks.reduce((count, task) => count + (task.status === 'done' ? task.outputImages.length : 0), 0)
}

function skipSupportPromptForImportedData(tasks: TaskRecord[]) {
  const count = countSuccessfulOutputImages(tasks)
  useStore.setState((state) => {
    if (state.supportPromptDismissed) return {}
    if (count <= SUPPORT_PROMPT_IMAGE_THRESHOLD) {
      return { supportPromptSkippedForImportedData: false }
    }
    if (state.supportPromptOpen) return {}
    return { supportPromptSkippedForImportedData: true }
  })
}

function showSupportPromptForExistingLocalData(tasks: TaskRecord[]) {
  const count = countSuccessfulOutputImages(tasks)
  useStore.setState((state) => {
    if (state.supportPromptDismissed || state.supportPromptOpen) return {}
    if (count <= SUPPORT_PROMPT_IMAGE_THRESHOLD) {
      return { supportPromptSkippedForImportedData: false }
    }
    if (state.supportPromptSkippedForImportedData) return {}
    return { supportPromptOpen: true }
  })
}

function maybeOpenSupportPrompt(previousTasks: TaskRecord[], nextTasks: TaskRecord[], taskId: string) {
  const state = useStore.getState()
  if (state.supportPromptDismissed || state.supportPromptOpen || state.supportPromptSkippedForImportedData) return

  const previousTask = previousTasks.find((task) => task.id === taskId)
  const nextTask = nextTasks.find((task) => task.id === taskId)
  if (!nextTask || previousTask?.status === 'done' || nextTask.status !== 'done' || nextTask.outputImages.length === 0) return

  const previousCount = countSuccessfulOutputImages(previousTasks)
  const nextCount = countSuccessfulOutputImages(nextTasks)
  if (previousCount <= SUPPORT_PROMPT_IMAGE_THRESHOLD && nextCount > SUPPORT_PROMPT_IMAGE_THRESHOLD) {
    useStore.setState({ supportPromptOpen: true })
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function getPersistedState(state: AppState) {
  const settings = normalizeSettings(state.settings)
  const galleryInputDraft = getPersistableGalleryInputDraft(state)
  return {
    settings,
    params: state.params,
    ...(settings.persistInputOnRestart && galleryInputDraft
      ? {
          prompt: galleryInputDraft?.prompt ?? '',
          inputImages: galleryInputDraft?.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) ?? [],
        }
      : {}),
    galleryInputDraft: settings.persistInputOnRestart && galleryInputDraft
      ? { ...galleryInputDraft, inputImages: galleryInputDraft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) }
      : null,
    supportPromptDismissed: state.supportPromptDismissed,
    supportPromptOpen: state.supportPromptOpen,
    supportPromptSkippedForImportedData: state.supportPromptSkippedForImportedData,
  }
}

function mergePersistedState(persistedState: unknown, currentState: AppState): AppState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = persistedState as Partial<AppState>
  const settings = normalizeSettings(persisted.settings ?? currentState.settings)
  const persistedParams = persisted.params
    ? (() => {
      const { quality: _ignoredQuality, ...paramsWithoutQuality } = persisted.params as typeof persisted.params & { quality?: unknown }
      void _ignoredQuality
      return paramsWithoutQuality
    })()
    : {}
  const galleryInputDraft = settings.persistInputOnRestart
    ? normalizeInputDraft((persisted as { galleryInputDraft?: unknown }).galleryInputDraft ?? {
        prompt: persisted.prompt,
        inputImages: persisted.inputImages,
        maskEditorImageId: null,
      })
    : null
  return {
    ...currentState,
    ...persisted,
    settings,
    params: {
      ...DEFAULT_PARAMS,
      ...persistedParams,
      resolution: normalizeResolution(
        (persisted.params as { resolution?: unknown } | undefined)?.resolution,
        DEFAULT_PARAMS.resolution,
      ),
    },
    galleryInputDraft: galleryInputDraft && !isEmptyInputDraft(galleryInputDraft) ? galleryInputDraft : null,
    supportPromptDismissed: Boolean(persisted.supportPromptDismissed),
    supportPromptOpen: Boolean(persisted.supportPromptOpen),
    supportPromptSkippedForImportedData: Boolean(persisted.supportPromptSkippedForImportedData),
    prompt: galleryInputDraft?.prompt ?? '',
    inputImages: galleryInputDraft?.inputImages ?? [],
    maskEditorImageId: galleryInputDraft?.maskEditorImageId ?? null,
  }
}

// ===== Store 类型 =====

interface AppState {
  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  replaceInputImage: (idx: number, img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[], options?: { equivalentImageIds?: Record<string, string> }) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void
  galleryInputDraft: InputDraft | null

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void
  reusedTaskApiProfileId: string | null
  reusedTaskApiProfileName: string | null
  reusedTaskApiProfileMissing: boolean
  setReusedTaskApiProfile: (profileId: string | null, missing?: boolean, profileName?: string | null) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void
  streamPreviews: Record<string, string>
  streamPreviewSlots: Record<string, Record<string, string>>
  setTaskStreamPreview: (taskId: string, image?: string, requestIndex?: number) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  settingsTabRequest: SettingsTab | null
  setShowSettings: (v: boolean, tab?: SettingsTab) => void
  supportPromptOpen: boolean
  supportPromptDismissed: boolean
  supportPromptSkippedForImportedData: boolean
  setSupportPromptOpen: (v: boolean) => void
  dismissSupportPrompt: () => void

  // Toast
  toast: { message: string; type: ToastType } | null
  showToast: (message: string, type?: ToastType) => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    checkbox?: {
      label: string
      defaultChecked?: boolean
      disabled?: boolean
      tone?: 'primary' | 'danger'
    }
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    buttons?: Array<{
      label: string
      tone?: 'primary' | 'secondary' | 'danger' | 'warning'
      action: (checkboxChecked?: boolean) => void
    }>
    icon?: 'info' | 'copy'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action?: (checkboxChecked?: boolean) => void
    cancelAction?: (checkboxChecked?: boolean) => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void

  // 分组管理
  createGroup: (name: string) => void
  deleteGroup: (id: string) => void
  renameGroup: (id: string, name: string) => void
  assignTaskToGroup: (taskId: string, groupId: string | null) => void
  // 侧边栏与当前选中分组
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  selectedGroupId: string
  setSelectedGroupId: (id: string) => void
  currentUser: UserInfo | null
  setCurrentUser: (user: UserInfo | null) => void

  // 任务加载分页状态
  tasksCurrentPage: number
  tasksHasMore: boolean
  tasksLoading: boolean
  setTasksCurrentPage: (page: number) => void
  setTasksHasMore: (hasMore: boolean) => void
  setTasksLoading: (loading: boolean) => void
  loadMoreTasks: (groupId: string, page: number, append?: boolean) => Promise<void>
}

function isImageReferencedByState(state: AppState, imageId: string) {
  if (state.inputImages.some((img) => img.id === imageId)) return true
  if (state.galleryInputDraft?.inputImages.some((img) => img.id === imageId)) return true
  if (state.tasks.some((task) =>
    task.inputImageIds.includes(imageId) ||
    task.outputImages.includes(imageId) ||
    task.streamPartialImageIds?.includes(imageId) ||
    task.maskTargetImageId === imageId ||
    task.maskImageId === imageId
  )) return true
  return false
}

export async function deleteImageIfUnreferenced(imageId: string) {
  imageCache.delete(imageId)
  thumbnailCache.delete(imageId)
  thumbnailBackfillIds.delete(imageId)
  thumbnailBackfillRunningIds.delete(imageId)
  thumbnailSubscribers.delete(imageId)
  if (isImageReferencedByState(useStore.getState(), imageId)) return
  try {
    await deleteImage(imageId)
  } catch {
    // 清理是内存/存储优化，失败不影响替换结果。
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeInputImages(value: unknown): InputImage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((img): InputImage | null => {
      if (!isRecord(img) || typeof img.id !== 'string') return null
      return {
        id: img.id,
        dataUrl: typeof img.dataUrl === 'string' ? img.dataUrl : '',
        editSource: img.editSource === 'mask' ? 'mask' : undefined,
      }
    })
    .filter((img): img is InputImage => img != null)
}

function normalizeInputDraft(value: unknown, fallbackUpdatedAt = Date.now()): InputDraft {
  const draft = isRecord(value) ? value : {}
  const updatedAt = typeof draft.updatedAt === 'number' && Number.isFinite(draft.updatedAt) ? draft.updatedAt : fallbackUpdatedAt
  return {
    prompt: typeof draft.prompt === 'string' ? draft.prompt : '',
    inputImages: normalizeInputImages(draft.inputImages),
    maskEditorImageId: typeof draft.maskEditorImageId === 'string' ? draft.maskEditorImageId : null,
    updatedAt,
  }
}

function clearInputDraftState(): Pick<InputDraft, 'prompt' | 'inputImages' | 'maskEditorImageId'> {
  return {
    prompt: '',
    inputImages: [],
    maskEditorImageId: null,
  }
}

function copyInputDraft(draft: InputDraft): InputDraft {
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskEditorImageId: draft.maskEditorImageId,
    updatedAt: draft.updatedAt ?? Date.now(),
  }
}

function getCurrentInputDraft(state: Pick<AppState, 'prompt' | 'inputImages' | 'maskEditorImageId'>): InputDraft {
  return {
    prompt: state.prompt,
    inputImages: state.inputImages,
    maskEditorImageId: state.maskEditorImageId,
    updatedAt: Date.now(),
  }
}

function isEmptyInputDraft(draft: InputDraft) {
  return draft.prompt.length === 0 && draft.inputImages.length === 0 && !draft.maskEditorImageId
}

function saveGalleryInputDraft(state: Pick<AppState, 'galleryInputDraft' | 'prompt' | 'inputImages' | 'maskEditorImageId'>) {
  const draft = getCurrentInputDraft(state)
  return isEmptyInputDraft(draft) ? null : copyInputDraft(draft)
}

function getPersistableGalleryInputDraft(state: AppState) {
  return saveGalleryInputDraft(state)
}

function restoreGalleryInputDraftState(draft: InputDraft | null): Pick<InputDraft, 'prompt' | 'inputImages' | 'maskEditorImageId'> {
  if (!draft) return clearInputDraftState()
  return {
    prompt: draft.prompt,
    inputImages: draft.inputImages.map((img) => ({ ...img })),
    maskEditorImageId: draft.maskEditorImageId,
  }
}

function syncActiveInputDraft<T extends Partial<InputDraft>>(
  state: AppState,
  patch: T,
): T & { galleryInputDraft?: InputDraft | null } {
  const draft: InputDraft = {
    prompt: patch.prompt ?? state.prompt,
    inputImages: patch.inputImages ?? state.inputImages,
    maskEditorImageId: patch.maskEditorImageId !== undefined ? patch.maskEditorImageId : state.maskEditorImageId,
  }
  return {
    ...patch,
    galleryInputDraft: isEmptyInputDraft(draft) ? null : copyInputDraft(draft),
  }
}

const lastSavedValueMap = new Map<string, string>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

const customAsyncStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (typeof window === 'undefined') return null
    try {
      const appState = await getAppState(name)
      if (appState) {
        const stringified = JSON.stringify(appState.value)
        lastSavedValueMap.set(name, stringified)
        return stringified
      }
    } catch (e) {
      console.error('Failed to get app state:', e)
    }

    try {
      const localVal = localStorage.getItem(name)
      if (localVal) {
        const parsed = JSON.parse(localVal)
        await putAppState(name, parsed)
        localStorage.removeItem(name)
        lastSavedValueMap.set(name, localVal)
        return localVal
      }
    } catch (e) {
      console.error('Failed to migrate local storage config:', e)
    }
    return null
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') return

    const lastVal = lastSavedValueMap.get(name)
    if (lastVal === value) {
      // 若数据没有发生实际内容改变，直接拦截，完全省去无谓的防抖及网络同步调用
      return
    }
    lastSavedValueMap.set(name, value)

    if (debounceTimers.has(name)) {
      clearTimeout(debounceTimers.get(name))
    }

    return new Promise<void>((resolve) => {
      const timer = setTimeout(async () => {
        try {
          const parsed = JSON.parse(value)
          await putAppState(name, parsed)
        } catch (e) {
          console.error('Failed to save state:', e)
        } finally {
          debounceTimers.delete(name)
          resolve()
        }
      }, 1000)

      debounceTimers.set(name, timer)
    })
  },
  removeItem: async (name: string): Promise<void> => {
    if (typeof window === 'undefined') return
    try {
      await deleteAppState(name)
    } catch (e) {
      console.error('Failed to delete state:', e)
    }
  }
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      // Settings
      settings: { ...DEFAULT_SETTINGS },

      // 侧边栏与当前选中分组
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      selectedGroupId: 'unassigned',
      setSelectedGroupId: (id) => {
        set({ selectedGroupId: id })
        void useStore.getState().loadMoreTasks(id, 1, false)
      },
      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),

      // 任务加载分页状态实现
      tasksCurrentPage: 1,
      tasksHasMore: false,
      tasksLoading: false,
      setTasksCurrentPage: (page) => set({ tasksCurrentPage: page }),
      setTasksHasMore: (hasMore) => set({ tasksHasMore: hasMore }),
      setTasksLoading: (loading) => set({ tasksLoading: loading }),
      loadMoreTasks: async (groupId, page, append = false) => {
        const { tasksLoading, filterFavorite } = useStore.getState()
        if (tasksLoading) return

        set({ tasksLoading: true })
        try {
          const params = new URLSearchParams()
          params.set('groupId', groupId)
          params.set('page', String(page))
          params.set('limit', '20')
          if (filterFavorite) {
            params.set('favorite', 'true')
          }

          const res = await fetch(`/api/tasks?${params.toString()}`, {
            credentials: 'include',
          })
          const json = await res.json()
          if (json.success) {
            const rawTasks = json.data as TaskRecord[]
            const { hasMore } = json.pagination

            const settings = useStore.getState().settings
            const profiles = settings.profiles || []

            const newTasks = rawTasks.map((task) => {
              if (task.status === 'running') {
                const matchedProfile = profiles.find((p) => p.id === task.apiProfileId)
                const timeoutSeconds = matchedProfile?.timeout || getActiveApiProfile(settings)?.timeout || 600
                const elapsedSeconds = (Date.now() - task.createdAt) / 1000
                const hasRecoveryInfo = (task.apiProvider === 'fal' && task.falRequestId) || task.customTaskId

                // 孤儿判定：若已严重超时（超过 1.5 倍）且毫无轮询凭据，主动判定为超时错误并静默同步回远程 MySQL 数据库
                if (elapsedSeconds > timeoutSeconds * 1.5 || (elapsedSeconds > 1800 && !hasRecoveryInfo)) {
                  task.status = 'error'
                  task.error = '生图任务网络超时或进程被打断，未成功完成。'
                  task.finishedAt = Date.now()
                  task.elapsed = Date.now() - task.createdAt

                  void (async () => {
                    try {
                      await putTask(task)
                    } catch (err) {
                      console.error('异步同步已修正的僵尸任务到数据库失败:', err)
                    }
                  })()
                } else {
                  // 只要是运行中任务，前台在加载出后，立即主动重新激活/插一下云端轮询恢复，保证绝对不错过任何一个被打断但实际已生成的任务！
                  if (
                    task.apiProvider === 'fal' &&
                    task.falRequestId &&
                    task.falEndpoint
                  ) {
                    scheduleFalRecovery(task.id, 0)
                  } else if (task.customTaskId) {
                    scheduleCustomRecovery(task.id, 0)
                  }
                }
              }
              scheduleTaskRemoteImageTransfers(task, 0)
              return task
            })

            set((s) => {
              const updatedTasks = append ? [...s.tasks, ...newTasks] : newTasks

              const seenIds = new Set<string>()
              const uniqueTasks = updatedTasks.filter((t) => {
                if (seenIds.has(t.id)) return false
                seenIds.add(t.id)
                return true
              })

              return {
                tasks: uniqueTasks,
                tasksCurrentPage: page,
                tasksHasMore: hasMore,
              }
            })
          }
        } catch (e) {
          console.error('Failed to load tasks:', e)
        } finally {
          set({ tasksLoading: false })
        }
      },
      setSettings: (s) => set((st) => {
        const previous = normalizeSettings(st.settings)
        const incoming = s as Partial<AppSettings>
        const hasLegacyOverrides =
          incoming.baseUrl !== undefined ||
          incoming.model !== undefined ||
          incoming.timeout !== undefined ||
          incoming.apiMode !== undefined ||
          incoming.apiProxy !== undefined ||
          incoming.streamImages !== undefined ||
          incoming.streamPartialImages !== undefined
        const merged = normalizeSettings({ ...previous, ...incoming })
        if (hasLegacyOverrides && incoming.profiles === undefined) {
          merged.profiles = merged.profiles.map((profile) =>
            profile.id === merged.activeProfileId
              ? {
                  ...profile,
                  baseUrl: incoming.baseUrl ?? profile.baseUrl,
                  model: incoming.model ?? profile.model,
                  timeout: incoming.timeout ?? profile.timeout,
                  apiMode: incoming.apiMode === 'images' || incoming.apiMode === 'responses' ? incoming.apiMode : profile.apiMode,
                  apiProxy: incoming.apiProxy ?? profile.apiProxy,
                  streamImages: incoming.streamImages ?? profile.streamImages,
                  streamPartialImages: incoming.streamPartialImages ?? profile.streamPartialImages,
                }
              : profile,
          )
        }
        const settings = normalizeSettings(merged)
        const shouldClearReusedProfile = st.reusedTaskApiProfileId && settings.activeProfileId === st.reusedTaskApiProfileId
        return {
          settings,
          ...(shouldClearReusedProfile
            ? { reusedTaskApiProfileId: null, reusedTaskApiProfileName: null, reusedTaskApiProfileMissing: false }
            : {}),
        }
      }),
      // Input
      prompt: '',
      setPrompt: (prompt) => set((s) => syncActiveInputDraft(s, { prompt })),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return syncActiveInputDraft(s, { inputImages: [...s.inputImages, img] })
        }),
      replaceInputImage: (idx, img) => {
        let removedImageId: string | null = null
        set((s) => {
          if (idx < 0 || idx >= s.inputImages.length) return s
          const previous = s.inputImages[idx]
          if (!previous || previous.id === img.id) return s
          if (s.inputImages.some((item, itemIdx) => itemIdx !== idx && item.id === img.id)) return s
          removedImageId = previous.id
          const inputImages = s.inputImages.map((item, itemIdx) => itemIdx === idx ? img : item)
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages, { [previous.id]: img.id }),
          })
        })
        if (removedImageId) void deleteImageIfUnreferenced(removedImageId)
      },
      removeInputImage: (idx) => {
        set((s) => {
          const inputImages = s.inputImages.filter((_, i) => i !== idx)
          return syncActiveInputDraft(s, {
            inputImages,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, inputImages),
          })
        })
        useStore.getState().showToast('参考图已移除', 'info')
      },
      clearInputImages: () => {
        set((s) => {
          for (const img of s.inputImages) imageCache.delete(img.id)
          return syncActiveInputDraft(s, {
            inputImages: [],
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, []),
            maskEditorImageId: null,
          })
        })
        useStore.getState().showToast('参考图已清空', 'info')
      },
      setInputImages: (imgs, options) =>
        set((s) => syncActiveInputDraft(s, {
          inputImages: imgs,
          prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, imgs, options?.equivalentImageIds),
        })),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const targetIdx = Math.max(0, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return syncActiveInputDraft(s, {
            inputImages: images,
            prompt: remapImageMentionsForOrder(s.prompt, s.inputImages, images),
          })
        }),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => {
        if (maskEditorImageId) dismissAllTooltips()
        set((s) => syncActiveInputDraft(s, { maskEditorImageId }))
      },
      galleryInputDraft: null,

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => {
        const params = { ...s.params, ...p }
        return { params: { ...params, resolution: normalizeResolution(params.resolution, DEFAULT_PARAMS.resolution) } }
      }),
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      setReusedTaskApiProfile: (profileId, missing = false, profileName = null) => set({
        reusedTaskApiProfileId: profileId,
        reusedTaskApiProfileName: profileName,
        reusedTaskApiProfileMissing: missing,
      }),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set(() => ({
        tasks,
        ...(countSuccessfulOutputImages(tasks) <= SUPPORT_PROMPT_IMAGE_THRESHOLD
          ? { supportPromptSkippedForImportedData: false }
          : {}),
      })),
      streamPreviews: {},
      streamPreviewSlots: {},
      setTaskStreamPreview: (taskId, image, requestIndex = 0) => set((s) => {
        if (image) {
          const slotKey = String(requestIndex)
          const currentSlots = s.streamPreviewSlots[taskId] ?? {}
          if (s.streamPreviews[taskId] === image && currentSlots[slotKey] === image) return s
          return {
            streamPreviews: { ...s.streamPreviews, [taskId]: image },
            streamPreviewSlots: {
              ...s.streamPreviewSlots,
              [taskId]: { ...currentSlots, [slotKey]: image },
            },
          }
        }

        if (!(taskId in s.streamPreviews) && !(taskId in s.streamPreviewSlots)) return s
        const next = { ...s.streamPreviews }
        const nextSlots = { ...s.streamPreviewSlots }
        delete next[taskId]
        delete nextSlots[taskId]
        return { streamPreviews: next, streamPreviewSlots: nextSlots }
      }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set({ filterFavorite }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) => set((s) => ({
        selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
      })),
      toggleTaskSelection: (id, force) => set((s) => {
        const isSelected = s.selectedTaskIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedTaskIds: shouldSelect
            ? [...s.selectedTaskIds, id]
            : s.selectedTaskIds.filter((x) => x !== id)
        }
      }),
      clearSelection: () => set({ selectedTaskIds: [] }),

      // UI
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => {
        if (detailTaskId) dismissAllTooltips()
        set({ detailTaskId })
      },
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) => {
        if (lightboxImageId) dismissAllTooltips()
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) })
      },
      showSettings: false,
      settingsTabRequest: null,
      setShowSettings: (showSettings, settingsTabRequest) => {
        if (showSettings) dismissAllTooltips()
        set({
          showSettings,
          ...(settingsTabRequest ? { settingsTabRequest } : {}),
          ...(!showSettings ? { settingsTabRequest: null } : {}),
        })
      },
      supportPromptOpen: false,
      supportPromptDismissed: false,
      supportPromptSkippedForImportedData: false,
      setSupportPromptOpen: (supportPromptOpen) => set({ supportPromptOpen }),
      dismissSupportPrompt: () => set({ supportPromptOpen: false, supportPromptDismissed: true }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        const toastMessage = getToastMessage(message, type)
        const toast = { message: toastMessage, type }
        set({ toast })
        setTimeout(() => {
          set((s) => (s.toast === toast ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => {
        if (confirmDialog) dismissAllTooltips()
        set({ confirmDialog })
      },

      // 分组管理
      createGroup: async (name) => {
        const newGroup = { id: genId(), name, createdAt: Date.now() }
        try {
          const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newGroup),
            credentials: 'include',
          })
          const json = await res.json()
          if (json.success) {
            set((s) => {
              const groups = [...(s.settings.groups ?? []), newGroup]
              return { settings: { ...s.settings, groups } }
            })
          }
        } catch (e) {
          console.error('Failed to create group:', e)
        }
      },
      deleteGroup: async (id) => {
        try {
          const res = await fetch(`/api/groups?id=${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include',
          })
          const json = await res.json()
          if (json.success) {
            set((s) => {
              const groups = (s.settings.groups ?? []).filter((g) => g.id !== id)
              const tasks = s.tasks.map((t) => t.groupId === id ? { ...t, groupId: undefined } : t)
              return { settings: { ...s.settings, groups }, tasks }
            })
            // 如果删除的是当前选中的分组，则切回“未分类”
            const { selectedGroupId, setSelectedGroupId } = useStore.getState()
            if (selectedGroupId === id) {
              setSelectedGroupId('unassigned')
            }
          }
        } catch (e) {
          console.error('Failed to delete group:', e)
        }
      },
      renameGroup: async (id, name) => {
        const { settings } = useStore.getState()
        const target = (settings.groups ?? []).find((g) => g.id === id)
        if (!target) return

        const updatedGroup = { ...target, name }
        try {
          const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedGroup),
            credentials: 'include',
          })
          const json = await res.json()
          if (json.success) {
            set((s) => {
              const groups = (s.settings.groups ?? []).map((g) => g.id === id ? { ...g, name } : g)
              return { settings: { ...s.settings, groups } }
            })
          }
        } catch (e) {
          console.error('Failed to rename group:', e)
        }
      },
      assignTaskToGroup: (taskId, groupId) => {
        updateTaskInStore(taskId, { groupId: groupId ?? undefined })
      },
    }),
    {
      name: 'gpt-image-playground',
      storage: createJSONStorage(() => customAsyncStorage),
      partialize: getPersistedState,
      merge: mergePersistedState,
    },
  ),
)

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

function getApiKeyFingerprint(apiKey: string): string {
  if (!apiKey) return 'default'
  let hash = 0
  for (let i = 0; i < apiKey.length; i++) {
    hash = (hash << 5) - hash + apiKey.charCodeAt(i)
    hash |= 0
  }
  return 'user_' + Math.abs(hash).toString(36)
}

export function getCurrentFingerprint(settings: AppSettings): string {
  const activeProfile = getActiveApiProfile(settings)
  return getApiKeyFingerprint(activeProfile?.apiKey || '')
}


function isOpenAITask(task: TaskRecord) {
  return (task.apiProvider ?? 'openai') !== 'fal'
}

function isRunningOpenAITask(task: TaskRecord) {
  return task.status === 'running' && isOpenAITask(task)
}

function isAsyncCustomProviderTask(settings: AppSettings, provider: string, hasInputImages: boolean) {
  const customProvider = getCustomProviderDefinition(settings, provider)
  if (!customProvider?.poll) return false
  const submitMapping = hasInputImages && customProvider.editSubmit ? customProvider.editSubmit : customProvider.submit
  return Boolean(submitMapping.taskIdPath)
}

export function markInterruptedOpenAIRunningTasks(tasks: TaskRecord[], now = Date.now()) {
  const interruptedTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningOpenAITask(task) || task.customTaskId) return task

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: OPENAI_INTERRUPTED_ERROR,
      falRecoverable: false,
      finishedAt: now,
      elapsed: Math.max(0, now - task.createdAt),
    }
    interruptedTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, interruptedTasks }
}

function clearOpenAIWatchdogTimer(taskId: string) {
  const timer = openAIWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  openAIWatchdogTimers.delete(taskId)
}

function failOpenAITaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return false

  updateTaskInStore(taskId, {
    status: 'error',
    error,
    falRecoverable: false,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

function scheduleOpenAIWatchdog(taskId: string, timeoutSeconds: number, profile?: TimeoutStreamingHintProfile | null) {
  clearOpenAIWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return

  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const remainingMs = Math.max(0, timeoutMs - (Date.now() - task.createdAt))
  const timer = setTimeout(() => {
    openAIWatchdogTimers.delete(taskId)
    const failed = failOpenAITaskIfStillRunning(taskId, createOpenAITimeoutError(timeoutSeconds, profile))
    if (failed) useStore.getState().showToast('OpenAI 任务请求超时', 'error')
  }, remainingMs)
  openAIWatchdogTimers.set(taskId, timer)
}


function getFalRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === 'fal') return taskProfile
  return null
}

function getCustomRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const provider = task.apiProvider ?? task.apiProfileSnapshot?.provider
  if (!provider || provider === 'openai' || provider === 'fal') return null
  const taskProfile = getTaskApiProfile(settings, task)
  if (taskProfile?.provider === provider) return taskProfile
  return null
}

export function getTaskApiProfile(settings: AppSettings, task: TaskRecord): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  const provider = task.apiProvider ?? task.apiProfileSnapshot?.provider

  if (!task.apiProfileId && !task.apiProfileSnapshot) return null

  const byId = task.apiProfileId
    ? normalized.profiles.find((profile) => profile.id === task.apiProfileId)
    : null
  if (byId && (!provider || byId.provider === provider)) return byId
  return task.apiProfileSnapshot && (!provider || task.apiProfileSnapshot.provider === provider)
    ? normalizeSettings({
      ...settings,
      profiles: [task.apiProfileSnapshot],
      activeProfileId: task.apiProfileSnapshot.id,
    }).profiles[0] ?? task.apiProfileSnapshot
    : null
}

function createSettingsForApiProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const normalized = normalizeSettings(settings)
  return normalizeSettings({
    ...normalized,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    apiProxy: profile.apiProxy,
    profiles: normalized.profiles.map((item) => item.id === profile.id ? profile : item),
    activeProfileId: profile.id,
  })
}

function getReusedTaskApiProfile(settings: AppSettings, profileId: string | null): ApiProfile | null {
  if (!profileId) return null
  return normalizeSettings(settings).profiles.find((profile) => profile.id === profileId) ?? null
}

function getTaskApiProfileName(task: TaskRecord) {
  return task.apiProfileName || task.apiProfileSnapshot?.name || task.apiModel || '未知配置'
}

function getTaskCustomProviderDefinition(settings: AppSettings, task: TaskRecord): CustomProviderDefinition | null {
  const provider = task.apiProvider ?? task.apiProfileSnapshot?.provider
  if (!provider || provider === 'openai' || provider === 'fal') return null
  return getCustomProviderDefinition(settings, provider) ?? task.customProviderSnapshot ?? null
}

function isFalConnectionRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function isApiRequestNetworkError(err: unknown): boolean {
  if (err instanceof TypeError) {
    const message = err.message.toLowerCase()
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed/i.test(message)
  }
  return false
}

function getApiModeApiName(apiMode: ApiMode) {
  return apiMode === 'responses' ? 'Responses API' : 'Image API'
}

function getApiRequestNetworkErrorHint(
  err: unknown,
  createdAt: number,
  usesApiProxy: boolean,
  profile?: Pick<ApiProfile, 'provider' | 'apiMode' | 'streamImages' | 'streamPartialImages'> | null,
): string | null {
  if (!isApiRequestNetworkError(err)) return null

  const elapsedSeconds = Math.max(0, (Date.now() - createdAt) / 1000)

  if (elapsedSeconds <= 15) {
    if (usesApiProxy) {
      return '提示：请求立即失败，请检查 API 代理服务是否正常运行。'
    }
    const unsupportedApiHint = profile?.provider === 'openai'
      ? `\n· API 不支持 ${getApiModeApiName(profile.apiMode)}`
      : ''
    return `提示：请求立即失败，可能原因：\n· API 服务器不可达或地址有误，请检查 API URL 是否正确、服务是否正常运行${unsupportedApiHint}\n· 接口不支持浏览器跨域请求，可使用 Docker 部署版或本地运行版并配置 API 代理解决`
  }

  if (elapsedSeconds >= 55 && elapsedSeconds <= 75) {
    return `提示：请求等待约 60 秒后被断开，这通常是 Nginx 等反向代理的默认超时，而非接口本身报错。可调大代理的超时时间（如 proxy_read_timeout），或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
  }

  if (elapsedSeconds >= 110 && elapsedSeconds <= 140) {
    return `提示：请求等待约 120 秒后被断开，这通常是 Cloudflare 等 CDN/网关的超时限制，而非接口本身报错。如果使用 Cloudflare，可考虑升级套餐或使用不经过 CDN 的直连地址。${getTimeoutStreamingHint(profile)}`
  }

  return `提示：请求等待较长时间后被断开，通常是反向代理或网关的超时限制，而非接口本身报错。可检查代理超时设置，或降低图片尺寸/质量后重试。${getTimeoutStreamingHint(profile)}`
}

function getRawErrorPayload(err: unknown): Pick<Partial<TaskRecord>, 'rawImageUrls' | 'rawResponsePayload'> {
  if (!(err instanceof Error)) return {}

  const rawImageUrls = 'rawImageUrls' in err ? (err as { rawImageUrls?: unknown }).rawImageUrls : undefined
  const rawResponsePayload = 'rawResponsePayload' in err ? (err as { rawResponsePayload?: unknown }).rawResponsePayload : undefined
  return {
    rawImageUrls: Array.isArray(rawImageUrls) && rawImageUrls.length ? rawImageUrls.filter((url): url is string => typeof url === 'string') : undefined,
    rawResponsePayload: typeof rawResponsePayload === 'string' ? rawResponsePayload : undefined,
  }
}

function clearFalRecoveryTimer(taskId: string) {
  const timer = falRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  falRecoveryTimers.delete(taskId)
}

function scheduleFalRecovery(taskId: string, delayMs = FAL_RECOVERY_POLL_MS) {
  if (falRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    falRecoveryTimers.delete(taskId)
    recoverFalTask(taskId)
  }, delayMs)
  falRecoveryTimers.set(taskId, timer)
}

function clearCustomRecoveryTimer(taskId: string) {
  const timer = customRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  customRecoveryTimers.delete(taskId)
}

function scheduleCustomRecovery(taskId: string, delayMs = CUSTOM_RECOVERY_POLL_MS) {
  if (customRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    customRecoveryTimers.delete(taskId)
    recoverCustomTask(taskId)
  }, delayMs)
  customRecoveryTimers.set(taskId, timer)
}

function hasActualParams(params: Partial<TaskParams> | undefined): params is Partial<TaskParams> {
  return Boolean(params && Object.keys(params).length > 0)
}

function firstActualParams(paramsList: Array<Partial<TaskParams> | undefined> | undefined): Partial<TaskParams> | undefined {
  return paramsList?.find(hasActualParams)
}

function mapActualParamsByImage(outputIds: string[], paramsList: Array<Partial<TaskParams> | undefined> | undefined) {
  const mapped = paramsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
    const imgId = outputIds[index]
    if (imgId && hasActualParams(params)) acc[imgId] = params
    return acc
  }, {})
  return mapped && Object.keys(mapped).length > 0 ? mapped : undefined
}

async function readImageSizeParam(dataUrl: string): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return undefined

  return new Promise((resolve) => {
    let settled = false
    const image = new Image()
    const finish = (params: Partial<TaskParams> | undefined) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(params)
    }
    const timer = setTimeout(() => finish(undefined), 2000)
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
      } else {
        finish(undefined)
      }
    }
    image.onerror = () => finish(undefined)
    image.src = dataUrl
    if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
      finish({ size: `${image.naturalWidth}x${image.naturalHeight}` })
    }
  })
}

async function readImageSizeParamsList(images: string[]): Promise<Array<Partial<TaskParams> | undefined>> {
  return Promise.all(images.map((image) => readImageSizeParam(image)))
}

async function resolveImageSizeParamsList(
  images: string[],
  preferred?: Array<Partial<TaskParams> | undefined>,
): Promise<Array<Partial<TaskParams> | undefined>> {
  if (preferred?.length === images.length && preferred.every(hasActualParams)) return preferred
  const fallback = await readImageSizeParamsList(images)
  return images.map((_, index) => hasActualParams(preferred?.[index]) ? preferred?.[index] : fallback[index])
}

async function completeRecoveredFalTask(task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return

  const actualParamsList = await resolveImageSizeParamsList(result.images, result.actualParamsList)
  const outputIds: string[] = []
  for (const dataUrl of result.images) {
    const imgId = await persistGeneratedImage(dataUrl, task.id)
    outputIds.push(imgId)
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    falRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(`fal.ai 任务已恢复，共 ${outputIds.length} 张图片`, 'success')
}

async function recoverFalTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  let task = tasks.find((item) => item.id === taskId)
  if (!task) {
    const allTasks = await getAllTasks()
    task = allTasks.find((item) => item.id === taskId)
  }
  if (!task) return
  const taskProvider = task.apiProvider ?? task.apiProfileSnapshot?.provider
  if (taskProvider !== 'fal' || !task.falRequestId || !task.falEndpoint || task.status === 'done') return

  const profile = getFalRecoveryProfile(settings, task)
  if (!profile) {
    scheduleFalRecovery(taskId)
    return
  }

  try {
    const result = await getFalQueuedImageResult(profile, task.falEndpoint, task.falRequestId, task.params)
    clearFalRecoveryTimer(taskId)
    await completeRecoveredFalTask(task, result)
    return
  } catch (err) {
    if (isFalConnectionRecoverableError(err)) {
      scheduleFalRecovery(taskId)
      return
    }

    clearFalRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: getFalErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)),
      ...getRawErrorPayload(err),
      falRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
  }
}

/** 初始化：从 IndexedDB 加载任务，按需恢复输入图片，并清理孤立图片 */
export async function initStore() {
  // 1. 异步请求并拉取所有分组列表
  try {
    const res = await fetch('/api/groups', { credentials: 'include' })
    const json = await res.json()
    if (json.success) {
      useStore.getState().setSettings({ groups: json.data })
    }
  } catch (e) {
    console.error('Failed to init groups:', e)
  }

  // 2. 默认加载当前选中分组第一页任务（初始为 unassigned）
  const { selectedGroupId } = useStore.getState()
  await useStore.getState().loadMoreTasks(selectedGroupId || 'unassigned', 1, false)

  // 3. 异步托管全量自检、故障恢复和清理孤立图片逻辑，不阻塞前台渲染
  void (async () => {
    try {
      const storedTasks = await getAllTasks()
      const { tasks: markedTasks, interruptedTasks } = markInterruptedOpenAIRunningTasks(storedTasks)

      const settings = useStore.getState().settings
      const profiles = settings.profiles || []
      let tasksUpdated = false
      const processedTasks = markedTasks.map((task) => {
        // 自检防线：如果运行中的任务已超时（采用 1.5 倍宽限期），且无任何云端挂起轮询凭据，主动判定其超时失败
        if (task.status === 'running') {
          const matchedProfile = profiles.find((p) => p.id === task.apiProfileId)
          const timeoutSeconds = matchedProfile?.timeout || getActiveApiProfile(settings)?.timeout || 600
          const elapsedSeconds = (Date.now() - task.createdAt) / 1000
          const hasRecoveryInfo = (task.apiProvider === 'fal' && task.falRequestId) || task.customTaskId

          if (elapsedSeconds > timeoutSeconds * 1.5 || (elapsedSeconds > 1800 && !hasRecoveryInfo)) {
            task.status = 'error'
            task.error = '生图任务网络超时或进程被打断，未成功完成。'
            task.finishedAt = Date.now()
            task.elapsed = Date.now() - task.createdAt
            tasksUpdated = true
          }
        }

        if (!task.ownerFingerprint) {
          const matchedProfile = profiles.find((p) => p.id === task.apiProfileId)
          const apiKey = matchedProfile?.apiKey || getActiveApiProfile(settings)?.apiKey || ''
          task.ownerFingerprint = getApiKeyFingerprint(apiKey)
          tasksUpdated = true
        }
        return task
      })

      if (tasksUpdated || interruptedTasks.length > 0) {
        await Promise.all(processedTasks.map((task) => putTask(task)))

        // 同步更新前台内存 store 里的任务列表，让画廊卡片能够瞬间刷新显示正确状态！
        const currentTasks = useStore.getState().tasks
        const updatedCurrent = currentTasks.map((t) => {
          const matched = processedTasks.find((pt) => pt.id === t.id)
          return matched ? matched : t
        })
        useStore.getState().setTasks(updatedCurrent)
      }

      for (const task of processedTasks) {
        scheduleTaskRemoteImageTransfers(task, 0)
        if (
          task.apiProvider === 'fal' &&
          task.falRequestId &&
          task.falEndpoint &&
          (task.status === 'running' || task.falRecoverable)
        ) {
          scheduleFalRecovery(task.id, 0)
        }
        if (
          task.customTaskId &&
          (task.status === 'running' || task.customRecoverable)
        ) {
          scheduleCustomRecovery(task.id, 0)
        }
      }

      // 收集图片引用
      const referencedIds = new Set<string>()
      const state = useStore.getState()
      const persistedInputImages = state.inputImages
      const galleryInputDraft = state.galleryInputDraft
      for (const img of persistedInputImages) referencedIds.add(img.id)
      if (galleryInputDraft) {
        for (const img of galleryInputDraft.inputImages) referencedIds.add(img.id)
      }
      for (const t of processedTasks) {
        addTaskReferencedImageIds(referencedIds, t)
      }

      // 只枚举 key 清理孤立图片
      const imageIds = await getAllImageIds()
      const referencedImageIds: string[] = []
      for (const imgId of imageIds) {
        if (referencedIds.has(imgId)) {
          referencedImageIds.push(imgId)
        } else {
          await deleteImage(imgId)
        }
      }
      scheduleThumbnailBackfill(referencedImageIds)

      const restoredInputImages: InputImage[] = []
      for (const img of persistedInputImages) {
        if (img.dataUrl) {
          restoredInputImages.push(img)
          cacheImage(img.id, img.dataUrl)
          continue
        }
        const storedImage = await getImage(img.id)
        if (storedImage?.dataUrl) {
          restoredInputImages.push({ ...img, dataUrl: storedImage.dataUrl })
          cacheImage(img.id, storedImage.dataUrl)
        }
      }
      if (restoredInputImages.length !== persistedInputImages.length || restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)) {
        useStore.getState().setInputImages(restoredInputImages)
      }

      if (galleryInputDraft) {
        const restoredGalleryImages: InputImage[] = []
        for (const img of galleryInputDraft.inputImages) {
          if (img.dataUrl) {
            restoredGalleryImages.push(img)
            cacheImage(img.id, img.dataUrl)
            continue
          }
          const storedImage = await getImage(img.id)
          if (storedImage?.dataUrl) {
            restoredGalleryImages.push({ ...img, dataUrl: storedImage.dataUrl })
            cacheImage(img.id, storedImage.dataUrl)
          }
        }
        const restoredGalleryDraft: InputDraft = {
          ...galleryInputDraft,
          inputImages: restoredGalleryImages,
          prompt: remapImageMentionsForOrder(galleryInputDraft.prompt, galleryInputDraft.inputImages, restoredGalleryImages),
        }
        const galleryDraftsChanged =
          restoredGalleryImages.length !== galleryInputDraft.inputImages.length ||
          restoredGalleryImages.some((img, index) => img.dataUrl !== galleryInputDraft.inputImages[index]?.dataUrl)
        if (galleryDraftsChanged) {
          const nextGalleryInputDraft = isEmptyInputDraft(restoredGalleryDraft) ? null : restoredGalleryDraft
          useStore.setState({
            galleryInputDraft: nextGalleryInputDraft,
            ...restoreGalleryInputDraftState(nextGalleryInputDraft),
          })
        }
      }
    } catch (e) {
      console.error('Background self-heal inspection failed:', e)
    }
  })()
}

// ===== 主题应用与全局监听 =====

function applyTheme(theme: 'light' | 'dark' | 'system') {
  if (typeof window === 'undefined') return
  const root = document.documentElement
  let isDark = false
  if (theme === 'dark') {
    isDark = true
  } else if (theme === 'light') {
    isDark = false
  } else {
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  }

  if (isDark) {
    root.classList.add('dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0d111c')
  } else {
    root.classList.remove('dark')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f9fafb')
  }
}

if (typeof window !== 'undefined') {
  let lastTheme: string | undefined = undefined
  useStore.subscribe((state) => {
    const newTheme = state.settings?.theme || 'system'
    if (newTheme !== lastTheme) {
      lastTheme = newTheme
      applyTheme(newTheme)
      localStorage.setItem('gpt-image-theme', newTheme)
    }
  })

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleMediaChange = () => {
    const currentTheme = useStore.getState().settings?.theme || 'system'
    if (currentTheme === 'system') {
      applyTheme('system')
    }
  }
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleMediaChange)
  } else {
    (mediaQuery as any).addListener(handleMediaChange)
  }
}

/** 提交新任务 */
export async function submitTask(options: { allowFullMask?: boolean; useCurrentApiProfileWhenReusedMissing?: boolean } = {}) {
  const { settings, prompt, inputImages, params, reusedTaskApiProfileId, reusedTaskApiProfileName, reusedTaskApiProfileMissing, showToast, setConfirmDialog, selectedGroupId } =
    useStore.getState()

  const normalizedSettings = normalizeSettings(settings)
  let activeProfile = getActiveApiProfile(settings)
  let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  if (reusedTaskApiProfileId || reusedTaskApiProfileMissing) {
    const reusedProfile = getReusedTaskApiProfile(normalizedSettings, reusedTaskApiProfileId)
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        useStore.getState().setReusedTaskApiProfile(null)
      } else {
        setConfirmDialog({
          title: '找不到 API 配置',
      message: `找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
      action: () => {
        void submitTask({ ...options, useCurrentApiProfileWhenReusedMissing: true })
      },
        })
        return
      }
    } else {
      activeProfile = reusedProfile
      requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
    }
  }

  if (validateApiProfile(activeProfile)) {
    showToast(`请先完善请求 API 配置：${validateApiProfile(activeProfile)}`, 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  const taskId = genId()

  // 建立临时 ID 到真实物理 ID 的映射表
  const idMap: Record<string, string> = {}
  const uploadedImages: InputImage[] = []

  // 1. 统一后台延迟上传本地临时图片到对象存储任务目录 uploads/${taskId}/reference/images/
  for (const img of inputImages) {
    if (img.id.startsWith('temp-')) {
      const realId = await storeImage(img.dataUrl, 'upload', taskId)
      cacheImage(realId, img.dataUrl) // 本地内存缓存登记
      idMap[img.id] = realId
      uploadedImages.push({ id: realId, dataUrl: img.dataUrl, editSource: img.editSource })
    } else {
      uploadedImages.push(img)
    }
  }

  // 2. 如果存在临时 ID 到真实哈希 ID 的升级，前端自动完成 mentions 和 Store 替换
  if (Object.keys(idMap).length > 0) {
    useStore.getState().setInputImages(uploadedImages, { equivalentImageIds: idMap })
  }

  const normalizedParams = normalizeParamsForSettings(params, requestSettings, { hasInputImages: uploadedImages.length > 0 })
  const normalizedParamPatch = getChangedParams(params, normalizedParams)
  if (Object.keys(normalizedParamPatch).length) {
    useStore.getState().setParams(normalizedParamPatch)
  }

  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: normalizedParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    apiProfileSnapshot: { ...activeProfile },
    customProviderSnapshot: getCustomProviderDefinition(settings, activeProfile.provider) ?? undefined,
    inputImageIds: uploadedImages.map((i) => i.id),
    maskTargetImageId: uploadedImages.find((image) => image.editSource === 'mask')?.id ?? null,
    maskImageId: null,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
    ownerFingerprint: getCurrentFingerprint(settings),
    groupId: selectedGroupId && selectedGroupId !== 'unassigned' ? selectedGroupId : undefined,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  await putTask(task)
  useStore.getState().showToast('任务已提交', 'success')

  if (settings.clearInputAfterSubmit) {
    useStore.getState().setPrompt('')
    useStore.getState().clearInputImages()
  }
  useStore.getState().setReusedTaskApiProfile(null)

  // 异步调用 API
  executeTask(taskId)
}

function addInputDraftReferencedImageIds(target: Set<string>, draft: InputDraft | null) {
  if (!draft) return
  for (const img of draft.inputImages) target.add(img.id)
}

function addTaskReferencedImageIds(target: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) target.add(id)
  if (task.maskImageId) target.add(task.maskImageId)
  for (const id of task.outputImages || []) target.add(id)
  for (const id of task.streamPartialImageIds || []) target.add(id)
}

async function deleteUnreferencedImageIds(imageIds: Iterable<string>) {
  const candidates = Array.from(new Set(Array.from(imageIds).filter(Boolean)))
  if (candidates.length === 0) return

  const { tasks, inputImages, galleryInputDraft } = useStore.getState()
  const stillUsed = new Set<string>()
  for (const task of tasks) addTaskReferencedImageIds(stillUsed, task)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)

  for (const imgId of candidates) {
    if (stillUsed.has(imgId)) continue
    await deleteImage(imgId)
    imageCache.delete(imgId)
    thumbnailCache.delete(imgId)
  }
}

function collectStillReferencedImageIds(tasks: TaskRecord[], inputImages: InputImage[], galleryInputDraft: InputDraft | null) {
  const stillUsed = new Set<string>()
  for (const task of tasks) addTaskReferencedImageIds(stillUsed, task)
  addInputDraftReferencedImageIds(stillUsed, galleryInputDraft)
  for (const img of inputImages) stillUsed.add(img.id)
  return stillUsed
}

async function persistTaskStreamPartialImage(taskId: string, dataUrl: string) {
  try {
    const imgId = await persistGeneratedImage(dataUrl, taskId)

    const latestTask = useStore.getState().tasks.find((task) => task.id === taskId)
    if (!latestTask || latestTask.status === 'done') {
      await deleteUnreferencedImageIds([imgId])
      return
    }

    const currentIds = latestTask.streamPartialImageIds || []
    if (currentIds.includes(imgId)) return
    updateTaskInStore(taskId, { streamPartialImageIds: [...currentIds, imgId] })
  } catch (err) {
    console.error(err)
  }
}

async function compressImageBase64(dataUrl: string): Promise<string> {
  if (typeof window === 'undefined' || !dataUrl.startsWith('data:image/')) return dataUrl

  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      // 限制最大边为 1024，生图参考图无需过大
      const maxSide = 1024
      let w = img.width
      let h = img.height
      if (w > maxSide || h > maxSide) {
        if (w > h) {
          h = Math.round((h * maxSide) / w)
          w = maxSide
        } else {
          w = Math.round((w * maxSide) / h)
          h = maxSide
        }
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h)
        // 导出为高度压缩的 jpeg 格式，画质高而体积极小
        resolve(canvas.toDataURL('image/jpeg', 0.72))
      } else {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

/**
 * 确保图片是 100% 物理可达的绝对路径或 Base64：
 * 1. 如果是相对路径（如以 / 开头）且非 Base64，自动通过 fetch 转换为 Base64，保证在 localhost 开发环境下也能让三方 API 访问。
 * 2. 如果 fetch 失败（如跨域或服务不可达），则利用 window.location.origin 自动拼接补全为公网绝对 URL 进行兜底。
 */
async function ensureImageAbsoluteOrBase64(dataUrl: string): Promise<string> {
  if (typeof window === 'undefined') return dataUrl

  if (
    typeof dataUrl === 'string' &&
    !dataUrl.startsWith('data:') &&
    (dataUrl.startsWith('/') || !/^https?:\/\//i.test(dataUrl))
  ) {
    try {
      const absoluteUrl = dataUrl.startsWith('/')
        ? `${window.location.origin}${dataUrl}`
        : dataUrl
      const res = await fetch(absoluteUrl)
      if (res.ok) {
        const blob = await res.blob()
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        return base64
      }
    } catch (err) {
      console.warn('尝试将相对路径图片转为 Base64 失败，将使用绝对 URL 兜底:', err)
      if (dataUrl.startsWith('/')) {
        return `${window.location.origin}${dataUrl}`
      }
    }
  }
  return dataUrl
}

async function executeTask(taskId: string) {
  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) return
  const taskProfile = getTaskApiProfile(settings, task)
  if (!taskProfile && task.apiProfileId) {
    updateTaskInStore(taskId, {
      status: 'error',
      error: '找不到此任务所使用的 API 配置。',
      falRecoverable: false,
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
    return
  }
  const activeProfile = taskProfile ?? getActiveApiProfile(settings)
  const requestSettings = createSettingsForApiProfile(settings, activeProfile)
  const taskProvider = task.apiProvider ?? activeProfile.provider
  let falRequestInfo: { requestId: string; endpoint: string } | null = task.falRequestId && task.falEndpoint
        ? { requestId: task.falRequestId, endpoint: task.falEndpoint }
    : null
  let customTaskInfo: { taskId: string } | null = task.customTaskId
    ? { taskId: task.customTaskId }
    : null

  if (taskProvider !== 'fal' && !isAsyncCustomProviderTask(requestSettings, taskProvider, task.inputImageIds.length > 0)) {
    scheduleOpenAIWatchdog(taskId, activeProfile.timeout, activeProfile)
  }

  try {
    // 获取输入图片 data URLs，在前端进行极速且深度的 JPEG 压缩以保证网络传输的最佳物理稳定性
    const inputDataUrls: string[] = []

    for (let i = 0; i < task.inputImageIds.length; i++) {
      const imgId = task.inputImageIds[i]
      let dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error('输入图片已不存在')

      // 先对相对路径的参考图片进行智能 Base64 转换与绝对路径补全自愈
      dataUrl = await ensureImageAbsoluteOrBase64(dataUrl)

      // 生图发送前自动对 Base64 图片进行 JPEG 高倍体积缩减
      dataUrl = await compressImageBase64(dataUrl)
      inputDataUrls.push(dataUrl)
    }

    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      let dataUrl = await ensureImageCached(task.maskImageId)
      if (!dataUrl) throw new Error('遮罩图片已不存在')

      // 对相对路径的遮罩图片进行智能 Base64 转换与绝对路径补全自愈
      dataUrl = await ensureImageAbsoluteOrBase64(dataUrl)

      dataUrl = await compressImageBase64(dataUrl)
      maskDataUrl = dataUrl
    }

    const result = await callImageApi({
      settings: requestSettings,
      prompt: replaceImageMentionsForApi(task.prompt, inputDataUrls.length),
      params: task.params,
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
      onFalRequestEnqueued: (request) => {
        falRequestInfo = request
        updateTaskInStore(taskId, {
          falRequestId: request.requestId,
          falEndpoint: request.endpoint,
          falRecoverable: false,
        })
      },
      onCustomTaskEnqueued: (request) => {
        customTaskInfo = request
        updateTaskInStore(taskId, {
          customTaskId: request.taskId,
          customRecoverable: false,
        })
      },
      onCustomTaskProgress: (progress) => {
        if (progress.cost != null) {
          updateTaskInStore(taskId, { cost: progress.cost })
        }
      },
      onPartialImage: (partial) => {
        useStore.getState().setTaskStreamPreview(taskId, partial.image, partial.requestIndex)
        void persistTaskStreamPartialImage(taskId, partial.image)
      },
    })

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeSuccess || latestBeforeSuccess.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      return
    }

    // 存储输出图片
    const outputIds: string[] = []
    for (const dataUrl of result.images) {
      const imgId = await persistGeneratedImage(dataUrl, taskId)
      outputIds.push(imgId)
    }
    const isAsyncCustomTask = taskProvider !== 'fal' && taskProvider !== 'openai' && Boolean(customTaskInfo)
    const actualParamsList = taskProvider === 'fal'
      ? await resolveImageSizeParamsList(result.images, result.actualParamsList)
      : isAsyncCustomTask
      ? await readImageSizeParamsList(result.images)
      : result.actualParamsList
    const actualParams = (() => {
      if (taskProvider === 'fal') return firstActualParams(actualParamsList)
      if (isAsyncCustomTask) return firstActualParams(actualParamsList)
      return { ...result.actualParams, n: outputIds.length }
    })()
    const shouldStoreRevisedPrompts = taskProvider !== 'fal' && !isAsyncCustomTask
    const actualParamsByImage = mapActualParamsByImage(outputIds, actualParamsList)
    const revisedPromptByImage = shouldStoreRevisedPrompts ? result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
      const imgId = outputIds[index]
      if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
      return acc
    }, {}) : undefined
    // 更新任务
    const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') {
      useStore.getState().setTaskStreamPreview(taskId)
      return
    }
    const partialImageIdsToClean = latestBeforeUpdate.streamPartialImageIds || []
    clearOpenAIWatchdogTimer(taskId)
    useStore.getState().setTaskStreamPreview(taskId)
    updateTaskInStore(taskId, {
      outputImages: outputIds,
      streamPartialImageIds: undefined,
      rawImageUrls: result.rawImageUrls?.length ? result.rawImageUrls : undefined,
      actualParams,
      actualParamsByImage,
      revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
      status: 'done',
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
      falRecoverable: false,
      customRecoverable: false,
      cost: result.cost,
    })
    void deleteUnreferencedImageIds(partialImageIdsToClean)

    useStore.getState().showToast(`生成完成，共 ${outputIds.length} 张图片`, 'success')
  } catch (err) {
    clearOpenAIWatchdogTimer(taskId)
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId) ?? task
    if (latestTask.status !== 'running') return
    useStore.getState().setTaskStreamPreview(taskId)
    const latestFalRequestInfo = falRequestInfo ?? (latestTask.falRequestId && latestTask.falEndpoint
      ? { requestId: latestTask.falRequestId, endpoint: latestTask.falEndpoint }
      : null)
    const latestCustomTaskInfo = customTaskInfo ?? (latestTask.customTaskId ? { taskId: latestTask.customTaskId } : null)
    if (latestTask.apiProvider === 'fal' && latestFalRequestInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
        falRequestId: latestFalRequestInfo.requestId,
        falEndpoint: latestFalRequestInfo.endpoint,
        falRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleFalRecovery(taskId)
    } else if (latestCustomTaskInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: '与自定义异步任务的连接已断开，之后会继续查询任务结果。',
        customTaskId: latestCustomTaskInfo.taskId,
        customRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleCustomRecovery(taskId)
    } else {
      let errorMessage = err instanceof Error ? err.message : String(err)
      const settings = useStore.getState().settings
      const profile = getTaskApiProfile(settings, latestTask)
      const usesApiProxy = profile?.apiProxy ?? settings.apiProxy
      const activeProfile = getActiveApiProfile(settings)
      const hintProfile = profile ?? {
        provider: latestTask.apiProvider ?? activeProfile.provider,
        apiMode: settings.apiMode,
        streamImages: activeProfile.streamImages,
        streamPartialImages: activeProfile.streamPartialImages,
      }
      const networkErrorHint = getApiRequestNetworkErrorHint(err, latestTask.createdAt, usesApiProxy, hintProfile)
      if (networkErrorHint && !errorMessage.includes(IMAGE_FETCH_CORS_HINT)) {
        errorMessage += `\n${networkErrorHint}`
      }
      updateTaskInStore(taskId, {
        status: 'error',
        error: errorMessage,
        ...getRawErrorPayload(err),
        falRecoverable: false,
        customRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      useStore.getState().showToast(`生成失败: ${errorMessage}`, 'error')
      useStore.getState().setDetailTaskId(taskId)
    }
  } finally {
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      imageCache.delete(imgId)
    }
  }
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks } = useStore.getState()
  const prevTask = tasks.find((t) => t.id === taskId)
  if (prevTask) {
    const updated = tasks.map((t) =>
      t.id === taskId ? { ...t, ...patch } : t,
    )
    setTasks(updated)
    maybeOpenSupportPrompt(tasks, updated, taskId)
    const task = updated.find((t) => t.id === taskId)
    if (task) {
      // 关键属性改变或进入终态检测，避免在轮询进度（elapsed/progress）时进行频繁的网络数据库写入
      const hasStatusChanged = patch.status !== undefined && prevTask.status !== patch.status
      const hasCostChanged = patch.cost !== undefined && prevTask.cost !== patch.cost
      const hasGroupChanged = patch.groupId !== undefined && prevTask.groupId !== patch.groupId
      const hasFavoriteChanged = patch.isFavorite !== undefined && prevTask.isFavorite !== patch.isFavorite
      const isTerminated = task.status !== 'running'
      const isNewImageUploaded = patch.inputImageIds !== undefined || patch.maskImageId !== undefined

      const shouldSyncToDb = hasStatusChanged || hasCostChanged || hasGroupChanged || hasFavoriteChanged || isTerminated || isNewImageUploaded

      if (shouldSyncToDb) {
        putTask(task)
      }
    }
  } else {
    // 补救性后台更新：如果当前展示的 tasks 列表里没有这个任务（比如它属于其他分组，或者正在分页加载中），我们直接去数据库捞出这个任务，应用补丁，并存回数据库！
    void (async () => {
      try {
        const allTasks = await getAllTasks()
        const dbTask = allTasks.find((t) => t.id === taskId)
        if (dbTask) {
          const updatedDbTask = { ...dbTask, ...patch }
          await putTask(updatedDbTask)

          // 如果在这个异步过程中，这个任务被重新加载进了 tasks 列表（比如用户切换回了对应分组），我们同步更新 store
          const currentTasks = useStore.getState().tasks
          if (currentTasks.some((t) => t.id === taskId)) {
            const updated = currentTasks.map((t) =>
              t.id === taskId ? { ...t, ...patch } : t,
            )
            setTasks(updated)
          }
        }
      } catch (err) {
        console.error('异步在数据库更新任务失败:', err)
      }
    })()
  }
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  const { settings } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  const normalizedParams = normalizeParamsForSettings(task.params, settings, { hasInputImages: task.inputImageIds.length > 0 })
  const taskId = genId()
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    params: normalizedParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    apiProfileSnapshot: { ...activeProfile },
    customProviderSnapshot: getCustomProviderDefinition(settings, activeProfile.provider) ?? undefined,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
    ownerFingerprint: getCurrentFingerprint(settings),
    groupId: task.groupId,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  await putTask(newTask)

  executeTask(taskId)
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { settings, setPrompt, setParams, setInputImages, showToast, setConfirmDialog, setReusedTaskApiProfile } = useStore.getState()
  const normalizedSettings = normalizeSettings(settings)
  const currentProfile = getActiveApiProfile(settings)
  const matchedProfile = getTaskApiProfile(normalizedSettings, task)
  const shouldTemporarilyReuseProfile = Boolean(matchedProfile && matchedProfile.id !== currentProfile.id)
  const missingReusedProfile = !matchedProfile
  const taskProfileName = matchedProfile?.name ?? getTaskApiProfileName(task)
  const paramsSettings = shouldTemporarilyReuseProfile && matchedProfile ? createSettingsForApiProfile(normalizedSettings, matchedProfile) : normalizedSettings

  setParams(normalizeParamsForSettings(task.params, paramsSettings, { hasInputImages: task.inputImageIds.length > 0 }))
  setReusedTaskApiProfile(
    shouldTemporarilyReuseProfile && matchedProfile ? matchedProfile.id : null,
    missingReusedProfile,
    taskProfileName,
  )

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }
  setInputImages(imgs)
  setPrompt(task.prompt)
  if (missingReusedProfile) {
    setConfirmDialog({
      title: '找不到 API 配置',
      message: `找不到复用任务所使用的 API 配置「${taskProfileName}」，要使用当前的 API 配置「${currentProfile.name}」提交任务吗？`,
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
      action: () => {
        void submitTask({ useCurrentApiProfileWhenReusedMissing: true })
      },
    })
    return
  }

  showToast(
    shouldTemporarilyReuseProfile && matchedProfile
      ? `已临时复用该任务的 API 配置「${matchedProfile.name}」`
      : '已复用配置到输入框',
    'success',
  )
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(`已添加 ${added} 张输出图到输入`, 'success')
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, inputImages, galleryInputDraft, showToast, clearSelection, selectedTaskIds } = useStore.getState()

  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const remaining = tasks.filter(t => !toDelete.has(t.id))

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      addTaskReferencedImageIds(deletedImageIds, t)
    }
  }

  setTasks(remaining)

  // 找出其他任务或当前输入仍引用的图片
  const stillUsed = collectStillReferencedImageIds(remaining, inputImages, galleryInputDraft)

  for (const id of taskIds) {
    await dbDeleteTask(id, Array.from(stillUsed))
  }

  // 删除孤立图片
  for (const imgId of deletedImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
      thumbnailCache.delete(imgId)
    }
  }

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter(id => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  showToast(`已删除 ${taskIds.length} 条记录`, 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, galleryInputDraft, showToast } = useStore.getState()

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
    ...(task.streamPartialImageIds || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)
  // 找出其他任务或当前输入仍引用的图片
  const stillUsed = collectStillReferencedImageIds(remaining, inputImages, galleryInputDraft)
  await dbDeleteTask(task.id, Array.from(stillUsed))

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
      thumbnailCache.delete(imgId)
    }
  }

  showToast('记录已删除', 'success')
}

/** 从 dataUrl 或可访问 URL 解析出 MIME 扩展名和二进制数据 */
async function imageSourceToBytes(source: string): Promise<{ ext: string; bytes: Uint8Array }> {
  if (!source.startsWith('data:')) {
    const url = source.startsWith('/') && typeof window !== 'undefined'
      ? `${window.location.origin}${source}`
      : source
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) throw new Error(`下载导出图片失败：HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : contentType.includes('gif') ? 'gif' : 'png'
    return { ext, bytes: new Uint8Array(await response.arrayBuffer()) }
  }

  const match = source.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = source.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatExportDate(value: number | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : ''
}

function formatExportResolution(value: unknown): string {
  return normalizeResolution(value, '1k')
}

type ExportImageFiles = Record<string, {
  path: string
  createdAt?: number
  source?: 'upload' | 'generated' | 'mask'
  width?: number
  height?: number
}>

function getTaskExportRows(tasks: TaskRecord[], outputFiles: ExportImageFiles, referenceFiles: ExportImageFiles) {
  const maxOutputCount = Math.max(1, ...tasks.map((task) => task.outputImages?.length ?? 0))
  const maxReferenceCount = Math.max(1, ...tasks.map((task) => task.inputImageIds?.length ?? 0))
  const headers = [
    '任务ID',
    '状态',
    '提示词',
    '模型',
    '分辨率',
    '尺寸',
    '格式',
    '创建时间',
    '完成时间',
    '耗时毫秒',
    '费用',
    '错误',
    ...Array.from({ length: maxOutputCount }, (_, index) => `图片${index + 1}`),
    ...Array.from({ length: maxReferenceCount }, (_, index) => `参考图${index + 1}`),
    '遮罩图',
  ]

  const rows = tasks.map((task) => {
    const actual = task.actualParams ?? {}
    const values = [
      task.id,
      task.status,
      task.prompt,
      task.apiModel || task.apiProfileSnapshot?.model || '',
      formatExportResolution(actual.resolution || task.params.resolution),
      actual.size || task.params.size,
      task.params.output_format,
      formatExportDate(task.createdAt),
      formatExportDate(task.finishedAt),
      task.elapsed ?? '',
      task.cost ?? '',
      task.error ?? '',
    ]
    const imageCells = Array.from({ length: maxOutputCount }, (_, index) => {
      const imageId = task.outputImages[index]
      const path = imageId ? outputFiles[imageId]?.path : undefined
      return {
        value: path || imageId || '',
        href: path,
      }
    })
    const referenceCells = Array.from({ length: maxReferenceCount }, (_, index) => {
      const imageId = task.inputImageIds[index]
      const path = imageId ? referenceFiles[imageId]?.path : undefined
      return {
        value: path || imageId || '',
        href: path,
      }
    })
    const maskPath = task.maskImageId ? referenceFiles[task.maskImageId]?.path : undefined
    const maskCell = {
      value: maskPath || task.maskImageId || '',
      href: maskPath,
    }
    return { values, imageCells, referenceCells, maskCell }
  })

  return { headers, rows }
}

function buildTasksExcelXml(tasks: TaskRecord[], outputFiles: ExportImageFiles, referenceFiles: ExportImageFiles): string {
  const { headers, rows } = getTaskExportRows(tasks, outputFiles, referenceFiles)
  const headerCells = headers
    .map((header) => `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`)
    .join('')
  const bodyRows = rows
    .map((row) => {
      const valueCells = row.values
        .map((value) => `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`)
        .join('')
      const imageCells = row.imageCells
        .map((cell) => cell.href
          ? `<Cell ss:HRef="${escapeXml(cell.href)}"><Data ss:Type="String">${escapeXml(cell.value)}</Data></Cell>`
          : `<Cell><Data ss:Type="String">${escapeXml(cell.value)}</Data></Cell>`,
        )
        .join('')
      const referenceCells = row.referenceCells
        .map((cell) => cell.href
          ? `<Cell ss:HRef="${escapeXml(cell.href)}"><Data ss:Type="String">${escapeXml(cell.value)}</Data></Cell>`
          : `<Cell><Data ss:Type="String">${escapeXml(cell.value)}</Data></Cell>`,
        )
        .join('')
      const maskCell = row.maskCell.href
        ? `<Cell ss:HRef="${escapeXml(row.maskCell.href)}"><Data ss:Type="String">${escapeXml(row.maskCell.value)}</Data></Cell>`
        : `<Cell><Data ss:Type="String">${escapeXml(row.maskCell.value)}</Data></Cell>`
      return `<Row>${valueCells}${imageCells}${referenceCells}${maskCell}</Row>`
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="任务清单">
  <Table>
   <Row>${headerCells}</Row>
   ${bodyRows}
  </Table>
 </Worksheet>
</Workbook>`
}

async function completeRecoveredCustomTask(task: TaskRecord, result: Awaited<ReturnType<typeof getCustomQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return

  const actualParamsList = await readImageSizeParamsList(result.images)
  const outputIds: string[] = []
  for (const dataUrl of result.images) {
    const imgId = await persistGeneratedImage(dataUrl, task.id)
    outputIds.push(imgId)
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    actualParams: firstActualParams(actualParamsList),
    actualParamsByImage: mapActualParamsByImage(outputIds, actualParamsList),
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    customRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
    cost: result.cost,
  })
  useStore.getState().showToast(`自定义异步任务已恢复，共 ${outputIds.length} 张图片`, 'success')
}

async function recoverCustomTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  let task = tasks.find((item) => item.id === taskId)
  if (!task) {
    const allTasks = await getAllTasks()
    task = allTasks.find((item) => item.id === taskId)
  }
  if (!task || !task.customTaskId || task.status === 'done') return

  const profile = getCustomRecoveryProfile(settings, task)
  const customProvider = getTaskCustomProviderDefinition(settings, task)
  if (!profile || !customProvider?.poll) {
    scheduleCustomRecovery(taskId)
    return
  }

  try {
    const result = await getCustomQueuedImageResult(profile, customProvider, task.customTaskId, task.params, (progress) => {
      if (progress.cost != null) {
        updateTaskInStore(taskId, { cost: progress.cost })
      }
    })
    clearCustomRecoveryTimer(taskId)
    await completeRecoveredCustomTask(task, result)
  } catch (err) {
    clearCustomRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      ...getRawErrorPayload(err),
      customRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
  }
}

export async function queryTaskResult(taskId: string): Promise<'done' | 'pending' | 'unsupported'> {
  const { settings, tasks } = useStore.getState()
  let task = tasks.find((item) => item.id === taskId)
  if (!task) {
    const allTasks = await getAllTasks()
    task = allTasks.find((item) => item.id === taskId)
  }
  if (!task) throw new Error('任务不存在或已被删除')
  if (task.status === 'done') return 'done'

  const taskProvider = task.apiProvider ?? task.apiProfileSnapshot?.provider
  if (taskProvider === 'fal' && task.falRequestId && task.falEndpoint) {
    const profile = getFalRecoveryProfile(settings, task)
    if (!profile) throw new Error(`找不到任务原本使用的 API 配置：${getTaskApiProfileName(task)}`)

    clearFalRecoveryTimer(taskId)
    try {
      const result = await getFalQueuedImageResult(profile, task.falEndpoint, task.falRequestId, task.params)
      await completeRecoveredFalTask(task, result)
      return 'done'
    } catch (err) {
      const message = getFalErrorMessage(err) ?? (err instanceof Error ? err.message : String(err))
      updateTaskInStore(taskId, {
        status: 'error',
        error: message,
        ...getRawErrorPayload(err),
        falRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      throw new Error(message)
    }
  }

  if (task.customTaskId) {
    const profile = getCustomRecoveryProfile(settings, task)
    const customProvider = getTaskCustomProviderDefinition(settings, task)
    if (!profile || !customProvider?.poll) {
      throw new Error(`找不到任务原本使用的异步查询配置：${getTaskApiProfileName(task)}`)
    }

    clearCustomRecoveryTimer(taskId)
    try {
      const query = await queryCustomQueuedImageResult(profile, customProvider, task.customTaskId, task.params, (progress) => {
        if (progress.cost != null) updateTaskInStore(taskId, { cost: progress.cost })
      })
      if (query.state === 'pending') {
        updateTaskInStore(taskId, {
          status: 'running',
          error: null,
          customRecoverable: true,
          ...(query.cost != null ? { cost: query.cost } : {}),
        })
        scheduleCustomRecovery(taskId)
        return 'pending'
      }

      await completeRecoveredCustomTask(task, query.result)
      return 'done'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isFalConnectionRecoverableError(err)) {
        updateTaskInStore(taskId, {
          status: 'running',
          error: message,
          ...getRawErrorPayload(err),
          customRecoverable: true,
        })
        scheduleCustomRecovery(taskId)
      } else {
        updateTaskInStore(taskId, {
          status: 'error',
          error: message,
          ...getRawErrorPayload(err),
          customRecoverable: false,
          finishedAt: Date.now(),
          elapsed: Date.now() - task.createdAt,
        })
      }
      throw new Error(message)
    }
  }

  return 'unsupported'
}

function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

/** 导出选项 */
export interface ExportOptions {
  groupId?: string | null
  groupName?: string
}

function downloadZip(zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]>, filename: string) {
  const zipped = zipSync(zipFiles, { level: 6 })
  const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function getExportTasksByGroup(tasks: TaskRecord[], groupId: string | null | undefined): TaskRecord[] {
  if (groupId === undefined) return tasks
  if (groupId === null) return tasks.filter((task) => !task.groupId)
  return tasks.filter((task) => task.groupId === groupId)
}

function sanitizeExportFilenamePart(value: string): string {
  const clean = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  return clean || 'tasks'
}

/** 导出数据为 ZIP */
export async function exportData(options: ExportOptions = {}) {
  try {
    const allTasks = await getAllTasks()
    const tasks = getExportTasksByGroup(allTasks, options.groupId)
    if (tasks.length === 0) {
      useStore.getState().showToast('当前范围没有可导出的任务', 'info')
      return
    }
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()
    const outputImageIds = new Set<string>()
    const referenceImageIds = new Set<string>()

    for (const task of tasks) {
      for (const id of [
        ...(task.outputImages || []),
        ...(task.outputImagesPending || []),
        ...(task.streamPartialImageIds || []),
      ]) {
        outputImageIds.add(id)
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }

      for (const id of [
        ...(task.inputImageIds || []),
        ...(task.maskImageId ? [task.maskImageId] : []),
      ]) {
        referenceImageIds.add(id)
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }

    const outputFiles: ExportImageFiles = {}
    const referenceFiles: ExportImageFiles = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}
    zipFiles['images/'] = [new Uint8Array(), { mtime: new Date(exportedAt) }]
    zipFiles['reference/'] = [new Uint8Array(), { mtime: new Date(exportedAt) }]

    for (const imageId of outputImageIds) {
      const img = await getImage(imageId)
      if (!img?.dataUrl) continue
      const { ext, bytes } = await imageSourceToBytes(img.dataUrl)
      const path = `images/${imageId}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(imageId) ?? exportedAt
      outputFiles[imageId] = {
        path,
        createdAt,
        source: img.source,
        width: img.width,
        height: img.height,
      }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
    }

    for (const imageId of referenceImageIds) {
      const img = await getImage(imageId)
      if (!img?.dataUrl) continue
      const { ext, bytes } = await imageSourceToBytes(img.dataUrl)
      const path = `reference/${imageId}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(imageId) ?? exportedAt
      referenceFiles[imageId] = {
        path,
        createdAt,
        source: img.source,
        width: img.width,
        height: img.height,
      }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
    }
    zipFiles['tasks.xls'] = [strToU8(buildTasksExcelXml(tasks, outputFiles, referenceFiles)), { mtime: new Date(exportedAt) }]

    const scope = sanitizeExportFilenamePart(options.groupName ?? '全部分组')
    downloadZip(zipFiles, `image-studio-${scope}_${formatExportFileTime(new Date(exportedAt))}.zip`)
    useStore.getState().showToast(`已导出 ${tasks.length} 条任务`, 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        `导出失败：${e instanceof Error ? e.message : String(e)}`,
        'error',
      )
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  const image = await createInputImageFromFile(file)
  if (!image) return
  useStore.getState().addInputImage(image)
  useStore.getState().showToast('参考图已添加', 'success')
}

export async function createInputImageFromFile(file: File): Promise<InputImage | null> {
  if (!file.type.startsWith('image/')) return null
  let dataUrl = await fileToDataUrl(file)

  // 构筑 LocalStorage 安全防线：从源头上对上传图片进行 Canvas 高倍率极速压缩，防止几十兆大图瞬间挤爆 5MB 浏览器本地存储引发崩溃
  dataUrl = await compressImageBase64(dataUrl)

  const id = `temp-${genId()}`
  cacheImage(id, dataUrl)
  return { id, dataUrl }
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error('不是有效的图片')
  let dataUrl = await blobToDataUrl(blob)

  // 链接导入同样在源头上焊死压缩安全线，预防大二进制大包阻塞网络
  dataUrl = await compressImageBase64(dataUrl)

  const id = `temp-${genId()}`
  cacheImage(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
