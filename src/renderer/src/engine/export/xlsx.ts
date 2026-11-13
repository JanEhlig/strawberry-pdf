import type { DecimalMark, ExportOptions } from '../types'
import type { ExportPage, ExportParagraph } from './model'
import { decimalMarkOf, parseCell, type CellValue } from './values'
import { escapeXml } from './xml'
import { zip, type ZipEntry } from './zip'

interface Cell {
  value: CellValue
  bold: boolean
}

interface Sheet {
  name: string
  rows: (Cell | null)[][]
  widths: number[]
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAIN_NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
const REL_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const PT_PER_CHAR = 5.25
const DATE_FORMAT = 14

class Styles {
  private formats = new Map<string, number>()
  private xfs: { numFmt: number; bold: boolean }[] = [{ numFmt: 0, bold: false }]

  index(value: CellValue, bold: boolean): number {
    const numFmt = this.numberFormat(value)
    const at = this.xfs.findIndex((xf) => xf.numFmt === numFmt && xf.bold === bold)
    if (at >= 0) return at
    this.xfs.push({ numFmt, bold })
    return this.xfs.length - 1
  }

  private numberFormat(value: CellValue): number {
    if (value.kind === 'date') return DATE_FORMAT
    if (value.kind !== 'number') return 0
    const { decimals, percent } = value
    if (percent) {
      if (decimals === 0) return 9
      if (decimals === 2) return 10
      return this.custom(`0.${'0'.repeat(decimals)}%`)
    }
    if (decimals === 0) return 3
    if (decimals === 2) return 4
    return this.custom(`#,##0.${'0'.repeat(decimals)}`)
  }

  private custom(code: string): number {
    let id = this.formats.get(code)
    if (id === undefined) {
      id = 164 + this.formats.size
      this.formats.set(code, id)
    }
    return id
  }

  xml(): string {
    const numFmts = [...this.formats].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(code)}"/>`).join('')
    const xfs = this.xfs
      .map(
        (xf) =>
          `<xf numFmtId="${xf.numFmt}" fontId="${xf.bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"` +
          `${xf.numFmt ? ' applyNumberFormat="1"' : ''}${xf.bold ? ' applyFont="1"' : ''}/>`
      )
      .join('')
    return (
      XML_HEAD +
      `<styleSheet ${MAIN_NS}>` +
      (this.formats.size ? `<numFmts count="${this.formats.size}">${numFmts}</numFmts>` : '') +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${xfs}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    )
  }
}

function paragraphText(paragraphs: ExportParagraph[]): string {
  return paragraphs
    .map((p) => p.lines.map((l) => l.text).join('').trim())
    .filter(Boolean)
    .join(' ')
}

function isBold(paragraphs: ExportParagraph[]): boolean {
  return paragraphs[0]?.lines[0]?.font.bold ?? false
}

function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

function sheetName(label: string, index: number, used: Set<string>): string {
  const base = `${label} ${index + 1}`.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31).trim() || `${index + 1}`
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`
  used.add(name.toLowerCase())
  return name
}

function buildSheet(page: ExportPage, name: string, fallback: DecimalMark): Sheet {
  const texts: string[] = []
  for (const block of page.blocks) {
    if (block.kind === 'table') for (const row of block.rows) for (const cell of row) texts.push(paragraphText(cell))
  }
  const mark = decimalMarkOf(texts, fallback)
  const rows: (Cell | null)[][] = []
  const widths: number[] = []
  const cell = (paragraphs: ExportParagraph[]): Cell | null => {
    const text = paragraphText(paragraphs)
    return text ? { value: parseCell(text, mark), bold: isBold(paragraphs) } : null
  }
  let previous: 'paragraph' | 'table' | null = null
  for (const block of page.blocks) {
    if (block.kind === 'image') continue
    if (previous && (block.kind === 'table' || previous === 'table')) rows.push([])
    if (block.kind === 'paragraph') {
      const text = paragraphText([block])
      rows.push([{ value: { kind: 'text', text }, bold: isBold([block]) }])
    } else {
      block.columns.forEach((w, i) => {
        widths[i] = Math.max(widths[i] ?? 0, Math.min(80, Math.max(4, Math.round((w / PT_PER_CHAR) * 10) / 10)))
      })
      for (const row of block.rows) rows.push(row.map(cell))
    }
    previous = block.kind
  }
  return { name, rows, widths }
}

function cellXml(cell: Cell, ref: string, styles: Styles): string {
  const s = styles.index(cell.value, cell.bold)
  const style = s ? ` s="${s}"` : ''
  if (cell.value.kind === 'text') return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(cell.value.text)}</t></is></c>`
  const value = cell.value.kind === 'date' ? cell.value.serial : cell.value.value
  return `<c r="${ref}"${style}><v>${value}</v></c>`
}

function sheetXml(sheet: Sheet, styles: Styles): string {
  const cols = sheet.widths.length
    ? `<cols>${sheet.widths.map((w, i) => (w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : '')).join('')}</cols>`
    : ''
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((c, i) => (c ? cellXml(c, `${columnName(i)}${r + 1}`, styles) : '')).join('')
      return cells ? `<row r="${r + 1}">${cells}</row>` : ''
    })
    .join('')
  return `${XML_HEAD}<worksheet ${MAIN_NS} ${REL_NS}>${cols}<sheetData>${rows}</sheetData></worksheet>`
}

export function writeXlsx(pages: ExportPage[], options: ExportOptions): Uint8Array<ArrayBuffer> {
  const used = new Set<string>()
  const sheets = (pages.length ? pages : [{ width: 0, height: 0, blocks: [] }]).map((page, i) =>
    buildSheet(page, sheetName(options.sheetLabel, i, used), options.decimalMark)
  )
  const styles = new Styles()
  const sheetFiles = sheets.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet, styles) }))
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data:
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join('') +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data:
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rWorkbook" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      data:
        `${XML_HEAD}<workbook ${MAIN_NS} ${REL_NS}><sheets>` +
        sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rSheet${i + 1}"/>`).join('') +
        '</sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map((_, i) => `<Relationship Id="rSheet${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join('') +
        '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>'
    },
    ...sheetFiles,
    { name: 'xl/styles.xml', data: styles.xml() }
  ]
  return zip(entries)
}
