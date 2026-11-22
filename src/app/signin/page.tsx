'use client';

import { useState } from 'react';

export default function SigninPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const json = await response.json().catch(() => null);
      if (response.ok && json?.success) {
        // redirect 参数仅允许站内路径，防止开放跳转
        const requested = new URLSearchParams(window.location.search).get('redirect') || '/';
        const target = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';
        window.location.href = target;
        return;
      }
      setError(json?.error || '登录失败，请稍后重试');
    } catch {
      setError('网络异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl overflow-hidden mb-4 shadow-lg">
            <img src="/logo.png" alt="Image Studio" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Image Studio</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">请登录以继续使用</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 shadow-sm space-y-4"
        >
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              账号
            </label>
            <input
              id="email"
              type="text"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入账号"
              className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1.5">
              密码
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              className="w-full h-10 px-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-300 dark:placeholder:text-gray-600 outline-none focus:border-blue-400 dark:focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition"
            />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100/60 dark:border-red-500/20 px-3 py-2 text-xs text-red-500 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="w-full h-10 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 dark:disabled:bg-gray-800 disabled:text-gray-400 text-white text-sm font-medium transition-colors"
          >
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="text-center text-[11px] text-gray-400 dark:text-gray-600 mt-6">
          账号由管理员分配，忘记密码请联系管理员重置
        </p>
      </div>
    </div>
  );
}
