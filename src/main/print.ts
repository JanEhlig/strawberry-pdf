import { app, BrowserWindow, type WebContents } from 'electron'
import { execFile } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PrinterSummary, PrintJob } from '@shared/api'
import { parseDefaultPrinter, printHtml, printOptions, sanitizePrintSettings } from './printJob'

const pending = new Set<string>()
app.on('will-quit', () => {
  for (const dir of pending) rmSync(dir, { recursive: true, force: true })
})

const DEVICE_KEY = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows'

function defaultPrinter(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('reg', ['query', DEVICE_KEY, '/v', 'Device'], { windowsHide: true, timeout: 5000 }, (error, stdout) =>
      resolve(error ? null : parseDefaultPrinter(stdout))
    )
  })
}

export async function listPrinters(contents: WebContents): Promise<PrinterSummary[]> {
  const [printers, standard] = await Promise.all([contents.getPrintersAsync(), defaultPrinter()])
  return printers.map((printer) => ({
    name: printer.name,
    displayName: printer.displayName || printer.name,
    isDefault: printer.name === standard
  }))
}

export async function printPages(parent: BrowserWindow | null, job: PrintJob): Promise<boolean> {
  if (job.pages.length === 0) return false
  const settings = sanitizePrintSettings(job.settings)
  const dir = await mkdtemp(join(tmpdir(), 'strawberry-print-'))
  pending.add(dir)
  let win: BrowserWindow | null = null
  try {
    const names = await Promise.all(
      job.pages.map(async (bytes, i) => {
        const name = `seite-${i + 1}.jpg`
        await writeFile(join(dir, name), bytes)
        return name
      })
    )
    const htmlPath = join(dir, 'druck.html')
    await writeFile(htmlPath, printHtml(names, job.sizes, job.title, settings?.scaling ?? 'fit'), 'utf8')
    win = new BrowserWindow({
      show: false,
      parent: parent ?? undefined,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await win.loadURL(pathToFileURL(htmlPath).toString())
    const printing = win
    return await new Promise<boolean>((resolve) => {
      printing.webContents.print(printOptions(settings), (success) => resolve(success))
    })
  } finally {
    win?.destroy()
    setTimeout(() => {
      void rm(dir, { recursive: true, force: true }).finally(() => pending.delete(dir))
    }, 30_000)
  }
}
