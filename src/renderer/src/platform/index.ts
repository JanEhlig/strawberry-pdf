import type { AppEnvironment, FontQuery, StrawberryApi, PrintJob, RecentFile, StoreKey, SystemFont, WriteFileError } from '@shared/api'

export interface OpenedFile {
  name: string
  path: string | null
  data: Uint8Array<ArrayBuffer>
}

export class SaveError extends Error {
  constructor(public info: WriteFileError) {
    super(info.message)
    this.name = 'SaveError'
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function parseWriteError(error: unknown): WriteFileError {
  const message = error instanceof Error ? error.message : String(error)
  const json = message.match(/\{.*\}/s)
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as WriteFileError
      if (parsed.code) return parsed
    } catch {
    }
  }
  return { code: 'unknown', message }
}

function toOwned(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy
}

function pickFilesInBrowser(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf,.pdf'
    input.multiple = true
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.oncancel = () => resolve([])
    input.click()
  })
}

function downloadInBrowser(name: string, data: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const api: StrawberryApi | undefined = window.strawberry

export const platform = {
  isDesktop: !!api,

  async environment(): Promise<AppEnvironment> {
    if (api) return api.getEnvironment()
    return { platform: 'web', userName: '', locale: navigator.language, version: '1.0.0', isPackaged: false }
  },

  async pickPdfFiles(): Promise<OpenedFile[]> {
    if (api) {
      const paths = await api.showOpenDialog()
      return Promise.all(paths.map((p) => platform.readPath(p)))
    }
    const files = await pickFilesInBrowser()
    return Promise.all(files.map((f) => platform.readDropped(f)))
  },

  async readPath(path: string): Promise<OpenedFile> {
    if (!api) throw new Error('Not available')
    const data = await api.readFile(path)
    return { name: baseName(path), path, data: toOwned(data) }
  },

  async readDropped(file: File): Promise<OpenedFile> {
    const path = api ? api.getPathForFile(file) || null : null
    return { name: file.name, path, data: new Uint8Array(await file.arrayBuffer()) }
  },

  async writeToPath(path: string, data: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!api) {
      downloadInBrowser(baseName(path), data)
      return
    }
    try {
      await api.writeFile(path, data)
    } catch (error) {
      throw new SaveError(parseWriteError(error))
    }
  },

  async saveAs(suggestedName: string, directoryOf: string | null, data: Uint8Array<ArrayBuffer>): Promise<{ path: string | null; name: string } | null> {
    if (!api) {
      downloadInBrowser(suggestedName, data)
      return { path: null, name: suggestedName }
    }
    const dir = directoryOf ? directoryOf.replace(/[\\/][^\\/]*$/, '') : ''
    const target = await api.showSaveDialog(dir ? `${dir}\\${suggestedName}` : suggestedName)
    if (!target) return null
    const path = /\.pdf$/i.test(target) ? target : `${target}.pdf`
    await platform.writeToPath(path, data)
    return { path, name: baseName(path) }
  },

  async getRecent(): Promise<RecentFile[]> {
    return api ? api.getRecent() : []
  },
  async addRecent(path: string): Promise<RecentFile[]> {
    return api ? api.addRecent(path) : []
  },
  async removeRecent(path: string): Promise<RecentFile[]> {
    return api ? api.removeRecent(path) : []
  },

  async loadStore<T>(key: StoreKey): Promise<T | null> {
    if (api) return api.loadStore<T>(key)
    try {
      const raw = localStorage.getItem(`strawberry.${key}`)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  },
  async saveStore(key: StoreKey, value: unknown): Promise<void> {
    if (api) return api.saveStore(key, value)
    try {
      localStorage.setItem(`strawberry.${key}`, JSON.stringify(value))
    } catch {
    }
  },

  takeInitialFiles(): Promise<string[]> {
    return api ? api.takeInitialFiles() : Promise.resolve([])
  },
  onOpenFiles(callback: (paths: string[]) => void): () => void {
    return api ? api.onOpenFiles(callback) : () => undefined
  },
  setUnsaved(unsaved: boolean): void {
    api?.setUnsaved(unsaved)
  },
  onCloseRequested(callback: () => void): () => void {
    return api ? api.onCloseRequested(callback) : () => undefined
  },
  closeWindow(): void {
    if (api) api.closeWindow()
    else window.close()
  },
  openExternal(url: string): void {
    if (api) void api.openExternal(url)
    else window.open(url, '_blank', 'noopener')
  },
  showItemInFolder(path: string): void {
    api?.showItemInFolder(path)
  },
  openDefaultAppsSettings(): void {
    api?.openDefaultAppsSettings()
  },
  setTitleBarColors(color: string, symbolColor: string): void {
    api?.setTitleBarColors({ color, symbolColor })
  },
  setWindowTitle(title: string): void {
    if (api) api.setWindowTitle(title)
    document.title = title
  },
  print(job: PrintJob): Promise<boolean> {
    if (api) return api.print(job)
    return Promise.resolve(false)
  },
  async matchFonts(query: FontQuery): Promise<SystemFont[]> {
    return api ? api.matchFonts(query) : []
  },
  async readFont(file: string): Promise<Uint8Array> {
    if (!api) throw new Error('Not available')
    return toOwned(await api.readFont(file))
  },
  baseName
}
