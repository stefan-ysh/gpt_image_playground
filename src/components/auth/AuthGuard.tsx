import React, { useEffect, useState } from 'react'
import { useStore } from '../../store'

interface AuthGuardProps {
  children: React.ReactNode
}

/** 未登录时跳转本项目登录页 */
function buildSigninUrl() {
  const returnUrl = new URL(window.location.href)
  const redirect = encodeURIComponent(returnUrl.pathname + returnUrl.search)
  return `/signin?redirect=${redirect}`
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string>('')

  useEffect(() => {
    let active = true

    async function checkAuth() {
      try {
        const response = await fetch('/api/auth/me', {
          method: 'GET',
          headers: { Accept: 'application/json' },
          credentials: 'include',
        })

        if (!active) return

        if (response.ok) {
          const result = await response.json()
          if (result.success && result.data) {
            useStore.getState().setCurrentUser(result.data)
            setIsAuthenticated(true)
            setIsLoading(false)
            return
          }
        }

        if (response.status === 401) {
          // 未登录：引导到本项目登录页
          window.location.href = buildSigninUrl()
          return
        }

        const result = await response.json().catch(() => null)
        setErrorMsg(result?.error || '登录态校验失败，请检查服务端配置')
        setIsAuthenticated(false)
        setIsLoading(false)
      } catch (err) {
        if (!active) return
        console.error('Authentication check failed:', err)
        setErrorMsg('无法连接至认证服务')
        setIsAuthenticated(false)
        setIsLoading(false)
      }
    }

    void checkAuth()

    return () => {
      active = false
    }
  }, [])

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center select-none overflow-hidden bg-white/30 dark:bg-gray-950/20 backdrop-blur-md">
        <div className="premium-glass-card flex flex-col items-center justify-center p-8 rounded-3xl w-[320px] max-w-full text-center">
          <div className="relative w-16 h-16 mb-4 flex items-center justify-center">
            {/* 高阶渐变呼吸加载圆环 */}
            <div className="absolute inset-0 rounded-full border-2 border-dashed border-gray-200 dark:border-white/[0.08]" />
            <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <svg className="w-6 h-6 text-blue-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            正在校验您的登录状态
          </h2>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 font-mono">
            VERIFYING SESSION...
          </p>
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center select-none overflow-hidden bg-white/40 dark:bg-gray-950/30 backdrop-blur-md">
        <div className="premium-glass-card flex flex-col items-center justify-center p-8 rounded-3xl w-[340px] max-w-full text-center">
          <div className="relative w-16 h-16 mb-4 bg-amber-50 dark:bg-amber-500/10 rounded-full flex items-center justify-center border border-amber-200/50 dark:border-amber-500/20">
            <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            登录态校验失败
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
            {errorMsg || '请重新登录后继续使用'}
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = buildSigninUrl() }}
            className="mt-5 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium transition-colors"
          >
            前往登录
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
