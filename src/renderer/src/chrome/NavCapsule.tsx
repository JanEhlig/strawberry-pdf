import { Maximize2, Minus, MoveHorizontal, Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { t } from '@renderer/i18n'
import type { TabEntry } from '@renderer/state/appStore'
import { IconButton, MenuItem, MenuSeparator, Popover } from '@renderer/ui'
import { stepZoom } from '@renderer/viewer/layout'

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

function PageInput({ tab }: { tab: TabEntry }): React.JSX.Element {
  const current = useStore(tab.store, (s) => s.currentPage)
  const count = useStore(tab.store, (s) => s.info.pages.length)
  const label = useStore(tab.store, (s) => s.info.pages[s.currentPage]?.label ?? null)
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? label ?? String(current + 1)
  const commit = (): void => {
    if (draft === null) return
    const value = draft.trim()
    const pages = tab.store.getState().info.pages
    const byLabel = pages.findIndex((p) => p.label === value)
    const n = byLabel >= 0 ? byLabel : parseInt(value, 10) - 1
    if (Number.isFinite(n)) tab.store.getState().goTo(n)
    setDraft(null)
  }
  return (
    <label className="page-input">
      <span className="sr-only">{t('nav.pageInput')}</span>
      <input
        className="tabular"
        value={shown}
        size={Math.max(2, shown.length)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            commit()
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'Escape') {
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      <span className="page-count tabular">{t('nav.of', { n: count })}</span>
    </label>
  )
}

export function NavCapsule({ tab }: { tab: TabEntry }): React.JSX.Element {
  const zoom = useStore(tab.store, (s) => s.zoom)
  const fit = useStore(tab.store, (s) => s.fit)
  const [menu, setMenu] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const [idle, setIdle] = useState(false)

  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 2500)
    const wake = (): void => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 2500)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('wheel', wake, { passive: true })
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('wheel', wake)
    }
  }, [])

  const setZoom = (z: number, f: 'width' | 'page' | null = null): void => tab.store.getState().setZoom(z, f)

  return (
    <div className={`nav-capsule${idle ? ' idle' : ''}`} role="toolbar" aria-label={t('nav.page')}>
      <IconButton small label={t('nav.zoomOut')} onClick={() => setZoom(stepZoom(zoom, -1))}>
        <Minus size={16} />
      </IconButton>
      <button ref={anchor} type="button" className="zoom-value tabular" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        {Math.round(zoom * 100)} %
      </button>
      <IconButton small label={t('nav.zoomIn')} onClick={() => setZoom(stepZoom(zoom, 1))}>
        <Plus size={16} />
      </IconButton>
      <span className="capsule-sep" />
      <IconButton small label={t('nav.fitWidth')} pressed={fit === 'width'} onClick={() => setZoom(zoom, 'width')}>
        <MoveHorizontal size={16} />
      </IconButton>
      <IconButton small label={t('nav.fitPage')} pressed={fit === 'page'} onClick={() => setZoom(zoom, 'page')}>
        <Maximize2 size={15} />
      </IconButton>
      <span className="capsule-sep" />
      <PageInput tab={tab} />
      {menu && (
        <Popover anchor={anchor} onClose={() => setMenu(false)} placement="top">
          <div role="menu">
            <MenuItem onClick={() => (setZoom(zoom, 'width'), setMenu(false))}>{t('nav.fitWidth')}</MenuItem>
            <MenuItem onClick={() => (setZoom(zoom, 'page'), setMenu(false))}>{t('nav.fitPage')}</MenuItem>
            <MenuSeparator />
            {PRESETS.map((z) => (
              <MenuItem key={z} hint={Math.abs(z - zoom) < 0.005 ? '✓' : undefined} onClick={() => (setZoom(z), setMenu(false))}>
                {Math.round(z * 100)} %
              </MenuItem>
            ))}
          </div>
        </Popover>
      )}
    </div>
  )
}
