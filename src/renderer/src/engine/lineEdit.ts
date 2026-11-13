import * as mupdf from 'mupdf'
import { buildToUnicode } from './cmap'
import { builtinFontFor, stripSubsetTag } from './fonts'
import { collectFontDicts, resourceFontFor, type ResourceFont } from './pdfFonts'
import type { FontProgram, Rect, RGB, TextEditPlan, TextFont, TextLine } from './types'

type ColorKind = 'gray' | 'rgb' | 'cmyk' | null

interface Glyph {
  font: mupdf.Font
  gid: number
  text: string
  matrix: mupdf.Matrix
  color: number[]
  colorKind: ColorKind
  invisible: boolean
}

type Source = { kind: 'resource'; font: ResourceFont } | { kind: 'program'; font: mupdf.Font }

type RunItem = { code: number; ch: string } | number

interface Run {
  source: number
  items: RunItem[]
}

export interface LineAnalysis {
  text: string
  font: TextFont
  size: number
  matrix: mupdf.Matrix
  charSpacing: number
  spaceWidth: number
  color: number[]
  colorKind: ColorKind
  fallbackColor: RGB
  invisible: boolean
  resources: ResourceFont[]
}

const DEFAULT_SPACE = 0.25

function colorKind(cs: mupdf.ColorSpace): ColorKind {
  if (cs.isCMYK()) return 'cmyk'
  if (cs.isRGB()) return 'rgb'
  if (cs.isGray()) return 'gray'
  return null
}

function textFontOf(font: mupdf.Font): TextFont {
  return { name: stripSubsetTag(font.getName()), bold: font.isBold(), italic: font.isItalic(), serif: font.isSerif(), mono: font.isMono() }
}

function collectGlyphs(page: mupdf.PDFPage, bbox: Rect): { line: Glyph[]; seen: Map<string, Set<string>> } {
  const [x0, y0, x1, y1] = [bbox[0] - 1, bbox[1] - 1, bbox[2] + 1, bbox[3] + 1]
  const line: Glyph[] = []
  const seen = new Map<string, Set<string>>()
  const placed = new Set<string>()
  const take = (text: mupdf.Text, ctm: mupdf.Matrix, color: number[], kind: ColorKind, invisible: boolean): void => {
    text.walk({
      showGlyph(font, trm, gid, unicode) {
        const ch = unicode > 0 ? String.fromCodePoint(unicode) : ''
        const name = font.getName()
        let chars = seen.get(name)
        if (!chars) seen.set(name, (chars = new Set()))
        if (ch) chars.add(ch)
        const matrix = mupdf.Matrix.concat(trm, ctm)
        if (matrix[4] < x0 || matrix[4] > x1 || matrix[5] < y0 || matrix[5] > y1) return
        const key = `${gid}@${matrix[4].toFixed(2)},${matrix[5].toFixed(2)}`
        if (placed.has(key)) return
        placed.add(key)
        line.push({ font, gid, text: ch, matrix, color: [...color], colorKind: kind, invisible })
      }
    })
  }
  const device = new mupdf.Device({
    fillText: (text, ctm, cs, color) => take(text, ctm, color, colorKind(cs), false),
    strokeText: (text, _stroke, ctm, cs, color) => take(text, ctm, color, colorKind(cs), false),
    clipText: (text, ctm) => take(text, ctm, [], null, true),
    ignoreText: (text, ctm) => take(text, ctm, [], null, true)
  })
  try {
    page.runPageContents(device, mupdf.Matrix.identity)
  } finally {
    device.close()
  }
  return { line, seen }
}

function advance(glyph: Glyph, resource: ResourceFont | undefined): number {
  const code = resource?.codes.get(glyph.text)
  if (resource?.width && code !== undefined) return resource.width(code) / 1000
  return glyph.font.advanceGlyph(glyph.gid)
}

interface Baseline {
  fonts: Map<string, ResourceFont>
  axis: [number, number]
  scale: number
}

