import { EngineCallError, engine } from '@renderer/engine/client'
import { askPassword } from '@renderer/dialogs/PasswordDialog'
import { t } from '@renderer/i18n'
import { platform, SaveError, type OpenedFile } from '@renderer/platform'
import { choose } from '@renderer/ui'
import { insertFile } from './pages'
import { activeTab, toast, useApp, type TabEntry } from './appStore'
import { settlePendingRedactions } from './redactions'
import { createDocStore } from './docStore'

let tabCounter = 0

function describeOpenError(error: unknown): string {
  if (error instanceof EngineCallError) {
    if (error.code === 'not-pdf') return t('error.notPdf')
    if (error.code === 'damaged') return t('error.damaged')
  }
  return error instanceof Error ? error.message : String(error)
}

export function activateTab(id: string): void {
  useApp.setState({ activeId: id })
}

async function openOne(file: OpenedFile): Promise<TabEntry | null> {
  const { tabs } = useApp.getState()
  if (file.path) {
    const existing = tabs.find((tab) => tab.store.getState().filePath?.toLowerCase() === file.path!.toLowerCase())
    if (existing) {
      activateTab(existing.id)
      return existing
    }
  }
  const size = file.data.byteLength
  let result = await engine().callTransfer('open', [file.data.buffer], file.data)
  while (result.status === 'needs-password') {
    const password = await askPassword(file.name, result.retry)
    if (password === null) {
      await engine().call('close', result.docId)
      return null
    }
    result = await engine().call('authenticate', result.docId, password)
  }
  const info = result.info
  const history = await engine().call('history', info.docId)
  const id = `tab${++tabCounter}`
  const store = createDocStore({ tabId: id, docId: info.docId, fileName: file.name, filePath: file.path, fileSize: size, info, history })
  const tab = { id, store }
  useApp.setState((s) => ({ tabs: [...s.tabs, tab], activeId: id }))
  if (file.path) {
    const recent = await platform.addRecent(file.path)
    useApp.setState({ recent })
  }
  if (info.wasRepaired) toast(t('toast.repaired'))
  return tab
}

export async function openFiles(files: OpenedFile[]): Promise<void> {
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name) && !isPdfHeader(file.data)) {
      toast(`${t('error.openFailed', { name: file.name })} ${t('error.notPdf')}`, 'error')
      continue
    }
    try {
      await openOne(file)
    } catch (error) {
      toast(`${t('error.openFailed', { name: file.name })} ${describeOpenError(error)}`, 'error', undefined, 7000)
    }
  }
}

function isPdfHeader(data: Uint8Array): boolean {
  const head = String.fromCharCode(...data.subarray(0, 1024))
  return head.includes('%PDF')
}

export async function openPaths(paths: string[]): Promise<void> {
  const files: OpenedFile[] = []
  for (const path of paths) {
    try {
      files.push(await platform.readPath(path))
    } catch {
      toast(`${t('error.openFailed', { name: platform.baseName(path) })} ${t('error.fileMissing')}`, 'error', {
        label: t('start.remove'),
        run: () => void platform.removeRecent(path).then((recent) => useApp.setState({ recent }))
      })
    }
  }
  await openFiles(files)
}

export async function promptOpen(): Promise<void> {
  await openFiles(await platform.pickPdfFiles())
}

export async function combineFiles(): Promise<void> {
  const files = await platform.pickPdfFiles()
  if (files.length === 0) return
  const [first, ...rest] = files
  let tab: TabEntry | null
  try {
    tab = await openOne({ ...first, name: `${t('combine.name')}.pdf`, path: null })
  } catch (error) {
    toast(`${t('error.openFailed', { name: first.name })} ${describeOpenError(error)}`, 'error', undefined, 7000)
    return
  }
  if (!tab) return
  for (const file of rest) await insertFile(tab, tab.store.getState().info.pages.length, file, true)
  tab.store.getState().setOrganize(true)
  tab.store.getState().setSelectedPages([])
  if (rest.length > 0) toast(t('combine.done', { n: files.length, pages: tab.store.getState().info.pages.length }), 'success')
}

export type SaveMode = 'save' | 'saveAs' | 'flatten'

