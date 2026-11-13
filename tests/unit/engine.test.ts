import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import zlib from 'node:zlib'
import * as mupdf from 'mupdf'
import { describe, expect, it } from 'vitest'
import { Engine, EngineError } from '@renderer/engine/core'
import type { AnnotData, DocInfo, Quad, Rect } from '@renderer/engine/types'

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join('tests', 'fixtures', name)))

function openOk(engine: Engine, name: string | Uint8Array): DocInfo {
  const result = engine.open(typeof name === 'string' ? fixture(name) : name)
  if (result.status !== 'ok') throw new Error('expected ok')
  return result.info
}

function pixelAt(img: { width: number; pixels: Uint8ClampedArray }, x: number, y: number): number[] {
  const o = (Math.round(y) * img.width + Math.round(x)) * 4
  return Array.from(img.pixels.slice(o, o + 4))
}

function orphanPages(bytes: Uint8Array): number {
  const doc = new mupdf.PDFDocument(bytes)
  const inTree = new Set<number>()
  for (let i = 0; i < doc.countPages(); i++) inTree.add(doc.findPage(i).asIndirect())
  let orphans = 0
  for (let i = 1; i < doc.countObjects(); i++) {
    const obj = doc.newIndirect(i).resolve()
    if (obj.isDictionary() && obj.get('Type').isName() && obj.get('Type').asName() === 'Page' && !inTree.has(i)) orphans++
  }
  doc.destroy()
  return orphans
}

function buildPdf(objects: Record<number, string>): Uint8Array {
  const nums = Object.keys(objects).map(Number).sort((a, b) => a - b)
  let out = '%PDF-1.7\n'
  const offsets: Record<number, number> = {}
  for (const n of nums) {
    offsets[n] = out.length
    const stream = /^STREAM:(.*)$/s.exec(objects[n])
    const body = stream ? `<< /Length ${stream[1].length} >>\nstream\n${stream[1]}\nendstream` : objects[n]
    out += `${n} 0 obj\n${body}\nendobj\n`
  }
  const max = Math.max(...nums)
  const xref = out.length
  out += `xref\n0 ${max + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= max; i++) out += offsets[i] === undefined ? '0000000000 65535 f \n' : `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array(Buffer.from(out, 'latin1'))
}

function catalogKeys(bytes: Uint8Array): string[] {
  const doc = new mupdf.PDFDocument(bytes)
  const keys: string[] = []
  doc.getTrailer().get('Root').forEach((_, key) => keys.push(String(key)))
  doc.destroy()
  return keys
}

const richPdf = (): Uint8Array =>
  buildPdf({
    1: '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [20 0 R 21 0 R] >> /Names << /EmbeddedFiles << /Names [(daten.xml) 30 0 R] >> >> /PageLabels << /Nums [0 << /S /r >> 2 << /S /D >>] >> /Lang (de-DE) >>',
    2: '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 /MediaBox [0 0 300 300] >>',
    3: '<< /Type /Page /Parent 2 0 R /Contents 10 0 R /Annots [20 0 R] >>',
    4: '<< /Type /Page /Parent 2 0 R /Contents 11 0 R >>',
    5: '<< /Type /Page /Parent 2 0 R /Contents 12 0 R /Annots [21 0 R] >>',
    10: 'STREAM:BT /F1 12 Tf ET',
    11: 'STREAM:BT /F1 12 Tf ET',
    12: 'STREAM:BT /F1 12 Tf ET',
    20: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (vorne) /V (A) /Rect [10 10 100 30] /P 3 0 R >>',
    21: '<< /Type /Annot /Subtype /Widget /FT /Tx /T (hinten) /V (geheim) /Rect [10 10 100 30] /P 5 0 R >>',
    30: '<< /Type /Filespec /F (daten.xml) /EF << /F 31 0 R >> >>',
    31: 'STREAM:<rechnung/>'
  })

function decompressed(bytes: Uint8Array): string {
  const doc = new mupdf.PDFDocument(bytes)
  const out = doc.saveToBuffer('decompress').asUint8Array().slice()
  doc.destroy()
  return Buffer.from(out).toString('latin1')
}

