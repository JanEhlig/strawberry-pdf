import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as mupdf from 'mupdf'
import { describe, expect, it } from 'vitest'
import { Engine } from '@renderer/engine/core'
import type { PrintRenderOptions } from '@renderer/engine/types'
import { paperSize, parsePageRange, placePage, planPrint, resolvePrinter, selectPages } from '@renderer/state/printPlan'
import { parseDefaultPrinter, printHtml, printOptions, sanitizePrintSettings } from '../../src/main/printJob'

const A4 = { width: 595, height: 842 }
const WIDE = { width: 842, height: 595 }

describe('Seitenauswahl', () => {
  it('liest Bereiche wie in Word und Acrobat', () => {
    expect(parsePageRange('1-3, 5', 8)).toEqual([0, 1, 2, 4])
    expect(parsePageRange('6-', 8)).toEqual([5, 6, 7])
    expect(parsePageRange('-2;7', 8)).toEqual([0, 1, 6])
    expect(parsePageRange('3, 1-2, 3', 8)).toEqual([0, 1, 2])
    expect(parsePageRange('2 - 4', 8)).toEqual([1, 2, 3])
    expect(parsePageRange('0', 8)).toBeNull()
    expect(parsePageRange('5-3', 8)).toBeNull()
    expect(parsePageRange('9', 8)).toBeNull()
    expect(parsePageRange('a', 8)).toBeNull()
    expect(parsePageRange(' , ', 8)).toBeNull()
  })

  it('wählt alle Seiten, die aktuelle oder einen Bereich', () => {
    expect(selectPages('all', '', 3, 1)).toEqual([0, 1, 2])
    expect(selectPages('current', '', 3, 1)).toEqual([1])
    expect(selectPages('range', '2-3', 3, 0)).toEqual([1, 2])
    expect(selectPages('range', '', 3, 0)).toBeNull()
  })
})

describe('Ausrichtung', () => {
  it('dreht bei Automatisch die Seiten, die nicht zur Mehrheit passen', () => {
    const sizes = [A4, WIDE, A4]
    expect(planPrint(sizes, [0, 1, 2], 'auto')).toEqual({
      landscape: false,
      pages: [
        { index: 0, turn: false },
        { index: 1, turn: true },
        { index: 2, turn: false }
      ]
    })
    expect(planPrint(sizes, [1], 'auto')).toEqual({ landscape: true, pages: [{ index: 1, turn: false }] })
    expect(planPrint(sizes, [0, 1], 'landscape')).toEqual({
      landscape: true,
      pages: [
        { index: 0, turn: false },
        { index: 1, turn: false }
      ]
    })
  })
})

describe('Papier und Vorschau', () => {
  it('nimmt beim Druckerstandard das übliche Papier der Region', () => {
    expect(paperSize('printer', 'de', false)).toEqual(A4)
    expect(paperSize('printer', 'en-GB', false)).toEqual(A4)
    expect(paperSize('printer', 'en-US', false)).toEqual({ width: 612, height: 792 })
    expect(paperSize('A5', 'de', true)).toEqual({ width: 595, height: 420 })
  })

  it('legt Seiten angepasst, in Originalgröße oder nur verkleinert aufs Blatt', () => {
    const a5 = { width: 420, height: 595 }
    expect(placePage(a5, A4, 'actual')).toEqual({ x: 87.5, y: 123.5, width: 420, height: 595 })
    expect(placePage(a5, A4, 'shrink')).toEqual(placePage(a5, A4, 'actual'))
    expect(placePage(a5, A4, 'fit')).toMatchObject({ x: 12, width: 571 })
    expect(placePage({ width: 842, height: 1191 }, A4, 'shrink').width).toBeCloseTo(571)
  })

  it('nimmt den gemerkten Drucker, sonst den Standarddrucker', () => {
    const printers = [
      { name: 'Büro', displayName: 'Büro', isDefault: false },
      { name: 'Flur', displayName: 'Flur', isDefault: true }
    ]
    expect(resolvePrinter(printers, 'Büro')?.name).toBe('Büro')
    expect(resolvePrinter(printers, 'Alter Drucker')?.name).toBe('Flur')
    expect(resolvePrinter([], 'Büro')).toBeNull()
  })
})

