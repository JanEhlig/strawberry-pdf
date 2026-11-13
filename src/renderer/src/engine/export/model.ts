import * as mupdf from 'mupdf'
import { displayFontName } from '@shared/fontNames'
import type { Point, Rect, RGB } from '../types'

export interface ExportFont {
  family: string
  generic: 'serif' | 'sans-serif' | 'monospace'
  bold: boolean
  italic: boolean
  size: number
}

export interface ExportLine {
  text: string
  bbox: Rect
  font: ExportFont
  color: RGB
  spacing: number
}

export type Alignment = 'left' | 'center' | 'right' | 'justify'

export interface ExportParagraph {
  kind: 'paragraph'
  bbox: Rect
  lines: ExportLine[]
  align: Alignment
}

export interface ExportTable {
  kind: 'table'
  bbox: Rect
  columns: number[]
  heights: number[]
  rows: ExportParagraph[][][]
}

export interface ExportImage {
  kind: 'image'
  bbox: Rect
  data: Uint8Array
  format: 'png' | 'jpeg'
}

export type ExportBlock = ExportParagraph | ExportTable | ExportImage

export interface ExportPage {
  width: number
  height: number
  blocks: ExportBlock[]
}

interface JsonBox {
  x: number
  y: number
  w: number
  h: number
}

interface JsonLine {
  bbox: JsonBox
  font: { name: string; family: string; weight: string; style: string; size: number }
  text: string
}

interface JsonText {
  type: 'text'
  bbox: JsonBox
  lines: JsonLine[]
}

interface JsonStructure {
  type: 'structure'
  std: string
  contents: JsonBlock[]
}

interface JsonGrid {
  type: 'grid'
  xpos: number[]
  ypos: number[]
}

type JsonBlock = JsonText | JsonStructure | JsonGrid | { type: 'image' | 'vector' }

interface PlainLine {
  bbox: Rect
  color: RGB
  size: number
  text: string
  spacing: number
}

interface PlainChar {
  c: string
  x0: number
  x1: number
}

const MIN_IMAGE_SIZE = 12
const OCR_GLYPHS = 20
const LETTER_SPACING = 0.08
const COLUMN_LINES = 3

function toRect(box: JsonBox): Rect {
  return [box.x, box.y, box.x + box.w, box.y + box.h]
}

function toRGB(color: number[]): RGB {
  if (color.length === 1) return [color[0], color[0], color[0]]
  if (color.length >= 4) {
    const [c, m, y, k] = color
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
  }
  return [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0]
}

function letterSpacing(chars: PlainChar[], size: number): { text: string; spacing: number } | null {
  const letters = chars.filter((ch) => ch.c.trim())
  if (letters.length < 4) return null
  const gaps = letters.slice(1).map((ch, i) => ch.x0 - letters[i].x1)
  const sorted = [...gaps].sort((a, b) => a - b)
  const spacing = sorted[sorted.length >> 1]
  if (spacing < size * LETTER_SPACING) return null
  let text = letters[0].c
  gaps.forEach((gap, i) => {
    text += (gap > spacing + size * 0.2 ? ' ' : '') + letters[i + 1].c
  })
  return { text, spacing }
}

function plainLines(list: mupdf.DisplayList): PlainLine[] {
  const st = list.toStructuredText('')
  const lines: PlainLine[] = []
  let current: PlainLine | null = null
  let chars: PlainChar[] = []
  st.walk({
    beginLine(bbox) {
      current = { bbox: [...bbox] as Rect, color: [0, 0, 0], size: 0, text: '', spacing: 0 }
      chars = []
    },
    onChar(c, _origin, _font, size, quad, color) {
      if (!current) return
      if (current.size === 0 && c.trim()) {
        current.size = size
        current.color = toRGB(color)
      }
      chars.push({ c, x0: Math.min(quad[0], quad[4]), x1: Math.max(quad[2], quad[6]) })
    },
    endLine() {
      if (!current) return
      const spaced = letterSpacing(chars, current.size)
      if (spaced) {
        current.text = spaced.text
        current.spacing = spaced.spacing
      }
      lines.push(current)
      current = null
    }
  })
  st.destroy()
  return lines
}

function matchPlain(plain: PlainLine[], bbox: Rect): PlainLine | null {
  const cx = (bbox[0] + bbox[2]) / 2
  const cy = (bbox[1] + bbox[3]) / 2
  let best: PlainLine | null = null
  let distance = Infinity
  for (const line of plain) {
    const [x0, y0, x1, y1] = line.bbox
    if (cy < y0 - 1 || cy > y1 + 1 || bbox[2] < x0 - 1 || bbox[0] > x1 + 1) continue
    const d = Math.abs((x0 + x1) / 2 - cx) + Math.abs((y0 + y1) / 2 - cy)
    if (d < distance) {
      distance = d
      best = line
    }
  }
  return best
}