function extraGap(g: Glyph, next: Glyph, { fonts, axis, scale }: Baseline): number {
  const actual = ((next.matrix[4] - g.matrix[4]) * axis[0] + (next.matrix[5] - g.matrix[5]) * axis[1]) / scale
  return actual - advance(g, fonts.get(g.font.getName()))
}

function estimateCharSpacing(glyphs: Glyph[], baseline: Baseline): number {
  const gaps: number[] = []
  for (let i = 0; i + 1 < glyphs.length; i++) {
    if (glyphs[i].text.trim()) gaps.push(extraGap(glyphs[i], glyphs[i + 1], baseline))
  }
  if (gaps.length < 2) return 0
  gaps.sort((a, b) => a - b)
  const median = gaps[gaps.length >> 1]
  return Math.abs(median) < 0.002 || Math.abs(median) > 1 ? 0 : median
}

function readText(glyphs: Glyph[], baseline: Baseline, charSpacing: number, space: number): string {
  let text = ''
  glyphs.forEach((g, i) => {
    text += g.text.trim() ? g.text : ' '
    const next = glyphs[i + 1]
    if (next && g.text.trim() && next.text.trim() && extraGap(g, next, baseline) - charSpacing > space * 0.6) text += ' '
  })
  return text.replace(/ {2,}/g, ' ').trim()
}

function measureSpace(glyphs: Glyph[], fonts: Map<string, ResourceFont>, main: mupdf.Font): number {
  const space = glyphs.find((g) => !g.text.trim())
  if (space) return advance(space, fonts.get(space.font.getName()))
  const gid = main.encodeCharacter(32)
  return gid > 0 ? main.advanceGlyph(gid) : DEFAULT_SPACE
}

export function normalizeLineText(text: string): string {
  return text.normalize('NFC').replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '')
}

export function analyzeLine(page: mupdf.PDFPage, line: TextLine): LineAnalysis {
  const { line: glyphs, seen } = collectGlyphs(page, line.bbox)
  const fallbackColor: RGB = line.color
  if (glyphs.length === 0) {
    const [x, y] = line.origin
    return {
      text: line.text,
      font: line.font,
      size: line.size,
      matrix: [line.size, 0, 0, -line.size, x, y],
      charSpacing: 0,
      spaceWidth: DEFAULT_SPACE,
      color: [],
      colorKind: null,
      fallbackColor,
      invisible: false,
      resources: []
    }
  }
  const first = glyphs[0].matrix
  const scale = Math.hypot(first[0], first[1]) || 1
  const axis: [number, number] = [first[0] / scale, first[1] / scale]
  const along = (g: Glyph): number => g.matrix[4] * axis[0] + g.matrix[5] * axis[1]
  glyphs.sort((a, b) => along(a) - along(b))
  const weights = new Map<string, { font: mupdf.Font; weight: number }>()
  for (const g of glyphs) {
    const name = g.font.getName()
    const entry = weights.get(name) ?? { font: g.font, weight: 0 }
    entry.weight += g.text.trim() ? 1 : 0.1
    weights.set(name, entry)
  }
  const fonts = [...weights.values()].sort((a, b) => b.weight - a.weight).map((e) => e.font)
  const candidates = collectFontDicts(page.getObject().getInheritable('Resources'))
  const byName = new Map<string, ResourceFont>()
  for (const font of fonts) {
    const resource = resourceFontFor(candidates, font.getName(), seen.get(font.getName()) ?? new Set())
    if (resource) byName.set(font.getName(), resource)
  }
  const start = glyphs[0]
  const body = glyphs.find((g) => g.text.trim()) ?? start
  const baseline: Baseline = { fonts: byName, axis, scale }
  const charSpacing = estimateCharSpacing(glyphs, baseline)
  const spaceWidth = measureSpace(glyphs, byName, fonts[0])
  return {
    text: readText(glyphs, baseline, charSpacing, spaceWidth),
    font: textFontOf(fonts[0]),
    size: Math.hypot(start.matrix[2], start.matrix[3]),
    matrix: start.matrix,
    charSpacing,
    spaceWidth,
    color: body.color,
    colorKind: body.colorKind,
    fallbackColor,
    invisible: glyphs.every((g) => g.invisible),
    resources: fonts.map((f) => byName.get(f.getName())).filter((r): r is ResourceFont => r !== undefined)
  }
}