describe('Öffnen & Info', () => {
  it('liest Seitenzahl, Größen, Rotation, Outline und Metadaten', () => {
    const info = openOk(new Engine(), 'sample.pdf')
    expect(info.pages).toHaveLength(6)
    expect(info.pages[0]).toMatchObject({ width: 595, height: 842, rotation: 0 })
    expect(info.pages[2]).toMatchObject({ width: 842, height: 595, rotation: 0 })
    expect(info.pages[3]).toMatchObject({ width: 842, height: 595, rotation: 90 })
    expect(info.outline.map((o) => o.title)).toEqual(['Mietvertrag', 'Grundriss', 'Kosten', 'Vertrauliches', 'Unterschriften'])
    expect(info.outline[3].page).toBe(4)
    expect(info.metadata.title).toBe('Mietvertrag Musterstraße 12')
    expect(info.hasForms).toBe(false)
  })

  it('fragt nach dem Passwort und akzeptiert nur das richtige', () => {
    const engine = new Engine()
    const first = engine.open(fixture('protected.pdf'))
    expect(first.status).toBe('needs-password')
    if (first.status !== 'needs-password') return
    const wrong = engine.authenticate(first.docId, 'falsch')
    expect(wrong).toMatchObject({ status: 'needs-password', retry: true })
    const right = engine.authenticate(first.docId, 'geheim')
    expect(right.status).toBe('ok')
    if (right.status === 'ok') expect(right.info.pages).toHaveLength(6)
  })

  it('öffnet und speichert eine beschädigte Datei', () => {
    const engine = new Engine()
    const info = openOk(engine, 'broken.pdf')
    expect(info.wasRepaired).toBe(true)
    expect(info.pages).toHaveLength(6)
    const saved = engine.save(info.docId)
    expect(openOk(new Engine(), saved).pages).toHaveLength(6)
  })

  it('lehnt Nicht-PDF-Daten ab', () => {
    expect(() => new Engine().open(new TextEncoder().encode('kein pdf'))).toThrow(EngineError)
  })

  it('erkennt Formulare', () => {
    expect(openOk(new Engine(), 'form.pdf').hasForms).toBe(true)
  })
})

describe('Rendern & Text', () => {
  it('rendert mit weißem Hintergrund in der richtigen Größe', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const img = engine.renderPage(docId, 0, 1)
    expect([img.width, img.height]).toEqual([595, 842])
    expect(pixelAt(img, 5, 5)).toEqual([255, 255, 255, 255])
  })

  it('rendert einen Ausschnitt', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const img = engine.renderPage(docId, 0, 2, [100, 100, 200, 150])
    expect([img.x, img.y, img.width, img.height]).toEqual([100, 100, 100, 50])
  })

  it('findet Text mit Umlauten', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const hits = engine.search(docId, 'Grüße', 0, 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].page).toBe(0)
  })

  it('liefert Textzeilen und kopiert eine Auswahl', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const lines = engine.getTextLines(docId, 0)
    expect(lines[0].text).toBe('Mietvertrag Musterstraße 12')
    expect(lines[0].size).toBeCloseTo(22, 0)
    const [x0, y0, x1, y1] = lines[0].bbox
    const sel = engine.selectText(docId, 0, [x0 + 1, (y0 + y1) / 2], [x1 - 1, (y0 + y1) / 2], 'chars')
    expect(sel.text).toContain('Mietvertrag')
    expect(sel.quads.length).toBeGreaterThan(0)
  })

  it('wählt per Wort-Modus genau ein Wort', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const [x0, y0, , y1] = engine.getTextLines(docId, 0)[0].bbox
    const p: [number, number] = [x0 + 20, (y0 + y1) / 2]
    expect(engine.selectText(docId, 0, p, p, 'words').text.trim()).toBe('Mietvertrag')
  })

  it('liefert interne und externe Links', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    expect(engine.getLinks(docId, 1).some((l) => l.page === 4)).toBe(true)
    expect(engine.getLinks(docId, 0).some((l) => l.uri === 'https://example.org/mietrecht')).toBe(true)
  })
})

