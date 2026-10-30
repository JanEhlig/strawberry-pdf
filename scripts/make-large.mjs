import { readFileSync, writeFileSync } from 'node:fs'
import * as mupdf from 'mupdf'

const [source, target, count = '600'] = process.argv.slice(2)
const src = new mupdf.PDFDocument(new Uint8Array(readFileSync(source)))
const out = new mupdf.PDFDocument()
const map = out.newGraftMap()
for (let i = 0; i < Number(count); i++) map.graftPage(-1, src, i % src.countPages())
writeFileSync(target, out.saveToBuffer('garbage,compress').asUint8Array())