export function planLineEdit(analysis: LineAnalysis, text = analysis.text): TextEditPlan {
  const missing = new Set<string>()
  for (const ch of normalizeLineText(text)) {
    if (ch.trim() && !analysis.resources.some((r) => r.codes.has(ch))) missing.add(ch)
  }
  return { text: analysis.text, font: analysis.font, size: analysis.size, missing: [...missing].join('') }
}

export function removeLine(page: mupdf.PDFPage, bbox: Rect): void {
  const redact = page.createAnnotation('Redact')
  const [x0, y0, x1, y1] = bbox
  redact.setRect([x0 - 0.5, y0 + 0.5, x1 + 0.5, y1 - 0.5])
  redact.applyRedaction(0, mupdf.PDFPage.REDACT_IMAGE_NONE, mupdf.PDFPage.REDACT_LINE_ART_NONE, mupdf.PDFPage.REDACT_TEXT_REMOVE)
}

function loadPrograms(analysis: LineAnalysis, fonts: FontProgram[]): mupdf.Font[] {
  const loaded: mupdf.Font[] = []
  for (const program of fonts) {
    try {
      loaded.push(new mupdf.Font(program.name, program.data, program.index))
    } catch {
    }
  }
  loaded.push(new mupdf.Font(builtinFontFor(analysis.font)))
  return loaded
}

function codeOf(source: Source, ch: string): number {
  if (source.kind === 'resource') return source.font.codes.get(ch) ?? -1
  const gid = source.font.encodeCharacter(ch.codePointAt(0) ?? 0)
  return gid > 0 ? gid : -1
}

function buildRuns(text: string, sources: Source[], gap: number): Run[] {
  const runs: Run[] = []
  let lead = 0
  for (const ch of text) {
    const resource = sources.findIndex((s) => s.kind === 'resource' && codeOf(s, ch) >= 0)
    if (!ch.trim() && resource < 0) {
      const last = runs[runs.length - 1]
      if (last) last.items.push(gap)
      else lead += gap
      continue
    }
    let source = resource >= 0 ? resource : sources.findIndex((s) => codeOf(s, ch) >= 0)
    if (source < 0) source = sources.length - 1
    const item: RunItem = { code: Math.max(0, codeOf(sources[source], ch)), ch }
    const last = runs[runs.length - 1]
    if (last && last.source === source) {
      last.items.push(item)
    } else {
      runs.push({ source, items: lead ? [lead, item] : [item] })
      lead = 0
    }
  }
  return runs
}

function embedSubset(doc: mupdf.PDFDocument, font: mupdf.Font, glyphs: Map<number, string>): mupdf.PDFObject {
  const scratch = new mupdf.PDFDocument()
  try {
    const ref = scratch.addFont(font)
    const codes = [...glyphs.keys()].map((gid) => gid.toString(16).padStart(4, '0')).join('')
    const resources = scratch.addObject({ Font: { F: ref } })
    scratch.insertPage(-1, scratch.addPage([0, 0, 10, 10], 0, resources, `BT /F 1 Tf <${codes}> Tj ET`))
    scratch.subsetFonts()
    const embedded = doc.graftObject(ref)
    embedded.put('ToUnicode', doc.addStream(buildToUnicode(glyphs), {}))
    return embedded
  } finally {
    scratch.destroy()
  }
}

function fontResourceName(doc: mupdf.PDFDocument, pageObj: mupdf.PDFObject, ref: mupdf.PDFObject): string {
  let resources = pageObj.getInheritable('Resources')
  if (!resources.isDictionary()) {
    resources = doc.newDictionary()
    pageObj.put('Resources', resources)
  }
  let fonts = resources.get('Font')
  if (!fonts.isDictionary()) {
    fonts = doc.newDictionary()
    resources.put('Font', fonts)
  }
  const num = ref.asIndirect()
  let existing: string | null = null
  fonts.forEach((value, key) => {
    if (existing === null && value.isIndirect() && value.asIndirect() === num) existing = String(key)
  })
  if (existing !== null) return existing
  let n = 1
  while (!fonts.get(`SpF${n}`).isNull()) n++
  fonts.put(`SpF${n}`, ref)
  return `SpF${n}`
}

