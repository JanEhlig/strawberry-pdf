import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mupdf from 'mupdf'
import { describe, expect, it } from 'vitest'
import { Engine } from '@renderer/engine/core'
import { writeDocx } from '@renderer/engine/export/docx'
import { pageModel, type ExportImage, type ExportPage, type ExportParagraph, type ExportTable } from '@renderer/engine/export/model'
import { decimalMarkOf, parseCell } from '@renderer/engine/export/values'
import { writeXlsx } from '@renderer/engine/export/xlsx'
import { crc32, zip } from '@renderer/engine/export/zip'

function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, string>()
  const decoder = new TextDecoder()
  let offset = 0
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true)
    const nameLength = view.getUint16(offset + 26, true)
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength))
    const start = offset + 30 + nameLength
    files.set(name, decoder.decode(bytes.subarray(start, start + size)))
    offset = start + size
  }
  return files
}

const line = (text: string, bold = false): ExportParagraph['lines'][number] => ({
  text,
  bbox: [72, 100, 300, 112],
  font: { family: 'Calibri', generic: 'sans-serif', bold, italic: false, size: 11 },
  color: [0, 0, 0],
  spacing: 0
})
const para = (text: string, bold = false, y = 100): ExportParagraph => ({ kind: 'paragraph', bbox: [72, y, 300, y + 12], lines: [line(text, bold)], align: 'left' })

const statement: ExportPage = {
  width: 595,
  height: 842,
  blocks: [
    para('Kontoauszug November', true, 72),
    {
      kind: 'table',
      bbox: [72, 120, 400, 160],
      columns: [100, 140, 88],
      heights: [20, 20],
      rows: [
        [[para('Datum', true)], [para('Text', true)], [para('Betrag', true)]],
        [[para('01.11.2026')], [para('Miete')], [para('-850,00')]]
      ]
    } satisfies ExportTable
  ]
}

describe('ZIP', () => {
  it('berechnet die Prüfsumme nach Norm und liest sich wieder ein', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    const files = unzip(zip([
      { name: 'a.txt', data: 'Grüße' },
      { name: 'ordner/b.xml', data: '<x/>' }
    ]))
    expect([...files]).toEqual([
      ['a.txt', 'Grüße'],
      ['ordner/b.xml', '<x/>']
    ])
  })
})

describe('Zellwerte', () => {
  it('erkennt Beträge, Prozente, Daten und lässt Nummern als Text', () => {
    expect(parseCell('-850,00', ',')).toEqual({ kind: 'number', value: -850, decimals: 2, percent: false })
    expect(parseCell('2.150,00 €', ',')).toMatchObject({ value: 2150, decimals: 2 })
    expect(parseCell('1,234.56', '.')).toMatchObject({ value: 1234.56 })
    expect(parseCell('1 234,50', ',')).toMatchObject({ value: 1234.5 })
    expect(parseCell('(1.234,00)', ',')).toMatchObject({ value: -1234 })
    expect(parseCell('850,00-', ',')).toMatchObject({ value: -850 })
    expect(parseCell('12,5 %', ',')).toMatchObject({ value: 0.125, percent: true, decimals: 1 })
    expect(parseCell('01.11.2026', ',')).toEqual({ kind: 'date', serial: Date.UTC(2026, 10, 1) / 86_400_000 + 25569 })
    expect(parseCell('31.02.2026', ',').kind).toBe('text')
    expect(parseCell('0221 1234567', ',').kind).toBe('text')
    expect(parseCell('04109', ',').kind).toBe('text')
    expect(parseCell('DE89370400440532013000', ',').kind).toBe('text')
    expect(parseCell('Miete', ',').kind).toBe('text')
  })

  it('entscheidet das Dezimalzeichen nach den eindeutigen Werten', () => {
    expect(decimalMarkOf(['1.234,56', '-84,37', '12'], '.')).toBe(',')
    expect(decimalMarkOf(['1,234.56', '84.37'], ',')).toBe('.')
    expect(decimalMarkOf(['1.234', '12'], ',')).toBe(',')
  })
})

describe('Excel-Datei', () => {
  it('legt je Seite ein Blatt an, mit echten Zahlen und Daten', () => {
    const files = unzip(writeXlsx([statement], { sheetLabel: 'Seite', decimalMark: ',' }))
    expect(files.get('xl/workbook.xml')).toContain('name="Seite 1"')
    const sheet = files.get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('<v>-850</v>')
    expect(sheet).toContain(`<v>${Date.UTC(2026, 10, 1) / 86_400_000 + 25569}</v>`)
    expect(sheet).toContain('<t xml:space="preserve">Miete</t>')
    expect(sheet).toMatch(/<col min="1" max="1" width="19(\.\d+)?"/)
    const styles = files.get('xl/styles.xml') ?? ''
    expect(styles).toContain('numFmtId="4"')
    expect(styles).toContain('numFmtId="14"')
    expect(styles).toContain('<b/>')
  })
})