describe('Druckauftrag', () => {
  it('liest den Standarddrucker aus der Registry', () => {
    const output = `
HKEY_CURRENT_USER    Windows
    Device    REG_SZ    Brother DCP-L3520CDW series,winspool,Ne03:
`
    expect(parseDefaultPrinter(output)).toBe('Brother DCP-L3520CDW series')
    expect(parseDefaultPrinter('FEHLER')).toBeNull()
  })

  it('übersetzt die Einstellungen in Druckoptionen und prüft die Eingaben', () => {
    const settings = sanitizePrintSettings({
      printer: 'Büro',
      copies: 2.4,
      collate: true,
      paper: 'A4',
      landscape: false,
      duplex: 'longEdge',
      color: false,
      scaling: 'fit'
    })
    expect(printOptions(settings)).toEqual({
      silent: true,
      printBackground: true,
      deviceName: 'Büro',
      copies: 2,
      collate: true,
      landscape: false,
      color: false,
      margins: { marginType: 'printableArea' },
      duplexMode: 'longEdge',
      pageSize: 'A4'
    })
    const odd = sanitizePrintSettings({ printer: 3, copies: 5000, paper: 'Folio', duplex: 'both', scaling: 'zoom' })
    expect(odd).toEqual({ printer: '', copies: 999, collate: true, paper: 'printer', landscape: false, duplex: 'printer', color: true, scaling: 'fit' })
    const actual = printOptions({ ...odd!, scaling: 'actual' })
    expect(actual).toMatchObject({ usePrinterDefaultPageSize: true, margins: { marginType: 'none' } })
    expect(actual).not.toHaveProperty('deviceName')
    expect(actual).not.toHaveProperty('duplexMode')
    expect(printOptions(undefined)).toEqual({ silent: false, printBackground: true, margins: { marginType: 'printableArea' } })
    expect(sanitizePrintSettings(null)).toBeUndefined()
  })

  it('legt jede Seite auf ein eigenes Blatt', () => {
    const html = printHtml(['seite-1.jpg', 'seite-2.jpg'], [A4, WIDE], 'Vertrag <1>', 'actual')
    expect(html.match(/class="sheet"/g)).toHaveLength(2)
    expect(html).toContain('<body class="actual">')
    expect(html).toContain('--w: 842pt; --h: 595pt')
    expect(html).toContain('<title>Vertrag &lt;1&gt;</title>')
  })
})

describe('Druckbild', () => {
  function prepared(): { engine: Engine; docId: string; field: mupdf.Rect } {
    const doc = new mupdf.PDFDocument(new Uint8Array(readFileSync(join('tests', 'fixtures', 'form.pdf'))))
    const page = doc.loadPage(0) as mupdf.PDFPage
    const square = page.createAnnotation('Square')
    square.setRect([300, 40, 500, 120])
    square.setColor([1, 0, 0])
    square.setInteriorColor([1, 0, 0])
    square.update()
    const widget = page.getWidgets().find((w) => w.getName() === 'name')!
    widget.setTextValue('Max Mustermann')
    widget.update()
    const engine = new Engine()
    const result = engine.open(doc.saveToBuffer('').asUint8Array().slice())
    if (result.status !== 'ok') throw new Error('expected ok')
    return { engine, docId: result.info.docId, field: widget.getRect() }
  }

  const render = (engine: Engine, docId: string, options: Partial<PrintRenderOptions>): mupdf.Pixmap =>
    new mupdf.Image(engine.renderForPrint(docId, 0, { dpi: 72, gray: false, markups: true, turn: false, ...options })).toPixmap()

  const value = (pix: mupdf.Pixmap, x: number, y: number): number[] => {
    const n = pix.getNumberOfComponents()
    const at = Math.round(y) * pix.getStride() + Math.round(x) * n
    return Array.from(pix.getPixels().slice(at, at + n))
  }

  const darkPixels = (pix: mupdf.Pixmap, [x0, y0, x1, y1]: mupdf.Rect): number => {
    let count = 0
    for (let y = Math.ceil(y0) + 2; y < y1 - 2; y++) for (let x = Math.ceil(x0) + 2; x < x1 - 2; x++) if (value(pix, x, y)[0] < 100) count++
    return count
  }

  it('druckt Anmerkungen nur auf Wunsch, Formularinhalte immer', () => {
    const { engine, docId, field } = prepared()
    const full = render(engine, docId, {})
    const [r, g, b] = value(full, 400, 80)
    expect(r).toBeGreaterThan(200)
    expect(g + b).toBeLessThan(120)
    const plain = render(engine, docId, { markups: false })
    expect(value(plain, 400, 80).every((v) => v > 230)).toBe(true)
    expect(darkPixels(plain, field)).toBeGreaterThan(20)
    expect(darkPixels(plain, field)).toBe(darkPixels(full, field))
  })

  it('rendert in Graustufen und dreht quer', () => {
    const { engine, docId } = prepared()
    const gray = render(engine, docId, { gray: true })
    expect(gray.getNumberOfComponents()).toBe(1)
    const turned = render(engine, docId, { turn: true })
    expect([turned.getWidth(), turned.getHeight()]).toEqual([842, 595])
    const [r, g, b] = value(turned, 80, 595 - 400)
    expect(r).toBeGreaterThan(200)
    expect(g + b).toBeLessThan(120)
  })
})