function num(v: number): string {
  return Math.abs(v) < 1e-6 ? '0' : v.toFixed(4).replace(/\.?0+$/, '')
}

function colorOperator(analysis: LineAnalysis): string {
  const { color, colorKind: kind } = analysis
  if (kind === 'gray' && color.length === 1) return `${num(color[0])} g`
  if (kind === 'rgb' && color.length === 3) return `${color.map(num).join(' ')} rg`
  if (kind === 'cmyk' && color.length === 4) return `${color.map(num).join(' ')} k`
  return `${analysis.fallbackColor.map(num).join(' ')} rg`
}

function showRun(run: Run, width: number): string {
  const parts: string[] = []
  let hex = ''
  for (const item of run.items) {
    if (typeof item === 'number') {
      if (hex) parts.push(`<${hex}>`)
      hex = ''
      parts.push(num(-item * 1000))
    } else {
      hex += item.code.toString(16).padStart(width, '0')
    }
  }
  if (hex) parts.push(`<${hex}>`)
  return `[${parts.join(' ')}] TJ`
}

function appendContent(doc: mupdf.PDFDocument, pageObj: mupdf.PDFObject, content: string): void {
  const contents = pageObj.get('Contents')
  const list = doc.newArray()
  list.push(doc.addStream('q\n', {}))
  if (contents.isArray()) for (let i = 0; i < contents.length; i++) list.push(contents.get(i))
  else if (!contents.isNull()) list.push(contents)
  list.push(doc.addStream('Q\n', {}))
  list.push(doc.addStream(content, {}))
  pageObj.put('Contents', list)
}

export function writeLine(doc: mupdf.PDFDocument, page: mupdf.PDFPage, analysis: LineAnalysis, text: string, fonts: FontProgram[], size?: number): void {
  const value = normalizeLineText(text)
  if (!value.trim()) return
  const sources: Source[] = [
    ...analysis.resources.map((font): Source => ({ kind: 'resource', font })),
    ...loadPrograms(analysis, fonts).map((font): Source => ({ kind: 'program', font }))
  ]
  const runs = buildRuns(value, sources, analysis.spaceWidth + analysis.charSpacing)
  const pageObj = page.getObject()
  const names = new Map<number, string>()
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    const used = runs.filter((r) => r.source === i)
    if (used.length === 0) continue
    let ref = source.kind === 'resource' ? source.font.ref : null
    if (source.kind === 'program') {
      const glyphs = new Map<number, string>()
      for (const run of used) for (const item of run.items) if (typeof item !== 'number') glyphs.set(item.code, item.ch)
      ref = embedSubset(doc, source.font, glyphs)
    }
    if (ref) names.set(i, fontResourceName(doc, pageObj, ref))
  }

  const factor = size && analysis.size > 0 ? size / analysis.size : 1
  const [a, b, c, d, e, f] = analysis.matrix
  const matrix = mupdf.Matrix.concat([a * factor, b * factor, c * factor, d * factor, e, f], mupdf.Matrix.invert(page.getTransform()))
  const lines = ['q', 'BT', colorOperator(analysis)]
  if (analysis.invisible) lines.push('3 Tr')
  if (analysis.charSpacing) lines.push(`${num(analysis.charSpacing)} Tc`)
  lines.push(`${matrix.map(num).join(' ')} Tm`)
  for (const run of runs) {
    const source = sources[run.source]
    const width = (source.kind === 'resource' ? source.font.bytesPerCode : 2) * 2
    lines.push(`/${names.get(run.source)} 1 Tf ${showRun(run, width)}`)
  }
  lines.push('ET', 'Q', '')
  appendContent(doc, pageObj, lines.join('\n'))
}
