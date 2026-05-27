'use client'

import { useLayoutEffect } from 'react'

export default function CssReadyGate() {
  useLayoutEffect(() => {
    const root = document.documentElement
    let frame = 0

    const syncCssReady = () => {
      const cssLoaded = getComputedStyle(root).getPropertyValue('--app-css-loaded').trim() === '1'
      root.toggleAttribute('data-app-css-ready', cssLoaded)
      if (!cssLoaded) frame = window.requestAnimationFrame(syncCssReady)
    }

    syncCssReady()
    const interval = window.setInterval(syncCssReady, 250)
    const failOpenTimer = window.setTimeout(() => {
      root.setAttribute('data-app-css-ready', '')
    }, 1500)

    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.clearInterval(interval)
      window.clearTimeout(failOpenTimer)
      root.removeAttribute('data-app-css-ready')
    }
  }, [])

  return null
}
