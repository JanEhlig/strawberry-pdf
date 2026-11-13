import type { WebContentsPrintOptions } from 'electron'
import type { DuplexMode, PaperSize, PrintScaling, PrintSettings } from '@shared/api'
import { PAPER_SIZES } from '@shared/paper'

const SCALINGS: PrintScaling[] = ['fit', 'actual', 'shrink']
const DUPLEX: DuplexMode[] = ['simplex', 'longEdge', 'shortEdge']

export function parseDefaultPrinter(output: string): string | null {
  const match = /\bDevice\s+REG_SZ\s+([^,\r\n]+)/.exec(output)
  return match ? match[1].trim() : null
}

export function sanitizePrintSettings(value: unknown): PrintSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<Record<keyof PrintSettings, unknown>>
  const copies = Number(raw.copies)
  return {
    printer: typeof raw.printer === 'string' ? raw.printer : '',
    copies: Number.isFinite(copies) ? Math.min(999, Math.max(1, Math.round(copies))) : 1,
    collate: raw.collate !== false,
    paper: typeof raw.paper === 'string' && raw.paper in PAPER_SIZES ? (raw.paper as PaperSize) : 'printer',
    landscape: raw.landscape === true,
    duplex: DUPLEX.includes(raw.duplex as DuplexMode) ? (raw.duplex as DuplexMode) : 'printer',
    color: raw.color !== false,
    scaling: SCALINGS.includes(raw.scaling as PrintScaling) ? (raw.scaling as PrintScaling) : 'fit'
  }
}

export function printOptions(settings: PrintSettings | undefined): WebContentsPrintOptions {
  if (!settings) return { silent: false, printBackground: true, margins: { marginType: 'printableArea' } }
  return {
    silent: true,
    printBackground: true,
    ...(settings.printer ? { deviceName: settings.printer } : {}),
    copies: settings.copies,
    collate: settings.collate,
    landscape: settings.landscape,
    color: settings.color,
    margins: { marginType: settings.scaling === 'actual' ? 'none' : 'printableArea' },
    ...(settings.duplex === 'printer' ? {} : { duplexMode: settings.duplex }),
    ...(settings.paper === 'printer' ? { usePrinterDefaultPageSize: true } : { pageSize: settings.paper })
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

export function printHtml(names: string[], sizes: { width: number; height: number }[], title: string, scaling: PrintScaling): string {
  const sheets = names.map((name, i) => {
    const { width, height } = sizes[i] ?? sizes[0] ?? PAPER_SIZES.A4
    return `<div class="sheet"><img src="${escapeHtml(name)}" style="--w: ${width}pt; --h: ${height}pt" alt=""></div>`
  })
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  .sheet { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; overflow: hidden; break-after: page; break-inside: avoid; }
  .sheet:last-child { break-after: auto; }
  .fit img { width: 100%; height: 100%; object-fit: contain; }
  .actual img { width: var(--w); height: var(--h); flex: none; }
  .shrink img { width: var(--w); height: var(--h); max-width: 100%; max-height: 100%; object-fit: contain; }
</style></head><body class="${scaling}">${sheets.join('\n')}</body></html>`
}