describe('Anmerkungen', () => {
  const quadsOfFirstLine = (engine: Engine, docId: string): Quad[] => {
    const [x0, y0, x1, y1] = engine.getTextLines(docId, 0)[1].bbox
    return engine.selectText(docId, 0, [x0 + 1, (y0 + y1) / 2], [x1 - 1, (y0 + y1) / 2], 'chars').quads
  }

  it('legt alle Arten an und sie überleben Speichern und Neuladen', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const quads = quadsOfFirstLine(engine, docId)
    const png = (() => {
      const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 40, 20], true)
      pix.clear(0)
      const bytes = pix.asPNG().slice()
      pix.destroy()
      return bytes
    })()
    const add = (spec: Parameters<Engine['createAnnotation']>[2]): AnnotData =>
      engine.createAnnotation(docId, 0, spec, 'Jan').annot
    add({ kind: 'highlight', quads, color: [1, 0.85, 0.2] })
    add({ kind: 'underline', quads, color: [0, 0, 1] })
    add({ kind: 'strikeout', quads, color: [1, 0, 0] })
    add({ kind: 'freetext', rect: [72, 400, 300, 430], text: 'Grüße – äöü €', font: 'Helv', size: 14, color: [0, 0, 0.6] })
    add({ kind: 'ink', paths: [[[100, 500], [150, 520], [200, 500]]], color: [1, 0, 0], width: 2 })
    add({ kind: 'square', rect: [100, 600, 200, 650], color: [0, 0.5, 0], fill: null, width: 2 })
    add({ kind: 'circle', rect: [250, 600, 350, 650], color: [0.5, 0, 0.5], fill: [1, 1, 0.8], width: 1 })
    add({ kind: 'line', a: [100, 700], b: [300, 720], color: [0, 0, 0], width: 2, arrow: true })
    add({ kind: 'note', point: [500, 100], contents: 'Bitte prüfen', color: [1, 0.85, 0.2] })
    add({ kind: 'stamp', rect: [350, 740, 470, 800], png, role: 'signature' })

    const saved = engine.save(docId)
    const reopened = new Engine()
    const info = openOk(reopened, saved)
    const annots = reopened.getAnnotations(info.docId, 0)
    expect(annots.map((a) => a.kind)).toEqual([
      'highlight', 'underline', 'strikeout', 'freetext', 'ink', 'square', 'circle', 'line', 'note', 'stamp'
    ])
    expect(annots.find((a) => a.kind === 'freetext')?.contents).toBe('Grüße – äöü €')
    expect(annots.find((a) => a.kind === 'freetext')?.font).toMatchObject({ name: 'Helv', size: 14 })
    expect(annots.find((a) => a.kind === 'stamp')?.role).toBe('signature')
    expect(annots.find((a) => a.kind === 'note')?.contents).toBe('Bitte prüfen')
    expect(annots.find((a) => a.kind === 'line')?.lineEnding?.end).toBe('OpenArrow')
    expect(annots.every((a) => a.author === 'Jan')).toBe(true)
  })

  it('ändert Farbe, Deckkraft, Kommentar und Schrift', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const sq = engine.createAnnotation(docId, 0, { kind: 'square', rect: [100, 100, 200, 200], color: [0, 0, 0], fill: null, width: 1 }, '').annot
    const updated = engine.updateAnnotation(docId, 0, sq.id, { color: [1, 0, 0], opacity: 0.5, contents: 'Hinweis', borderWidth: 4 }).annot
    expect(updated.color).toEqual([1, 0, 0])
    expect(updated.opacity).toBeCloseTo(0.5)
    expect(updated.contents).toBe('Hinweis')
    expect(updated.borderWidth).toBe(4)
    const ft = engine.createAnnotation(docId, 0, { kind: 'freetext', rect: [72, 300, 300, 330], text: 'A', font: 'Helv', size: 12, color: [0, 0, 0] }, '').annot
    const ft2 = engine.updateAnnotation(docId, 0, ft.id, { font: { size: 20, name: 'TiRo' }, color: [0, 0, 1] }).annot
    expect(ft2.font).toMatchObject({ name: 'TiRo', size: 20, color: [0, 0, 1] })
  })

  it('verschiebt und skaliert Geometrie', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const ink = engine.createAnnotation(docId, 0, { kind: 'ink', paths: [[[100, 100], [200, 200]]], color: [0, 0, 0], width: 1 }, '').annot
    const moved = engine.transformAnnotation(docId, 0, ink.id, [100, 100, 200, 200], [150, 150, 350, 350]).annot
    expect(moved.ink?.[0][0][0]).toBeCloseTo(150)
    expect(moved.ink?.[0][1][0]).toBeCloseTo(350)
    const sq = engine.createAnnotation(docId, 0, { kind: 'square', rect: [100, 100, 200, 200], color: [0, 0, 0], fill: null, width: 0 }, '').annot
    const sq2 = engine.transformAnnotation(docId, 0, sq.id, [100, 100, 200, 200], [110, 120, 210, 220]).annot
    expect(Math.abs(sq2.bounds[0] - 110)).toBeLessThanOrEqual(1)
    expect(Math.abs(sq2.bounds[1] - 120)).toBeLessThanOrEqual(1)
  })

  it('löscht eine Anmerkung, Undo stellt sie wieder her', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const a = engine.createAnnotation(docId, 0, { kind: 'note', point: [100, 100], contents: 'x', color: [1, 1, 0] }, '').annot
    engine.deleteAnnotation(docId, 0, a.id)
    expect(engine.getAnnotations(docId, 0)).toHaveLength(0)
    engine.undo(docId)
    expect(engine.getAnnotations(docId, 0).map((x) => x.id)).toEqual([a.id])
  })

  it('verfolgt den Ungespeichert-Status über Speichern, Undo und Redo', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    expect(engine.history(docId).dirty).toBe(false)
    const spec = { kind: 'note' as const, point: [100, 100] as [number, number], contents: '', color: [1, 1, 0] as [number, number, number] }
    expect(engine.createAnnotation(docId, 0, spec, '').history.dirty).toBe(true)
    engine.save(docId)
    expect(engine.markSaved(docId).dirty).toBe(false)
    expect(engine.undo(docId).history.dirty).toBe(true)
    expect(engine.redo(docId).history.dirty).toBe(false)
    engine.undo(docId)
    const branched = engine.createAnnotation(docId, 0, { ...spec, point: [300, 300] }, '')
    expect(branched.history.dirty).toBe(true)
  })

  it('Undo funktioniert auch nach dem Speichern', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.createAnnotation(docId, 0, { kind: 'square', rect: [10, 10, 50, 50], color: [0, 0, 0], fill: null, width: 1 }, '')
    engine.save(docId)
    engine.undo(docId)
    expect(engine.getAnnotations(docId, 0)).toHaveLength(0)
    expect(engine.history(docId).undoLabel).toBeNull()
  })

  it('blendet beim Bearbeiten aus, ohne Undo-Schritt', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const a = engine.createAnnotation(docId, 0, { kind: 'square', rect: [100, 100, 200, 200], color: [1, 0, 0], fill: [1, 0, 0], width: 1 }, '').annot
    const before = engine.history(docId)
    expect(pixelAt(engine.renderPage(docId, 0, 1), 150, 150)).toEqual([255, 0, 0, 255])
    engine.setAnnotationHidden(docId, 0, a.id, true)
    expect(pixelAt(engine.renderPage(docId, 0, 1), 150, 150)).toEqual([255, 255, 255, 255])
    expect(engine.history(docId)).toEqual(before)
    engine.setAnnotationHidden(docId, 0, a.id, false)
    expect(pixelAt(engine.renderPage(docId, 0, 1), 150, 150)).toEqual([255, 0, 0, 255])
  })

  it('platziert Anmerkungen auf gedrehten Seiten im Seitenraum', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const target: Rect = [100, 100, 200, 160]
    const a = engine.createAnnotation(docId, 3, { kind: 'square', rect: target, color: [1, 0, 0], fill: [1, 0, 0], width: 0 }, '').annot
    expect(Math.abs(a.bounds[0] - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.bounds[1] - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.bounds[2] - 200)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.bounds[3] - 160)).toBeLessThanOrEqual(1)
    const img = engine.renderPage(docId, 3, 1)
    expect([img.width, img.height]).toEqual([842, 595])
    expect(pixelAt(img, 150, 130)).toEqual([255, 0, 0, 255])
  })

  it('rendert eine einzelne Anmerkung transparent', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const a = engine.createAnnotation(docId, 0, { kind: 'square', rect: [100, 100, 200, 200], color: [0, 0, 1], fill: null, width: 4 }, '').annot
    const ghost = engine.renderAnnotation(docId, 0, a.id, 1)
    expect(ghost.width).toBeGreaterThan(90)
    expect(ghost.x).toBeLessThanOrEqual(100)
    expect(pixelAt(ghost, 150 - ghost.x, 150 - ghost.y)[3]).toBe(0)
  })
})

