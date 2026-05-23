import { useState } from 'react'
import { useStore } from '../store'
import GroupDialog from './GroupDialog'

/**
 * ChatGPT 风格的左侧侧边栏组件，承载分组管理和过滤
 */
export default function Sidebar() {
  const settings = useStore((s) => s.settings)
  const groups = settings.groups ?? []
  const createGroup = useStore((s) => s.createGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const renameGroup = useStore((s) => s.renameGroup)
  
  const selectedGroupId = useStore((s) => s.selectedGroupId)
  const setSelectedGroupId = useStore((s) => s.setSelectedGroupId)
  
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const currentUser = useStore((s) => s.currentUser)

  // GroupDialog 弹窗控制状态
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false)
  const [groupDialogMode, setGroupDialogMode] = useState<'create' | 'rename'>('create')
  const [editingGroupId, setEditingGroupId] = useState('')
  const [editingGroupName, setEditingGroupName] = useState('')

  // 触发新建分组弹窗
  const handleCreateClick = () => {
    setGroupDialogMode('create')
    setEditingGroupName('')
    setIsGroupDialogOpen(true)
  }

  // 触发重命名分组弹窗
  const handleRenameClick = (id: string, name: string) => {
    setGroupDialogMode('rename')
    setEditingGroupId(id)
    setEditingGroupName(name)
    setIsGroupDialogOpen(true)
  }

  // 确定分组弹窗修改
  const handleGroupConfirm = (name: string) => {
    if (groupDialogMode === 'create') {
      createGroup(name)
    } else {
      renameGroup(editingGroupId, name)
    }
  }

  // 删除分组确认
  const handleDeleteClick = (id: string, name: string) => {
    setConfirmDialog({
      title: '删除分组',
      message: `确认要删除分组「${name}」吗？组内的图片不会被删除，将重新划分为「未分类」。`,
      action: () => {
        deleteGroup(id)
        if (selectedGroupId === id) {
          setSelectedGroupId('all')
        }
      }
    })
  }

  // 未选中和已选中的样式模板 (仿 ChatGPT)
  const getMenuItemClass = (isActive: boolean) => {
    return `w-full flex items-center justify-between gap-2.5 px-3 py-2 text-xs rounded-xl transition-all duration-200 group/item select-none cursor-pointer ${
      isActive
        ? 'bg-blue-50/80 text-blue-600 font-semibold dark:bg-blue-500/10 dark:text-blue-400'
        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.04] dark:hover:text-white'
    }`
  }

  return (
    <>
      {/* 移动端侧边栏弹出时的黑色半透明蒙层 */}
      {sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs lg:hidden transition-opacity animate-fade-in"
        />
      )}

      {/* 侧栏主容器 */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200/70 bg-white/95 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-950/95 transition-transform duration-300 ease-in-out lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* 顶部 Logo 与流光标题 */}
        <div className="flex h-14 items-center justify-between border-b border-gray-100 px-4 dark:border-white/[0.05]">
          <span className="flex items-center gap-2 font-bold tracking-tight text-gray-900 dark:text-gray-100">
            <span className="text-lg">🎨</span>
            <span className="bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-sm font-extrabold text-transparent dark:from-blue-400 dark:to-indigo-300">
              GPT Image
            </span>
          </span>
          
          {/* 移动端收起侧栏按钮 */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.05] lg:hidden text-gray-500"
            aria-label="收起菜单"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>

        {/* 侧栏主体滚动区 */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
          
          {/* 快捷新建分组项 */}
          <button
            onClick={handleCreateClick}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition-all hover:border-gray-300 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.02] dark:text-gray-300 dark:hover:border-white/20 dark:hover:bg-white/[0.04]"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            新建分组
          </button>

          {/* 分组列表菜单 */}
          <div className="space-y-1">
            <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
              画廊分类
            </div>
            
            {/* 全部照片 */}
            <div 
              onClick={() => { setSelectedGroupId('all'); setSidebarOpen(false) }}
              className={getMenuItemClass(selectedGroupId === 'all')}
            >
              <span className="flex items-center gap-2">
                <span className="opacity-70 text-xs">🗂️</span>
                <span>全部</span>
              </span>
            </div>

            {/* 未分类照片 */}
            <div 
              onClick={() => { setSelectedGroupId('uncategorized'); setSidebarOpen(false) }}
              className={getMenuItemClass(selectedGroupId === 'uncategorized')}
            >
              <span className="flex items-center gap-2">
                <span className="opacity-70 text-xs">📂</span>
                <span>未分类</span>
              </span>
            </div>

            {/* 动态自定义分组 */}
            {groups.map((g) => {
              const isActive = selectedGroupId === g.id
              return (
                <div
                  key={g.id}
                  onClick={() => { setSelectedGroupId(g.id); setSidebarOpen(false) }}
                  className={getMenuItemClass(isActive)}
                >
                  <span className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="opacity-70 text-xs shrink-0">🏷️</span>
                    <span className="truncate">{g.name}</span>
                  </span>
                  
                  {/* 分组编辑与删除快捷按钮，在悬停时出现 */}
                  <span className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRenameClick(g.id, g.name)
                      }}
                      className="p-1 rounded text-gray-400 hover:bg-gray-200/50 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/[0.08] dark:hover:text-gray-200 transition"
                      title="重命名"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteClick(g.id, g.name)
                      }}
                      className="p-1 rounded text-gray-400 hover:bg-red-50 hover:text-red-500 dark:text-gray-500 dark:hover:bg-red-950/20 dark:hover:text-red-400 transition"
                      title="删除"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 侧栏底部个人操作区 (类似 ChatGPT) */}
        <div className="mt-auto border-t border-gray-100 p-3 dark:border-white/[0.05] bg-gray-50/40 dark:bg-white/[0.01] space-y-2">
          <button
            onClick={() => {
              setSidebarOpen(false)
              setShowSettings(true)
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.04] transition-all font-semibold"
          >
            <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.43l-1.003.828c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.43l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.991l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            全局系统设置
          </button>

          {currentUser && (
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-gray-100/50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04]">
              <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-500 text-white flex items-center justify-center font-bold text-xs shrink-0 select-none shadow-sm shadow-blue-500/10">
                {currentUser.displayName ? currentUser.displayName[0].toUpperCase() : currentUser.email[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate leading-none">
                  {currentUser.displayName || '未命名用户'}
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-1 leading-none font-mono">
                  {currentUser.email}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* 分组操作的弹窗组件 */}
      <GroupDialog
        isOpen={isGroupDialogOpen}
        onClose={() => setIsGroupDialogOpen(false)}
        mode={groupDialogMode}
        initialName={editingGroupName}
        onConfirm={handleGroupConfirm}
      />
    </>
  )
}
