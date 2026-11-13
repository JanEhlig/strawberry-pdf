import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mupdf from 'mupdf'
import { describe, expect, it } from 'vitest'
import { buildToUnicode, invertToUnicode, parseToUnicode } from '@renderer/engine/cmap'
import { Engine } from '@renderer/engine/core'
import type { FontProgram, TextLine } from '@renderer/engine/types'
import { glyphOutlines } from '@shared/sfnt'

const ARIAL = 'C:/Windows/Fonts/arial.ttf'
const hasArial = existsSync(ARIAL)
const arial = (): FontProgram[] => [{ name: 'Arial', data: new Uint8Array(readFileSync(ARIAL)), index: 0 }]

interface Placed {
  text: string
  font: string
  matrix: mupdf.Matrix
  color: number[]
}

function embeddedPdf(text: string, state: string, matrix: string): Uint8Array {
  const font = new mupdf.Font('Arial', readFileSync(ARIAL))
  const doc = new mupdf.PDFDocument()
  const ref = doc.addFont(font)
  const codes = [...text].map((c) => font.encodeCharacter(c).toString(16).padStart(4, '0')).join('')
  const resources = doc.addObject({ Font: { F1: ref } })
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, resources, `BT ${state} /F1 1 Tf ${matrix} Tm <${codes}> Tj ET`))
  doc.subsetFonts()
  const bytes = doc.saveToBuffer('garbage,compress').asUint8Array().slice()
  doc.destroy()
  return bytes
}

function placedGlyphs(bytes: Uint8Array): Placed[] {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  const out: Placed[] = []
  const device = new mupdf.Device({
    fillText(text, ctm, _cs, color) {
      text.walk({
        showGlyph(font, trm, _gid, unicode) {
          out.push({ text: String.fromCodePoint(unicode), font: font.getName(), matrix: mupdf.Matrix.concat(trm, ctm), color: [...color] })
        }
      })
    }
  })
  doc.loadPage(0).run(device, mupdf.Matrix.identity)
  device.close()
  doc.destroy()
  return out
}

function textOf(bytes: Uint8Array): string {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf')
  const text = doc.loadPage(0).toStructuredText('').asText().trim()
  doc.destroy()
  return text
}

function open(bytes: Uint8Array): { engine: Engine; docId: string; line: TextLine } {
  const engine = new Engine()
  const result = engine.open(bytes)
  if (result.status !== 'ok') throw new Error('expected ok')
  return { engine, docId: result.info.docId, line: engine.getTextLines(result.info.docId, 0)[0] }
}

