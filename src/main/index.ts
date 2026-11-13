import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import type { AppEnvironment, FontQuery, PrintJob, SaveKind, StoreKey } from '@shared/api'
import { APP_ORIGIN, handleAppScheme, registerAppSchemeAsPrivileged } from './protocol'
import { addRecent, getRecent, loadStore, removeRecent, saveStore, writeFileAtomic } from './storage'
import { installedFonts } from './fontIndex'
import { matchFonts } from './fontMatch'
import { listPrinters, printPages } from './print'

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']

const SAVE_FILTERS: Record<SaveKind, Electron.FileFilter> = {
  pdf: { name: 'PDF', extensions: ['pdf'] },
  docx: { name: 'Word', extensions: ['docx'] },
  xlsx: { name: 'Excel', extensions: ['xlsx'] }
}

registerAppSchemeAsPrivileged()

let mainWindow: BrowserWindow | null = null
let pendingFiles: string[] = []
let rendererReady = false
let windowHasUnsaved = false
let allowClose = false

function pdfPathsFromArgv(argv: string[], cwd = process.cwd()): string[] {
  return argv
    .filter((arg) => !arg.startsWith('-') && /\.pdf$/i.test(arg))
    .map((arg) => resolve(cwd, arg))
    .filter((p) => {
      try {
        return existsSync(p) && statSync(p).isFile()
      } catch {
        return false
      }
    })
}

function deliverFiles(paths: string[]): void {
  if (paths.length === 0) return
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send('app:open-files', paths)
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  } else {
    pendingFiles.push(...paths)
  }
}

function createWindow(): void {
  const dark = nativeTheme.shouldUseDarkColors
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Strawberry PDF',
    backgroundColor: dark ? '#1C2122' : '#E5EAE8',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? '#262C2D' : '#FBFCFB',
      symbolColor: dark ? '#E7ECEB' : '#1C2733',
      height: 40
    },
    icon: app.isPackaged ? undefined : join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(process.env['ELECTRON_RENDERER_URL']!) : url.startsWith(APP_ORIGIN)
    if (!allowed) event.preventDefault()
  })

  mainWindow.on('close', (event) => {
    if (allowClose || !windowHasUnsaved) return
    event.preventDefault()
    mainWindow?.webContents.send('app:close-requested')
  })
  mainWindow.webContents.on('render-process-gone', () => {
    allowClose = true
    windowHasUnsaved = false
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    rendererReady = false
  })

  if (isDev) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    void mainWindow.loadURL(`${APP_ORIGIN}/index.html`)
  }
}

function registerIpc(): void {
  ipcMain.handle('app:environment', (): AppEnvironment => {
    let userName = ''
    try {
      userName = userInfo().username
    } catch {
      userName = ''
    }
    return {
      platform: process.platform,
      userName,
      locale: app.getLocale(),
      version: app.getVersion(),
      isPackaged: app.isPackaged
    }
  })

  ipcMain.handle('file:open-dialog', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('file:save-dialog', async (event, defaultPath: string, kind: SaveKind) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const filter = SAVE_FILTERS[kind] ?? SAVE_FILTERS.pdf
    const result = await dialog.showSaveDialog(win!, { defaultPath, filters: [filter] })
    return result.canceled || !result.filePath ? null : result.filePath
  })

  ipcMain.handle('file:read', async (_event, path: string) => {
    const data = await readFile(path)
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  })

  ipcMain.handle('file:write', async (_event, path: string, data: Uint8Array) => {
    await writeFileAtomic(path, data)
  })

  ipcMain.handle('recent:get', () => getRecent())
  ipcMain.handle('recent:add', (_event, path: string) => addRecent(path))
  ipcMain.handle('recent:remove', (_event, path: string) => removeRecent(path))

  const checkKey = (key: unknown): StoreKey => {
    if (key !== 'settings' && key !== 'signatures') throw new Error('Unknown store')
    return key
  }
  ipcMain.handle('store:load', (_event, key: unknown) => loadStore(checkKey(key)))
  ipcMain.handle('store:save', (_event, key: unknown, value: unknown) => saveStore(checkKey(key), value))

  ipcMain.handle('app:take-initial-files', () => {
    rendererReady = true
    const files = pendingFiles
    pendingFiles = []
    return files
  })

  ipcMain.on('app:set-unsaved', (_event, unsaved: boolean) => {
    windowHasUnsaved = !!unsaved
  })

  ipcMain.on('app:close-window', () => {
    allowClose = true
    mainWindow?.close()
  })

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (/^(https?:|mailto:)/i.test(url)) await shell.openExternal(url)
  })
  ipcMain.on('shell:show-item', (_event, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:open-path', async (_event, path: string) => {
    if (/\.(docx|xlsx)$/i.test(path) && existsSync(path)) await shell.openPath(path)
  })
  ipcMain.on('shell:default-apps', () => void shell.openExternal('ms-settings:defaultapps'))

  ipcMain.on('window:title-bar', (event, colors: { color: string; symbolColor: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    try {
      win?.setTitleBarOverlay({ ...colors, height: 40 })
    } catch {
    }
    win?.setBackgroundColor(colors.color)
  })
  ipcMain.on('window:title', (event, title: string) => {
    BrowserWindow.fromWebContents(event.sender)?.setTitle(title)
  })

  ipcMain.handle('print:printers', (event) => listPrinters(event.sender))
  ipcMain.handle('print:pages', (event, job: PrintJob) =>
    printPages(BrowserWindow.fromWebContents(event.sender), job)
  )

  ipcMain.handle('fonts:match', async (_event, query: FontQuery) => {
    const safe: FontQuery = {
      name: String(query?.name ?? ''),
      bold: !!query?.bold,
      italic: !!query?.italic,
      serif: !!query?.serif,
      mono: !!query?.mono,
      text: String(query?.text ?? '')
    }
    return matchFonts(await installedFonts(), safe)
  })
  ipcMain.handle('fonts:read', async (_event, file: string) => {
    if (!(await installedFonts()).some((font) => font.file === file)) throw new Error('Unknown font')
    const data = await readFile(file)
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  pendingFiles = pdfPathsFromArgv(process.argv.slice(1))

  app.on('second-instance', (_event, argv, workingDirectory) => {
    deliverFiles(pdfPathsFromArgv(argv.slice(1), workingDirectory))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('de.strawberrypdf.app')
    Menu.setApplicationMenu(null)
    handleAppScheme(join(__dirname, '../renderer'))
    registerIpc()
    createWindow()
  })

  app.on('window-all-closed', () => app.quit())
}
