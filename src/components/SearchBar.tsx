import { useStore } from '../store'
import Select from './Select'

export default function SearchBar() {
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)

  return (
    <div data-no-drag-select className="mb-5 mt-0 sm:mt-5 flex flex-col gap-3 sm:flex-row">
      <div className="z-20 flex flex-shrink-0 gap-2">
        <button
          onClick={() => setFilterFavorite(!filterFavorite)}
          className={`rounded-2xl border p-2.5 transition-all active:scale-95 ${
            filterFavorite
              ? 'border-amber-300 bg-amber-50 text-amber-500 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300'
              : 'border-slate-200 bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500 dark:hover:bg-white/[0.06] dark:hover:text-slate-300'
          }`}
          title={filterFavorite ? '取消只看收藏' : '只看收藏'}
        >
          <svg className="w-5 h-5" fill={filterFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
        <div className="relative w-full sm:w-28">
          <Select
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as any)}
            options={[
              { label: '全部状态', value: 'all' },
              { label: '已完成', value: 'done' },
              { label: '生成中', value: 'running' },
              { label: '失败', value: 'error' },
            ]}
            className="rounded-2xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-[0_14px_36px_-30px_rgba(15,23,42,0.45)] transition hover:bg-slate-50 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:hover:bg-white/[0.06]"
          />
        </div>
      </div>
      <div className="relative flex-1 z-10">
        <svg
          className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder="搜索提示词、参数..."
          className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-800 shadow-[0_14px_36px_-30px_rgba(15,23,42,0.45)] transition placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-100 dark:placeholder:text-slate-500"
        />
      </div>
    </div>
  )
}
