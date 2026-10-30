import { RotateCw, Trash } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { t } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import { rotatePages } from '@renderer/state/pages'
import { Thumb } from '@renderer/viewer/PageThumb'
import { useApp, type TabEntry } from '@renderer/state/appStore'
import { IconButton } from '@renderer/ui'
import { insertPdfs, moveTo, openPage, removePages } from './actions'
import './organize.css'

const BOX = 184
const GAP_X = 24

interface DropMark {
  index: number
  left: number
  top: number
  height: number
}

function fit(page: { width: number; height: number }): { width: number; height: number } {
  const scale = Math.min(BOX / page.width, BOX / page.height)
  return { width: Math.max(1, Math.round(page.width * scale)), height: Math.max(1, Math.round(page.height * scale)) }
}

const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

export function PageGrid({ tab }: { tab: TabEntry }): React.JSX.Element {
  const pages = useStore(tab.store, (s) => s.info.pages)
  const versions = useStore(tab.store, (s) => s.pageVersion)
  const selected = useStore(tab.store, (s) => s.selectedPages)
  const nav = useStore(tab.store, (s) => s.nav)
  const current = useStore(tab.store, (s) => s.currentPage)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<number | null>(null)
  const dragging = useRef<number[] | null>(null)
  const [drop, setDrop] = useState<DropMark | null>(null)
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set())

  const card = (index: number): HTMLElement | null => gridRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`) ?? null

  const reveal = (index: number, center: boolean): void => {
    const root = scrollRef.current
    const el = card(index)
    if (!root || !el) return
    const top = el.offsetTop
    const bottom = top + el.offsetHeight
    if (center) {
      root.scrollTop = top - (root.clientHeight - el.offsetHeight) / 2
      return
    }
    if (top < root.scrollTop + 12) root.scrollTo({ top: top - 12, behavior: 'smooth' })
    else if (bottom > root.scrollTop + root.clientHeight - 12) root.scrollTo({ top: bottom - root.clientHeight + 12, behavior: 'smooth' })
  }

  useLayoutEffect(() => {
    const root = scrollRef.current
    const grid = gridRef.current
    if (!root || !grid) return
    const observer = new IntersectionObserver(
      (entries) =>
        setVisible((prev) => {
          const next = new Set(prev)
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.index)
            if (entry.isIntersecting) next.add(index)
            else next.delete(index)
          }
          return next
        }),
      { root, rootMargin: '600px 0px' }
    )
    for (const el of grid.querySelectorAll('[data-index]')) observer.observe(el)
    return () => observer.disconnect()
  }, [pages.length])

  useLayoutEffect(() => {
    reveal(tab.store.getState().currentPage, true)
    gridRef.current?.focus({ preventScroll: true })
  }, [tab])

  const lastNav = useRef(nav?.nonce ?? 0)
  useEffect(() => {
    if (!nav || nav.nonce === lastNav.current) return
    lastNav.current = nav.nonce
    reveal(nav.page, false)
  }, [nav])

  const active = selected.length > 0 ? selected[selected.length - 1] : current
  const group = (index: number): number[] => (selected.includes(index) ? selected : [index])

  const onCardClick = (index: number, e: React.MouseEvent): void => {
    const s = tab.store.getState()
    if (e.ctrlKey || e.metaKey) {
      anchor.current = index
      s.setSelectedPages(selected.includes(index) ? selected.filter((p) => p !== index) : [...selected, index])
      return
    }
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = anchor.current < index ? [anchor.current, index] : [index, anchor.current]
      s.setSelectedPages(Array.from({ length: b - a + 1 }, (_, i) => a + i))
      return
    }
    anchor.current = index
    s.setSelectedPages([index])
    s.goTo(index)
  }

  const dropAt = (x: number, y: number): DropMark | null => {
    const root = scrollRef.current
    const grid = gridRef.current
    if (!root || !grid) return null
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-index]'))
    if (cards.length === 0) return null
    const base = root.getBoundingClientRect()
    const mark = (r: DOMRect, after: boolean, index: number): DropMark => ({
      index,
      left: (after ? r.right + GAP_X / 2 : r.left - GAP_X / 2) - base.left + root.scrollLeft,
      top: r.top - base.top + root.scrollTop,
      height: r.height
    })
    let index = cards.length
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect()
      if (y < r.top || (y <= r.bottom && x < r.left + r.width / 2)) {
        index = i
        break
      }
    }
    if (index > 0) {
      const prev = cards[index - 1].getBoundingClientRect()
      if (index === cards.length || (y >= prev.top && y <= prev.bottom)) return mark(prev, true, index)
    }
    return mark(cards[index].getBoundingClientRect(), false, index)
  }

  const accepts = (e: React.DragEvent): boolean => dragging.current !== null || hasFiles(e)

  return (
    <div className="org" role="region" aria-label={t('organize.title')}>
      <div
        ref={scrollRef}
        className="org-scroll"
        onClick={() => tab.store.getState().setSelectedPages([])}
        onDragEnter={(e) => {
          if (!accepts(e)) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onDragOver={(e) => {
          if (!accepts(e)) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = dragging.current ? 'move' : 'copy'
          if (useApp.getState().dragOver) useApp.setState({ dragOver: null })
          setDrop(dropAt(e.clientX, e.clientY))
        }}
        onDragLeave={(e) => {
          if (!accepts(e)) return
          e.stopPropagation()
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null)
        }}
        onDrop={async (e) => {
          if (!accepts(e)) return
          e.preventDefault()
          e.stopPropagation()
          const target = dropAt(e.clientX, e.clientY)?.index ?? pages.length
          setDrop(null)
          useApp.setState({ dragOver: null })
          const moving = dragging.current
          dragging.current = null
          if (moving) {
            await moveTo(tab, moving, target)
            return
          }
          const files = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name))
          if (files.length > 0) await insertPdfs(tab, target, await Promise.all(files.map((f) => platform.readDropped(f))))
        }}
      >
        <div className="org-inner">
          <header className="org-head">
            <h2 className="org-title">{t('organize.title')}</h2>
            <span className="org-count tabular" aria-live="polite">
              {selected.length > 0 ? t('organize.selected', { n: selected.length, total: pages.length }) : t('organize.count', { n: pages.length })}
            </span>
          </header>
          <div
            ref={gridRef}
            className="org-grid"
            role="listbox"
            tabIndex={0}
            aria-multiselectable="true"
            aria-label={t('organize.title')}
            aria-activedescendant={`org-card-${active}`}
          >
            {pages.map((page, index) => {
              const label = page.label ?? String(index + 1)
              const isSelected = selected.includes(index)
              const box = fit(page)
              return (
                <div
                  key={index}
                  id={`org-card-${index}`}
                  data-index={index}
                  data-active={index === active || undefined}
                  className={`org-card${isSelected ? ' selected' : ''}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-label={t('sidebar.page', { n: label })}
                  draggable
                  onDragStart={(e) => {
                    dragging.current = group(index)
                    if (!isSelected) tab.store.getState().setSelectedPages([index])
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', label)
                  }}
                  onDragEnd={() => {
                    dragging.current = null
                    setDrop(null)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCardClick(index, e)
                  }}
                  onDoubleClick={() => openPage(tab, index)}
                >
                  <div className="org-slot">
                    <div className="org-paper" style={{ width: box.width, height: box.height }}>
                      {visible.has(index) && <Thumb tab={tab} index={index} width={box.width} height={box.height} version={versions[index] ?? 0} />}
                      <div className="org-quick" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                        <IconButton small label={t('organize.rotateRight')} onClick={() => void rotatePages(tab, group(index), 90)}>
                          <RotateCw size={15} />
                        </IconButton>
                        <IconButton small danger label={t('organize.delete')} onClick={(e) => {
                            if (e.detail <= 1) void removePages(tab, group(index))
                          }}>
                          <Trash size={15} />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                  <span className="org-label tabular">{label}</span>
                </div>
              )
            })}
          </div>
        </div>
        {drop && <div className="org-drop" style={{ left: drop.left, top: drop.top, height: drop.height }} />}
      </div>
    </div>
  )
}