describe('Text ändern in der Originalschrift', () => {
  it.skipIf(!hasArial)('nutzt die eingebettete Schrift, wenn sie alle Zeichen enthält', () => {
    const { engine, docId, line } = open(embeddedPdf('Rechnung 117', '0 g', '20 0 0 20 72 700'))
    expect(engine.planTextEdit(docId, 0, line, 'Rechnung 171').missing).toBe('')
    engine.replaceTextLine(docId, 0, line, 'Rechnung 171')
    const bytes = engine.save(docId)
    const placed = placedGlyphs(bytes)
    expect(textOf(bytes)).toBe('Rechnung 171')
    expect(new Set(placed.map((g) => g.font)).size).toBe(1)
    expect(placed[0].font).toMatch(/^[A-Z]{6}\+Arial$/)
    expect(placed[0].matrix[4]).toBeCloseTo(72, 2)
    expect(Math.hypot(placed[0].matrix[2], placed[0].matrix[3])).toBeCloseTo(20, 2)
  })

  it.skipIf(!hasArial)('holt nur fehlende Zeichen aus der Systemschrift', () => {
    const { engine, docId, line } = open(embeddedPdf('Rechnung 117', '0 g', '20 0 0 20 72 700'))
    expect(engine.planTextEdit(docId, 0, line, 'Rechnung 118').missing).toBe('8')
    engine.replaceTextLine(docId, 0, line, 'Rechnung 118', { fonts: arial() })
    const bytes = engine.save(docId)
    const placed = placedGlyphs(bytes)
    expect(textOf(bytes)).toBe('Rechnung 118')
    const original = placed[0].font
    expect(placed.filter((g) => g.font !== original).map((g) => g.text).join('')).toBe('8')
    expect(placed.find((g) => g.text === '8')?.font).toMatch(/^[A-Z]{6}\+Arial$/)
    expect(bytes.length).toBeLessThan(150_000)
  })

  it.skipIf(!hasArial)('erkennt beim zweiten Ändern, welche Zeichen die neu eingebettete Teilschrift wirklich hat', () => {
    const first = open(embeddedPdf('Rechnung 117', '0 g', '20 0 0 20 72 700'))
    first.engine.replaceTextLine(first.docId, 0, first.line, 'Rechnung 118', { fonts: arial() })
    const { engine, docId, line } = open(first.engine.save(first.docId))
    expect(line.text).toBe('Rechnung 118')
    expect(engine.planTextEdit(docId, 0, line, 'Rechnung 119').missing).toBe('9')
    engine.replaceTextLine(docId, 0, line, 'Rechnung 819', { fonts: arial() })
    expect(textOf(engine.save(docId))).toBe('Rechnung 819')
  })

  it.skipIf(!hasArial)('behält Sperrung und CMYK-Farbe', () => {
    const bytes = embeddedPdf('ABCD ABCD', '0 0.6 1 0 k 0.15 Tc', '20 0 0 20 72 700')
    const { engine, docId, line } = open(bytes)
    engine.replaceTextLine(docId, 0, line, 'ABCD ABCE', { fonts: arial() })
    const before = placedGlyphs(bytes)
    const saved = engine.save(docId)
    const after = placedGlyphs(saved)
    const letters = (glyphs: Placed[]): Placed[] => glyphs.filter((g) => g.text.trim())
    expect(letters(after).map((g) => g.text).join('')).toBe('ABCDABCE')
    const x = (glyphs: Placed[]): number[] => letters(glyphs).map((g) => g.matrix[4])
    x(after).forEach((value, i) => expect(value).toBeCloseTo(x(before)[i], 2))
    expect(after[0].color).toHaveLength(4)
    after[0].color.forEach((value, i) => expect(value).toBeCloseTo([0, 0.6, 1, 0][i], 4))
  })

  it.skipIf(!hasArial)('behält gedrehten Text exakt in Lage und Richtung', () => {
    const bytes = embeddedPdf('Hallo', '0 g', '0 20 -20 0 300 400')
    const { engine, docId, line } = open(bytes)
    engine.replaceTextLine(docId, 0, line, 'Hola')
    const before = placedGlyphs(bytes)[0].matrix
    const saved = engine.save(docId)
    const after = placedGlyphs(saved)
    expect(textOf(saved)).toBe('Hola')
    for (let i = 0; i < 6; i++) expect(after[0].matrix[i]).toBeCloseTo(before[i], 2)
  })

  it('setzt Zeichen außerhalb der Originalschrift mit der eingebauten Ersatzschrift', () => {
    const engine = new Engine()
    const result = engine.open(new Uint8Array(readFileSync(join('tests', 'fixtures', 'sample.pdf'))))
    if (result.status !== 'ok') throw new Error('expected ok')
    const { docId } = result.info
    const line = engine.getTextLines(docId, 0)[1]
    engine.replaceTextLine(docId, 0, line, 'Zażółć gęślą jaźń, Ωμέγα, Жизнь')
    const reopened = new Engine()
    const again = reopened.open(engine.save(docId))
    if (again.status !== 'ok') throw new Error('expected ok')
    expect(reopened.getTextLines(again.info.docId, 0).map((l) => l.text)).toContain('Zażółć gęślą jaźń, Ωμέγα, Жизнь')
  })
})

describe('Zeichentabellen', () => {
  it('liest ToUnicode-Einträge einzeln, als Bereich und als Liste', () => {
    const { bytesPerCode, map } = parseToUnicode(
      '1 begincodespacerange <0000> <FFFF> endcodespacerange\n' +
        '2 beginbfchar <0003> <0020> <0024> <00660069> endbfchar\n' +
        '2 beginbfrange <0010> <0012> <0041> <0020> <0021> [<00E4> <0142>] endbfrange'
    )
    expect(bytesPerCode).toBe(2)
    expect([map.get(3), map.get(0x24), map.get(0x10), map.get(0x12), map.get(0x20), map.get(0x21)]).toEqual([' ', 'fi', 'A', 'C', 'ä', 'ł'])
    const inverse = invertToUnicode(map)
    expect(inverse.get('fi')).toBeUndefined()
    expect(inverse.get('ł')).toBe(0x21)
  })

  it('schreibt Tabellen, die sich wieder einlesen lassen', () => {
    const entries = new Map([
      [5, '€'],
      [0x1234, 'ż']
    ])
    expect(parseToUnicode(buildToUnicode(entries)).map).toEqual(entries)
  })

  it.skipIf(!hasArial)('erkennt leere Glyphen in TrueType-Schriften', () => {
    const font = new mupdf.Font('Arial', readFileSync(ARIAL))
    const outlines = glyphOutlines(new Uint8Array(readFileSync(ARIAL)))
    expect(outlines?.(font.encodeCharacter('A'))).toBe(true)
    expect(outlines?.(font.encodeCharacter(' '))).toBe(false)
  })
})