export async function saveTab(tab: TabEntry, mode: SaveMode): Promise<boolean> {
  await tab.store.getState().idle()
  if (!(await settlePendingRedactions(tab))) return false
  const state = tab.store.getState()
  const flatten = mode === 'flatten'
  let bytes: Uint8Array<ArrayBuffer>
  let position: number
  try {
    ;[position, bytes] = await Promise.all([engine().call('journalPosition', state.docId), engine().call('save', state.docId, { flatten })])
  } catch (error) {
    toast(t('error.saveFailed', { message: error instanceof Error ? error.message : String(error) }), 'error', undefined, 8000)
    return false
  }
  try {
    if (mode === 'save' && state.filePath && platform.isDesktop) {
      await platform.writeToPath(state.filePath, bytes)
      tab.store.setState({ history: await engine().call('markSaved', state.docId, position), fileSize: bytes.byteLength })
      toast(t('toast.saved'), 'success', undefined, 2000)
      return true
    }
    const stem = state.fileName.replace(/\.pdf$/i, '')
    const suggested = flatten ? `${stem} (final).pdf` : state.fileName
    const target = await platform.saveAs(suggested, state.filePath, bytes)
    if (!target) return false
    if (!flatten) {
      tab.store.setState({
        filePath: target.path,
        fileName: target.name,
        fileSize: bytes.byteLength,
        history: await engine().call('markSaved', state.docId, position)
      })
      if (target.path) {
        const recent = await platform.addRecent(target.path)
        useApp.setState({ recent })
      }
    }
    toast(t('toast.savedAs', { name: target.name }), 'success', undefined, 3000)
    return true
  } catch (error) {
    if (!(error instanceof SaveError)) {
      toast(t('error.saveFailed', { message: error instanceof Error ? error.message : String(error) }), 'error', undefined, 8000)
      return false
    }
    const message =
      error.info.code === 'locked'
        ? t('error.saveLocked')
        : error.info.code === 'denied'
          ? t('error.saveDenied')
          : t('error.saveFailed', { message: error.info.message })
    const choice = await choose({
      title: t('error.saveFailed', { message: '' }).replace(/:\s*$/, ''),
      body: message,
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'saveAs', label: t('error.saveAsInstead'), variant: 'primary' }
      ],
      cancel: 'cancel'
    })
    if (choice === 'saveAs') return saveTab(tab, 'saveAs')
    return false
  }
}
export async function saveActive(mode: SaveMode): Promise<void> {
  const tab = activeTab()
  if (tab) await saveTab(tab, mode)
}

export async function closeTab(id: string): Promise<boolean> {
  const tab = useApp.getState().tabs.find((x) => x.id === id)
  if (!tab) return true
  const state = tab.store.getState()
  if (state.history.dirty) {
    activateTab(id)
    const choice = await choose({
      title: t('dialog.unsavedTitle'),
      body: t('dialog.unsavedBody', { name: state.fileName }),
      choices: [
        { id: 'cancel', label: t('common.cancel') },
        { id: 'discard', label: t('common.dontSave') },
        { id: 'save', label: t('common.save'), variant: 'primary' }
      ],
      cancel: 'cancel'
    })
    if (choice === 'cancel') return false
    if (choice === 'save' && !(await saveTab(tab, 'save'))) return false
  }
  useApp.setState((s) => {
    const index = s.tabs.findIndex((x) => x.id === id)
    const tabs = s.tabs.filter((x) => x.id !== id)
    const activeId = s.activeId === id ? (tabs[Math.min(index, tabs.length - 1)]?.id ?? null) : s.activeId
    return { tabs, activeId }
  })
  void engine()
    .call('close', state.docId)
    .catch(() => undefined)
  return true
}

let closingWindow = false

export async function requestCloseWindow(): Promise<void> {
  if (closingWindow) return
  closingWindow = true
  try {
    for (const tab of useApp.getState().tabs) {
      const state = tab.store.getState()
      if (!state.history.dirty) continue
      activateTab(tab.id)
      const choice = await choose({
        title: t('dialog.unsavedTitle'),
        body: t('dialog.unsavedBody', { name: state.fileName }),
        choices: [
          { id: 'cancel', label: t('common.cancel') },
          { id: 'discard', label: t('common.dontSave') },
          { id: 'save', label: t('common.save'), variant: 'primary' }
        ],
        cancel: 'cancel'
      })
      if (choice === 'cancel') return
      if (choice === 'save' && !(await saveTab(tab, 'save'))) return
    }
    platform.closeWindow()
  } finally {
    closingWindow = false
  }
}