describe('Formulare', () => {
  it('listet Felder mit Typen', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'form.pdf')
    const fields = engine.getFields(docId, 0)
    const byName = (n: string) => fields.filter((f) => f.name === n)
    expect(byName('name')[0].type).toBe('text')
    expect(byName('bemerkung')[0].multiline).toBe(true)
    expect(byName('zustimmung')[0].type).toBe('checkbox')
    expect(byName('zahlung')).toHaveLength(2)
    expect(byName('zahlung')[0].type).toBe('radio')
    expect(byName('land')[0]).toMatchObject({ type: 'combobox', options: ['Deutschland', 'Österreich', 'Schweiz'] })
    expect(byName('interessen')[0].type).toBe('listbox')
    expect(byName('unterschrift')[0]).toMatchObject({ type: 'signature', signed: false })
  })

  it('setzt Werte, die nach dem Speichern erhalten bleiben', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'form.pdf')
    const fields = engine.getFields(docId, 0)
    const id = (n: string, i = 0) => fields.filter((f) => f.name === n)[i].id
    engine.setFieldValue(docId, 0, id('name'), 'Jan Müller')
    engine.setFieldValue(docId, 0, id('zustimmung'), true)
    engine.setFieldValue(docId, 0, id('zahlung', 1), true)
    const after = engine.setFieldValue(docId, 0, id('land'), 'Österreich').fields
    expect(after.find((f) => f.name === 'name')?.value).toBe('Jan Müller')
    expect(after.find((f) => f.name === 'zustimmung')?.checked).toBe(true)
    expect(after.filter((f) => f.name === 'zahlung').map((f) => f.checked)).toEqual([false, true])

    const reopened = new Engine()
    const info = openOk(reopened, engine.save(docId))
    const saved = reopened.getFields(info.docId, 0)
    expect(saved.find((f) => f.name === 'name')?.value).toBe('Jan Müller')
    expect(saved.find((f) => f.name === 'zustimmung')?.checked).toBe(true)
    expect(saved.find((f) => f.name === 'land')?.value).toBe('Österreich')
    expect(saved.filter((f) => f.name === 'zahlung').map((f) => f.checked)).toEqual([false, true])
  })
})

