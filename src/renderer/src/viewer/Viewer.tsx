import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t } from '@renderer/i18n'
import { useApp } from '@renderer/state/appStore'
import { ViewerContext, useDoc, useDocStore, type ViewerApi } from './context'
import { MAX_ZOOM, MIN_ZOOM, baseRenderScale, computeLayout, dominantPage, fitZoom, visibleRange, type Layout } from './layout'
import { PageView } from './PageView'
import './viewer.css'

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    let media: MediaQueryList | null = null
    const update = (): void => {
      setDpr(window.devicePixelRatio || 1)
      media?.removeEventListener('change', update)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      media.addEventListener('change', update)
    }
    update()
    return () => media?.removeEventListener('change', update)
  }, [])
  return dpr
}

interface Anchor {
  x: number
  y: number
}

export function Viewer({ children }: { children?: React.ReactNode }): React.JSX.Element {
  const store = useDocStore()
  const pages = useDoc((s) => s.info.pages)
  const zoom = useDoc((s) => s.zoom)
  const fit = useDoc((s) => s.fit)
  const nav = useDoc((s) => s.nav)
  const pageVersion = useDoc((s) => s.pageVersion)
  const darkPages = useApp((s) => s.darkPages)
  const tool = useApp((s) => s.tool)
  const dpr = useDevicePixelRatio()

  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const anchorRef = useRef<Anchor | null>(null)
  const prevLayoutRef = useRef<Layout | null>(null)

  const layout = useMemo(() => computeLayout(pages, zoom, viewport.width), [pages, zoom, viewport.width])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setViewport({ width: el.clientWidth, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (!fit || viewport.width === 0 || pages.length === 0) return
    let maxWidth = 0
    let maxHeight = 0
    for (const p of pages) {
      maxWidth = Math.max(maxWidth, p.width)
      maxHeight = Math.max(maxHeight, p.height)
    }
    const z = fitZoom({ width: maxWidth, height: maxHeight }, maxWidth, fit, viewport.width, viewport.height)
    if (Math.abs(z - zoom) > 0.001) store.getState().setZoom(z, fit)
  }, [fit, viewport.width, viewport.height, pages, zoom, store])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const prev = prevLayoutRef.current
    prevLayoutRef.current = layout
    if (!el || !prev || prev.scale === layout.scale || prev.boxes.length !== layout.boxes.length) return
    const anchor = anchorRef.current ?? { x: el.clientWidth / 2, y: el.scrollTop < 2 ? 0 : el.clientHeight / 2 }
    anchorRef.current = null
    const contentY = el.scrollTop + anchor.y
    const contentX = el.scrollLeft + anchor.x
    const index = Math.min(prev.boxes.length - 1, Math.max(0, findPageAt(prev, contentY)))
    const old = prev.boxes[index]
    const ptX = (contentX - old.left) / prev.scale
    const ptY = (contentY - old.top) / prev.scale
    const box = layout.boxes[index]
    el.scrollLeft = box.left + ptX * layout.scale - anchor.x
    el.scrollTop = box.top + ptY * layout.scale - anchor.y
    setScroll({ top: el.scrollTop, left: el.scrollLeft })
  }, [layout])

  const tabId = useDoc((s) => s.tabId)
  const restored = useRef(false)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || restored.current || viewport.width === 0) return
    restored.current = true
    const saved = scrollMemory.get(tabId)
    if (saved) {
      el.scrollTop = saved.top
      el.scrollLeft = saved.left
      setScroll(saved)
    }
  }, [tabId, viewport.width])
  useEffect(() => {
    const el = scrollRef.current
    return () => {
      if (el) scrollMemory.set(tabId, { top: el.scrollTop, left: el.scrollLeft })
    }
  }, [tabId])

  const lastNav = useRef(nav?.nonce ?? 0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !nav || nav.nonce === lastNav.current) return
    lastNav.current = nav.nonce
    const box = layout.boxes[nav.page]
    if (!box) return
    const targetTop = nav.y !== undefined ? box.top + nav.y * layout.scale - el.clientHeight * 0.3 : box.top - 12
    if (nav.ifNeeded && nav.y !== undefined) {
      const y = box.top + nav.y * layout.scale
      if (y >= el.scrollTop + 40 && y <= el.scrollTop + el.clientHeight - 60) return
    }
    el.scrollTop = Math.max(0, targetTop)
    if (nav.x !== undefined) {
      const x = box.left + nav.x * layout.scale
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, x - el.clientWidth / 2)
    }
    setScroll({ top: el.scrollTop, left: el.scrollLeft })
  }, [nav])

  const frame = useRef(0)
  const onScroll = useCallback(() => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = scrollRef.current
      if (!el) return
      setScroll({ top: el.scrollTop, left: el.scrollLeft })
    })
  }, [])
  useEffect(() => {
    if (viewport.height === 0) return
    store.getState().setCurrentPage(dominantPage(layout, scroll.top, viewport.height))
  }, [layout, scroll.top, viewport.height, store])

  const zoomAt = useCallback(
    (next: number, clientX: number, clientY: number) => {
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      anchorRef.current = { x: clientX - rect.left, y: clientY - rect.top }
      store.getState().setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next)), null)
    },
    [store]
  )
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022))
      zoomAt(store.getState().zoom * factor, e.clientX, e.clientY)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [store, zoomAt])

  const api = useMemo<ViewerApi>(() => ({ scrollElement: () => scrollRef.current, zoomAt }), [zoomAt])

  const [first, last] = visibleRange(layout, scroll.top, viewport.height || 800, 1)
  const items: React.JSX.Element[] = []
  for (let i = first; i <= last; i++) {
    const box = layout.boxes[i]
    const page = pages[i]
    const wanted = layout.scale * dpr
    let detailRect: string | null = null
    if (baseRenderScale(page, wanted) < wanted * 0.98) {
      const x0 = Math.max(0, scroll.left - box.left)
      const y0 = Math.max(0, scroll.top - box.top)
      const x1 = Math.min(box.width, scroll.left + viewport.width - box.left)
      const y1 = Math.min(box.height, scroll.top + viewport.height - box.top)
      if (x1 > x0 && y1 > y0) detailRect = [x0, y0, x1, y1].map((v) => Math.round(v)).join(',')
    }
    items.push(
      <PageView key={i} index={i} box={box} scale={layout.scale} dpr={dpr} version={pageVersion[i] ?? 0} detailRect={detailRect} />
    )
  }

  return (
    <ViewerContext.Provider value={api}>
      <div
        ref={scrollRef}
        className={`viewer${darkPages ? ' dark-pages' : ''}`}
        data-tool={tool}
        tabIndex={-1}
        onScroll={onScroll}
        aria-label={t('viewer.document')}
      >
        <div className="viewer-content" style={{ width: layout.width, height: layout.height }}>
          {items}
        </div>
      </div>
      {children}
    </ViewerContext.Provider>
  )
}

const scrollMemory = new Map<string, { top: number; left: number }>()

function findPageAt(layout: Layout, y: number): number {
  for (let i = 0; i < layout.boxes.length; i++) {
    const b = layout.boxes[i]
    if (y < b.top + b.height + 9) return i
  }
  return layout.boxes.length - 1
}
