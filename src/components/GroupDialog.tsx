import React, { useState, useEffect } from 'react'
import Dialog from './ui/Dialog'

/** GroupDialog 属性接口定义 */
interface GroupDialogProps {
  isOpen: boolean
  onClose: () => void
  mode: 'create' | 'rename'
  initialName?: string
  onConfirm: (name: string) => void
}

/**
 * 分组新建/重命名专用的表单弹窗组件
 */
export default function GroupDialog({ isOpen, onClose, mode, initialName = '', onConfirm }: GroupDialogProps) {
  const [name, setName] = useState(initialName)

  // 当弹窗打开时，拉齐输入框默认值
  useEffect(() => {
    if (isOpen) {
      setName(initialName)
    }
  }, [isOpen, initialName])

  // 处理表单提交
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    onConfirm(name.trim())
    onClose()
  }

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? '新建图片分组' : '重命名分组'}
      description={mode === 'create' ? '请输入新分组的名称。' : '请重新输入该分组的名称。'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <input
            type="text"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="分组名称，例如：动漫、水彩、写实..."
            className="flex h-10 w-full rounded-xl border border-gray-200 bg-transparent px-3.5 py-2 text-sm shadow-sm transition-all focus:border-blue-500 focus:outline-none dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-100 dark:focus:border-blue-500/50 placeholder:text-gray-400 dark:placeholder:text-gray-600"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.04] transition-all"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-blue-500/10"
          >
            确定
          </button>
        </div>
      </form>
    </Dialog>
  )
}