describe('Schwärzen', () => {
  it('entfernt Text aus Speicher und gespeicherter Datei; Undo stellt ihn im Speicher wieder her', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const hits = engine.search(docId, 'GEHEIM', 4, 4)
    expect(hits).toHaveLength(1)
    engine.createAnnotation(docId, 4, { kind: 'redact', quads: hits[0].quads }, '')
    expect(engine.pagesWithRedactions(docId)).toEqual([4])
    const result = engine.applyRedactions(docId, 'black')
    expect(result.pages).toEqual([4])
    expect(engine.search(docId, 'GEHEIM', 4, 4)).toHaveLength(0)
    expect(engine.pagesWithRedactions(docId)).toEqual([])
    const text = decompressed(engine.save(docId))
    expect(text).not.toContain('GEHEIM')
    expect(text).toContain('Telefon')
    engine.undo(docId)
    expect(engine.search(docId, 'GEHEIM', 4, 4)).toHaveLength(1)
  })

  it('weiße Füllung hinterlässt keinen schwarzen Balken', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const hit = engine.search(docId, 'GEHEIM', 4, 4)[0]
    engine.createAnnotation(docId, 4, { kind: 'redact', quads: hit.quads }, '')
    engine.applyRedactions(docId, 'white')
    const q = hit.quads[0]
    const img = engine.renderPage(docId, 4, 1)
    expect(pixelAt(img, (q[0] + q[2]) / 2, (q[1] + q[5]) / 2)).toEqual([255, 255, 255, 255])
  })

  it('schwärzt Bereiche über Bildern pixelgenau', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.createAnnotation(docId, 1, { kind: 'redact', rect: [100, 320, 180, 380] }, '')
    engine.applyRedactions(docId, 'black')
    const img = engine.renderPage(docId, 1, 1)
    expect(pixelAt(img, 140, 350)).toEqual([0, 0, 0, 255])
    expect(pixelAt(img, 250, 440)[2]).toBeGreaterThan(150)
  })
})

function twoColorPng(w = 60, h = 20): Uint8Array {
  const crc = (buf: Buffer): number => zlib.crc32(buf) >>> 0
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4
      if (x < w / 2) raw.set([255, 0, 0, 255], o)
      else if (y >= h / 2) raw.set([0, 0, 255, 255], o)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return new Uint8Array(
    Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
  )
}

const color = (px: number[]): string => (px[0] > 200 && px[1] < 60 && px[2] < 60 ? 'red' : px[2] > 200 && px[0] < 60 ? 'blue' : px[0] > 200 && px[1] > 200 && px[2] > 200 ? 'white' : 'other')

describe('Randfälle', () => {
  it('Seite bleibt nach dem Schwärzen bedienbar (Anmerkungsliste wird neu aufgebaut)', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.createAnnotation(docId, 4, { kind: 'note', point: [400, 400], contents: 'bleibt', color: [1, 1, 0] }, '')
    expect(engine.getAnnotations(docId, 4)).toHaveLength(1)
    const hit = engine.search(docId, 'GEHEIM', 4, 4)[0]
    engine.createAnnotation(docId, 4, { kind: 'redact', quads: hit.quads }, '')
    expect(engine.getAnnotations(docId, 4)).toHaveLength(2)
    engine.applyRedactions(docId, 'black')
    const after = engine.getAnnotations(docId, 4)
    expect(after.map((a) => a.kind)).toEqual(['note'])
    expect(engine.listAnnotations(docId).map((a) => a.contents)).toEqual(['bleibt'])
    const moved = engine.transformAnnotation(docId, 4, after[0].id, after[0].bounds, [10, 10, 30, 30])
    expect(moved.annot.bounds[0]).toBeLessThan(20)
  })

  it('Seite bleibt nach „Text ändern“ bedienbar', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.createAnnotation(docId, 0, { kind: 'square', rect: [300, 600, 400, 700], color: [0, 0, 0], fill: null, width: 1 }, '')
    expect(engine.getAnnotations(docId, 0)).toHaveLength(1)
    engine.replaceTextLine(docId, 0, engine.getTextLines(docId, 0)[1], 'Neu')
    expect(engine.getAnnotations(docId, 0).map((a) => a.kind)).toEqual(['square'])
    expect(engine.getFields(docId, 0)).toEqual([])
  })

  it('Signaturen stehen auf gedrehten Seiten aufrecht, auch nach dem Verschieben und Neuladen', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const png = twoColorPng()
    const at = (doc: string, e: Engine, x: number, y: number): string => color(pixelAt(e.renderPage(doc, 3, 1), x, y))
    const stamp = engine.createAnnotation(docId, 3, { kind: 'stamp', rect: [100, 100, 400, 200], png, role: 'signature' }, '').annot
    expect([at(docId, engine, 150, 180), at(docId, engine, 350, 180), at(docId, engine, 350, 120)]).toEqual(['red', 'blue', 'white'])
    engine.transformAnnotation(docId, 3, stamp.id, stamp.bounds, [100, 300, 400, 400])
    expect([at(docId, engine, 150, 380), at(docId, engine, 350, 380), at(docId, engine, 350, 320)]).toEqual(['red', 'blue', 'white'])
    const other = new Engine()
    const info = openOk(other, engine.save(docId))
    expect([at(info.docId, other, 150, 380), at(info.docId, other, 350, 380)]).toEqual(['red', 'blue'])
    engine.createAnnotation(docId, 0, { kind: 'stamp', rect: [100, 600, 400, 700], png, role: 'image' }, '')
    const page0 = engine.renderPage(docId, 0, 1)
    expect([color(pixelAt(page0, 150, 680)), color(pixelAt(page0, 350, 680)), color(pixelAt(page0, 350, 620))]).toEqual(['red', 'blue', 'white'])
  })

  it('Änderungen während des Speicherns bleiben „ungespeichert“', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.createAnnotation(docId, 0, { kind: 'note', point: [100, 100], contents: '', color: [1, 1, 0] }, '')
    const position = engine.journalPosition(docId)
    engine.save(docId)
    engine.createAnnotation(docId, 0, { kind: 'note', point: [200, 200], contents: '', color: [1, 1, 0] }, '')
    expect(engine.markSaved(docId, position).dirty).toBe(true)
  })

  it('Schwärzen entfernt auch Formularwerte unter der Schwärzung', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'form.pdf')
    const name = engine.getFields(docId, 0).find((f) => f.name === 'name')!
    engine.setFieldValue(docId, 0, name.id, 'Geheimer Name')
    engine.createAnnotation(docId, 0, { kind: 'redact', rect: name.rect }, '')
    engine.applyRedactions(docId, 'black')
    expect(engine.getFields(docId, 0).some((f) => f.name === 'name')).toBe(false)
    expect(engine.getFields(docId, 0).some((f) => f.name === 'bemerkung')).toBe(true)
    const text = decompressed(engine.save(docId))
    expect(text).not.toContain('Geheimer Name')
  })

  it('Schwärzen entfernt eingebettete Seitenvorschaubilder', () => {
    const doc = new mupdf.PDFDocument(fixture('sample.pdf'))
    const thumb = doc.addStream('GEHEIMESVORSCHAUBILD', { Type: doc.newName('XObject') })
    doc.findPage(4).put('Thumb', thumb)
    const bytes = doc.saveToBuffer('garbage,decompress').asUint8Array().slice()
    const engine = new Engine()
    const { docId } = openOk(engine, bytes)
    engine.createAnnotation(docId, 4, { kind: 'redact', rect: [72, 140, 300, 170] }, '')
    engine.applyRedactions(docId, 'black')
    expect(decompressed(engine.save(docId))).not.toContain('GEHEIMESVORSCHAUBILD')
  })
})

