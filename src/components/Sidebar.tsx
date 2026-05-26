import { useState } from 'react'

import { useStore } from '../store'
import GroupDialog from './GroupDialog'
import { FolderIcon, PhotoIcon, PlusIcon, SettingsIcon, TagIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

import { useTooltip } from '../hooks/useTooltip'
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
  const settingsBtn= useTooltip()
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
          setSelectedGroupId('unassigned')
        }
      }
    })
  }

  // 未选中和已选中的样式模板 (仿 ChatGPT)
  const getMenuItemClass = (isActive: boolean) => {
    return `w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-xs rounded-2xl transition-all duration-200 group/item select-none cursor-pointer border ${
      isActive
        ? 'border-blue-200/60 bg-blue-50/85 font-semibold text-blue-600 shadow-[0_14px_32px_-26px_rgba(37,99,235,0.55)] dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300'
        : 'border-transparent text-slate-600 hover:bg-white/70 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-white/[0.045] dark:hover:text-white'
    }`
  }

  return (
    <>
      {/* 移动端侧边栏弹出时的半透明蒙层 */}
      {sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/38 backdrop-blur-sm lg:hidden transition-opacity animate-fade-in"
        />
      )}

      {/* 侧栏主容器 */}
      <aside 
        className={`fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-slate-200/75 bg-white/[0.86] backdrop-blur-2xl transition-transform duration-300 ease-out dark:border-white/[0.08] dark:bg-[#10141d]/[0.92] lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200/60 px-4 dark:border-white/[0.06]">
          <span className="flex items-center gap-2.5 font-bold tracking-tight text-gray-950 dark:text-gray-100">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-blue-200/70 bg-blue-50 text-blue-600 shadow-[0_14px_32px_-24px_rgba(37,99,235,0.55)] dark:border-blue-400/20 dark:bg-blue-500/10 dark:text-blue-300">
            <img src="./logo.png" alt="Image Studio Logo" />
            </span>
            <span className="text-sm font-extrabold text-slate-900 dark:text-slate-100">
              Image Studio
            </span>
          </span>
          
          {/* 移动端收起侧栏按钮 */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-xl p-1.5 text-gray-500 transition-all hover:bg-slate-100 active:scale-95 dark:hover:bg-white/[0.06] lg:hidden"
            aria-label="收起菜单"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>

        {/* 侧栏主体滚动区 */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3.5 space-y-4">
          
          {/* 快捷新建分组项 */}
          <button
            onClick={handleCreateClick}
            className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-slate-200/90 bg-white/[0.55] px-3 py-2.5 text-xs font-semibold text-slate-600 transition-all duration-200 hover:-translate-y-px hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-600 active:translate-y-0 dark:border-white/10 dark:bg-white/[0.025] dark:text-slate-300 dark:hover:border-blue-400/30 dark:hover:bg-blue-500/[0.08] dark:hover:text-blue-300"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            新建分组
          </button>

          {/* 分组列表菜单 */}
          <div className="space-y-1 h-full overflow-auto custom-scrollbar">
            {/* <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
              画廊分组
            </div> */}
            
            {/* 未分类照片 */}
            <div 
              onClick={() => { setSelectedGroupId('unassigned'); setSidebarOpen(false) }}
              className={getMenuItemClass(selectedGroupId === 'unassigned')}
            >
              <span className="flex items-center gap-2">
                <FolderIcon className="h-3.5 w-3.5 opacity-70" />
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
                    <TagIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
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
        <div className="mt-auto space-y-2 border-t border-slate-200/60 bg-slate-50/55 p-0 dark:border-white/[0.06] dark:bg-white/[0.015]">
          {currentUser && (
            <div className="flex items-center justify-between gap-2.5 border border-none bg-white/[0.58] px-3 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.025]">
              <div className="flex-1">
                <div className="truncate text-xs font-semibold leading-none text-slate-700 dark:text-slate-200">
                  {currentUser.displayName || '未命名用户'}
                </div>
                <div className="mt-1 truncate font-mono text-[10px] leading-none text-slate-400 dark:text-slate-500">
                  {currentUser.email}
                </div>
              </div>
              <div {...settingsBtn.handlers}>
                <SettingsIcon
                  onClick={() => {
                    setSidebarOpen(false)
                    setShowSettings(true)
                  }}
                  className="h-5 w-5 cursor-pointer text-slate-500 transition-all duration-300 hover:rotate-90 hover:text-slate-700 pointer-events-auto dark:text-slate-400 dark:hover:text-slate-200"
                />
                <ViewportTooltip visible={settingsBtn.visible} className="whitespace-nowrap">
                  系统设置
                </ViewportTooltip>
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
