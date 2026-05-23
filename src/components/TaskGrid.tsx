import { useMemo, useRef, useState, useEffect } from 'react'
import { useStore, reuseConfig, editOutputs, removeTask, getCurrentFingerprint } from '../store'
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

  const currentGroupName = useMemo(() => {
    if (selectedGroupId === 'all') return '全部'
    if (selectedGroupId === 'uncategorized') return '未分类'
    const found = groups.find((g) => g.id === selectedGroupId)
    return found ? found.name : '未分类'
  }, [selectedGroupId, groups])

  const [assigningTask, setAssigningTask] = useState<typeof tasks[0] | null>(null)

  const filteredTasks = useMemo(() => {
    const currentFingerprint = getCurrentFingerprint(settings)
    const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt)
    const q = searchQuery.trim().toLowerCase()
    
    return sorted.filter((t) => {
      // 隔离：只看当前 API Key 指纹匹配的任务
      if (t.ownerFingerprint !== currentFingerprint) return false

      // 分组过滤
      if (selectedGroupId === 'uncategorized') {
        if (t.groupId) return false
      } else if (selectedGroupId !== 'all') {
        if (t.groupId !== selectedGroupId) return false
      }

      if (filterFavorite && !t.isFavorite) return false
      const matchStatus = filterStatus === 'all' || t.status === filterStatus
      if (!matchStatus) return false
      
      if (!q) return true
      const prompt = (t.prompt || '').toLowerCase()
      const paramStr = JSON.stringify(t.params).toLowerCase()
      return prompt.includes(q) || paramStr.includes(q)
    })
  }, [tasks, searchQuery, filterStatus, filterFavorite, settings, selectedGroupId])

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

  return (
    <div 
      ref={rootRef}
      data-task-grid-root
      className="relative min-h-[50vh]"
    >
      {/* 分组名称面包屑/指示标题 */}
      <div className="mb-6 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 font-medium select-none" data-no-drag-select>
        <span>画廊分类</span>
        <span>/</span>
        <span className="text-gray-900 dark:text-gray-100 font-semibold">{currentGroupName}</span>
      </div>

      {!filteredTasks.length ? (
        <div className="text-center py-20 text-gray-400 dark:text-gray-500">
          {searchQuery || filterFavorite ? (
            <p className="text-sm">没有找到匹配的记录</p>
          ) : (
            <>
              <svg
                className="w-16 h-16 mx-auto mb-4 text-gray-200 dark:text-gray-700"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              <p className="text-sm">该分组目前没有图片，输入提示词开始生成</p>
            </>
          )}
        </div>
      ) : (
        <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
          {filteredTasks.map((task) => (
            <div key={task.id} className="task-card-wrapper" data-task-id={task.id}>
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
          title="归类图片分组"
          description="请选择要将该图片归入以下哪个分组："
        >
          <div className="grid grid-cols-1 gap-2 pt-2">
            <button
              onClick={() => {
                useStore.getState().assignTaskToGroup(assigningTask.id, null)
                setAssigningTask(null)
              }}
              className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 dark:border-white/[0.08] hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-all text-sm font-semibold flex items-center justify-between text-gray-700 dark:text-gray-300"
            >
              <span className="flex items-center gap-2">
                <span>📂</span>
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
                  <span>🏷️</span>
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
