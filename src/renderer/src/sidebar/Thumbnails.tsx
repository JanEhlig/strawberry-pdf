import { FilePlus, FileUp, FolderOutput, RotateCcw, RotateCw, Trash } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { t } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import { useApp, type TabEntry } from '@renderer/state/appStore'
import { IconButton, MenuItem, MenuSeparator } from '@renderer/ui'
import { deletePages, extractPages, insertBlankPage, insertFile, movePages, rotatePages } from '@renderer/state/pages'
import { Thumb } from '@renderer/viewer/PageThumb'

const THUMB_WIDTH = 148
const ROW_GAP = 34

interface Row {
  top: number
  width: number
  height: number
}

export function Thumbnails({ tab }: { tab: TabEntry }): React.JSX.Element {
  const pages = useStore(tab.store, (s) => s.info.pages)
  const versions = useStore(tab.store, (s) => s.pageVersion)
  const current = useStore(tab.store, (s) => s.currentPage)
  const selected = useStore(tab.store, (s) => s.selectedPages)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scroll, setScroll] = useState({ top: 0, height: 600 })
  const [drop, setDrop] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; pages: number[] } | null>(null)
  const dragging = useRef<number[] | null>(null)

  const rows = useMemo<Row[]>(() => {
    let top = 12
    return pages.map((p) => {
      const scale = Math.min(THUMB_WIDTH / p.width, (THUMB_WIDTH * 1.5) / p.height)
      const row = { top, width: Math.round(p.width * scale), height: Math.round(p.height * scale) }
      top += row.height + ROW_GAP
      return row
    })
  }, [pages])
  const total = rows.length ? rows[rows.length - 1].top + rows[rows.length - 1].height + ROW_GAP : 0

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = (): void => setScroll({ top: el.scrollTop, height: el.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    const row = rows[current]
    if (!el || !row) return
    if (row.top < el.scrollTop || row.top + row.height > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: row.top - el.clientHeight / 3, behavior: 'smooth' })
    }
  }, [current, rows])

  const selection = (index: number): number[] => (selected.includes(index) ? selected : [index])

  const onClick = (index: number, e: React.MouseEvent): void => {
    const s = tab.store.getState()
    if (e.ctrlKey || e.metaKey) {
      s.setSelectedPages(selected.includes(index) ? selected.filter((p) => p !== index) : [...selected, index])
      return
    }
    if (e.shiftKey && selected.length > 0) {
      const anchor = selected[0]
      const [a, b] = anchor < index ? [anchor, index] : [index, anchor]
      s.setSelectedPages(Array.from({ length: b - a + 1 }, (_, i) => a + i))
      return
    }
    s.setSelectedPages([index])
    s.goTo(index)
  }

  const dropIndexAt = (clientY: number): number => {
    const el = scrollRef.current!
    const y = clientY - el.getBoundingClientRect().top + el.scrollTop
    for (let i = 0; i < rows.length; i++) if (y < rows[i].top + rows[i].height / 2) return i
    return rows.length
  }

  const first = Math.max(0, rows.findIndex((r) => r.top + r.height > scroll.top - 200))
  let last = first
  while (last + 1 < rows.length && rows[last + 1].top < scroll.top + scroll.height + 200) last++

  return (
    <div
      ref={scrollRef}
      className="thumbs"
      tabIndex={0}
      onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}
      onKeyDown={(e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
          e.preventDefault()
          void deletePages(tab, selected)
        }
      }}
      onDragOver={(e) => {
        const external = e.dataTransfer.types.includes('Files')
        if (!dragging.current && !external) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = external ? 'copy' : 'move'
        if (external && useApp.getState().dragOver !== 'insert') useApp.setState({ dragOver: 'insert' })
        setDrop(dropIndexAt(e.clientY))
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(null)
      }}
      onDrop={async (e) => {
        e.preventDefault()
        e.stopPropagation()
        const target = dropIndexAt(e.clientY)
        setDrop(null)
        useApp.setState({ dragOver: null })
        if (dragging.current) {
          const moving = dragging.current
          dragging.current = null
          await movePages(tab, moving, target)
          return
        }
        const files = Array.from(e.dataTransfer.files).filter((f) => /\.pdf$/i.test(f.name))
        let at = target
        for (const file of files) at += await insertFile(tab, at, await platform.readDropped(file))
      }}
    >
      <div className="thumbs-inner" style={{ height: total }}>
        {rows.slice(first, last + 1).map((row, k) => {
          const index = first + k
          const label = pages[index].label ?? String(index + 1)
          const isSelected = selected.includes(index)
          return (
            <div
              key={index}
              className={`thumb${index === current ? ' current' : ''}${isSelected ? ' selected' : ''}`}
              style={{ top: row.top }}
              draggable
              onDragStart={(e) => {
                dragging.current = selection(index)
                if (!isSelected) tab.store.getState().setSelectedPages([index])
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', label)
              }}
              onDragEnd={() => {
                dragging.current = null
                setDrop(null)
              }}
              onClick={(e) => onClick(index, e)}
              onContextMenu={(e) => {
                e.preventDefault()
                const pagesFor = selection(index)
                if (!isSelected) tab.store.getState().setSelectedPages([index])
                setMenu({ x: e.clientX, y: e.clientY, pages: pagesFor })
              }}
              role="button"
              aria-label={t('sidebar.page', { n: label })}
              aria-current={index === current ? 'page' : undefined}
            >
              <div className="thumb-paper" style={{ width: row.width, height: row.height }}>
                <Thumb tab={tab} index={index} width={row.width} height={row.height} version={versions[index] ?? 0} />
                <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
                  <IconButton small label={t('pages.rotateLeft')} onClick={() => void rotatePages(tab, selection(index), -90)}>
                    <RotateCcw size={14} />
                  </IconButton>
                  <IconButton small label={t('pages.rotateRight')} onClick={() => void rotatePages(tab, selection(index), 90)}>
                    <RotateCw size={14} />
                  </IconButton>
                  <IconButton small danger label={t('pages.delete')} onClick={() => void deletePages(tab, selection(index))}>
                    <Trash size={14} />
                  </IconButton>
                </div>
              </div>
              <span className="thumb-label tabular">{label}</span>
            </div>
          )
        })}
        {drop !== null && <div className="thumb-drop" style={{ top: (rows[drop]?.top ?? total - ROW_GAP + 6) - 10 }} />}
      </div>
      {menu && <PageMenu tab={tab} menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

function PageMenu({ tab, menu, onClose }: { tab: TabEntry; menu: { x: number; y: number; pages: number[] }; onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos({
      left: Math.min(menu.x, window.innerWidth - el.offsetWidth - 8),
      top: Math.min(menu.y, window.innerHeight - el.offsetHeight - 8)
    })
  }, [menu.x, menu.y])
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onClose])
  const last = Math.max(...menu.pages)
  const act = (fn: () => void) => () => {
    onClose()
    fn()
  }
  return (
    <div ref={ref} className="popover" role="menu" style={{ left: pos.left, top: pos.top }}>
      {menu.pages.length > 1 && <div className="menu-caption">{t('pages.selected', { n: menu.pages.length })}</div>}
      <MenuItem icon={<RotateCcw size={16} />} onClick={act(() => void rotatePages(tab, menu.pages, -90))}>
        {t('pages.rotateLeft')}
      </MenuItem>
      <MenuItem icon={<RotateCw size={16} />} onClick={act(() => void rotatePages(tab, menu.pages, 90))}>
        {t('pages.rotateRight')}
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<FilePlus size={16} />} onClick={act(() => void insertBlankPage(tab, last))}>
        {t('pages.insertBlank')}
      </MenuItem>
      <MenuItem icon={<FileUp size={16} />} onClick={act(() => void insertFile(tab, last + 1))}>
        {t('pages.insertFile')}
      </MenuItem>
      <MenuItem icon={<FolderOutput size={16} />} onClick={act(() => void extractPages(tab, menu.pages))}>
        {t('pages.extract')}
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger icon={<Trash size={16} />} onClick={act(() => void deletePages(tab, menu.pages))}>
        {t('pages.delete')}
      </MenuItem>
    </div>
  )
}
