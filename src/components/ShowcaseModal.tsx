import { useMemo, useState } from 'react'

import { SHOWCASE_CATEGORIES, SHOWCASE_EXAMPLES, ShowcaseExample } from '../data/showcase'
import { copyTextToClipboard, getClipboardFailureMessage } from '../lib/clipboard'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { useStore } from '../store'
import { CloseIcon, CopyIcon, PhotoIcon, PlusIcon } from './icons'

interface ShowcaseModalProps {
  onClose: () => void
}

function getParamSummary(example: ShowcaseExample) {
  const parts = [
    example.params.size,
    example.params.resolution ? `resolution ${example.params.resolution}` : null,
    example.params.n && example.params.n > 1 ? `${example.params.n} variants` : null,
  ].filter(Boolean)

  return parts.join(' / ')
}

function ShowcaseThumbGrid({ images, label, onPreview }: { images: string[]; label: string; onPreview: (src: string) => void }) {
  return (
    <div className={`grid gap-2 ${images.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {images.slice(0, 4).map((src, index) => (
        <button
          type="button"
          key={`${src}-${index}`}
          onClick={() => onPreview(src)}
          className="group relative block aspect-[4/5] overflow-hidden rounded-lg border border-gray-200 bg-gray-100 text-left dark:border-white/[0.08] dark:bg-white/[0.04]"
          title="预览示例图"
        >
          <img
            src={src}
            alt={`${label} ${index + 1}`}
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
            loading="lazy"
          />
          {images.length > 4 && index === 3 && (
            <span className="absolute inset-0 grid place-items-center bg-black/45 text-xs font-bold text-white">
              +{images.length - 4}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export default function ShowcaseModal({ onClose }: ShowcaseModalProps) {
  const setPrompt = useStore((s) => s.setPrompt)
  const setParams = useStore((s) => s.setParams)
  const showToast = useStore((s) => s.showToast)
  const inputImages = useStore((s) => s.inputImages)
  const [category, setCategory] = useState<(typeof SHOWCASE_CATEGORIES)[number]['id']>('all')
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState(SHOWCASE_EXAMPLES[0]?.id ?? '')
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)

  const filteredExamples = useMemo(() => {
    const q = query.trim().toLowerCase()
    return SHOWCASE_EXAMPLES.filter((example) => {
      if (category !== 'all' && example.category !== category) return false
      if (!q) return true
      return [
        example.title,
        example.useCase,
        example.description,
        example.prompt,
        example.mode,
      ].join('\n').toLowerCase().includes(q)
    })
  }, [category, query])

  const activeExample = useMemo(() => (
    filteredExamples.find((example) => example.id === activeId) ?? filteredExamples[0] ?? SHOWCASE_EXAMPLES[0]
  ), [activeId, filteredExamples])

  const applyExample = (prompt: string) => {
    dismissAllTooltips()
    setPrompt(prompt)
    setParams(activeExample.params)
    if (activeExample.mode === 'edit' && inputImages.length === 0) {
      showToast('已套用提示词。该示例需要先上传参考图再生成。', 'info')
    } else {
      showToast('已套用到输入栏', 'success')
    }
    onClose()
  }

  const copyPrompt = async (prompt: string) => {
    try {
      await copyTextToClipboard(prompt)
      showToast('提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }

  if (!activeExample) return null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-gray-950/45 backdrop-blur-sm"
        aria-label="关闭 showcase"
        onClick={onClose}
      />

      <section className="z-10 flex h-full w-full max-w-7xl flex-col overflow-hidden border border-gray-200/80 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-gray-950 sm:h-[min(860px,calc(100vh-2rem))] sm:rounded-2xl absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200/70 px-4 py-4 dark:border-white/[0.08] sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600 dark:text-blue-400">
              <PhotoIcon className="h-4 w-4" />
              Prompt Showcase
            </div>
            <h2 className="mt-1 text-lg font-bold text-gray-950 dark:text-white">提示词及效果展示库</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
            aria-label="关闭"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-b border-gray-200/70 dark:border-white/[0.08] lg:border-b-0 lg:border-r">
            <div className="shrink-0 space-y-3 p-4">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索用例、提示词、参数..."
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white dark:focus:border-blue-400"
              />
              <div className="flex gap-1 overflow-x-auto pb-1 hide-scrollbar">
                {SHOWCASE_CATEGORIES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setCategory(item.id)
                      setActiveId('')
                    }}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      category === item.id
                        ? 'bg-gray-950 text-white dark:bg-white dark:text-gray-950'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              {filteredExamples.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500 dark:border-white/[0.08] dark:text-gray-400">
                  没有匹配的 showcase。
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredExamples.map((example) => {
                    const isActive = activeExample.id === example.id
                    return (
                      <button
                        key={example.id}
                        type="button"
                        onClick={() => setActiveId(example.id)}
                        className={`w-full rounded-xl border p-3 text-left transition ${
                          isActive
                            ? 'border-blue-300 bg-blue-50/70 shadow-sm shadow-blue-500/10 dark:border-blue-500/30 dark:bg-blue-500/10'
                            : 'border-transparent hover:border-gray-200 hover:bg-gray-50 dark:hover:border-white/[0.08] dark:hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-bold text-gray-900 dark:text-white">{example.title}</span>
                          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                            example.mode === 'edit'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                          }`}>
                            {example.mode === 'edit' ? 'Edit' : 'Generate'}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{example.description}</p>
                        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-gray-400 dark:text-gray-500">
                          <span>{example.useCase}</span>
                          <span>{getParamSummary(example)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto p-4 sm:p-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-xl font-black tracking-tight text-gray-950 dark:text-white">{activeExample.title}</h3>
                      <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">
                        {activeExample.useCase}
                      </span>
                    </div>
                    <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-600 dark:text-gray-300">{activeExample.description}</p>
                  </div>
                </div>
              {
                activeExample.prompt.map((p, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 bg-gray-50/80 p-3 dark:border-white/[0.08] dark:bg-white/[0.03]">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-gray-700 dark:text-gray-200">Prompt</span>
                      <div className="flex items-center gap-2">
                        {/* <span className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{getParamSummary(activeExample)}</span> */}
                        <button
                          type="button"
                          title='复制这个提示词'
                          onClick={() => copyPrompt(p)}
                        >
                          <CopyIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          title='套用这个提示词'
                          onClick={() => applyExample(p)}
                        >
                          <PlusIcon className="h-4 w-4" />
                        </button>     
                      </div>
                    </div>
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg bg-white p-4 font-mono text-xs leading-relaxed text-gray-700 dark:bg-gray-950/70 dark:text-gray-200">
                      {p}
                    </pre>
                  </div>
                ))
              }

                {activeExample.notes && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-xs leading-relaxed text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                    {activeExample.notes.join(' ')}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {activeExample.inputImages && (
                  <section>
                    <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-700 dark:text-gray-200">
                      <span>参考图</span>
                      <span className="font-mono text-[11px] text-gray-400">共 {activeExample.inputImages.length} 张</span>
                    </div>
                    <ShowcaseThumbGrid images={activeExample.inputImages} label={`${activeExample.title} input`} onPreview={setPreviewSrc} />
                  </section>
                )}

                <section>
                  <div className="mb-2 flex items-center justify-between text-xs font-bold text-gray-700 dark:text-gray-200">
                    <span>效果图</span>
                  </div>
                  <ShowcaseThumbGrid images={activeExample.outputImages} label={`${activeExample.title} output`} onPreview={setPreviewSrc} />
                </section>
              </div>
            </div>
          </main>
        </div>
      </section>

      {previewSrc && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4" onClick={() => setPreviewSrc(null)}>
          <button
            type="button"
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
            onClick={() => setPreviewSrc(null)}
            aria-label="关闭预览"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
          <img
            src={previewSrc}
            alt="示例图预览"
            className="max-h-[90vh] max-w-[92vw] rounded-xl object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
