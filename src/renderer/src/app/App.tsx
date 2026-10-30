import { FileDown } from 'lucide-react'
import { useEffect } from 'react'
import { useStore } from 'zustand'
import { NavCapsule } from '@renderer/chrome/NavCapsule'
import { SearchBar } from '@renderer/chrome/SearchBar'
import { TitleBar } from '@renderer/chrome/TitleBar'
import { ToolOptions } from '@renderer/chrome/ToolOptions'
import { Toolbar } from '@renderer/chrome/Toolbar'
import { t } from '@renderer/i18n'
import { PageGrid } from '@renderer/organize/PageGrid'
import { platform } from '@renderer/platform'
import { Sidebar } from '@renderer/sidebar/Sidebar'
import { StartScreen } from '@renderer/start/StartScreen'
import { useApp, type TabEntry } from '@renderer/state/appStore'
import { openFiles, requestCloseWindow } from '@renderer/state/files'
import { DialogHost, Toasts, TooltipLayer } from '@renderer/ui'
import { DocContext } from '@renderer/viewer/context'
import { Viewer } from '@renderer/viewer/Viewer'
import { useShortcuts } from './shortcuts'
import './app.css'
import '@renderer/chrome/chrome.css'

function Workspace({ tab }: { tab: TabEntry }): React.JSX.Element {
  const sidebar = useApp((s) => s.sidebar)
  const organize = useStore(tab.store, (s) => s.organize)
  return (
    <DocContext.Provider value={tab.store}>
      {sidebar && (
        <div style={{ display: 'contents' }} inert={organize}>
          <Sidebar tab={tab} />
        </div>
      )}
      <main className="stage" inert={organize}>
        <Viewer key={tab.id} />
        <ToolOptions tab={tab} />
        <SearchBar tab={tab} />
        <NavCapsule tab={tab} />
      </main>
      {organize && <PageGrid key={tab.id} tab={tab} />}
    </DocContext.Provider>
  )
}

function useWindowState(): void {
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  useEffect(() => {
    const update = (): void => {
      const states = tabs.map((tab) => tab.store.getState())
      platform.setUnsaved(states.some((s) => s.history.dirty))
      const active = tabs.find((tab) => tab.id === activeId)?.store.getState()
      platform.setWindowTitle(active ? `${active.history.dirty ? '• ' : ''}${active.fileName} – ${t('app.name')}` : t('app.name'))
    }
    update()
    const unsubscribers = tabs.map((tab) => tab.store.subscribe((s, prev) => {
      if (s.history.dirty !== prev.history.dirty || s.fileName !== prev.fileName) update()
    }))
    return () => unsubscribers.forEach((u) => u())
  }, [tabs, activeId])

  useEffect(() => platform.onCloseRequested(() => void requestCloseWindow()), [])
}

function useToolReset(tab: TabEntry | null): void {
  const tool = useApp((s) => s.tool)
  useEffect(() => {
    if (!tab || tool === 'select') return
    const s = tab.store.getState()
    s.select(null)
    s.setTextSel(null)
    if (s.editing) s.setEditing(null)
  }, [tool, tab])
}

function useFileDrop(): void {
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      useApp.setState({ dragOver: 'open' })
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) useApp.setState({ dragOver: null })
    }
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      if (useApp.getState().dragOver !== 'open') useApp.setState({ dragOver: 'open' })
    }
    const drop = async (e: DragEvent): Promise<void> => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      useApp.setState({ dragOver: null })
      const files = Array.from(e.dataTransfer?.files ?? [])
      await openFiles(await Promise.all(files.map((f) => platform.readDropped(f))))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [])
}


export function App(): React.JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  const language = useApp((s) => s.language)
  const dragOver = useApp((s) => s.dragOver)
  const tab = tabs.find((x) => x.id === activeId) ?? null
  useShortcuts()
  useWindowState()
  useToolReset(tab)
  useFileDrop()

  return (
    <div className="app" key={language}>
      <TitleBar />
      <Toolbar tab={tab} />
      <div className="workspace">{tab ? <Workspace tab={tab} /> : <StartScreen />}</div>
      {dragOver && (
        <div className="drop-overlay" aria-live="polite">
          <div className="drop-card">
            <FileDown size={30} />
            <span>{dragOver === 'insert' ? t('drop.insert') : t('drop.open')}</span>
          </div>
        </div>
      )}
      <DialogHost />
      <Toasts />
      <TooltipLayer />
    </div>
  )
}
