import { useEffect, useState } from 'react'

import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { useStore } from '../store'
import HelpModal from './HelpModal'
import { HelpCircleIcon, PhotoIcon } from './icons'
import ViewportTooltip from './ViewportTooltip'

interface HeaderProps {
  onOpenShowcase?: () => void
}

export default function Header({ onOpenShowcase }: HeaderProps) {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const currentTheme = settings.theme || 'system'
  const [showHelp, setShowHelp] = useState(false)

  const toggleTheme = () => {
    const nextThemeMap: Record<string, 'light' | 'dark' | 'system'> = {
      system: 'light',
      light: 'dark',
      dark: 'system',
    }
    const nextTheme = nextThemeMap[currentTheme] || 'system'
    setSettings({ theme: nextTheme })
  }

  const themeTooltip = useTooltip()



  const helpTooltip = useTooltip()
  const showcaseTooltip = useTooltip()

  return (
    <>
      <header data-no-drag-select className="safe-area-top sticky top-0 z-30 w-full border-b border-gray-200/70 bg-white/82 shadow-[0_1px_20px_rgba(15,23,42,0.04)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-950/82 dark:shadow-[0_1px_22px_rgba(0,0,0,0.28)]">
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="flex-1 min-w-0 pr-2 flex items-center gap-2">
            {/* 移动端汉堡菜单按钮 */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 mr-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/[0.05] lg:hidden text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
              aria-label="打开侧栏"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div
              className="relative"
              {...showcaseTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  onOpenShowcase?.()
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="提示词展示库"
              >
                <PhotoIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={showcaseTooltip.visible} className="whitespace-nowrap">
                提示词展示库
              </ViewportTooltip>
            </div>

            <div
              className="relative"
              {...themeTooltip.handlers}
            >
              <button
                onClick={toggleTheme}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-all duration-300 active:scale-95 group"
                aria-label="切换主题"
              >
                {currentTheme === 'light' && (
                  <svg className="w-5 h-5 text-amber-500 group-hover:rotate-90 transition-transform duration-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="5"></circle>
                    <line x1="12" y1="1" x2="12" y2="3"></line>
                    <line x1="12" y1="21" x2="12" y2="23"></line>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                    <line x1="1" y1="12" x2="3" y2="12"></line>
                    <line x1="21" y1="12" x2="23" y2="12"></line>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
                  </svg>
                )}
                {currentTheme === 'dark' && (
                  <svg className="w-5 h-5 text-indigo-400 group-hover:-rotate-12 transition-transform duration-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                  </svg>
                )}
                {currentTheme === 'system' && (
                  <svg className="w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:scale-105 transition-transform duration-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                )}
              </button>
              <ViewportTooltip visible={themeTooltip.visible} className="whitespace-nowrap">
                {currentTheme === 'light' ? '主题：明亮' : currentTheme === 'dark' ? '主题：暗黑' : '主题：跟随系统'}
              </ViewportTooltip>
            </div>

            <div
              className="relative"
              {...helpTooltip.handlers}
            >
              <button
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>

          </div>
        </div>
      </header>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </>
  )
}
