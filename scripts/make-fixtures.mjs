import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'
import { PDFDocument, PDFString, StandardFonts, degrees, rgb } from 'pdf-lib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tests', 'fixtures')
mkdirSync(outDir, { recursive: true })

const LOREM = [
  'Die Vertragsparteien vereinbaren, dass die Wohnung ab dem 1. Januar übergeben wird.',
  'Die monatliche Miete beträgt 850,00 € zuzüglich Nebenkosten in Höhe von 120,00 €.',
  'Schönheitsreparaturen übernimmt der Mieter; größere Schäden meldet er unverzüglich.',
  'Grüße aus Köln, Düsseldorf und München – äöü ÄÖÜ ß sind korrekt dargestellt.',
  'Kündigungsfrist: drei Monate zum Monatsende. Änderungen bedürfen der Schriftform.'
]

function makePng(width, height) {
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false)
  const px = pix.getPixels()
  const n = pix.getNumberOfComponents() + pix.getAlpha()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * n
      px[o] = 40 + Math.round((x / width) * 180)
      px[o + 1] = 90 + Math.round((y / height) * 120)
      px[o + 2] = 200
    }
  }
  const png = pix.asPNG().slice()
  pix.destroy()
  return png
}

function wrap(text, font, size, maxWidth) {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

async function makeSample() {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Mietvertrag Musterstraße 12')
  pdf.setAuthor('Strawberry PDF Testdaten')
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const times = await pdf.embedFont(StandardFonts.TimesRoman)

  const addTextPage = (title, paragraphs, size = [595, 842]) => {
    const page = pdf.addPage(size)
    const { height } = page.getSize()
    page.drawText(title, { x: 72, y: height - 90, size: 22, font: bold, color: rgb(0.1, 0.12, 0.2) })
    let y = height - 130
    for (const para of paragraphs) {
      for (const line of wrap(para, helv, 12, page.getWidth() - 144)) {
        page.drawText(line, { x: 72, y, size: 12, font: helv })
        y -= 18
      }
      y -= 10
    }
    return page
  }

  addTextPage('Mietvertrag Musterstraße 12', LOREM)
  const p2 = addTextPage('Anlage 1: Grundriss', [LOREM[0], LOREM[2]])
  const png = await pdf.embedPng(makePng(240, 160))
  p2.drawImage(png, { x: 72, y: 380, width: 240, height: 160 })
  p2.drawText('Siehe Seite 5 für vertrauliche Angaben.', { x: 72, y: 340, size: 12, font: helv })
  const p3 = pdf.addPage([842, 595])
  p3.drawText('Übersicht der Kosten', { x: 72, y: 520, size: 20, font: bold })
  const rows = [['Posten', 'Betrag'], ['Kaltmiete', '850,00 €'], ['Nebenkosten', '120,00 €'], ['Summe', '970,00 €']]
  rows.forEach((row, i) => {
    const y = 470 - i * 30
    p3.drawRectangle({ x: 72, y: y - 8, width: 500, height: 30, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 1 })
    p3.drawText(row[0], { x: 82, y, size: 12, font: i === 0 ? bold : helv })
    p3.drawText(row[1], { x: 400, y, size: 12, font: i === 0 ? bold : helv })
  })
  const p4 = addTextPage('Gedrehte Seite', ['Diese Seite ist im PDF um 90 Grad gedreht gespeichert.'])
  p4.setRotation(degrees(90))
  addTextPage('Vertrauliche Angaben', [
    'IBAN: DE89 3704 0044 0532 0130 00',
    'Das Passwort lautet GEHEIM und darf nicht weitergegeben werden.',
    'Telefon: 0221 1234567'
  ])
  const p6 = pdf.addPage([595, 842])
  p6.drawText('Unterschriften', { x: 72, y: 752, size: 22, font: times })
  p6.drawText('Ort, Datum: ______________________', { x: 72, y: 600, size: 12, font: times })
  p6.drawText('Unterschrift Mieter: ______________________', { x: 72, y: 540, size: 12, font: times })

  const bytes = await pdf.save()

  const doc = new mupdf.PDFDocument(bytes)
  const page2 = doc.loadPage(1)
  page2.createLink([72, 842 - 352, 330, 842 - 338], '#page=5')
  const page1 = doc.loadPage(0)
  page1.createLink([72, 760, 300, 780], 'https://example.org/mietrecht')
  const it = doc.outlineIterator()
  it.insert({ title: 'Mietvertrag', uri: '#page=1', open: true })
  it.insert({ title: 'Grundriss', uri: '#page=2', open: false })
  it.insert({ title: 'Kosten', uri: '#page=3', open: false })
  it.insert({ title: 'Vertrauliches', uri: '#page=5', open: false })
  it.insert({ title: 'Unterschriften', uri: '#page=6', open: false })
  const out = doc.saveToBuffer('garbage,compress').asUint8Array().slice()
  doc.destroy()
  return out
}

async function makeForm() {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const helv = await pdf.embedFont(StandardFonts.Helvetica)
  const form = pdf.getForm()
  page.drawText('Anmeldeformular', { x: 72, y: 770, size: 22, font: helv })

  page.drawText('Name', { x: 72, y: 722, size: 11, font: helv })
  form.createTextField('name').addToPage(page, { x: 72, y: 690, width: 300, height: 26 })

  page.drawText('Bemerkung', { x: 72, y: 662, size: 11, font: helv })
  const note = form.createTextField('bemerkung')
  note.enableMultiline()
  note.addToPage(page, { x: 72, y: 570, width: 300, height: 86 })

  page.drawText('Ich stimme zu', { x: 100, y: 532, size: 11, font: helv })
  form.createCheckBox('zustimmung').addToPage(page, { x: 72, y: 528, width: 18, height: 18 })

  page.drawText('Zahlung', { x: 72, y: 496, size: 11, font: helv })
  const radio = form.createRadioGroup('zahlung')
  radio.addOptionToPage('ueberweisung', page, { x: 72, y: 466, width: 16, height: 16 })
  page.drawText('Überweisung', { x: 96, y: 469, size: 11, font: helv })
  radio.addOptionToPage('bar', page, { x: 200, y: 466, width: 16, height: 16 })
  page.drawText('Bar', { x: 224, y: 469, size: 11, font: helv })

  page.drawText('Land', { x: 72, y: 436, size: 11, font: helv })
  const land = form.createDropdown('land')
  land.addOptions(['Deutschland', 'Österreich', 'Schweiz'])
  land.addToPage(page, { x: 72, y: 404, width: 200, height: 24 })

  page.drawText('Interessen', { x: 72, y: 380, size: 11, font: helv })
  const list = form.createOptionList('interessen')
  list.addOptions(['Lesen', 'Sport', 'Musik'])
  list.addToPage(page, { x: 72, y: 310, width: 200, height: 64 })

  page.drawText('Unterschrift', { x: 72, y: 270, size: 11, font: helv })
  const sig = pdf.context.obj({
    FT: 'Sig',
    T: PDFString.of('unterschrift'),
    Type: 'Annot',
    Subtype: 'Widget',
    Rect: [72, 200, 300, 260],
    F: 4,
    P: page.ref
  })
  const sigRef = pdf.context.register(sig)
  page.node.addAnnot(sigRef)
  form.acroForm.addField(sigRef)

  return pdf.save()
}

function makeProtected(sampleBytes) {
  const doc = new mupdf.PDFDocument(sampleBytes)
  const out = doc
    .saveToBuffer('encrypt=aes-256,user-password=geheim,owner-password=eigentuemer,garbage,compress')
    .asUint8Array()
    .slice()
  doc.destroy()
  return out
}

async function makeScan(sampleBytes) {
  const doc = new mupdf.PDFDocument(sampleBytes)
  const page = doc.loadPage(0)
  const pix = page.toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false)
  const png = pix.asPNG().slice()
  pix.destroy()
  doc.destroy()
  const pdf = await PDFDocument.create()
  const p = pdf.addPage([595, 842])
  const img = await pdf.embedPng(png)
  p.drawImage(img, { x: 0, y: 0, width: 595, height: 842 })
  return pdf.save()
}

