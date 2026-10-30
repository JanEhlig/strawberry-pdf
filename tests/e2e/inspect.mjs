import { readFileSync } from 'node:fs'
import * as mupdf from 'mupdf'

const file = process.argv[2]
const doc = new mupdf.PDFDocument(new Uint8Array(readFileSync(file)))
const out = { pages: doc.countPages(), annots: [], fields: [], text: [], rotation: [] }
for (let i = 0; i < doc.countPages(); i++) {
  const page = doc.loadPage(i)
  for (const a of page.getAnnotations()) {
    const role = a.getObject().get('StrawberryRole')
    out.annots.push({ page: i, type: a.getType(), contents: a.getContents(), role: role.isName() ? role.asName() : null, rect: a.getBounds() })
  }
  for (const w of page.getWidgets()) out.fields.push({ page: i, name: w.getName(), value: w.getValue() })
  out.text.push(page.toStructuredText('').asText())
  const rot = doc.findPage(i).getInheritable('Rotate')
  out.rotation.push(rot.isNumber() ? rot.asNumber() : 0)
}
console.log(JSON.stringify(out))
