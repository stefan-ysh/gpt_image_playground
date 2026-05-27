import { canManualSyncTask, getTaskStatusDescription, getTaskStatusText, isSavingImageStatus, isTaskDone, isTaskFailed, isTaskRunning } from '@/lib/taskStatus'
import { useEffect, useRef, useState } from 'react'

import type {ReactNode} from 'react'
import type { TaskRecord } from '../types'
import { useStore, ensureImageThumbnailCached, subscribeImageThumbnail, updateTaskInStore, retryTask, queryTaskResult, retryTaskImageTransfers } from '../store'
import { formatImageRatio } from '../lib/size'
import { getParamDisplay, getResolutionDisplay, ActualValueBadge } from '../lib/paramDisplay'
import { CodeIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onAssignGroup: () => void
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  isSelected?: boolean
  disableSwipe?: boolean
}

function TaskActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={className}
        disabled={disabled}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export default function TaskCard({
  task,
  onReuse,
  onEditOutputs,
  onDelete,
  onAssignGroup,
  onClick,
  isSelected,
  disableSwipe,
}: Props) {
  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [thumbSrcLoaded, setThumbSrcLoaded] = useState(false)
  const [thumbSrcFailed, setThumbSrcFailed] = useState(false)
  const [coverRatio, setCoverRatio] = useState<string>('')
  const [coverSize, setCoverSize] = useState<string>('')
  const [now, setNow] = useState(Date.now())
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartedSelected, setSwipeStartedSelected] = useState(false)
  const [swipeActionActive, setSwipeActionActive] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<-1 | 0 | 1>(0)
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const [isQueryingResult, setIsQueryingResult] = useState(false)
  const [isTransferringImages, setIsTransferringImages] = useState(false)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const settings = useStore((s) => s.settings)
  const streamPreviewSrc = useStore((s) => s.streamPreviews[task.id] || '')
  const showToast = useStore((s) => s.showToast)



  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeResetTimerRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<-1 | 0 | 1>(0)
  const swipeActionActiveRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const pendingSwipeOffsetRef = useRef(0)
  const swipeFrameRef = useRef<number | null>(null)

  const updateSwipeDirection = (nextDirection: -1 | 0 | 1) => {
    if (swipeDirectionRef.current === nextDirection) return
    swipeDirectionRef.current = nextDirection
    setSwipeDirection(nextDirection)
  }

  const updateSwipeActionActive = (nextActive: boolean) => {
    if (swipeActionActiveRef.current === nextActive) return
    swipeActionActiveRef.current = nextActive
    setSwipeActionActive(nextActive)
  }

  const applySwipeOffset = (offset: number) => {
    swipeOffsetRef.current = offset
    if (cardRef.current) {
      cardRef.current.style.transform = offset ? `translateX(${offset}px)` : ''
    }
  }

  const cancelSwipeFrame = () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
  }

  const scheduleSwipeOffset = (offset: number) => {
    if (swipeFrameRef.current == null && swipeOffsetRef.current === offset) return
    pendingSwipeOffsetRef.current = offset
    if (swipeFrameRef.current != null) return
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      applySwipeOffset(pendingSwipeOffsetRef.current)
    })
  }

  const isTagScrollTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest('[data-tag-scroll-area]'))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disableSwipe || isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      applySwipeOffset(0)
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
      swipeResetTimerRef.current = null
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    horizontalSwipeRef.current = false
    setSwipeStartedSelected(Boolean(isSelected))
    updateSwipeActionActive(false)
    updateSwipeDirection(0)
    cancelSwipeFrame()
    applySwipeOffset(0)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) return
    if (!touchStartRef.current) return
    const deltaX = e.touches[0].clientX - touchStartRef.current.x
    const deltaY = e.touches[0].clientY - touchStartRef.current.y
    
    // 如果主要是水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      horizontalSwipeRef.current = true
      e.preventDefault()
      // 限制滑动距离，例如最大 60px
      const boundedOffset = Math.max(-60, Math.min(60, deltaX))
      const nextDirection = boundedOffset > 0 ? 1 : boundedOffset < 0 ? -1 : 0
      const nextActionActive = Math.abs(deltaX) >= 40
      scheduleSwipeOffset(boundedOffset)
      updateSwipeDirection(nextDirection)
      updateSwipeActionActive(nextActionActive)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    touchStartRef.current = null
    const isSwipeAction = horizontalSwipeRef.current && Math.abs(deltaX) > 40
    horizontalSwipeRef.current = false
    updateSwipeActionActive(isSwipeAction)
    swipeResetTimerRef.current = window.setTimeout(() => {
      updateSwipeActionActive(false)
      swipeResetTimerRef.current = null
    }, 220)

    // 如果是水平滑动，且垂直偏移较小，认为是滑动选择
    if (isSwipeAction) {
      suppressClickUntilRef.current = Date.now() + 350
      e.preventDefault()
      e.stopPropagation()
      toggleTaskSelection(task.id)
    }
  }

  const handleTouchCancel = () => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    updateSwipeActionActive(false)
  }

  useEffect(() => () => {
    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
    }
    cancelSwipeFrame()
  }, [])

  useEffect(() => {
    if (!isSwiping) {
      applySwipeOffset(0)
    }
  }, [isSwiping])

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [streamPreviewSrc, task.id])

  // 定时更新运行中任务的计时
  useEffect(() => {
    const shouldTick =
      isTaskRunning(task.status) ||
      (task.status === 'error' && (task.falRecoverable || task.customRecoverable))

    if (!shouldTick) return

    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())

    return () => clearInterval(id)
  }, [task.customRecoverable, task.falRecoverable, task.status])

  // 加载缩略图
  useEffect(() => {
    setCoverRatio('')
    setCoverSize('')
    setThumbSrc('')
    setThumbSrcLoaded(false)
    setThumbSrcFailed(false)

    let cancelled = false
    const imageId = task.outputImages?.[0]
    let unsubscribe: (() => void) | undefined

    const applyThumbnail = (thumbnail: { dataUrl: string; width?: number; height?: number }) => {
      if (cancelled) return
      setThumbSrc(thumbnail.dataUrl)
      if (thumbnail.width && thumbnail.height) {
        setCoverRatio(formatImageRatio(thumbnail.width, thumbnail.height))
        setCoverSize(`${thumbnail.width}×${thumbnail.height}`)
      }
    }

    if (imageId) {
      unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
      ensureImageThumbnailCached(imageId).then((thumbnail) => {
        if (cancelled || !thumbnail) return
        applyThumbnail(thumbnail)
      }).catch(() => {
        if (!cancelled) setThumbSrc('')
      })
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [task.outputImages])

  const duration = (() => {
    let seconds: number
    if (isTaskRunning(task.status) || task.falRecoverable || task.customRecoverable) {
      seconds = Math.floor((now - task.createdAt) / 1000)
    } else if (task.elapsed != null) {
      seconds = Math.floor(task.elapsed / 1000)
    } else {
      return '00:00'
    }
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  })()
  const showSwipeAction = swipeActionActive
  const isFalReconnecting = task.status === 'error' && task.falRecoverable
  const isCustomReconnecting = task.status === 'error' && task.customRecoverable
  const showRunningTimer = isTaskRunning(task.status) || isFalReconnecting || isCustomReconnecting
  const isWorkerLikeRunning = isTaskRunning(task.status)
  const showLegacyStreamPreview = task.status === 'running' && streamPreviewSrc
  const showGeneratingPlaceholder =
    isWorkerLikeRunning &&
    !(task.status === 'running' && streamPreviewSrc && streamPreviewLoaded)
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'bg-gray-500 dark:bg-gray-600'
      : 'bg-blue-500'
    : 'bg-gray-200 dark:bg-gray-700'

  const resolutionDisplay = getResolutionDisplay(task)
  const showResolution = Boolean(task.params.resolution) || resolutionDisplay.isMismatch || resolutionDisplay.isAutoResolved

  const sizeDisplay = getParamDisplay(task, 'size')
  const showSize = task.params.size !== 'auto' || sizeDisplay.isMismatch

  const formatDisplay = getParamDisplay(task, 'output_format')
  const showFormat = task.params.output_format !== 'png' || formatDisplay.isMismatch

  const nDisplay = getParamDisplay(task, 'n')

  const taskModel = task.apiModel || task.apiProfileSnapshot?.model || ''
  const showModel = Boolean(taskModel)
  const isInterrupted = task.status === 'error' && task.error === '已停止生成。'
  const canQueryResult =
  canManualSyncTask(task.status) ||
  (
    !isTaskDone(task.status) &&
    (
      Boolean(task.falRequestId && task.falEndpoint) ||
      Boolean(task.customTaskId)
    )
  )
  const hasRemoteOutputImages = [
    ...(task.outputImages ?? []),
    ...(task.outputImagesPending ?? []),
    ...(task.rawImageUrls ?? []),
  ].some((id) => /^https?:\/\//i.test(id))
  const hasPendingOutputImages = (task.outputImagesPending && task.outputImagesPending.length > 0) ?? false

  const handleQueryResult = async () => {
    if (isQueryingResult) return
    setIsQueryingResult(true)
    try {
      let result
      if (canManualSyncTask(task.status)) {
        result = await useStore.getState().syncTask(task.id)
      } else {
        result = await queryTaskResult(task.id)
      }
      if (result === 'pending') {
        showToast('任务还在生成中，稍后可以再次查询', 'info')
      } else if (result === 'unsupported') {
        showToast('该任务没有可查询的异步任务 ID', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setIsQueryingResult(false)
    }
  }

  const handleRetryImageTransfer = async () => {
    if (isTransferringImages) return
    setIsTransferringImages(true)
    try {
      const result = await retryTaskImageTransfers(task)
      if (result.succeeded > 0) {
        showToast(`已转存 ${result.succeeded} 张图片到 COS`, 'success')
      } else if (result.attempted > 0) {
        showToast('图片暂时转存失败，已加入后台重试', 'info')
      } else {
        showToast('没有可转存的临时图片', 'info')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '图片转存失败，已加入后台重试', 'error')
    } finally {
      setIsTransferringImages(false)
    }
  }

  const handleTriggerQueueProcess = async () => {
    if (isTransferringImages) return
    setIsTransferringImages(true)
    try {
      const res = await fetch('/api/images/transfer', { method: 'POST', credentials: 'include' })
      const json = await res.json()
      if (json.success) {
        const transferred = json.transferred ?? 0
        const processed = json.processed ?? 0
        if (transferred > 0) {
          await retryTaskImageTransfers(task)
        }
        showToast(`触发转存完成：处理 ${processed}，成功 ${transferred}`, 'success')
      } else {
        showToast(json.error || '触发转存失败', 'error')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '触发转存失败', 'error')
    } finally {
      setIsTransferringImages(false)
    }
  }

  const handleThumbLoad = () => {
    setThumbSrcLoaded(true)
    setThumbSrcFailed(false)
  }

  const handleThumbError = () => {
    setThumbSrcLoaded(false)
    setThumbSrcFailed(true)
  }

  return (
    <div className="relative rounded-2xl">
      {/* 侧滑底图 */}
      <div
        className={`absolute inset-0 rounded-2xl flex items-center transition-opacity duration-200 pointer-events-none ${
          isSwiping || swipeDirection !== 0 || swipeActionActive ? 'opacity-100' : 'opacity-0'
        } ${swipeBgClass} ${
          swipeDirection > 0 ? 'justify-start pl-6' : 'justify-end pr-6'
        }`}
      >
        <svg className={`w-8 h-8 transition-transform duration-150 ${showSwipeAction ? 'scale-110 text-white' : 'scale-90 text-white/60'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {swipeStartedSelected && showSwipeAction ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>

      <div
        ref={cardRef}
        className={`relative overflow-hidden rounded-2xl border bg-white/[0.86] shadow-[0_20px_48px_-38px_rgba(15,23,42,0.42)] backdrop-blur-sm cursor-pointer touch-pan-y will-change-transform duration-300 hover:shadow-[0_26px_60px_-36px_rgba(37,99,235,0.28)] dark:bg-white/[0.035] dark:backdrop-blur-md ${
          isSwiping ? '!bg-white dark:!bg-gray-900' : ''
        } ${
          !isSwiping ? 'transition-all' : 'transition-[box-shadow,border-color,background-color]'
        } ${
          isTaskRunning(task.status)
            ? 'border-blue-400 generating shadow-xs shadow-blue-500/10'
            : isSelected
            ? 'border-blue-500 shadow-md dark:shadow-blue-500/10 ring-4 ring-blue-500/10'
            : 'border-slate-200/80 hover:-translate-y-0.5 hover:border-blue-300 dark:border-white/[0.08] dark:hover:border-blue-500/30'
        }`}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          onClick(e)
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        draggable={isTaskDone(task.status) && task.outputImages?.length > 0}
        onDragStart={(e) => {
          if (!isTaskDone(task.status) || !task.outputImages?.length) return;
          const imageIds = task.outputImages;
          e.dataTransfer.setData('text/plain', imageIds.join(','));
          e.dataTransfer.effectAllowed = 'copy';
          // Optionally set drag image if we have thumbSrc
          if (thumbSrc) {
            const preview = document.createElement('div');
            preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:100px;height:100px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);';
            const previewImg = document.createElement('img');
            previewImg.src = thumbSrc;
            previewImg.style.cssText = 'width:100px;height:100px;object-fit:cover;display:block;';
            preview.appendChild(previewImg);
            document.body.appendChild(preview);
            e.dataTransfer.setDragImage(preview, 50, 50);
            setTimeout(() => preview.remove(), 0);
          }
        }}
      >
        {/* 选中时的角标 */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      <div className="flex flex-col min-[350px]:flex-row h-auto min-[350px]:h-40">
        {/* 左侧图片区域：小屏幕下自动全宽占满，高度为 40 保持极致自适应比例 */}
        <div className="relative flex h-40 w-full flex-shrink-0 items-center justify-center overflow-hidden bg-slate-100 min-[350px]:h-full min-[350px]:w-40 min-[350px]:min-w-[10rem] dark:bg-slate-950/35">
          {showLegacyStreamPreview && (
            <>
              <img
                src={streamPreviewSrc}
                className={`h-full w-full object-cover ${streamPreviewLoaded ? '' : 'hidden'}`}
                alt=""
                onLoad={() => setStreamPreviewLoaded(true)}
                onError={() => setStreamPreviewLoaded(false)}
              />
              {streamPreviewLoaded && (
                <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:text-xs">
                  预览
                </span>
              )}
            </>
          )}
          {showGeneratingPlaceholder && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 select-none">
              <div className="absolute inset-0 shimmer-skeleton z-0 rounded-lg pointer-events-none" />
              <div className="relative z-10 flex flex-col items-center gap-2 bg-black/20 dark:bg-black/35 px-4 py-2.5 rounded-2xl backdrop-blur-md shadow-lg border border-white/10 scale-95 sm:scale-100">
                <svg
                  className="w-7 h-7 text-white animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                <span className="text-[10px] sm:text-xs text-white font-semibold tracking-wider">
                  {getTaskStatusText(task.status)}
                </span>
              </div>
            </div>
          )}
          {task.status === 'error' && isFalReconnecting && (
            <div className="flex flex-col items-center gap-1 px-2">
              <svg
                className="w-7 h-7 text-yellow-400 animate-pulse"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="text-xs text-yellow-500 text-center leading-tight">
                重连中
              </span>
            </div>
          )}
          {isTaskFailed(task.status) && !isFalReconnecting && (
            <div className="flex flex-col items-center gap-1 px-2">
              <svg
                className={`w-7 h-7 ${isInterrupted ? 'text-yellow-400' : 'text-red-400'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className={`text-xs text-center leading-tight ${isInterrupted ? 'text-yellow-500' : 'text-red-400'}`}>
                {isInterrupted ? '已停止' : '失败'}
              </span>
            </div>
          )}
          {task.status === 'done' && thumbSrc && !thumbSrcFailed && (
            <>
              {!thumbSrcLoaded && <div className="absolute inset-0 shimmer-skeleton z-10 rounded-lg pointer-events-none"/>}
              <img
                src={thumbSrc}
                data-image-id={task.outputImages[0]}
                data-output-image-ids={task.outputImages.join(',')}
                className="saveable-image w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                loading="lazy"
                onLoad={handleThumbLoad}
                onError={handleThumbError}
                alt=""
              />
              {task.outputImages.length > 1 && (
                <span className="absolute bottom-1.5 right-1.5 bg-black/65 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-xs font-semibold z-20 shadow-sm border border-white/5">
                  {task.outputImages.length} 张
                </span>
              )}
            </>
          )}
          {/* 暂时注释，误删，或许日后重启 */}
          {/* {task.status === 'done' && (!thumbSrc || thumbSrcFailed) && (
            <svg
              className="w-8 h-8 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          )} */}
          {/* 运行中显示耗时，完成后显示封面图比例与分辨率标签 */}
          <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
            {showRunningTimer || !isTaskDone(task.status) || !coverRatio || !coverSize ? (
              <span className="flex items-center gap-1 bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {duration}
              </span>
            ) : (
              <>
                <span className="bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                  {coverRatio}
                </span>
                <span className="bg-black/50 text-white/90 text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-medium">
                  {coverSize}
                </span>
              </>
            )}
          </div>
        </div>

        {/* 右侧信息区域 */}
        <div className="flex min-w-0 flex-1 flex-col p-3">
          <div className="flex-1 min-h-0 mb-2 overflow-hidden">
            <p className="line-clamp-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {task.prompt || '(无提示词)'}
            </p>
          </div>
          <div className="mt-auto flex flex-col gap-1.5">
            {/* 参数与信息：横向滚动 */}
            <div 
              data-tag-scroll-area
              className="flex overflow-x-auto hide-scrollbar pt-0.5 gap-1.5 whitespace-nowrap mask-edge-r min-w-0 pr-2"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onTouchCancel={(e) => e.stopPropagation()}
            >
              {/* Model */}
              {showModel && (
                <span 
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 text-xs flex-shrink-0"
                  title={taskModel}
                >
                  <CodeIcon className="w-3 h-3 flex-shrink-0 text-gray-400" />
                  <span className="truncate max-w-[8rem]">
                    {taskModel}
                  </span>
                </span>
              )}
              {/* Mask */}
              {(task.maskImageId || task.maskTargetImageId) && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs flex-shrink-0">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  局部重绘
                </span>
              )}
              {/* Params: only show if not default or mismatch */}
              {showResolution && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs flex-shrink-0">
                  {/* <span className="text-gray-400 dark:text-gray-500">分辨率</span> */}
                  {resolutionDisplay.isMismatch ? <ActualValueBadge value={resolutionDisplay.displayValue} className="px-1 rounded-sm" /> : <span className="text-gray-600 dark:text-gray-300">{resolutionDisplay.displayValue}</span>}
                </span>
              )}
              {showSize && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs flex-shrink-0">
                  <span className="text-gray-400 dark:text-gray-500">尺寸</span>
                  {sizeDisplay.isMismatch ? <ActualValueBadge value={sizeDisplay.displayValue} className="px-1 rounded-sm" /> : <span className="text-gray-600 dark:text-gray-300">{sizeDisplay.displayValue}</span>}
                </span>
              )}
              {showFormat && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-white/[0.04] text-xs flex-shrink-0">
                  <span className="text-gray-400 dark:text-gray-500">格式</span>
                  {formatDisplay.isMismatch ? <ActualValueBadge value={formatDisplay.displayValue} className="px-1 rounded-sm" /> : <span className="text-gray-600 dark:text-gray-300">{formatDisplay.displayValue}</span>}
                </span>
              )}
            
            </div>
            {/* 操作按钮 */}
            <div
              data-tag-scroll-area
              className="flex items-center gap-1 flex-shrink-0 mt-0.5 ml-auto max-w-full overflow-x-auto hide-scrollbar mask-edge-r pr-2"
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              onTouchCancel={(e) => e.stopPropagation()}
            >
              {canQueryResult && (
                <TaskActionButton
                  tooltip="查询结果"
                  onClick={handleQueryResult}
                  disabled={isQueryingResult}
                  className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-400 hover:text-blue-500 transition"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${isQueryingResult ? 'animate-spin' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </TaskActionButton>
              )}
              {hasRemoteOutputImages && (
                <TaskActionButton
                  tooltip="重新转存图片"
                  onClick={handleRetryImageTransfer}
                  disabled={isTransferringImages}
                  className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-400 hover:text-blue-500 transition"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${isTransferringImages ? 'animate-pulse' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {/* 服务器 */}
                    <rect
                      x="4"
                      y="4"
                      width="16"
                      height="6"
                      rx="2"
                      strokeWidth={2}
                    />
                    <rect
                      x="4"
                      y="14"
                      width="16"
                      height="6"
                      rx="2"
                      strokeWidth={2}
                    />

                    {/* 指示灯 */}
                    <circle cx="8" cy="7" r="1" fill="currentColor" />
                    <circle cx="8" cy="17" r="1" fill="currentColor" />

                    {/* 转存箭头 */}
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 10v4m0 0l-2-2m2 2l2-2"
                    />
                  </svg>
                </TaskActionButton>
              )}
              {hasPendingOutputImages && (
                <TaskActionButton
                  tooltip="触发后台转存队列"
                  onClick={handleTriggerQueueProcess}
                  disabled={isTransferringImages}
                  className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-400 hover:text-blue-500 transition"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${isTransferringImages ? 'animate-pulse' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {/* 队列列表 */}
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 7h8M5 12h10M5 17h6"
                    />

                    {/* 后台处理齿轮 */}
                    <circle
                      cx="17"
                      cy="16"
                      r="3"
                      strokeWidth={2}
                    />

                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 11v1M17 20v1M12 16h1M20 16h1M13.5 12.5l.7.7M19.8 18.8l.7.7M20.5 12.5l-.7.7M14.2 18.8l-.7.7"
                    />

                    {/* 触发箭头 */}
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M14 6l3 3-3 3"
                    />
                  </svg>
                </TaskActionButton>
              )}
              {((isTaskFailed(task.status) && !isFalReconnecting) || settings.alwaysShowRetryButton) && (
                <TaskActionButton
                  tooltip="重试任务"
                  onClick={() => {
                    retryTask(task)
                    showToast('已重新将该绘图任务提交至生图队列', 'success')
                  }}
                  className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-400 hover:text-blue-500 transition"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </TaskActionButton>
              )}
              <TaskActionButton
                tooltip={task.isFavorite ? '取消收藏' : '收藏记录'}
                onClick={() => {
                  const nextFav = !task.isFavorite
                  updateTaskInStore(task.id, { isFavorite: nextFav })
                  showToast(nextFav ? '已成功将该绘图加入收藏列表' : '已取消收藏该绘图记录', 'success')
                }}
                className={`p-1.5 rounded-md transition ${
                  task.isFavorite
                    ? 'text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-500/10'
                    : 'text-gray-400 hover:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-500/10'
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill={task.isFavorite ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                  />
                </svg>
              </TaskActionButton>
              <TaskActionButton
                tooltip="复用配置"
                onClick={() => {
                  onReuse()
                  showToast('绘图参数与提示词已成功复用至输入栏', 'success')
                }}
                className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-400 hover:text-blue-500 transition"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                  />
                </svg>
              </TaskActionButton>
              <TaskActionButton
                tooltip="编辑输出"
                onClick={onEditOutputs}
                className="p-1.5 rounded-md hover:bg-green-50 dark:hover:bg-green-950/30 text-gray-400 hover:text-green-500 transition disabled:opacity-30"
                disabled={!task.outputImages?.length}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                  />
                </svg>
              </TaskActionButton>
              <TaskActionButton
                tooltip="归类分组"
                onClick={onAssignGroup}
                className="p-1.5 rounded-md hover:bg-blue-50 dark:hover:bg-blue-950/30 text-gray-400 hover:text-blue-500 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </TaskActionButton>
              <TaskActionButton
                tooltip="删除记录"
                onClick={onDelete}
                className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 text-gray-400 hover:text-red-500 transition"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </TaskActionButton>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
