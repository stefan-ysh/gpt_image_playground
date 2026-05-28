import { useEffect, useMemo, useRef, useState } from 'react'

import { matchesTaskStatusFilter } from '../lib/taskStatus'
import { editOutputs, getCurrentFingerprint, removeTask, reuseConfig, useStore } from '../store'
import { FolderIcon, PhotoIcon, TagIcon } from './icons'
import TaskCard from './TaskCard'
import Dialog from './ui/Dialog'

export default function TaskGrid() {
  const tasks = useStore((s) => s.tasks)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const tasksCurrentPage = useStore((s) => s.tasksCurrentPage)
  const tasksHasMore = useStore((s) => s.tasksHasMore)
  const tasksLoading = useStore((s) => s.tasksLoading)
  const loadMoreTasks = useStore((s) => s.loadMoreTasks)
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [selectionBox, setSelectionBox] = useState<{ startPageX: number; startPageY: number; currentPageX: number; currentPageY: number } | null>(null)
  const dragStart = useRef<{ pageX: number; pageY: number } | null>(null)
  const lastClientPoint = useRef<{ x: number; y: number } | null>(null)
  const hasDragged = useRef(false)
  const isDragging = useRef(false)
  const dragScrollIntervalRef = useRef<number | null>(null)
  const dragScrollDirectionRef = useRef<-1 | 1 | null>(null)
  const lastToastTimeRef = useRef(0)
  const suppressClickUntil = useRef(0)
  const startedOnCard = useRef(false)
  const startedWithCtrl = useRef(false)
  const initialSelection = useRef<string[]>([])
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  // 分组管理
  const selectedGroupId = useStore((s) => s.selectedGroupId)
  const settings = useStore((s) => s.settings)
  const groups = settings.groups ?? []


  const [assigningTask, setAssigningTask] = useState<typeof tasks[0] | null>(null)

  const filteredTasks = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt)
    const q = searchQuery.trim().toLowerCase()
    
    return sorted.filter((t) => {
      if (filterFavorite && !t.isFavorite) return false
      const matchStatus = matchesTaskStatusFilter(t.status, filterStatus)
      if (!matchStatus) return false
      
      if (!q) return true
      const prompt = (t.prompt || '').toLowerCase()
      const paramStr = JSON.stringify(t.params).toLowerCase()
      return prompt.includes(q) || paramStr.includes(q)
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite])
  const showInitialLoading = tasksLoading && filteredTasks.length === 0

  const handleDelete = (task: typeof tasks[0]) => {
    setConfirmDialog({
      title: '删除记录',
      message: '确定要删除这条记录吗？关联的图片资源也会被清理（如果没有其他任务引用）。',
      action: () => removeTask(task),
    })
  }

  const getPagePoint = (clientX: number, clientY: number) => {
    const scrollContainer = rootRef.current?.closest('[data-drag-select-surface]')
    const scrollX = scrollContainer?.scrollLeft ?? 0
    const scrollY = scrollContainer?.scrollTop ?? 0
    return {
      pageX: clientX + scrollX,
      pageY: clientY + scrollY,
    }
  }

  const beginSelection = (target: HTMLElement, clientX: number, clientY: number, isCtrl: boolean) => {
    const point = getPagePoint(clientX, clientY)

    startedOnCard.current = Boolean(target.closest('.task-card-wrapper'))
    startedWithCtrl.current = isCtrl
    initialSelection.current = [...useStore.getState().selectedTaskIds]

    isDragging.current = true
    hasDragged.current = false
    dragStart.current = point
    lastClientPoint.current = { x: clientX, y: clientY }
    document.body.classList.add('select-none')
    document.body.classList.add('drag-selecting')
    setSelectionBox({
      startPageX: point.pageX,
      startPageY: point.pageY,
      currentPageX: point.pageX,
      currentPageY: point.pageY,
    })
  }

  const updateSelectionFromPoint = (pageX: number, pageY: number) => {
    const start = dragStart.current
    if (!start || !gridRef.current) return

    const minX = Math.min(start.pageX, pageX)
    const maxX = Math.max(start.pageX, pageX)
    const minY = Math.min(start.pageY, pageY)
    const maxY = Math.max(start.pageY, pageY)

    const scrollContainer = rootRef.current?.closest('[data-drag-select-surface]')
    const scrollX = scrollContainer?.scrollLeft ?? 0
    const scrollY = scrollContainer?.scrollTop ?? 0

    const cards = gridRef.current.querySelectorAll('.task-card-wrapper')
    const newSelected = new Set(initialSelection.current)
    const initialSelected = new Set(initialSelection.current)

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect()
      const taskId = card.getAttribute('data-task-id')
      if (!taskId) return

      const cardLeft = rect.left + scrollX
      const cardRight = rect.right + scrollX
      const cardTop = rect.top + scrollY
      const cardBottom = rect.bottom + scrollY

      const isIntersecting =
        minX < cardRight && maxX > cardLeft && minY < cardBottom && maxY > cardTop

      if (isIntersecting) {
        if (initialSelected.has(taskId)) {
          newSelected.delete(taskId)
        } else {
          newSelected.add(taskId)
        }
      } else if (!initialSelected.has(taskId)) {
        newSelected.delete(taskId)
      }
    })

    setSelectedTaskIds(Array.from(newSelected))
  }

  useEffect(() => {
    const stopDragScroll = () => {
      if (dragScrollIntervalRef.current) {
        clearInterval(dragScrollIntervalRef.current)
        dragScrollIntervalRef.current = null
      }
      dragScrollDirectionRef.current = null
    }

    const startDragScroll = (direction: -1 | 1) => {
      if (dragScrollIntervalRef.current && dragScrollDirectionRef.current === direction) return
      stopDragScroll()
      dragScrollDirectionRef.current = direction
      dragScrollIntervalRef.current = window.setInterval(() => {
        const scrollContainer = rootRef.current?.closest('[data-drag-select-surface]')
        if (scrollContainer) {
          scrollContainer.scrollBy({ top: direction * 15, behavior: 'instant' })
        }
      }, 16)
    }

    const endSelection = (clearEmptySurfaceClick = false, suppressClick = false) => {
      if (isDragging.current) {
        document.body.classList.remove('select-none')
        document.body.classList.remove('drag-selecting')
      }
      if (isDragging.current && clearEmptySurfaceClick && !hasDragged.current && !startedOnCard.current && !startedWithCtrl.current) {
        clearSelection()
      }
      if (isDragging.current && suppressClick && hasDragged.current) {
        suppressClickUntil.current = Date.now() + 250
      }
      stopDragScroll()
      isDragging.current = false
      dragStart.current = null
      lastClientPoint.current = null
      setSelectionBox(null)
    }

    const getEventElement = (e: MouseEvent) => {
      if (e.target instanceof Element) return e.target
      return document.elementFromPoint(e.clientX, e.clientY)
    }

    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = getEventElement(e)
      if (!target) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('[data-input-bar]')) return
      if (target.closest('[data-no-drag-select], [data-lightbox-root]')) return
      if (target.closest('button, a, input, textarea, select')) return

      const isCtrl = isMac ? e.metaKey : e.ctrlKey
      beginSelection(target as HTMLElement, e.clientX, e.clientY, isCtrl)
      e.preventDefault()
    }

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return

      const start = dragStart.current
      const point = getPagePoint(e.clientX, e.clientY)
      lastClientPoint.current = { x: e.clientX, y: e.clientY }
      const distance = Math.hypot(point.pageX - start.pageX, point.pageY - start.pageY)
      if (distance < 6 && !hasDragged.current) return

      hasDragged.current = true
      setSelectionBox({
        startPageX: start.pageX,
        startPageY: start.pageY,
        currentPageX: point.pageX,
        currentPageY: point.pageY,
      })
      updateSelectionFromPoint(point.pageX, point.pageY)
      e.preventDefault()

      const scrollThreshold = 40
      if (e.clientY < scrollThreshold) {
        startDragScroll(-1)
      } else if (e.clientY > window.innerHeight - scrollThreshold) {
        startDragScroll(1)
      } else {
        stopDragScroll()
      }
    }

    const handleDocumentScroll = () => {
      if (!isDragging.current || !dragStart.current || !lastClientPoint.current || !hasDragged.current) return

      const point = getPagePoint(lastClientPoint.current.x, lastClientPoint.current.y)
      const start = dragStart.current
      setSelectionBox({
        startPageX: start.pageX,
        startPageY: start.pageY,
        currentPageX: point.pageX,
        currentPageY: point.pageY,
      })
      updateSelectionFromPoint(point.pageX, point.pageY)
    }

    const handleDocumentWheel = (e: WheelEvent) => {
      if (!isDragging.current) return
      if ((e.buttons & 1) === 0) {
        endSelection()
        return
      }
      if (!hasDragged.current) return
      if (!e.ctrlKey && !e.metaKey) return

      e.preventDefault()
      const now = Date.now()
      if (now - lastToastTimeRef.current > 3000) {
        lastToastTimeRef.current = now
        const keyName = isMac ? '⌘' : 'Ctrl'
        useStore.getState().showToast(`松开 ${keyName} 键使用滚轮，或拖至边缘自动滚动`, 'info')
      }
    }

    const handleDocumentMouseUp = () => {
      endSelection(true, true)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    document.addEventListener('mousemove', handleDocumentMouseMove, true)
    document.addEventListener('mouseup', handleDocumentMouseUp, true)
    document.addEventListener('wheel', handleDocumentWheel, { capture: true, passive: false })
    window.addEventListener('scroll', handleDocumentScroll, true)
    return () => {
      stopDragScroll()
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      document.removeEventListener('mousemove', handleDocumentMouseMove, true)
      document.removeEventListener('mouseup', handleDocumentMouseUp, true)
      document.removeEventListener('wheel', handleDocumentWheel, true)
      window.removeEventListener('scroll', handleDocumentScroll, true)
    }
  }, [clearSelection, isMac])

  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!tasksHasMore || tasksLoading) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreTasks(selectedGroupId, tasksCurrentPage + 1, true)
        }
      },
      { threshold: 0.1 }
    )

    const el = sentinelRef.current
    if (el) observer.observe(el)

    return () => {
      if (el) observer.unobserve(el)
    }
  }, [tasksHasMore, tasksLoading, tasksCurrentPage, selectedGroupId, loadMoreTasks])

  return (
    <div 
      ref={rootRef}
      data-task-grid-root
      className="relative min-h-[50vh]"
    >
      {showInitialLoading ? (
        <div className="mx-auto flex max-w-xl flex-col items-center py-20 text-center text-slate-400 dark:text-slate-500">
          <div className="rounded-[2rem] border border-slate-200/70 bg-white/[0.54] px-8 py-10 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)] dark:border-white/[0.08] dark:bg-white/[0.025]">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-blue-200/70 bg-blue-50 text-blue-500 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300">
              <PhotoIcon className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">正在加载画廊图片...</p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">图片列表加载完成后会显示在这里。</p>
          </div>
        </div>
      ) : !filteredTasks.length ? (
        <div className="mx-auto flex max-w-xl flex-col items-center py-20 text-center text-slate-400 dark:text-slate-500">
          {searchQuery || filterFavorite ? (
            <div className="rounded-[2rem] border border-slate-200/70 bg-white/[0.64] px-8 py-10 shadow-[0_24px_60px_-42px_rgba(15,23,42,0.45)] dark:border-white/[0.08] dark:bg-white/[0.025]">
              <PhotoIcon className="mx-auto mb-4 h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">没有找到匹配的记录</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">换个关键词或清除筛选后再试。</p>
            </div>
          ) : (
            <div className="rounded-[2rem] border border-dashed border-slate-200/80 bg-white/[0.54] px-8 py-10  dark:border-white/[0.08] dark:bg-white/[0.02]">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-blue-200/70 bg-blue-50 text-blue-500 dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300">
                <PhotoIcon className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">该分组目前没有图片</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">在下方输入提示词，生成结果会自动进入当前分组。</p>
            </div>
          )}
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 pb-10">
          {filteredTasks.map((task, index) => (
            <div
              key={task.id}
              className="task-card-wrapper animate-card-rise"
              data-task-id={task.id}
              style={{ animationDelay: `${Math.min(index, 12) * 35}ms` }}
            >
              <TaskCard
                task={task}
                onClick={(e) => {
                  if (Date.now() < suppressClickUntil.current) {
                    e.preventDefault()
                    return
                  }
                  suppressClickUntil.current = 0
                  const isCtrl = isMac ? e.metaKey : e.ctrlKey
                  if (isCtrl) {
                    useStore.getState().toggleTaskSelection(task.id)
                    return
                  }

                  setDetailTaskId(task.id)
                }}
                onReuse={() => reuseConfig(task)}
                onEditOutputs={() => editOutputs(task)}
                onDelete={() => handleDelete(task)}
                onAssignGroup={() => setAssigningTask(task)}
                isSelected={selectedTaskIds.includes(task.id)}
              />
            </div>
          ))}
        </div>
      )}

      {/* 哨兵节点用于无限滚动加载更多 */}
      <div ref={sentinelRef} className="flex h-14 items-center justify-center pb-10 text-xs text-slate-400 dark:text-slate-500" data-no-drag-select>
        {tasksLoading && !showInitialLoading && (
          <div className="flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/[0.62] px-3 py-2 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.35)] dark:border-white/[0.08] dark:bg-white/[0.03]">
            <span className="h-2 w-12 rounded-full shimmer-skeleton" />
            <span>正在加载画廊图片...</span>
          </div>
        )}
        {!tasksLoading && tasksHasMore && <span className="opacity-60">向下滚动加载更多</span>}
        {!tasksLoading && !tasksHasMore && tasks.length > 0 && <span className="opacity-60">已显示该分类下的全部图片</span>}
      </div>

      {selectionBox && (() => {
        const scrollContainer = rootRef.current?.closest('[data-drag-select-surface]')
        const scrollX = scrollContainer?.scrollLeft ?? 0
        const scrollY = scrollContainer?.scrollTop ?? 0
        return (
          <div
            className="fixed bg-blue-500/20 border border-blue-500/50 pointer-events-none z-[30]"
            style={{
              left: Math.min(selectionBox.startPageX, selectionBox.currentPageX) - scrollX,
              top: Math.min(selectionBox.startPageY, selectionBox.currentPageY) - scrollY,
              width: Math.abs(selectionBox.currentPageX - selectionBox.startPageX),
              height: Math.abs(selectionBox.currentPageY - selectionBox.startPageY),
            }}
          />
        )
      })()}

      {assigningTask && (
        <Dialog
          isOpen={!!assigningTask}
          onClose={() => setAssigningTask(null)}
          title="归类任务分组"
          description="请选择要将该任务归入以下哪个分组："
        >
          <div className="grid grid-cols-1 gap-2 py-10 max-h-screen overflow-y-scroll">
            <button
              onClick={() => {
                useStore.getState().assignTaskToGroup(assigningTask.id, null)
                setAssigningTask(null)
              }}
              className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-all text-sm font-semibold flex items-center justify-between text-gray-700 dark:text-gray-300"
            >
              <span className="flex items-center gap-2">
                <FolderIcon className="h-4 w-4 text-slate-400" />
                <span>未分类</span>
              </span>
            </button>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  useStore.getState().assignTaskToGroup(assigningTask.id, g.id)
                  setAssigningTask(null)
                }}
                className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-all text-sm font-semibold flex items-center justify-between text-gray-700 dark:text-gray-300"
              >
                <span className="flex items-center gap-2">
                  <TagIcon className="h-4 w-4 text-slate-400" />
                  <span>{g.name}</span>
                </span>
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}