function exportLine(line: JsonLine, plain: PlainLine[]): ExportLine {
  const bbox = toRect(line.bbox)
  const match = matchPlain(plain, bbox)
  const generic = line.font.family === 'serif' ? 'serif' : line.font.family === 'monospace' ? 'monospace' : 'sans-serif'
  return {
    text: match?.spacing ? `${match.text} ` : line.text,
    bbox,
    color: match?.color ?? [0, 0, 0],
    spacing: match?.spacing ?? 0,
    font: {
      family: displayFontName(line.font.name) || line.font.name,
      generic,
      bold: line.font.weight === 'bold',
      italic: line.font.style === 'italic',
      size: match?.size || line.font.size
    }
  }
}

function joinLines(lines: ExportLine[]): ExportLine[] {
  return lines.map((line, i) => {
    const next = lines[i + 1]
    if (!next || /\s$/.test(line.text)) return line
    if (/[a-zäöüß]-$/.test(line.text) && /^[a-zäöüß]/.test(next.text)) return { ...line, text: line.text.slice(0, -1) }
    return { ...line, text: `${line.text} ` }
  })
}

function paragraph(block: JsonText, plain: PlainLine[]): ExportParagraph | null {
  const lines = block.lines.filter((l) => l.text.trim()).map((l) => exportLine(l, plain))
  if (lines.length === 0) return null
  return { kind: 'paragraph', bbox: toRect(block.bbox), lines: joinLines(lines), align: 'left' }
}

function table(block: JsonStructure, plain: PlainLine[]): ExportTable | null {
  const grid = block.contents.find((c): c is JsonGrid => c.type === 'grid')
  if (!grid || grid.xpos.length < 2 || grid.ypos.length < 2) return null
  const columns = grid.xpos.slice(1).map((x, i) => x - grid.xpos[i])
  const rows: ExportParagraph[][][] = []
  for (const row of block.contents) {
    if (row.type !== 'structure' || (row as JsonStructure).std !== 'TR') continue
    const cells: ExportParagraph[][] = columns.map(() => [])
    let next = 0
    for (const cell of (row as JsonStructure).contents) {
      if (cell.type !== 'structure') continue
      const paragraphs: ExportBlock[] = []
      collectBlocks((cell as JsonStructure).contents, plain, paragraphs)
      const texts = paragraphs.filter((p): p is ExportParagraph => p.kind === 'paragraph')
      const x = texts[0] ? (texts[0].bbox[0] + texts[0].bbox[2]) / 2 : null
      let index = x === null ? next : grid.xpos.findIndex((pos, i) => i < columns.length && x >= pos && x < grid.xpos[i + 1])
      if (index < 0) index = Math.min(next, columns.length - 1)
      cells[index].push(...texts)
      next = index + 1
    }
    rows.push(cells)
  }
  if (rows.length === 0) return null
  const heights = grid.ypos.slice(1).map((y, i) => y - grid.ypos[i])
  const bbox: Rect = [grid.xpos[0], grid.ypos[0], grid.xpos[grid.xpos.length - 1], grid.ypos[grid.ypos.length - 1]]
  return { kind: 'table', bbox, columns, heights, rows }
}

function collectBlocks(blocks: JsonBlock[], plain: PlainLine[], out: ExportBlock[]): void {
  for (const block of blocks) {
    if (block.type === 'text') {
      const p = paragraph(block as JsonText, plain)
      if (p) out.push(p)
    } else if (block.type === 'structure') {
      const structure = block as JsonStructure
      const asTable = structure.std === 'Table' ? table(structure, plain) : null
      if (asTable) out.push(asTable)
      else collectBlocks(structure.contents, plain, out)
    }
  }
}

function hasColumns(blocks: ExportBlock[]): boolean {
  const text = blocks.filter((b): b is ExportParagraph => b.kind === 'paragraph' && b.lines.length >= COLUMN_LINES)
  return text.some((a, i) =>
    text.slice(i + 1).some((b) => {
      const overlap = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1])
      const apart = a.bbox[2] <= b.bbox[0] || b.bbox[2] <= a.bbox[0]
      return apart && overlap > Math.min(a.bbox[3] - a.bbox[1], b.bbox[3] - b.bbox[1]) / 2
    })
  )
}

function readingOrder(blocks: ExportBlock[]): ExportBlock[] {
  if (hasColumns(blocks)) return blocks
  return [...blocks].sort((a, b) => (Math.abs(a.bbox[1] - b.bbox[1]) > 2 ? a.bbox[1] - b.bbox[1] : a.bbox[0] - b.bbox[0]))
}