function makeBroken(sampleBytes) {
  const text = Buffer.from(sampleBytes).toString('latin1')
  const idx = text.lastIndexOf('startxref')
  const broken = text.slice(0, idx) + 'startxref\n999999\n%%EOF\n'
  return Buffer.from(broken, 'latin1')
}

function makeFonts() {
  const doc = new mupdf.PDFDocument()
  const font = new mupdf.Font('Times-Roman')
  const ref = doc.addFont(font)
  const show = (text) => `<${[...text].map((c) => font.encodeCharacter(c).toString(16).padStart(4, '0')).join('')}>`
  const content = [
    'BT 0.1 0.2 0.5 rg /F1 1 Tf 18 0 0 18 72 720 Tm', show('Rechnung Nr. 4711'), 'Tj ET',
    'BT 0 g /F1 1 Tf 11 0 0 11 72 690 Tm', show('Zahlbar bis 30. November'), 'Tj ET'
  ].join(' ')
  doc.insertPage(-1, doc.addPage([0, 0, 595, 842], 0, doc.addObject({ Font: { F1: ref } }), content))
  doc.subsetFonts()
  return doc.saveToBuffer('garbage,compress').asUint8Array().slice()
}

const sample = await makeSample()
writeFileSync(join(outDir, 'sample.pdf'), sample)
writeFileSync(join(outDir, 'form.pdf'), await makeForm())
writeFileSync(join(outDir, 'protected.pdf'), makeProtected(sample))
writeFileSync(join(outDir, 'scan.pdf'), await makeScan(sample))
writeFileSync(join(outDir, 'broken.pdf'), makeBroken(sample))
writeFileSync(join(outDir, 'fonts.pdf'), makeFonts())
console.log('Fixtures geschrieben nach', outDir)
