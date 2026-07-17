import { useCallback, useEffect, useRef, useState } from 'react'

// Detachable preview window ("clean feed"). Opens a named same-origin child
// window via window.open — Electron's window-open handler (main.js) allows
// this frameName and gives it a plain dark chrome. Because the child is
// same-origin and same-process, the parent scripts its DOM directly and
// mirrors the active preview element (compositor canvas or preview <video>)
// onto a canvas in the child with one drawImage per child animation frame.
const POPOUT_NAME = 'velorn-preview-popout'
const BOUNDS_KEY = 'velorn-preview-popout-bounds'

export default function usePreviewPopout({ getSourceElement, onTogglePlay }) {
  const [isPoppedOut, setIsPoppedOut] = useState(false)
  const popoutRef = useRef(null)
  const getSourceRef = useRef(getSourceElement)
  const onTogglePlayRef = useRef(onTogglePlay)
  getSourceRef.current = getSourceElement
  onTogglePlayRef.current = onTogglePlay

  const close = useCallback(() => {
    const child = popoutRef.current
    popoutRef.current = null
    setIsPoppedOut(false)
    if (child && !child.closed) {
      try { child.close() } catch { /* already gone */ }
    }
  }, [])

  const open = useCallback(() => {
    const existing = popoutRef.current
    if (existing && !existing.closed) {
      try { existing.focus() } catch { /* best effort */ }
      return
    }

    let features = 'width=540,height=960'
    try {
      const saved = JSON.parse(localStorage.getItem(BOUNDS_KEY) || 'null')
      if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
        features = `left=${Math.round(saved.x)},top=${Math.round(saved.y)},width=${Math.round(saved.w)},height=${Math.round(saved.h)}`
      }
    } catch { /* corrupt bounds — use defaults */ }

    const child = window.open('about:blank', POPOUT_NAME, features)
    if (!child) return
    popoutRef.current = child

    // Re-adopting a still-open window (e.g. after HMR) must not stack blit
    // loops: each adoption bumps the token and stale loops see the mismatch.
    const blitToken = (child.__velornBlitToken || 0) + 1
    child.__velornBlitToken = blitToken

    const doc = child.document
    doc.title = 'Velorn Preview'
    doc.documentElement.style.height = '100%'
    doc.body.style.cssText = 'margin:0;height:100%;background:#000;overflow:hidden;'
    doc.body.textContent = ''
    const canvas = doc.createElement('canvas')
    canvas.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;'
    doc.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')

    const blit = () => {
      if (child.closed || child.__velornBlitToken !== blitToken) return
      const source = getSourceRef.current?.()
      if (source) {
        const isVideo = typeof source.videoWidth === 'number' && source.videoWidth > 0
        const srcWidth = isVideo ? source.videoWidth : source.width
        const srcHeight = isVideo ? source.videoHeight : source.height
        if (srcWidth > 0 && srcHeight > 0) {
          if (canvas.width !== srcWidth || canvas.height !== srcHeight) {
            canvas.width = srcWidth
            canvas.height = srcHeight
          }
          try { ctx.drawImage(source, 0, 0, srcWidth, srcHeight) } catch { /* source mid-teardown */ }
        }
      }
      child.requestAnimationFrame(blit)
    }
    child.requestAnimationFrame(blit)

    const toggleChildFullscreen = () => {
      try {
        if (doc.fullscreenElement) doc.exitFullscreen()
        else doc.documentElement.requestFullscreen()
      } catch { /* fullscreen denied — ignore */ }
    }
    canvas.addEventListener('dblclick', toggleChildFullscreen)
    doc.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault()
        onTogglePlayRef.current?.()
      } else if (event.key === 'f' || event.key === 'F') {
        toggleChildFullscreen()
      }
    })

    const saveBounds = () => {
      try {
        localStorage.setItem(BOUNDS_KEY, JSON.stringify({
          x: child.screenX, y: child.screenY, w: child.outerWidth, h: child.outerHeight,
        }))
      } catch { /* storage full — ignore */ }
    }
    child.addEventListener('beforeunload', () => {
      saveBounds()
      if (popoutRef.current === child) {
        popoutRef.current = null
        setIsPoppedOut(false)
      }
    })

    setIsPoppedOut(true)
  }, [])

  const toggle = useCallback(() => {
    if (popoutRef.current && !popoutRef.current.closed) close()
    else open()
  }, [close, open])

  // A reloading parent leaves the child with dead closures — close it and let
  // the user reopen instead of stranding a frozen frame on their monitor.
  useEffect(() => {
    const closeChild = () => {
      const child = popoutRef.current
      if (child && !child.closed) {
        try { child.close() } catch { /* already gone */ }
      }
    }
    window.addEventListener('beforeunload', closeChild)
    return () => window.removeEventListener('beforeunload', closeChild)
  }, [])

  return { isPoppedOut, open, close, toggle }
}
