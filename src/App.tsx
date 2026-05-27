'use client'

import { useEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import ShowcaseModal from './components/ShowcaseModal'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import AuthGuard from './components/auth/AuthGuard'
import Sidebar from './components/Sidebar'

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const [showShowcase, setShowShowcase] = useState(false)
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)

    if (hasUrlSettingParams(searchParams)) {
      const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)
      setSettings(nextSettings)
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    initStore()
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <AuthGuard>
      <div className="flex h-[100dvh] min-h-[100dvh] w-screen overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
        <Sidebar />
        <div
          className="relative flex h-full min-w-0 flex-1 flex-col overflow-y-auto"
          data-home-main
          data-drag-select-surface
        >
          <Header onOpenShowcase={() => setShowShowcase(true)} />
          <main className="flex-1 px-4 pb-48 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl space-y-4 pt-5">
              <SearchBar />
              <TaskGrid />
            </div>
          </main>
        </div>
      </div>
      <InputBar />
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <SupportPromptModal />
      {showShowcase && <ShowcaseModal onClose={() => setShowShowcase(false)} />}
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </AuthGuard>
  )
}