describe('Word-Datei', () => {
  it('schreibt Absätze mit Formatierung, Tabellen und Bilder', () => {
    const png = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 4, 4], false).asPNG().slice()
    const logo: ExportImage = { kind: 'image', bbox: [72, 200, 172, 260], data: png, format: 'png' }
    const page: ExportPage = { ...statement, blocks: [...statement.blocks, logo] }
    const files = unzip(writeDocx([page, page]))
    const document = files.get('word/document.xml') ?? ''
    expect(document).toContain('<w:b/>')
    expect(document).toContain('Kontoauszug November')
    expect(document.match(/<w:tbl>/g)).toHaveLength(2)
    expect(document.match(/<w:sectPr>/g)).toHaveLength(2)
    expect(document).toContain('<wp:extent cx="1270000" cy="762000"/>')
    expect(document.match(/<wp:docPr id="\d+"/g)).toEqual(['<wp:docPr id="1"', '<wp:docPr id="2"'])
    expect(document.match(/r:embed="rImage1"/g)).toHaveLength(2)
    expect([...files.keys()].filter((name) => name.startsWith('word/media/'))).toEqual(['word/media/image1.png'])
  })
})

describe('Dokumentmodell', () => {
  const sample = (): mupdf.PDFDocument => new mupdf.PDFDocument(new Uint8Array(readFileSync(join('tests', 'fixtures', 'sample.pdf'))))

  it('fügt Zeilen zu Absätzen zusammen und findet Bilder', () => {
    const model = pageModel(sample().loadPage(1) as mupdf.PDFPage)
    const paragraphs = model.blocks.filter((b): b is ExportParagraph => b.kind === 'paragraph')
    expect(paragraphs.map((p) => p.lines.map((l) => l.text).join('').trim())).toContain(
      'Die Vertragsparteien vereinbaren, dass die Wohnung ab dem 1. Januar übergeben wird.'
    )
    expect(model.blocks.some((b) => b.kind === 'image')).toBe(true)
    expect(paragraphs[0].lines[0].font.bold).toBe(true)
  })

  it('übernimmt Formularwerte und Anmerkungen', () => {
    const form = new mupdf.PDFDocument(new Uint8Array(readFileSync(join('tests', 'fixtures', 'form.pdf'))))
    const texts = (page: mupdf.PDFPage): string[] =>
      pageModel(page)
        .blocks.filter((b): b is ExportParagraph => b.kind === 'paragraph')
        .map((p) => p.lines.map((l) => l.text).join('').trim())
    expect(texts(form.loadPage(0) as mupdf.PDFPage)).toContain('Lesen Sport Musik')
    const page = sample().loadPage(0) as mupdf.PDFPage
    const note = page.createAnnotation('FreeText')
    note.setRect([72, 600, 320, 630])
    note.setDefaultAppearance('Helv', 12, [0, 0, 0])
    note.setContents('Geprüft am 13.11.2026')
    note.update()
    expect(texts(page)).toContain('Geprüft am 13.11.2026')
  })

  it('exportiert gescannte Seiten mit Texterkennung als Text statt als Bild', () => {
    const doc = new mupdf.PDFDocument()
    const scan = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 200, 280], false)
    scan.clear(230)
    const resources = doc.addObject({
      XObject: { Im0: doc.addImage(new mupdf.Image(scan)) },
      Font: { F1: doc.addSimpleFont(new mupdf.Font('Helvetica'), 'Latin') }
    })
    const content = 'q 595 0 0 842 0 0 cm /Im0 Do Q BT 3 Tr /F1 12 Tf 72 760 Td (Kontoauszug vom 01.11.2026) Tj 0 -16 Td (Miete November -850,00) Tj ET'
    doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, resources, content))
    const model = pageModel(doc.loadPage(0) as mupdf.PDFPage)
    expect(model.blocks.some((b) => b.kind === 'image')).toBe(false)
    const text = model.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.lines.map((l) => l.text.trim()) : []))
    expect(text).toEqual(['Kontoauszug vom 01.11.2026', 'Miete November -850,00'])
  })

  it('erkennt Tabellen mit Zeilen und Spalten', () => {
    const model = pageModel(sample().loadPage(2) as mupdf.PDFPage)
    const table = model.blocks.find((b): b is ExportTable => b.kind === 'table')
    const text = table?.rows.map((row) => row.map((cell) => cell.map((p) => p.lines.map((l) => l.text).join('').trim()).join(' ')))
    if (!text?.some((row) => row.join('|') === 'Kaltmiete|850,00 €')) throw new Error(JSON.stringify(text))
  })

  it('exportiert ein ganzes Dokument als Word und Excel', () => {
    const engine = new Engine()
    const result = engine.open(new Uint8Array(readFileSync(join('tests', 'fixtures', 'sample.pdf'))))
    if (result.status !== 'ok') throw new Error('expected ok')
    const docx = unzip(engine.exportDocument(result.info.docId, 'docx', { sheetLabel: 'Seite', decimalMark: ',' }))
    expect(docx.get('word/document.xml')).toContain('Mietvertrag Musterstraße 12')
    const xlsx = unzip(engine.exportDocument(result.info.docId, 'xlsx', { sheetLabel: 'Page', decimalMark: ',' }))
    expect(xlsx.get('xl/workbook.xml')).toContain('name="Page 6"')
  })
})
