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
  dailyLimit: number | null
  lastLoginIp: string | null
  lastLoginUa: string | null
  createdAt: string | null
  lastLoginAt: string | null
  taskCount: number
  doneCount: number
  doneToday: number
  imageCount: number
  activeSessions: number
  usedToday: number
  costTotal: number
  costToday: number
}

interface TaskView {
  id: string
  prompt: string
  status: string
  provider: string
  size: string | null
  resolution: string | null
  createdAt: string
  finishedAt: string | null
  error: string | null
  deletedAt: string | null
  cost: number
  billed: boolean
  billedResolution: string | null
  images: Array<{ id: string; url: string }>
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
  costTotal: number
  costToday: number
  pricing: { currency: string; prices: { '1k': number; '2k': number; '4k': number } }
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
  const [tasksTarget, setTasksTarget] = useState<AdminUser | null>(null)
  const [userTasks, setUserTasks] = useState<TaskView[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [adminTab, setAdminTab] = useState<'users' | 'audit'>('users')
  const [limitTarget, setLimitTarget] = useState<AdminUser | null>(null)
  const [limitInput, setLimitInput] = useState('')
  const [limitUseCustom, setLimitUseCustom] = useState(false)
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

  async function openTasks(user: AdminUser) {
    setTasksTarget(user)
    setUserTasks([])
    setTasksLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/tasks`, { credentials: 'include' })
      const json = await res.json().catch(() => null)
      setUserTasks(json?.success ? json.data : [])
    } catch {
      showToast('加载任务失败', 'error')
    } finally {
      setTasksLoading(false)
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

  const currency = stats?.pricing.currency ?? '¥'
  const statCards: Array<{ label: string; value: number | string; accent?: boolean }> = stats
    ? [
        { label: '今日花费', value: `${currency}${stats.costToday.toFixed(2)}`, accent: true },
        { label: '累计花费', value: `${currency}${stats.costTotal.toFixed(2)}`, accent: true },
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
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">用户管理</h1>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              超级管理员控制台 · 每日用量按北京时间自然日统计
              {stats?.pricing && (
                <span className="ml-2">
                  单价估算：1k {currency}{stats.pricing.prices['1k']} · 2k {currency}{stats.pricing.prices['2k']} · 4k {currency}{stats.pricing.prices['4k']}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
            <a href="/" className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              返回工作区
            </a>
          </div>
        </div>

        <div className="mb-4 flex gap-2">
          {[
            { key: 'users', label: '用户管理' },
            { key: 'audit', label: '任务审计' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setAdminTab(tab.key as 'users' | 'audit')}
              className={`rounded-xl px-4 py-2 text-xs font-medium transition ${
                adminTab === tab.key
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-white/[0.08] dark:text-blue-400'
                  : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.04]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {adminTab === 'users' && (
        <>
        {stats && (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {statCards.map((card) => (
              <div key={card.label} className={`rounded-2xl border p-4 ${card.accent ? 'border-blue-100 bg-blue-50/60 dark:border-blue-500/20 dark:bg-blue-500/10' : 'border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900'}`}>
                <div className="text-[11px] text-gray-400 dark:text-gray-500">{card.label}</div>
                <div className={`mt-1.5 text-xl font-semibold ${card.accent ? 'text-blue-600 dark:text-blue-400' : 'text-gray-900 dark:text-gray-100'}`}>{card.value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[1080px] text-left text-xs">
            <thead className="bg-gray-50 whitespace-nowrap text-gray-400 dark:bg-gray-800/60 dark:text-gray-500">
              <tr>
                <th className="min-w-[240px] px-4 py-3 font-medium">用户</th>
                <th className="px-3 py-3 font-medium">状态</th>
                <th className="px-3 py-3 font-medium">任务</th>
                <th className="px-3 py-3 font-medium">今日用量</th>
                <th className="px-3 py-3 font-medium">图片</th>
                <th className="px-3 py-3 font-medium">花费（今日/累计）</th>
                <th className="px-3 py-3 font-medium">每日限额</th>
                <th className="px-3 py-3 font-medium">登录</th>
                <th className="px-3 py-3 font-medium">最近登录</th>
                <th className="w-[150px] px-3 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
              {loading && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">加载中…</td></tr>
              )}
              {!loading && users.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">暂无用户</td></tr>
              )}
              {users.map((user) => (
                <tr key={user.id} className="text-gray-700 dark:text-gray-200">
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{user.email}</span>
                      {user.isAdmin && (
                        <span className="whitespace-nowrap rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:bg-purple-500/10 dark:text-purple-300">
                          超管
                        </span>
                      )}
                    </div>
                    {user.displayName && <div className="mt-0.5 text-[11px] text-gray-400">{user.displayName}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-medium ${
                      user.status === 'active'
                        ? 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {user.status === 'active' ? '正常' : '已禁用'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    {user.doneCount}/{user.taskCount}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    <span className={user.usedToday > 0 ? 'font-semibold text-blue-600 dark:text-blue-400' : ''}>
                      {user.usedToday}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">{user.imageCount}</td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    <span className={user.costToday > 0 ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-gray-400'}>
                      {currency}{user.costToday.toFixed(2)}
                    </span>
                    <span className="text-gray-300 dark:text-gray-600"> / </span>
                    <span>{currency}{user.costTotal.toFixed(2)}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    {user.dailyLimit === null || user.dailyLimit === undefined ? '默认' : user.dailyLimit}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    {user.loginCount} 次{user.activeSessions > 0 && <span className="ml-1 text-[10px] text-blue-500">· {user.activeSessions} 会话</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    <div>{fmtDate(user.lastLoginAt)}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-gray-400">{user.lastLoginIp || '—'}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-middle">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => void openTasks(user)}
                        className="whitespace-nowrap rounded-lg border border-blue-200 px-2.5 py-1.5 text-[11px] text-blue-600 transition hover:bg-blue-50 disabled:opacity-40 dark:border-blue-500/20 dark:text-blue-400 dark:hover:bg-blue-500/10"
                      >
                        查看任务
                      </button>
                      <button
                        type="button"
                        disabled={busyId === user.id}
                        onClick={() => patchStatus(user, user.status === 'active' ? 'disabled' : 'active')}
                        className="whitespace-nowrap rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-600 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        {user.status === 'active' ? '禁用' : '启用'}
                      </button>
                      <div className="relative">
                        <button
                          type="button"
                          disabled={busyId === user.id}
                          onClick={() => setMenuOpenId(menuOpenId === user.id ? null : user.id)}
                          className="rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] text-gray-500 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                          aria-label="更多操作"
                        >
                          ▾
                        </button>
                        {menuOpenId === user.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setMenuOpenId(null)} />
                            <div className="absolute right-0 top-full z-50 mt-1 w-28 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                              <button
                                type="button"
                                onClick={() => {
                                  setMenuOpenId(null)
                                  setLimitTarget(user)
                                  setLimitUseCustom(user.dailyLimit !== null && user.dailyLimit !== undefined)
                                  setLimitInput(user.dailyLimit !== null && user.dailyLimit !== undefined ? String(user.dailyLimit) : '')
                                }}
                                className="block w-full px-3 py-2 text-left text-[11px] text-gray-600 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60"
                              >
                                设置限额
                              </button>
                              <button
                                type="button"
                                onClick={() => { setMenuOpenId(null); setResetTarget(user); setResetPassword('') }}
                                className="block w-full px-3 py-2 text-left text-[11px] text-gray-600 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60"
                              >
                                重置密码
                              </button>
                              <button
                                type="button"
                                onClick={() => { setMenuOpenId(null); revokeSessions(user) }}
                                className="block w-full px-3 py-2 text-left text-[11px] text-gray-600 transition hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60"
                              >
                                强制下线
                              </button>
                              <button
                                type="button"
                                onClick={() => { setMenuOpenId(null); confirmDelete(user) }}
                                className="block w-full px-3 py-2 text-left text-[11px] text-red-500 transition hover:bg-red-50 dark:hover:bg-red-500/10"
                              >
                                删除用户
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
        )}

      </div>

      {limitTarget && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setLimitTarget(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-6 shadow-xl dark:border-gray-800 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">每日限额</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
              为 {limitTarget.email} 设置每日生图上限；留空/关闭开关则跟随全局默认（60 张）。
            </p>
            <div className="mt-4 flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={limitUseCustom}
                  onChange={(e) => {
                    setLimitUseCustom(e.target.checked)
                    if (!e.target.checked) setLimitInput('')
                  }}
                  className="h-4 w-4 rounded border-gray-300"
                />
                自定义限额
              </label>
              {limitUseCustom && (
                <input
                  type="number"
                  min={0}
                  value={limitInput}
                  onChange={(e) => setLimitInput(e.target.value)}
                  placeholder="张数"
                  className="h-9 w-28 rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                />
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLimitTarget(null)}
                className="rounded-xl px-4 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busyId === limitTarget.id}
                onClick={async () => {
                  setBusyId(limitTarget.id)
                  try {
                    const res = await fetch(`/api/admin/users/${encodeURIComponent(limitTarget.id)}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ dailyLimit: limitUseCustom ? Number(limitInput) : null }),
                    })
                    const json = await res.json().catch(() => null)
                    if (json?.success) {
                      showToast('每日限额已更新', 'success')
                      setLimitTarget(null)
                      await load()
                    } else {
                      showToast(json?.error || '设置失败', 'error')
                    }
                  } finally {
                    setBusyId(null)
                  }
                }}
                className="rounded-xl bg-blue-500 px-4 py-2 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-40"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

        {adminTab === 'audit' && (
          <AuditSection currency={currency} users={users} onMutated={() => void load()} />
        )}

      {tasksTarget && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={() => setTasksTarget(null)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-800">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {tasksTarget.email} 的任务
                </h3>
                <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                  共 {userTasks.length} 条 · 计费口径：生图成功（done）的任务 × 档位单价
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTasksTarget(null)}
                className="rounded-xl px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                关闭
              </button>
            </div>
            <div className="overflow-y-auto px-6 py-4">
              {tasksLoading && <div className="py-8 text-center text-xs text-gray-400">加载中…</div>}
              {!tasksLoading && userTasks.length === 0 && (
                <div className="py-8 text-center text-xs text-gray-400">该用户暂无任务</div>
              )}
              <div className="space-y-3">
                {userTasks.map((task) => (
                  <div key={task.id} className="rounded-xl border border-gray-100 p-4 dark:border-gray-800">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            task.status === 'done'
                              ? 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400'
                              : task.status === 'provider_failed' || task.status === 'submit_unknown'
                                ? 'bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400'
                                : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                          }`}>
                            {task.status === 'done' ? '完成' : task.status === 'provider_failed' ? '失败' : task.status === 'submit_unknown' ? '提交未知' : task.status === 'running' ? '生成中' : task.status}
                          </span>
                          {task.deletedAt && (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                              用户已删除
                            </span>
                          )}
                          {task.billed && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                              计费 {currency}{task.cost.toFixed(2)}（{task.billedResolution}）
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs text-gray-700 dark:text-gray-200">{task.prompt}</p>
                        <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10px] text-gray-400 dark:text-gray-500">
                          <span>{fmtDate(task.createdAt)}</span>
                          {task.size && <span>尺寸 {task.size}</span>}
                          {task.resolution && <span>档位 {task.resolution}</span>}
                          <span className="truncate">{task.provider}</span>
                        </div>
                        {task.error && (
                          <p className="mt-1.5 line-clamp-2 text-[11px] text-red-500 dark:text-red-400">{task.error}</p>
                        )}
                      </div>
                      {task.images.length > 0 && (
                        <div className="flex flex-shrink-0 gap-1.5">
                          {task.images.slice(0, 4).map((img) => (
                            <img
                              key={img.id}
                              src={img.url}
                              alt=""
                              className="h-16 w-16 rounded-lg border border-gray-100 object-cover dark:border-gray-800"
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

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

interface AdminTaskRow {
  id: string
  prompt: string
  status: string
  provider: string
  email: string
  displayName: string | null
  size: string | null
  resolution: string | null
  cost: number
  createdAt: string
  finishedAt: string | null
  deletedAt: string | null
  error: string | null
}

/** 任务审计视图：全局任务流水 + 卡死任务重置 */
function AuditSection({ currency, users, onMutated }: { currency: string; users: AdminUser[]; onMutated: () => void }) {
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const [statusFilter, setStatusFilter] = useState('all')
  const [userFilter, setUserFilter] = useState('')
  const [keyword, setKeyword] = useState('')
  const [applied, setApplied] = useState({ status: 'all', userId: '', q: '' })
  const [page, setPage] = useState(1)
  const [tasks, setTasks] = useState<Array<AdminTaskRow & { email: string; displayName: string | null }>>([])
  const [stuckCount, setStuckCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [resettingId, setResettingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const search = new URLSearchParams({
        page: String(page),
        limit: '50',
        status: applied.status,
        ...(applied.userId ? { userId: applied.userId } : {}),
        ...(applied.q ? { q: applied.q } : {}),
      })
      const res = await fetch(`/api/admin/tasks?${search.toString()}`, { credentials: 'include' })
      const json = await res.json().catch(() => null)
      if (json?.success) {
        setTasks(json.data)
        setTotal(json.pagination?.total ?? 0)
        setStuckCount(json.stuckCount ?? 0)
      } else {
        showToast(json?.error || '加载任务失败', 'error')
      }
    } catch {
      showToast('加载任务失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [applied, page, showToast])

  useEffect(() => {
    void load()
  }, [load])

  async function resetStuckTask(taskId: string) {
    setConfirmDialog({
      title: '重置卡死任务',
      message:
        '该任务停留在提交状态未知。若原提交**并未在服务商侧创建任务**（如参数被拒绝），重置后可安全重提；否则会**重复扣费**。建议先到 DragonCode 后台确认后再操作。确定重置吗？',
      buttons: [
        { label: '取消', tone: 'secondary', action: () => {} },
        {
          label: '确认重置',
          tone: 'primary',
          action: async () => {
            setResettingId(taskId)
            try {
              const res = await fetch(`/api/admin/tasks/${encodeURIComponent(taskId)}/reset`, {
                method: 'POST',
                credentials: 'include',
              })
              const json = await res.json().catch(() => null)
              if (json?.success) {
                showToast('任务已重置，等待 worker 重新提交', 'success')
                onMutated()
                await load()
              } else {
                showToast(json?.error || '重置失败', 'error')
              }
            } finally {
              setResettingId(null)
            }
          },
        },
      ],
    })
  }

  const statusLabel: Record<string, string> = {
    done: '完成',
    provider_failed: '失败',
    submit_unknown: '提交未知',
  }

  function fmtTime(value: unknown): string {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? new Date(n).toLocaleString('zh-CN', { hour12: false }) : '—'
  }

  return (
    <div className="space-y-4">
      {stuckCount > 0 && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            ⚠ 有 {stuckCount} 个卡死任务（提交状态未知），等待人工处理
          </span>
          <button
            type="button"
            onClick={() => { setStatusFilter('submit_unknown'); setPage(1); setApplied({ status: 'submit_unknown', userId: '', q: '' }) }}
            className="rounded-lg border border-amber-300 px-3 py-1.5 text-[11px] font-medium text-amber-600 hover:bg-amber-100 dark:border-amber-500/30 dark:text-amber-400 dark:hover:bg-amber-500/10"
          >
            筛选查看
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="h-9 rounded-xl border border-gray-200/70 bg-white/60 px-3 text-xs text-gray-700 outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
        >
          <option value="all">全部状态</option>
          <option value="done">已完成</option>
          <option value="failed">已失败</option>
          <option value="submit_unknown">提交未知</option>
          <option value="in_flight">进行中</option>
        </select>
        <select
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setPage(1) }}
          className="h-9 rounded-xl border border-gray-200/70 bg-white/60 px-3 text-xs text-gray-700 outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
        >
          <option value="">全部用户</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.email}</option>
          ))}
        </select>
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); setApplied({ status: statusFilter, userId: userFilter, q: keyword }) } }}
          placeholder="搜索提示词…"
          className="h-9 w-56 rounded-xl border border-gray-200/70 bg-white/60 px-3 text-xs text-gray-700 outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
        />
        <button
          type="button"
          onClick={() => { setPage(1); setApplied({ status: statusFilter, userId: userFilter, q: keyword }) }}
          className="h-9 rounded-xl border border-gray-200 px-4 text-xs font-medium text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          查询
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="bg-gray-50 whitespace-nowrap text-gray-400 dark:bg-gray-800/60 dark:text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">时间</th>
              <th className="px-3 py-3 font-medium">用户</th>
              <th className="px-3 py-3 font-medium">提示词</th>
              <th className="px-3 py-3 font-medium">状态</th>
              <th className="px-3 py-3 font-medium">档位/尺寸</th>
              <th className="px-3 py-3 font-medium">花费</th>
              <th className="px-3 py-3 font-medium">错误</th>
              <th className="px-3 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">加载中…</td></tr>
            )}
            {!loading && tasks.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">暂无任务</td></tr>
            )}
            {tasks.map((task) => (
              <tr key={task.id} className="text-gray-700 dark:text-gray-200">
                <td className="whitespace-nowrap px-4 py-3 align-middle">{fmtTime(task.createdAt)}</td>
                <td className="px-3 py-3 align-middle">
                  <div className="font-medium">{task.email}</div>
                  {task.displayName && <div className="text-[10px] text-gray-400">{task.displayName}</div>}
                </td>
                <td className="max-w-[220px] px-3 py-3 align-middle">
                  <div className="truncate">{task.prompt || '—'}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-middle">
                  <span className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${
                    task.status === 'done'
                      ? 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400'
                      : task.status === 'submit_unknown'
                        ? 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400'
                        : task.status === 'provider_failed'
                          ? 'bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400'
                          : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                  }`}>
                    {statusLabel[task.status] || task.status}
                  </span>
                  {task.deletedAt && (
                    <span className="ml-1 rounded-full bg-gray-100 px-2 py-1 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      已删除
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-middle">
                  {task.resolution || '—'}
                  {task.size && <div className="text-[10px] text-gray-400">{task.size}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-middle">
                  {task.cost > 0 ? <span className="font-semibold">{currency}{task.cost.toFixed(2)}</span> : <span className="text-gray-300 dark:text-gray-600">—</span>}
                </td>
                <td className="max-w-[200px] px-3 py-3 align-middle">
                  <div className="truncate text-[11px] text-gray-400">{task.error || '—'}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-middle">
                  {task.status === 'submit_unknown' && (
                    <button
                      type="button"
                      disabled={resettingId === task.id}
                      onClick={() => resetStuckTask(task.id)}
                      className="whitespace-nowrap rounded-lg border border-amber-300 px-2.5 py-1.5 text-[11px] font-medium text-amber-600 transition hover:bg-amber-50 disabled:opacity-40 dark:border-amber-500/30 dark:text-amber-400 dark:hover:bg-amber-500/10"
                    >
                      重置提交
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
        <span>共 {total} 条 · 第 {page} 页</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-gray-200 px-3 py-1.5 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={!hasMore(page, total) || loading}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-gray-200 px-3 py-1.5 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  )

  function hasMore(page: number, total: number) {
    return page * 50 < total
  }
}
