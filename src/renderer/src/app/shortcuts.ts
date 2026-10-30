import { useEffect } from 'react'
import { openShortcuts } from '@renderer/dialogs/ShortcutsDialog'
import { openPage, removePages, selectPage } from '@renderer/organize/actions'
import { activeTab, setTool, useApp, type TabEntry } from '@renderer/state/appStore'
import { activateTab, closeTab, promptOpen, saveTab } from '@renderer/state/files'
import { printTab } from '@renderer/state/print'
import { TOOL_SHORTCUTS } from '@renderer/tools/tools'
import { stepZoom } from '@renderer/viewer/layout'
import { copySelection } from '@renderer/viewer/overlay/TextSelectionBar'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

function scrollViewer(dy: number | 'top' | 'bottom'): void {
  const el = document.querySelector<HTMLDivElement>('.viewer')
  if (!el) return
  if (dy === 'top') el.scrollTo({ top: 0 })
  else if (dy === 'bottom') el.scrollTo({ top: el.scrollHeight })
  else el.scrollBy({ top: dy })
}

function gridColumns(): number {
  const grid = document.querySelector<HTMLElement>('.org-inner')
  return grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length) : 1
}

function organizeKey(e: KeyboardEvent, tab: TabEntry): boolean {
  const s = tab.store.getState()
  const count = s.info.pages.length
  const selected = s.selectedPages
  const onButton = !!(e.target as HTMLElement | null)?.closest?.('button, [role="menu"]')
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() !== 'a') return false
    s.setSelectedPages(Array.from({ length: count }, (_, i) => i))
    return true
  }
  if (e.key === 'Escape') {
    if (selected.length > 0) s.setSelectedPages([])
    else s.setOrganize(false)
    return true
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    void removePages(tab)
    return true
  }
  if (e.key === 'Enter' && !onButton && selected.length > 0) {
    openPage(tab, selected[0])
    return true
  }
  const step =
    e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? gridColumns() : e.key === 'ArrowUp' ? -gridColumns() : 0
  if (step !== 0) {
    const from = selected.length === 0 ? s.currentPage - step : step > 0 ? selected[selected.length - 1] : selected[0]
    selectPage(tab, Math.max(0, Math.min(count - 1, from + step)))
    return true
  }
  if (e.key === 'Home' || e.key === 'End') {
    selectPage(tab, e.key === 'Home' ? 0 : count - 1)
    return true
  }
  if (e.key === 'PageDown' || e.key === 'PageUp') {
    const el = document.querySelector<HTMLElement>('.org-scroll')
    el?.scrollBy({ top: (e.key === 'PageDown' ? 1 : -1) * el.clientHeight * 0.85 })
    return true
  }
  const tool = e.altKey || e.shiftKey ? undefined : TOOL_SHORTCUTS[e.key.toLowerCase()]
  if (!tool) return false
  s.setOrganize(false)
  setTool(tool)
  return true
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useApp.getState().dialogs.length > 0) return
      const tab = activeTab()
      const store = tab?.store.getState()
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const typing = isTyping(e.target)

      const handled = (): void => {
        e.preventDefault()
        e.stopPropagation()
      }

      if (tab && store?.organize && !typing && organizeKey(e, tab)) return handled()

      if (ctrl) {
        if (key === 'o') return handled(), void promptOpen()
        if (key === 'tab') {
          const { tabs, activeId } = useApp.getState()
          if (tabs.length < 2) return
          const i = tabs.findIndex((x) => x.id === activeId)
          const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]
          return handled(), activateTab(next.id)
        }
        if (!tab || !store) return
        if (key === 's') return handled(), void saveTab(tab, e.shiftKey ? 'saveAs' : 'save')
        if (key === 'p') return handled(), void printTab(tab)
        if (key === 'w') return handled(), void closeTab(tab.id)
        if (key === 'f') return handled(), store.setOrganize(false), store.setSearch({ open: true })
        if (typing) return
        if (key === 'z' && !e.shiftKey) return handled(), void store.undo()
        if (key === 'y' || (key === 'z' && e.shiftKey)) return handled(), void store.redo()
        if (key === '+' || key === '=') return handled(), store.setZoom(stepZoom(store.zoom, 1))
        if (key === '-') return handled(), store.setZoom(stepZoom(store.zoom, -1))
        if (key === '0') return handled(), store.setZoom(1)
        if (key === 'c' && store.textSel?.text) return handled(), void copySelection(store.textSel.text)
        if (key === 'a' && store.textSel) return
        return
      }

      if (e.key === 'F1') return handled(), openShortcuts()
      if (e.key === 'F4' && tab) {
        const sidebar = useApp.getState().sidebar
        return handled(), useApp.setState({ sidebar: sidebar ? null : 'pages' })
      }
      if (typing || !tab || !store) return

      if (e.key === 'Escape') {
        if (store.editing) return handled(), store.setEditing(null)
        if (store.selection || store.textSel) {
          store.select(null)
          store.setTextSel(null)
          return handled()
        }
        if (useApp.getState().tool !== 'select') return handled(), setTool('select')
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && store.selection) {
        const { page, id } = store.selection
        return handled(), void store.deleteAnnotation(page, id)
      }
      if (e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) return handled(), scrollViewer(window.innerHeight * 0.85)
      if (e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) return handled(), scrollViewer(-window.innerHeight * 0.85)
      if (e.key === 'Home') return handled(), scrollViewer('top')
      if (e.key === 'End') return handled(), scrollViewer('bottom')
      if (e.key === 'ArrowDown') return handled(), scrollViewer(60)
      if (e.key === 'ArrowUp') return handled(), scrollViewer(-60)
      if (e.altKey || e.shiftKey) return
      const tool = TOOL_SHORTCUTS[key]
      if (tool) return handled(), setTool(tool)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