function hiddenGlyphs(list: mupdf.DisplayList): Point[] {
  const points: Point[] = []
  const device = new mupdf.Device({
    ignoreText(text, ctm) {
      text.walk({
        showGlyph(_font, trm) {
          const matrix = mupdf.Matrix.concat(trm, ctm)
          points.push([matrix[4], matrix[5]])
        }
      })
    }
  })
  try {
    list.run(device, mupdf.Matrix.identity)
  } finally {
    device.close()
  }
  return points
}

function coversText(bbox: Rect, hidden: Point[]): boolean {
  let count = 0
  for (const [x, y] of hidden) {
    if (x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3] && ++count >= OCR_GLYPHS) return true
  }
  return false
}

function encodeImage(image: mupdf.Image): Pick<ExportImage, 'data' | 'format'> | null {
  let source: mupdf.Pixmap
  try {
    source = image.toPixmap()
  } catch {
    return null
  }
  const space = source.getColorSpace()
  const pixmap = space && (space.isRGB() || space.isGray()) ? source : source.convertToColorSpace(mupdf.ColorSpace.DeviceRGB, true)
  try {
    const photo = !pixmap.getAlpha() && pixmap.getWidth() * pixmap.getHeight() > 40_000
    return { data: (photo ? pixmap.asJPEG(88) : pixmap.asPNG()).slice(), format: photo ? 'jpeg' : 'png' }
  } finally {
    if (pixmap !== source) pixmap.destroy()
    source.destroy()
  }
}

function pageImages(list: mupdf.DisplayList): ExportImage[] {
  const hidden = hiddenGlyphs(list)
  const images: ExportImage[] = []
  const device = new mupdf.Device({
    fillImage(image, ctm) {
      const corners = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1]
      ].map(([u, v]) => [u * ctm[0] + v * ctm[2] + ctm[4], u * ctm[1] + v * ctm[3] + ctm[5]])
      const xs = corners.map((c) => c[0])
      const ys = corners.map((c) => c[1])
      const bbox: Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
      if (bbox[2] - bbox[0] < MIN_IMAGE_SIZE || bbox[3] - bbox[1] < MIN_IMAGE_SIZE || coversText(bbox, hidden)) return
      const encoded = encodeImage(image)
      if (encoded) images.push({ kind: 'image', bbox, ...encoded })
    }
  })
  try {
    list.run(device, mupdf.Matrix.identity)
  } finally {
    device.close()
  }
  return images
}

export function contentMargins(page: { width: number; height: number }, blocks: ExportBlock[]): [number, number, number, number] {
  if (blocks.length === 0) return [72, 72, 72, 72]
  const clamp = (v: number): number => Math.max(18, Math.min(108, v))
  const left = Math.min(...blocks.map((b) => b.bbox[0]))
  const top = Math.min(...blocks.map((b) => b.bbox[1]))
  const right = page.width - Math.max(...blocks.map((b) => b.bbox[2]))
  const bottom = page.height - Math.max(...blocks.map((b) => b.bbox[3]))
  return [clamp(left), clamp(top), clamp(right), clamp(bottom)]
}

function alignmentOf(lines: ExportLine[], bbox: Rect, page: { width: number }, margins: [number, number]): Alignment {
  const tolerance = 2
  const lefts = lines.map((l) => l.bbox[0])
  const rights = lines.map((l) => l.bbox[2])
  const centers = lines.map((l) => (l.bbox[0] + l.bbox[2]) / 2)
  const same = (values: number[]): boolean => Math.max(...values) - Math.min(...values) <= tolerance
  if (lines.length > 1) {
    if (lines.length > 2 && same(lefts) && same(rights.slice(0, -1))) return 'justify'
    if (same(lefts)) return 'left'
    if (same(rights)) return 'right'
    if (same(centers)) return 'center'
    return 'left'
  }
  const center = (bbox[0] + bbox[2]) / 2
  const [left, right] = margins
  const middle = (left + page.width - right) / 2
  if (bbox[0] > left + 24 && Math.abs(center - middle) <= 4) return 'center'
  if (bbox[0] > middle && Math.abs(bbox[2] - (page.width - right)) <= 4) return 'right'
  return 'left'
}

export function pageModel(page: mupdf.PDFPage): ExportPage {
  const [x0, y0, x1, y1] = page.getBounds()
  const size = { width: x1 - x0, height: y1 - y0 }
  const list = page.toDisplayList(true)
  try {
    const plain = plainLines(list)
    const st = list.toStructuredText('table-hunt,segment')
    const json = JSON.parse(st.asJSON()) as { blocks: JsonBlock[] }
    st.destroy()
    const blocks: ExportBlock[] = []
    collectBlocks(json.blocks, plain, blocks)
    const ordered = readingOrder([...blocks, ...pageImages(list)])
    const [left, , right] = contentMargins(size, ordered)
    for (const block of ordered) {
      if (block.kind === 'paragraph') block.align = alignmentOf(block.lines, block.bbox, size, [left, right])
    }
    return { ...size, blocks: ordered }
  } finally {
    list.destroy()
  }
}
