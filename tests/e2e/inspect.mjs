import { readFileSync } from 'node:fs'
import * as mupdf from 'mupdf'

const file = process.argv[2]
const doc = new mupdf.PDFDocument(new Uint8Array(readFileSync(file)))
const out = { pages: doc.countPages(), annots: [], fields: [], text: [], lines: [], rotation: [], sizes: [], images: [] }
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i)
  for (const a of page.getAnnotations()) {
    const role = a.getObject().get('StrawberryRole')
    out.annots.push({ page: i, type: a.getType(), contents: a.getContents(), role: role.isName() ? role.asName() : null, rect: a.getBounds() })
  }
  for (const w of page.getWidgets()) out.fields.push({ page: i, name: w.getName(), value: w.getValue() })
  const stext = page.toStructuredText('')
  out.text.push(stext.asText())
  let line = null
  stext.walk({
    beginLine() {
      line = { page: i, text: '', font: '', size: 0 }
    },
    onChar(c, _origin, font, size) {
      if (!line.font && c.trim()) {
        line.font = font.getName()
        line.size = size
      }
      line.text += c
    },
    endLine() {
      if (line.text.trim()) out.lines.push(line)
    }
  })
  const rot = doc.findPage(i).getInheritable('Rotate')
  out.rotation.push(rot.isNumber() ? rot.asNumber() : 0)
  const [x0, y0, x1, y1] = page.getBounds()
  out.sizes.push([x1 - x0, y1 - y0])
  const device = new mupdf.Device({
    fillImage(_image, ctm) {
      const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]]
      const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]]
      out.images.push({ page: i, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] })
    }
  })
  page.run(device, mupdf.Matrix.identity)
  device.close()
}
console.log(JSON.stringify(out))
