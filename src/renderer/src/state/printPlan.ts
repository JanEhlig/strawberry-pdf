import type { PaperSize, PrinterSummary, PrintOrientation, PrintPreferences, PrintScaling } from '@shared/api'
import { PAPER_SIZES } from '@shared/paper'

export interface Size {
  width: number
  height: number
}

export interface PlannedPage {
  index: number
  turn: boolean
}

export interface PrintPlan {
  pages: PlannedPage[]
  landscape: boolean
}

export interface Placement {
  x: number
  y: number
  width: number
  height: number
}

export type PageChoice = 'all' | 'current' | 'range'

export type PrintRequest =
  | { kind: 'system' }
  | { kind: 'print'; preferences: PrintPreferences; printer: PrinterSummary; copies: number; collate: boolean; pages: number[] }

const PRINTABLE_MARGIN = 12
const LETTER_REGIONS = new Set(['US', 'CA', 'MX', 'PH', 'CL', 'CO'])

export function resolvePrinter(printers: PrinterSummary[], preferred: string): PrinterSummary | null {
  return printers.find((p) => p.name === preferred) ?? printers.find((p) => p.isDefault) ?? printers[0] ?? null
}

export function parsePageRange(input: string, count: number): number[] | null {
  const parts = input
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return null
  const pages = new Set<number>()
  for (const part of parts) {
    const match = /^(\d*)\s*(?:[-\u2013]\s*(\d*))?$/.exec(part)
    if (!match) return null
    const from = match[1] ? Number(match[1]) : 1
    const to = match[2] === undefined ? from : match[2] ? Number(match[2]) : count
    if (from < 1 || to > count || from > to) return null
    for (let page = from; page <= to; page++) pages.add(page - 1)
  }
  return [...pages].sort((a, b) => a - b)
}

export function selectPages(choice: PageChoice, range: string, count: number, current: number): number[] | null {
  if (choice === 'all') return Array.from({ length: count }, (_, i) => i)
  if (choice === 'current') return [Math.min(Math.max(current, 0), count - 1)]
  return parsePageRange(range, count)
}

function shapeOf(size: Size): 'portrait' | 'landscape' | 'square' {
  if (size.width > size.height) return 'landscape'
  return size.height > size.width ? 'portrait' : 'square'
}

export function planPrint(sizes: Size[], indices: number[], orientation: PrintOrientation): PrintPlan {
  if (orientation !== 'auto') return { landscape: orientation === 'landscape', pages: indices.map((index) => ({ index, turn: false })) }
  const shapes = indices.map((index) => shapeOf(sizes[index]))
  const landscape = shapes.filter((s) => s === 'landscape').length > shapes.filter((s) => s === 'portrait').length
  const across = landscape ? 'portrait' : 'landscape'
  return { landscape, pages: indices.map((index, i) => ({ index, turn: shapes[i] === across })) }
}

export function turned(size: Size, turn: boolean): Size {
  return turn ? { width: size.height, height: size.width } : { width: size.width, height: size.height }
}

function regionPaper(locale: string): PaperSize {
  try {
    return LETTER_REGIONS.has(new Intl.Locale(locale).maximize().region ?? '') ? 'Letter' : 'A4'
  } catch {
    return 'A4'
  }
}

export function paperSize(paper: PaperSize | 'printer', locale: string, landscape: boolean): Size {
  const size = PAPER_SIZES[paper === 'printer' ? regionPaper(locale) : paper]
  return turned(size, landscape)
}

export function placePage(page: Size, paper: Size, scaling: PrintScaling): Placement {
  const margin = scaling === 'actual' ? 0 : PRINTABLE_MARGIN
  const fit = Math.min((paper.width - 2 * margin) / page.width, (paper.height - 2 * margin) / page.height)
  const scale = scaling === 'fit' ? fit : scaling === 'shrink' ? Math.min(1, fit) : 1
  const width = page.width * scale
  const height = page.height * scale
  return { x: (paper.width - width) / 2, y: (paper.height - height) / 2, width, height }
}
