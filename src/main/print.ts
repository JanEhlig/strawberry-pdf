import { app, BrowserWindow } from 'electron'
import { rmSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PrintJob } from '@shared/api'

const pending = new Set<string>()
app.on('will-quit', () => {
  for (const dir of pending) rmSync(dir, { recursive: true, force: true })
})

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

function printHtml(names: string[], sizes: { width: number; height: number }[], title: string): string {
  const fallback = sizes[0] ?? { width: 595, height: 842 }
  const keys = new Map<string, number>()
  const rules: string[] = []
  const pages = names.map((name, i) => {
    const { width, height } = sizes[i] ?? fallback
    const key = `${Math.round(width)}x${Math.round(height)}`
    let id = keys.get(key)
    if (id === undefined) {
      id = keys.size
      keys.set(key, id)
      rules.push(`@page s${id} { size: ${width}pt ${height}pt; margin: 0; }`)
      rules.push(`.s${id} { page: s${id}; width: ${width}pt; height: ${height}pt; }`)
    }
    return `<div class="pg s${id}"><img src="${name}" alt=""></div>`
  })
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: ${fallback.width}pt ${fallback.height}pt; margin: 0; }
  ${rules.join('\n  ')}
  html, body { margin: 0; padding: 0; background: #fff; }
  .pg { display: flex; align-items: center; justify-content: center; overflow: hidden; break-after: page; }
  .pg:last-child { break-after: auto; }
  .pg img { max-width: 100%; max-height: 100%; }
</style></head><body>${pages.join('\n')}</body></html>`
}

export async function printPages(parent: BrowserWindow | null, job: PrintJob): Promise<boolean> {
  if (job.pages.length === 0) return false
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
    await writeFile(htmlPath, printHtml(names, job.sizes, job.title), 'utf8')
    win = new BrowserWindow({
      show: false,
      parent: parent ?? undefined,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await win.loadURL(pathToFileURL(htmlPath).toString())
    const printing = win
    return await new Promise<boolean>((resolve) => {
      printing.webContents.print({ silent: false, printBackground: true }, (success) => resolve(success))
    })
  } finally {
    win?.destroy()
    setTimeout(() => {
      void rm(dir, { recursive: true, force: true }).finally(() => pending.delete(dir))
    }, 30_000)
  }
}
