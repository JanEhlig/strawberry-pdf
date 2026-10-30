import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { t } from '@renderer/i18n'
import type { TabEntry } from '@renderer/state/appStore'
import { IconButton } from '@renderer/ui'

export function SearchBar({ tab }: { tab: TabEntry }): React.JSX.Element | null {
  const search = useStore(tab.store, (s) => s.search)
  const inputRef = useRef<HTMLInputElement>(null)
  const lastRun = useRef('')

  useLayoutEffect(() => {
    if (search.open) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [search.open])

  useEffect(() => {
    if (!search.open) return
    const query = search.query
    if (query.trim() === lastRun.current.trim()) return
    const timer = window.setTimeout(() => {
      lastRun.current = query
      void tab.store.getState().runSearch(query)
    }, 280)
    return () => window.clearTimeout(timer)
  }, [search.query, search.open, tab])

  if (!search.open) return null
  const s = tab.store.getState()
  const close = (): void => {
    lastRun.current = ''
    s.setSearch({ open: false, query: '', hits: [], index: -1, running: false, done: false })
  }
  let status = ''
  if (search.hits.length > 0) status = t('search.count', { i: search.index + 1, n: search.hits.length }) + (search.running ? ' …' : '')
  else if (search.running) status = t('search.searching')
  else if (search.done && search.query.trim()) status = t('search.none')

  return (
    <div className="search-bar" role="search" onPointerDown={(e) => e.stopPropagation()}>
      <Search size={16} className="search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        className="search-input"
        value={search.query}
        placeholder={t('search.placeholder')}
        aria-label={t('search.placeholder')}
        onChange={(e) => s.setSearch({ query: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') {
            e.preventDefault()
            if (search.query.trim() !== lastRun.current.trim()) {
              lastRun.current = search.query
              void s.runSearch(search.query)
            } else {
              s.stepSearch(e.shiftKey ? -1 : 1)
            }
          }
        }}
      />
      <span className={`search-status tabular${search.done && search.hits.length === 0 && search.query.trim() ? ' empty' : ''}`} aria-live="polite">
        {status}
      </span>
      <IconButton small label={t('search.prev')} disabled={search.hits.length === 0} onClick={() => s.stepSearch(-1)}>
        <ChevronUp size={17} />
      </IconButton>
      <IconButton small label={t('search.next')} disabled={search.hits.length === 0} onClick={() => s.stepSearch(1)}>
        <ChevronDown size={17} />
      </IconButton>
      <IconButton small label={t('search.close')} onClick={close}>
        <X size={16} />
      </IconButton>
    </div>
  )
}
