import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { FontQuery, StrawberryApi, PrintJob, StoreKey } from '@shared/api'

function subscribe<T extends unknown[]>(channel: string, callback: (...args: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => callback(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: StrawberryApi = {
  getEnvironment: () => ipcRenderer.invoke('app:environment'),
  showOpenDialog: () => ipcRenderer.invoke('file:open-dialog'),
  showSaveDialog: (defaultPath: string) => ipcRenderer.invoke('file:save-dialog', defaultPath),
  readFile: (path: string) => ipcRenderer.invoke('file:read', path),
  writeFile: (path: string, data: Uint8Array) => ipcRenderer.invoke('file:write', path, data),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getRecent: () => ipcRenderer.invoke('recent:get'),
  addRecent: (path: string) => ipcRenderer.invoke('recent:add', path),
  removeRecent: (path: string) => ipcRenderer.invoke('recent:remove', path),
  loadStore: <T>(key: StoreKey) => ipcRenderer.invoke('store:load', key) as Promise<T | null>,
  saveStore: (key: StoreKey, value: unknown) => ipcRenderer.invoke('store:save', key, value),
  takeInitialFiles: () => ipcRenderer.invoke('app:take-initial-files'),
  onOpenFiles: (callback) => subscribe<[string[]]>('app:open-files', callback),
  setUnsaved: (unsaved: boolean) => ipcRenderer.send('app:set-unsaved', unsaved),
  onCloseRequested: (callback) => subscribe<[]>('app:close-requested', callback),
  closeWindow: () => ipcRenderer.send('app:close-window'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  showItemInFolder: (path: string) => ipcRenderer.send('shell:show-item', path),
  openDefaultAppsSettings: () => ipcRenderer.send('shell:default-apps'),
  setTitleBarColors: (colors) => ipcRenderer.send('window:title-bar', colors),
  setWindowTitle: (title: string) => ipcRenderer.send('window:title', title),
  print: (job: PrintJob) => ipcRenderer.invoke('print:pages', job),
  matchFonts: (query: FontQuery) => ipcRenderer.invoke('fonts:match', query),
  readFont: (file: string) => ipcRenderer.invoke('fonts:read', file)
}

contextBridge.exposeInMainWorld('strawberry', api)
