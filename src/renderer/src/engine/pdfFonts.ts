import type * as mupdf from 'mupdf'
import { glyphOutlines } from '@shared/sfnt'
import { invertToUnicode, parseToUnicode } from './cmap'
import { stripSubsetTag, WIN_ANSI_CHARS, winAnsiCode } from './fonts'
import { child } from './pdfObject'

export interface ResourceFont {
  ref: mupdf.PDFObject
  codes: Map<string, number>
  bytesPerCode: number
  width: ((code: number) => number) | null
}

function nameOf(obj: mupdf.PDFObject): string {
  return obj.isName() ? obj.asName() : ''
}

function numberOf(obj: mupdf.PDFObject, fallback: number): number {
  return obj.isNumber() ? obj.asNumber() : fallback
}

export function collectFontDicts(resources: mupdf.PDFObject, out: mupdf.PDFObject[] = [], visited = new Set<number>(), depth = 0): mupdf.PDFObject[] {
  if (!resources.isDictionary() || depth > 6) return out
  const fonts = resources.get('Font')
  if (fonts.isDictionary()) fonts.forEach((value) => out.push(value))
  const xobjects = resources.get('XObject')
  if (!xobjects.isDictionary()) return out
  xobjects.forEach((xobject) => {
    const num = xobject.isIndirect() ? xobject.asIndirect() : 0
    if (num > 0) {
      if (visited.has(num)) return
      visited.add(num)
    }
    if (nameOf(xobject.get('Subtype')) === 'Form') collectFontDicts(xobject.get('Resources'), out, visited, depth + 1)
  })
  return out
}

function hasProgram(font: mupdf.PDFObject): boolean {
  const descriptor = font.get('FontDescriptor')
  return descriptor.isDictionary() && ['FontFile', 'FontFile2', 'FontFile3'].some((key) => !descriptor.get(key).isNull())
}

function usesWinAnsi(font: mupdf.PDFObject): boolean {
  const encoding = font.get('Encoding')
  if (encoding.isName()) return encoding.asName() === 'WinAnsiEncoding'
  return encoding.isDictionary() && nameOf(encoding.get('BaseEncoding')) === 'WinAnsiEncoding' && encoding.get('Differences').isNull()
}

function cidToGid(font: mupdf.PDFObject): (cid: number) => number {
  const map = child(font, 'DescendantFonts', 0, 'CIDToGIDMap')
  if (!map.isStream()) return (cid) => cid
  const gids = map.readStream().asUint8Array()
  return (cid) => (2 * cid + 1 < gids.length ? (gids[2 * cid] << 8) | gids[2 * cid + 1] : 0)
}

function glyphPresence(font: mupdf.PDFObject): ((gid: number) => boolean) | null {
  const program = child(font, 'DescendantFonts', 0, 'FontDescriptor', 'FontFile2')
  return program.isStream() ? glyphOutlines(program.readStream().asUint8Array()) : null
}

function cidWidths(font: mupdf.PDFObject): (code: number) => number {
  const descendant = child(font, 'DescendantFonts', 0)
  const fallback = numberOf(child(descendant, 'DW'), 1000)
  const widths = child(descendant, 'W')
  const table = new Map<number, number>()
  let i = 0
  while (widths.isArray() && i + 1 < widths.length) {
    const first = widths.get(i).asNumber()
    const next = widths.get(i + 1)
    if (next.isArray()) {
      for (let k = 0; k < next.length; k++) table.set(first + k, next.get(k).asNumber())
      i += 2
    } else {
      const last = Math.min(next.asNumber(), first + 0xffff)
      const width = numberOf(widths.get(i + 2), fallback)
      for (let code = first; code <= last; code++) table.set(code, width)
      i += 3
    }
  }
  return (code) => table.get(code) ?? fallback
}

function simpleWidths(font: mupdf.PDFObject): ((code: number) => number) | null {
  const widths = font.get('Widths')
  if (!widths.isArray()) return null
  const first = numberOf(font.get('FirstChar'), 0)
  const fallback = numberOf(child(font, 'FontDescriptor', 'MissingWidth'), 0)
  return (code) => (code >= first && code - first < widths.length ? widths.get(code - first).asNumber() : fallback)
}

function resourceFont(ref: mupdf.PDFObject, seen: Set<string>): ResourceFont | null {
  if (!ref.isIndirect()) return null
  const font = ref.resolve()
  const toUnicode = font.get('ToUnicode')
  if (nameOf(font.get('Subtype')) === 'Type0') {
    if (nameOf(font.get('Encoding')) !== 'Identity-H' || !toUnicode.isStream()) return null
    const gid = cidToGid(font)
    const present = glyphPresence(font)
    const map = parseToUnicode(toUnicode.readStream().asString()).map
    const codes = invertToUnicode(map, (cid) => {
      const glyph = gid(cid)
      if (glyph === 0) return false
      const ch = map.get(cid) ?? ''
      return !present || !ch.trim() || seen.has(ch) || present(glyph)
    })
    return { ref, bytesPerCode: 2, codes, width: cidWidths(font) }
  }
  if (toUnicode.isStream()) {
    const parsed = parseToUnicode(toUnicode.readStream().asString())
    return parsed.bytesPerCode === 1 ? { ref, bytesPerCode: 1, codes: invertToUnicode(parsed.map), width: simpleWidths(font) } : null
  }
  if (!usesWinAnsi(font)) return null
  const codes = new Map<string, number>()
  for (const ch of hasProgram(font) ? seen : WIN_ANSI_CHARS) {
    const code = winAnsiCode(ch)
    if (code !== null) codes.set(ch, code)
  }
  return { ref, bytesPerCode: 1, codes, width: simpleWidths(font) }
}

export function resourceFontFor(candidates: mupdf.PDFObject[], name: string, seen: Set<string>): ResourceFont | null {
  const baseFont = (obj: mupdf.PDFObject): string => nameOf(obj.resolve().get('BaseFont'))
  const exact = candidates.filter((obj) => baseFont(obj) === name)
  const loose = exact.length > 0 ? exact : candidates.filter((obj) => stripSubsetTag(baseFont(obj)) === stripSubsetTag(name))
  for (const obj of loose) {
    const font = resourceFont(obj, seen)
    if (font && [...seen].every((ch) => font.codes.has(ch))) return font
  }
  return null
}