describe('Text ändern', () => {
  it('ersetzt eine Zeile, der alte Text verschwindet auch aus der Datei und Undo stellt ihn wieder her', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const line = engine.getTextLines(docId, 0)[1]
    expect(line.text).toContain('Vertragsparteien')
    engine.replaceTextLine(docId, 0, line, 'Neuer Vertragstext: Grüße – 100 € (netto)')
    const lines = engine.getTextLines(docId, 0)
    const replaced = lines.find((l) => l.text.includes('Neuer Vertragstext'))
    expect(replaced?.text).toBe('Neuer Vertragstext: Grüße – 100 € (netto)')
    expect(Math.abs(replaced!.origin[1] - line.origin[1])).toBeLessThan(1)
    expect(Math.abs(replaced!.size - line.size)).toBeLessThan(0.5)
    expect(lines.some((l) => l.text.includes('Vertragsparteien'))).toBe(false)
    expect(lines[0].text).toBe('Mietvertrag Musterstraße 12')
    expect(engine.getAnnotations(docId, 0)).toHaveLength(0)
    expect(decompressed(engine.save(docId))).not.toContain('Vertragsparteien')
    engine.undo(docId)
    expect(engine.getTextLines(docId, 0)[1].text).toContain('Vertragsparteien')
  })

  it('funktioniert auf gedrehten Seiten', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const line = engine.getTextLines(docId, 3)[1]
    engine.replaceTextLine(docId, 3, line, 'Gedreht und ersetzt')
    const replaced = engine.getTextLines(docId, 3).find((l) => l.text === 'Gedreht und ersetzt')
    expect(replaced).toBeDefined()
    expect(Math.abs(replaced!.origin[0] - line.origin[0])).toBeLessThan(1)
    expect(Math.abs(replaced!.origin[1] - line.origin[1])).toBeLessThan(1)
  })

  it('wählt passende Ersatzschriften', async () => {
    const { builtinFontFor } = await import('@renderer/engine/fonts')
    const plain = { bold: false, italic: false, serif: false, mono: false }
    expect(builtinFontFor({ ...plain, name: 'ABCDEF+Calibri-Bold' })).toBe('Helvetica-Bold')
    expect(builtinFontFor({ ...plain, name: 'TimesNewRomanPS-ItalicMT' })).toBe('Times-Italic')
    expect(builtinFontFor({ ...plain, name: 'CourierNewPSMT' })).toBe('Courier')
    expect(builtinFontFor({ ...plain, name: 'Frutiger', serif: true, bold: true })).toBe('Times-Bold')
  })
})

