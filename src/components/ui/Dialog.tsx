import React, { useEffect } from 'react'

/** Dialog 组件接口定义 */
interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
}

/**
 * 遵循 shadcn/ui 视觉设计语言的通用模态弹窗组件
 */
export default function Dialog({ isOpen, onClose, title, description, children }: DialogProps) {
  // 监听 Escape 键自动关闭弹窗
  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 磨砂模糊背景遮罩层 */}
      <div 
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity animate-fade-in" 
      />
      
      {/* 弹窗核心面板，遵循 shadcn 极细边框和柔和阴影质感 */}
      <div className="relative w-full max-w-md scale-100 rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xl dark:border-white/[0.08] dark:bg-gray-950 transition-all animate-modal-in z-10 mx-4">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 opacity-60 transition-opacity hover:opacity-100 focus:outline-none text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.05]"
          aria-label="关闭"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* 头部标题与副标题描述 */}
        <div className="flex flex-col space-y-1.5 text-left mb-4 pr-6">
          <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {description}
            </p>
          )}
        </div>

        {/* 弹窗内容插入区 */}
        <div className="text-sm text-gray-700 dark:text-gray-300">{children}</div>
      </div>
    </div>
  )
}
