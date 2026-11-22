'use client';

import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../../../store';

interface AdminUser {
  id: string
  email: string
  displayName: string | null
  status: string
  isAdmin: boolean
  loginCount: number
  lastLoginIp: string | null
  lastLoginUa: string | null
  createdAt: string | null
  lastLoginAt: string | null
  taskCount: number
  doneCount: number
  imageCount: number
  activeSessions: number
  usedToday: number
}

interface AdminStats {
  usersTotal: number
  usersActive: number
  tasksTotal: number
  tasksDone: number
  tasksInFlight: number
  doneToday: number
  imagesTotal: number
  transfersPending: number
}

function fmtDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

export default function AdminUsersPage() {
  const [checking, setChecking] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch('/api/admin/users', { credentials: 'include' }),
        fetch('/api/admin/stats', { credentials: 'include' }),
      ])
      if (usersRes.status === 403) {
        setIsAdmin(false)
        setChecking(false)
        setLoading(false)
        return
      }
      if (usersRes.status === 401) {
        window.location.href = '/signin?redirect=/admin/users'
        return
      }
      const usersJson = await usersRes.json()
      const statsJson = await statsRes.json()
      setUsers(usersJson?.success ? usersJson.data : [])
      setStats(statsJson?.success ? statsJson.data : null)
      setIsAdmin(true)
    } catch {
      showToast('加载管理数据失败', 'error')
    } finally {
      setChecking(false)
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    void load()
  }, [load])

  async function patchStatus(user: AdminUser, status: 'active' | 'disabled') {
    setBusyId(user.id)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      })
      const json = await res.json().catch(() => null)
      if (json?.success) {
        showToast(status === 'active' ? '已启用' : '已禁用并踢下线', 'success')
        await load()
      } else {
        showToast(json?.error || '操作失败', 'error')
      }
    } finally {
      setBusyId(null)
    }
  }

  async function revokeSessions(user: AdminUser) {
    setBusyId(user.id)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/revoke-sessions`, {
        method: 'POST',
        credentials: 'include',
      })
      const json = await res.json().catch(() => null)
      showToast(json?.success ? `已强制下线（清理 ${json.data?.revoked ?? 0} 个会话）` : json?.error || '操作失败', json?.success ? 'success' : 'error')
      if (json?.success) await load()
    } finally {
      setBusyId(null)
    }
  }

  async function submitResetPassword() {
    if (!resetTarget) return
    if (resetPassword.length < 8) {
      showToast('密码长度至少 8 位', 'error')
      return
    }
    setBusyId(resetTarget.id)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(resetTarget.id)}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPassword: resetPassword }),
      })
      const json = await res.json().catch(() => null)
      if (json?.success) {
        showToast('密码已重置并强制下线', 'success')
        setResetTarget(null)
        setResetPassword('')
        await load()
      } else {
        showToast(json?.error || '重置失败', 'error')
      }
    } finally {
      setBusyId(null)
    }
  }

  function confirmDelete(user: AdminUser) {
    setConfirmDialog({
      title: '删除用户',
      message: `将永久删除 **${user.email}** 及其全部任务与图片记录（外键级联，不可恢复）。确定继续吗？`,
      buttons: [
        { label: '取消', tone: 'secondary', action: () => {} },
        {
          label: '确认删除',
          tone: 'primary',
          action: async () => {
            setBusyId(user.id)
            try {
              const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
                method: 'DELETE',
                credentials: 'include',
              })
              const json = await res.json().catch(() => null)
              if (json?.success) {
                showToast('用户已删除', 'success')
                await load()
              } else {
                showToast(json?.error || '删除失败', 'error')
              }
            } finally {
              setBusyId(null)
            }
          },
        },
      ],
    })
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 text-sm text-gray-500 dark:bg-gray-950 dark:text-gray-400">
        正在校验权限…
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 dark:bg-gray-950">
        <p className="text-sm text-gray-600 dark:text-gray-300">该页面仅超级管理员可见</p>
        <a href="/" className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-medium text-white hover:bg-blue-600">
          返回工作区
        </a>
      </div>
    )
  }

  const statCards: Array<{ label: string; value: number | string }> = stats
    ? [
        { label: '用户（活跃）', value: `${stats.usersTotal}（${stats.usersActive}）` },
        { label: '任务总数', value: `${stats.tasksTotal}（完成 ${stats.tasksDone}）` },
        { label: '进行中任务', value: stats.tasksInFlight },
        { label: '今日完成图片', value: stats.doneToday },
        { label: '图片总数', value: stats.imagesTotal },
        { label: '待转存', value: stats.transfersPending },
      ]
    : []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">用户管理</h1>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">超级管理员控制台 · 每日用量按北京时间自然日统计</p>
          </div>
          <a href="/" className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            返回工作区
          </a>
        </div>

        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {statCards.map((card) => (
              <div key={card.label} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="text-[11px] text-gray-400 dark:text-gray-500">{card.label}</div>
                <div className="mt-1.5 text-xl font-semibold text-gray-900 dark:text-gray-100">{card.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-400 dark:bg-gray-800/60 dark:text-gray-500">
              <tr>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-3 py-3 font-medium">状态</th>
                <th className="px-3 py-3 font-medium">任务</th>
                <th className="px-3 py-3 font-medium">今日用量</th>
                <th className="px-3 py-3 font-medium">图片</th>
                <th className="px-3 py-3 font-medium">登录</th>
                <th className="px-3 py-3 font-medium">最近登录</th>
                <th className="px-3 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">加载中…</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无用户</td></tr>
              )}
              {users.map((user) => (
                <tr key={user.id} className="text-gray-700 dark:text-gray-200">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{user.email}</span>
                      {user.isAdmin && (
                        <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:bg-purple-500/10 dark:text-purple-300">
                          超管
                        </span>
                      )}
                    </div>
                    {user.displayName && <div className="mt-0.5 text-[11px] text-gray-400">{user.displayName}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      user.status === 'active'
                        ? 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {user.status === 'active' ? '正常' : '已禁用'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    {user.doneCount}/{user.taskCount}
                  </td>
                  <td className="px-3 py-3">
                    <span className={user.usedToday > 0 ? 'font-semibold text-blue-600 dark:text-blue-400' : ''}>
                      {user.usedToday}
                    </span>
                  </td>
                  <td className="px-3 py-3">{user.imageCount}</td>
                  <td className="px-3 py-3">
                    {user.loginCount} 次{user.activeSessions > 0 && <span className="ml-1 text-[10px] text-blue-500">· {user.activeSessions} 会话</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div>{fmtDate(user.lastLoginAt)}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-gray-400">{user.lastLoginIp || '—'}</div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => patchStatus(user, user.status === 'active' ? 'disabled' : 'active')}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        {user.status === 'active' ? '禁用' : '启用'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => { setResetTarget(user); setResetPassword('') }}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => revokeSessions(user)}
                        className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        强制下线
                      </button>
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => confirmDelete(user)}
                        className="rounded-lg border border-red-200 px-2 py-1 text-[11px] text-red-500 transition hover:bg-red-50 disabled:opacity-40 dark:border-red-500/20 dark:hover:bg-red-500/10"
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {resetTarget && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setResetTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">重置密码</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">为 {resetTarget.email} 设置新密码（至少 8 位），重置后该用户将被强制下线。</p>
            <input
              type="text"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder="输入新密码"
              className="mt-4 h-10 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="rounded-xl px-4 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busyId === resetTarget.id}
                onClick={submitResetPassword}
                className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