describe('Seiten', () => {
  it('dreht, löscht, sortiert und fügt Seiten ein – mit Undo', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.rotatePages(docId, [0], 90)
    expect(engine.info(docId).pages[0]).toMatchObject({ width: 842, height: 595, rotation: 90 })
    engine.deletePages(docId, [1, 2])
    expect(engine.info(docId).pages).toHaveLength(4)
    engine.undo(docId)
    expect(engine.info(docId).pages).toHaveLength(6)
    engine.movePages(docId, [5, 0, 1, 2, 3, 4])
    expect(engine.getTextLines(docId, 0)[0].text).toBe('Unterschriften')
    engine.undo(docId)
    expect(engine.getTextLines(docId, 0)[0].text).toBe('Mietvertrag Musterstraße 12')
    engine.insertBlankPage(docId, 1, 595, 842)
    expect(engine.info(docId).pages).toHaveLength(7)
    expect(engine.getTextLines(docId, 1)).toHaveLength(0)
    expect(() => engine.deletePages(docId, [0, 1, 2, 3, 4, 5, 6])).toThrow(EngineError)
  })

  it('fügt Seiten aus einer anderen PDF ein', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const result = engine.insertPagesFrom(docId, 6, fixture('form.pdf'))
    expect(result.count).toBe(1)
    const info = engine.info(docId)
    expect(info.pages).toHaveLength(7)
    expect(engine.getTextLines(docId, 6)[0].text).toBe('Anmeldeformular')
  })

  it('übernimmt beim Einfügen Formularwerte und Anmerkungen der anderen PDF', () => {
    const prep = new Engine()
    const { docId: srcId } = openOk(prep, 'form.pdf')
    prep.setFieldValue(srcId, 0, prep.getFields(srcId, 0).find((f) => f.name === 'name')!.id, 'Erika Mustermann')
    prep.createAnnotation(srcId, 0, { kind: 'note', point: [40, 40], contents: 'Bitte prüfen', color: [1, 0.8, 0] }, 'Jan')
    const fieldCount = prep.getFields(srcId, 0).length
    const source = prep.save(srcId)

    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.getAnnotations(docId, 1)
    engine.insertPagesFrom(docId, 1, source)
    const check = (e: Engine, id: string): void => {
      expect(e.getFields(id, 1)).toHaveLength(fieldCount)
      expect(e.getFields(id, 1).find((f) => f.name === 'name')?.value).toBe('Erika Mustermann')
      expect(e.getAnnotations(id, 1).some((a) => a.kind === 'note' && a.contents === 'Bitte prüfen')).toBe(true)
    }
    check(engine, docId)

    const saved = engine.save(docId)
    expect(orphanPages(saved)).toBe(0)
    const reopened = new Engine()
    check(reopened, openOk(reopened, saved).docId)
    engine.undo(docId)
    expect(engine.info(docId).pages).toHaveLength(6)
    expect(engine.getFields(docId, 1)).toEqual([])
  })

  it('Links eingefügter Seiten zeigen auf die eingefügten Seiten', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'form.pdf')
    engine.insertPagesFrom(docId, 1, fixture('sample.pdf'))
    expect(engine.getLinks(docId, 2).find((l) => l.page !== null)?.page).toBe(5)
    expect(engine.getLinks(docId, 1).find((l) => l.uri)?.uri).toBe('https://example.org/mietrecht')
    expect(orphanPages(engine.save(docId))).toBe(0)
  })

  it('dasselbe Formular zweimal eingefügt behält getrennte Felder', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'form.pdf')
    engine.insertPagesFrom(docId, 1, fixture('form.pdf'))
    const first = engine.getFields(docId, 0).find((f) => f.name === 'name')!
    const second = engine.getFields(docId, 1).find((f) => f.name.startsWith('name'))!
    expect(second.name).not.toBe(first.name)
    engine.setFieldValue(docId, 1, second.id, 'Zweite Person')
    expect(engine.getFields(docId, 0).find((f) => f.name === 'name')?.value).toBe('')
  })

  it('gelöschte Seiten hinterlassen keine Reste in der Datei', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    expect(decompressed(engine.save(docId))).toContain('Kosten')
    engine.deletePages(docId, [2])
    const saved = engine.save(docId)
    expect(orphanPages(saved)).toBe(0)
    expect(decompressed(saved)).not.toContain('bersicht der Kosten')
    expect(engine.info(docId).outline.map((o) => o.title)).not.toContain('Kosten')
    engine.undo(docId)
    expect(engine.info(docId).pages).toHaveLength(6)
  })

  it('Löschen und Verschieben behalten Formular, Anhänge und Seitenbeschriftungen, auch nach Rückgängig', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, richPdf())
    const keys = ['AcroForm', 'Names', 'PageLabels', 'Lang']
    expect(engine.info(docId).pages.map((p) => p.label)).toEqual(['i', 'ii', '1'])

    engine.deletePages(docId, [1])
    expect(engine.info(docId).hasForms).toBe(true)
    expect(catalogKeys(engine.save(docId))).toEqual(expect.arrayContaining(keys))
    engine.undo(docId)
    expect(engine.info(docId).pages).toHaveLength(3)
    expect(catalogKeys(engine.save(docId))).toEqual(expect.arrayContaining(keys))

    engine.movePages(docId, [2, 0, 1])
    expect(engine.getFields(docId, 0).map((f) => f.name)).toEqual(['hinten'])
    expect(engine.info(docId).pages.map((p) => p.label)).toEqual(['i', 'ii', '1'])
    expect(catalogKeys(engine.save(docId))).toEqual(expect.arrayContaining(keys))
    engine.undo(docId)
    expect(engine.getFields(docId, 0).map((f) => f.name)).toEqual(['vorne'])
  })

  it('gelöschte Seiten nehmen ihre Formularwerte mit', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, richPdf())
    engine.deletePages(docId, [2])
    const saved = engine.save(docId)
    expect(decompressed(saved)).not.toContain('(geheim)')
    expect(orphanPages(saved)).toBe(0)
    expect(engine.getFields(docId, 0).map((f) => f.name)).toEqual(['vorne'])
  })

  it('Extrahieren und flache Kopie lassen das Passwort der Originaldatei unangetastet', () => {
    const engine = new Engine()
    const opened = engine.open(fixture('protected.pdf'))
    if (opened.status !== 'needs-password') throw new Error('expected password')
    engine.authenticate(opened.docId, 'geheim')
    const part = engine.extractPages(opened.docId, [0])
    const flat = engine.save(opened.docId, { flatten: true })
    expect(new mupdf.PDFDocument(engine.save(opened.docId)).needsPassword()).toBe(true)
    for (const bytes of [part, flat]) {
      const doc = new mupdf.PDFDocument(bytes)
      expect(doc.needsPassword()).toBe(true)
      expect(doc.authenticatePassword('geheim')).toBeTruthy()
      expect(doc.loadPage(0).toStructuredText('').asText()).toContain('Mietvertrag')
    }
  })

  it('Einfügen zieht keine Quellseiten über Popups oder Sprung-Knöpfe mit', () => {
    const source = buildPdf({
      1: '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [30 0 R] >> >>',
      2: '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 10 0 R /Annots [30 0 R 31 0 R] >>',
      4: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 11 0 R >>',
      10: 'STREAM:',
      11: 'STREAM:',
      30: '<< /Type /Annot /Subtype /Widget /FT /Btn /Ff 65536 /T (weiter) /Rect [10 10 80 30] /P 3 0 R /A << /S /GoTo /D [4 0 R /Fit] >> >>',
      31: '<< /Type /Annot /Subtype /Text /Rect [100 10 120 30] /Contents (Notiz) /P 3 0 R /Popup 32 0 R >>',
      32: '<< /Type /Annot /Subtype /Popup /Rect [130 40 280 120] /Parent 31 0 R /P 3 0 R >>'
    })
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.insertPagesFrom(docId, 1, source)
    const saved = engine.save(docId)
    expect(orphanPages(saved)).toBe(0)
    const doc = new mupdf.PDFDocument(saved)
    const button = doc.findPage(1).get('Annots').get(0)
    expect(button.get('A').get('D').get(0).asIndirect()).toBe(doc.findPage(2).asIndirect())
  })

  it('Einfügen verträgt kaputte Einträge in der Feldliste', () => {
    const target = buildPdf({
      1: '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [null] >> >>',
      2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 10 0 R >>',
      10: 'STREAM:'
    })
    const engine = new Engine()
    const { docId } = openOk(engine, target)
    engine.insertPagesFrom(docId, 1, fixture('form.pdf'))
    expect(engine.getFields(docId, 1).length).toBeGreaterThan(0)
  })

  it('extrahierte Seiten behalten Anmerkungen und Formularfelder', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.insertPagesFrom(docId, 6, fixture('form.pdf'))
    engine.createAnnotation(docId, 0, { kind: 'square', rect: [100, 100, 200, 200], color: [1, 0, 0], fill: null, width: 2 }, '')
    const bytes = engine.extractPages(docId, [6, 0])
    expect(orphanPages(bytes)).toBe(0)
    const other = new Engine()
    const info = openOk(other, bytes)
    expect(info.pages).toHaveLength(2)
    expect(other.getFields(info.docId, 0).length).toBeGreaterThan(0)
    expect(other.getAnnotations(info.docId, 1).some((a) => a.kind === 'square')).toBe(true)
    expect(other.getFields(info.docId, 1)).toEqual([])
  })

  it('extrahiert Seiten in eine neue PDF', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    const bytes = engine.extractPages(docId, [4, 0])
    const other = new Engine()
    const info = openOk(other, bytes)
    expect(info.pages).toHaveLength(2)
    expect(other.getTextLines(info.docId, 0)[0].text).toBe('Vertrauliche Angaben')
  })

  it('speichert eine Kopie mit fest eingebetteten Anmerkungen', () => {
    const engine = new Engine()
    const { docId } = openOk(engine, 'sample.pdf')
    engine.createAnnotation(docId, 0, { kind: 'square', rect: [100, 100, 200, 200], color: [1, 0, 0], fill: [1, 0, 0], width: 0 }, '')
    const flat = engine.save(docId, { flatten: true })
    const other = new Engine()
    const info = openOk(other, flat)
    expect(other.getAnnotations(info.docId, 0)).toHaveLength(0)
    expect(pixelAt(other.renderPage(info.docId, 0, 1), 150, 150)).toEqual([255, 0, 0, 255])
    expect(engine.getAnnotations(docId, 0)).toHaveLength(1)
  })
})
