import * as mupdf from 'mupdf'
import { stripSubsetTag } from './fonts'
import { intersectRect, isEmptyRect, mapQuad, mapRect, normalizeRect, quadsBounds, rectMapper } from './geometry'
import { analyzeLine, planLineEdit, removeLine, writeLine } from './lineEdit'
import { child } from './pdfObject'
import type {
  AnnotData,
  AnnotKind,
  AnnotPatch,
  AnnotRole,
  Changed,
  DocInfo,
  DocMetadata,
  FieldData,
  FieldType,
  HistoryState,
  LinkData,
  MutationResult,
  NewAnnot,
  OpenResult,
  OutlineNode,
  PageInfo,
  Point,
  Quad,
  Rect,
  RedactFill,
  RenderedImage,
  RGB,
  SaveOptions,
  SearchHit,
  SelectMode,
  TextEditOptions,
  TextEditPlan,
  TextLine,
  TextSelection
} from './types'

export const SAVE_OPTIONS = 'garbage,compress'

const PAGE_CACHE_SIZE = 48
const STEXT_CACHE_SIZE = 24
const ROLE_KEY = 'StrawberryRole'
const IMAGE_KEY = 'StrawberryImage'
const IMAGE_ROTATION_KEY = 'StrawberryImageRotation'

export type EngineErrorCode = 'not-pdf' | 'damaged' | 'not-found' | 'invalid'

export class EngineError extends Error {
  constructor(
    public code: EngineErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'EngineError'
  }
}

interface DocEntry {
  id: string
  doc: mupdf.PDFDocument
  ready: boolean
  pages: Map<number, mupdf.PDFPage>
  stext: Map<number, mupdf.StructuredText>
  savedPosition: number
  hasSignedSignatures: boolean
  redacted: boolean
  password?: string
}

const TYPE_TO_KIND: Partial<Record<mupdf.PDFAnnotationType, AnnotKind>> = {
  Highlight: 'highlight',
  Underline: 'underline',
  StrikeOut: 'strikeout',
  Squiggly: 'squiggly',
  FreeText: 'freetext',
  Ink: 'ink',
  Square: 'square',
  Circle: 'circle',
  Line: 'line',
  Polygon: 'polygon',
  PolyLine: 'polyline',
  Text: 'note',
  Stamp: 'stamp',
  Redact: 'redact'
}

const KIND_TO_TYPE: Record<NewAnnot['kind'], mupdf.PDFAnnotationType> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'StrikeOut',
  squiggly: 'Squiggly',
  freetext: 'FreeText',
  ink: 'Ink',
  square: 'Square',
  circle: 'Circle',
  line: 'Line',
  note: 'Text',
  stamp: 'Stamp',
  redact: 'Redact'
}

const IGNORED_TYPES = new Set<string>(['Popup', 'Link', 'Widget'])

function toRGB(color: mupdf.AnnotColor | mupdf.Color | number[] | undefined | null): RGB | null {
  if (!color || color.length === 0) return null
  if (color.length === 1) return [color[0], color[0], color[0]]
  if (color.length === 3) return [color[0], color[1], color[2]]
  if (color.length === 4) {
    const [c, m, y, k] = color as number[]
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
  }
  return null
}

function safeTime(read: () => Date): number | null {
  try {
    const t = read().getTime()
    return Number.isFinite(t) && t > 0 ? t : null
  } catch {
    return null
  }
}

function annotId(annot: mupdf.PDFAnnotation, page: number, index: number): string {
  const num = annot.getObject().asIndirect()
  return num > 0 ? String(num) : `p${page}i${index}`
}

function readRole(annot: mupdf.PDFAnnotation): AnnotRole | null {
  const value = annot.getObject().get(ROLE_KEY)
  if (!value.isName()) return null
  const role = value.asName()
  return role === 'signature' || role === 'image' || role === 'check' || role === 'cross' || role === 'date'
    ? role
    : null
}

function rootOf(doc: mupdf.PDFDocument): mupdf.PDFObject {
  return child(doc.getTrailer(), 'Root')
}

function rectFromObject(obj: mupdf.PDFObject): Rect | null {
  if (!obj.isArray() || obj.length < 4) return null
  const values = [0, 1, 2, 3].map((i) => obj.get(i).asNumber())
  if (values.some((v) => !Number.isFinite(v))) return null
  return normalizeRect(values as Rect)
}

function normalizeRotation(value: number): number {
  const r = ((Math.round(value / 90) * 90) % 360 + 360) % 360
  return r
}

function pageRotation(page: mupdf.PDFPage): number {
  const rot = page.getObject().getInheritable('Rotate')
  return normalizeRotation(rot.isNumber() ? rot.asNumber() : 0)
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ]
  let out = ''
  let rest = Math.max(1, Math.floor(n))
  for (const [value, letters] of table) {
    while (rest >= value) {
      out += letters
      rest -= value
    }
  }
  return out
}

function toLetters(n: number): string {
  const index = Math.max(1, Math.floor(n)) - 1
  const letter = String.fromCharCode(97 + (index % 26))
  return letter.repeat(Math.floor(index / 26) + 1)
}

function formatLabel(style: string, value: number): string {
  switch (style) {
    case 'D':
      return String(value)
    case 'R':
      return toRoman(value).toUpperCase()
    case 'r':
      return toRoman(value)
    case 'A':
      return toLetters(value).toUpperCase()
    case 'a':
      return toLetters(value)
    default:
      return ''
  }
}

function readPageLabels(doc: mupdf.PDFDocument, count: number): (string | null)[] {
  const tree = child(rootOf(doc), 'PageLabels')
  const none = new Array<string | null>(count).fill(null)
  if (tree.isNull()) return none
  const ranges: { start: number; style: string; prefix: string; first: number }[] = []
  const collect = (node: mupdf.PDFObject, depth: number): void => {
    if (depth > 32 || !node.isDictionary()) return
    const nums = node.get('Nums')
    if (nums.isArray()) {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const dict = nums.get(i + 1)
        const s = child(dict, 'S')
        const p = child(dict, 'P')
        const st = child(dict, 'St')
        ranges.push({
          start: nums.get(i).asNumber(),
          style: s.isName() ? s.asName() : '',
          prefix: p.isString() ? p.asString() : '',
          first: st.isNumber() ? st.asNumber() : 1
        })
      }
    }
    const kids = node.get('Kids')
    if (kids.isArray()) for (let i = 0; i < kids.length; i++) collect(kids.get(i), depth + 1)
  }
  collect(tree, 0)
  if (ranges.length === 0) return none
  ranges.sort((a, b) => a.start - b.start)
  const labels: (string | null)[] = []
  let r = -1
  for (let i = 0; i < count; i++) {
    while (r + 1 < ranges.length && ranges[r + 1].start <= i) r++
    if (r < 0) {
      labels.push(null)
      continue
    }
    const range = ranges[r]
    labels.push(range.prefix + formatLabel(range.style, range.first + (i - range.start)))
  }
  return labels.every((l, i) => l === String(i + 1)) ? none : labels
}

function convertOutline(items: ReturnType<mupdf.Document['loadOutline']>, depth = 0): OutlineNode[] {
  if (!items || depth > 64) return []
  return items.map((item) => ({
    title: item.title ?? '',
    page: typeof item.page === 'number' && item.page >= 0 ? item.page : null,
    uri: item.uri && /^\w[\w+.-]*:/.test(item.uri) ? item.uri : null,
    open: !!item.open,
    children: convertOutline(item.down ?? null, depth + 1)
  }))
}

function visitFields(fields: mupdf.PDFObject, visit: (field: mupdf.PDFObject) => boolean, depth = 0): boolean {
  if (!fields.isArray() || depth > 32) return false
  for (let i = 0; i < fields.length; i++) {
    const field = fields.get(i)
    if (!field.isDictionary()) continue
    if (visit(field)) return true
    if (visitFields(child(field, 'Kids'), visit, depth + 1)) return true
  }
  return false
}

function widgetType(widget: mupdf.PDFWidget): FieldType {
  switch (widget.getFieldType()) {
    case 'text':
      return 'text'
    case 'checkbox':
      return 'checkbox'
    case 'radiobutton':
      return 'radio'
    case 'combobox':
      return 'combobox'
    case 'listbox':
      return 'listbox'
    case 'button':
      return 'button'
    case 'signature':
      return 'signature'
    default:
      return 'unknown'
  }
}

function removeFieldReference(list: mupdf.PDFObject, num: number, depth = 0): void {
  if (depth > 32) return
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list.get(i)
    if (item.asIndirect() === num) {
      list.delete(i)
      continue
    }
    const kids = child(item, 'Kids')
    if (kids.isArray()) {
      removeFieldReference(kids, num, depth + 1)
      if (kids.length === 0) list.delete(i)
    }
  }
}

function isName(obj: mupdf.PDFObject, name: string): boolean {
  return obj.isName() && obj.asName() === name
}

function stripSignature(widget: mupdf.PDFObject): void {
  const chain: mupdf.PDFObject[] = []
  for (let field = widget; field.isDictionary() && chain.length < 32; field = field.get('Parent')) chain.push(field)
  const type = chain.map((field) => field.get('FT')).find((ft) => ft.isName())
  if (type && isName(type, 'Sig')) for (const field of chain) field.delete('V')
}

function actionsOf(obj: mupdf.PDFObject): mupdf.PDFObject[] {
  const list: mupdf.PDFObject[] = []
  const action = obj.get('A')
  if (action.isDictionary()) list.push(action)
  const more = obj.get('AA')
  if (more.isDictionary()) more.forEach((value) => value.isDictionary() && list.push(value))
  return list
}

function destPage(obj: mupdf.PDFObject): number | null {
  let dest = obj.get('Dest')
  if (!dest.isArray()) {
    const action = obj.get('A')
    if (!action.isDictionary() || !isName(action.get('S'), 'GoTo')) return null
    dest = action.get('D')
  }
  return dest.isArray() && dest.get(0).isIndirect() ? dest.get(0).asIndirect() : null
}

function pruneOutline(parent: mupdf.PDFObject, gone: Set<number>, depth = 0): void {
  if (!parent.isDictionary() || depth > 32) return
  const kept: mupdf.PDFObject[] = []
  let item = parent.get('First')
  for (let guard = 0; item.isDictionary() && guard < 100_000; guard++) {
    pruneOutline(item, gone, depth + 1)
    const target = destPage(item)
    if (target !== null && gone.has(target)) {
      if (item.get('First').isDictionary()) {
        item.delete('Dest')
        item.delete('A')
        kept.push(item)
      }
    } else {
      kept.push(item)
    }
    item = item.get('Next')
  }
  const count = parent.get('Count')
  if (count.isNumber()) parent.put('Count', count.asNumber() < 0 ? -kept.length : kept.length)
  if (kept.length === 0) {
    parent.delete('First')
    parent.delete('Last')
    return
  }
  parent.put('First', kept[0])
  parent.put('Last', kept[kept.length - 1])
  kept.forEach((entry, i) => {
    if (i > 0) entry.put('Prev', kept[i - 1])
    else entry.delete('Prev')
    if (i < kept.length - 1) entry.put('Next', kept[i + 1])
    else entry.delete('Next')
  })
}

function clearStructure(node: mupdf.PDFObject, gone: Set<number>, page: number | null, depth = 0): void {
  if (depth > 64) return
  if (node.isArray()) {
    for (let i = 0; i < node.length; i++) clearStructure(node.get(i), gone, page, depth + 1)
    return
  }
  if (!node.isDictionary()) return
  const own = node.get('Pg')
  const current = own.isIndirect() ? own.asIndirect() : page
  clearStructure(node.get('K'), gone, current, depth + 1)
  if (current !== null && gone.has(current) && !node.get('S').isNull()) {
    for (const key of ['K', 'ActualText', 'Alt', 'E', 'T', 'Lang', 'A', 'C']) node.delete(key)
  }
}

function removePages(doc: mupdf.PDFDocument, pages: number[]): void {
  const gone = new Set<number>()
  const removed: mupdf.PDFObject[] = []
  const widgets: number[] = []
  const goneAnnots = new Set<number>()
  for (const i of pages) {
    const page = doc.findPage(i)
    gone.add(page.asIndirect())
    removed.push(page)
    const annots = child(page, 'Annots')
    for (let k = 0; annots.isArray() && k < annots.length; k++) {
      const annot = annots.get(k)
      if (!annot.isIndirect()) continue
      goneAnnots.add(annot.asIndirect())
      if (isName(annot.get('Subtype'), 'Widget')) widgets.push(annot.asIndirect())
    }
  }
  clearStructure(child(rootOf(doc), 'StructTreeRoot', 'K'), gone, null)
  for (const i of [...pages].sort((a, b) => b - a)) doc.deletePage(i)
  const fields = child(rootOf(doc), 'AcroForm', 'Fields')
  if (fields.isArray()) for (const num of widgets) removeFieldReference(fields, num)
  pruneOutline(child(rootOf(doc), 'Outlines'), gone)
  for (let i = 0; i < doc.countPages(); i++) {
    const page = doc.findPage(i)
    const annots = child(page, 'Annots')
    for (let k = annots.isArray() ? annots.length - 1 : -1; k >= 0; k--) {
      const annot = annots.get(k)
      if (!annot.isDictionary()) continue
      const target = isName(annot.get('Subtype'), 'Link') ? destPage(annot) : null
      if (target !== null && gone.has(target)) {
        annots.delete(k)
        continue
      }
      const owner = annot.get('P')
      if (owner.isIndirect() && gone.has(owner.asIndirect())) annot.put('P', page)
      const reply = annot.get('IRT')
      if (reply.isIndirect() && goneAnnots.has(reply.asIndirect())) annot.delete('IRT')
    }
  }
  for (const page of removed) {
    const keys: string[] = []
    page.forEach((_, key) => keys.push(String(key)))
    for (const key of keys) page.delete(key)
  }
}

function reorderPages(doc: mupdf.PDFDocument, order: number[]): void {
  const pages = order.map((i) => doc.findPage(i))
  for (const page of pages) {
    for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      if (!page.get(key).isNull()) continue
      const value = page.getInheritable(key)
      if (!value.isNull()) page.put(key, value)
    }
  }
  const catalog = rootOf(doc)
  const labels = catalog.get('PageLabels')
  if (!labels.isNull()) catalog.delete('PageLabels')
  for (let i = doc.countPages() - 1; i >= 0; i--) doc.deletePage(i)
  pages.forEach((page, i) => doc.insertPage(i, page))
  if (!labels.isNull()) catalog.put('PageLabels', labels)
}

function mergeFields(dst: mupdf.PDFDocument, src: mupdf.PDFDocument, map: mupdf.PDFGraftMap, widgets: mupdf.PDFObject[]): void {
  const roots = new Map<number, mupdf.PDFObject>()
  for (const widget of widgets) {
    let field = widget
    for (let depth = 0; depth < 32 && field.get('Parent').isDictionary(); depth++) field = field.get('Parent')
    if (field.isIndirect()) roots.set(field.asIndirect(), field)
  }
  if (roots.size === 0) return
  const catalog = rootOf(dst)
  let form = catalog.get('AcroForm')
  if (!form.isDictionary()) {
    form = dst.addObject(dst.newDictionary())
    catalog.put('AcroForm', form)
  }
  let fields = form.get('Fields')
  if (!fields.isArray()) {
    fields = dst.newArray()
    form.put('Fields', fields)
  }
  const nameOf = (field: mupdf.PDFObject): string | null => (field.isDictionary() && field.get('T').isString() ? field.get('T').asString() : null)
  const taken = new Set<string>()
  for (let i = 0; i < fields.length; i++) {
    const name = nameOf(fields.get(i))
    if (name !== null) taken.add(name)
  }
  for (const field of roots.values()) {
    const copy = map.graftObject(field)
    let name = nameOf(copy)
    if (name !== null && taken.has(name)) {
      let n = 2
      while (taken.has(`${name}_${n}`)) n++
      name = `${name}_${n}`
      copy.put('T', dst.newString(name))
    }
    if (name !== null) taken.add(name)
    fields.push(copy)
  }
  const source = child(rootOf(src), 'AcroForm')
  if (!source.isDictionary()) return
  if (form.get('DA').isNull() && source.get('DA').isString()) form.put('DA', map.graftObject(source.get('DA')))
  if (source.get('NeedAppearances').isBoolean() && source.get('NeedAppearances').asBoolean()) form.put('NeedAppearances', true)
  const fonts = child(source, 'DR', 'Font')
  if (!fonts.isDictionary()) return
  let resources = form.get('DR')
  if (!resources.isDictionary()) {
    resources = dst.newDictionary()
    form.put('DR', resources)
  }
  let target = resources.get('Font')
  if (!target.isDictionary()) {
    target = dst.newDictionary()
    resources.put('Font', target)
  }
  fonts.forEach((font, key) => {
    if (target.get(key).isNull()) target.put(key, map.graftObject(font))
  })
}

function widgetIsOn(widget: mupdf.PDFWidget): boolean {
  const as = widget.getObject().get('AS')
  return as.isName() && as.asName() !== 'Off'
}

function copyPixels(pix: mupdf.Pixmap): Uint8ClampedArray<ArrayBuffer> {
  const view = pix.getPixels()
  const copy = new Uint8ClampedArray(view.length)
  copy.set(view)
  return copy
}

function bytesOf(buffer: mupdf.Buffer): Uint8Array<ArrayBuffer> {
  const view = buffer.asUint8Array()
  const copy = new Uint8Array(view.length)
  copy.set(view)
  buffer.destroy()
  return copy
}

export class Engine {
  private docs = new Map<string, DocEntry>()
  private counter = 0

  open(bytes: Uint8Array): OpenResult {
    let doc: mupdf.Document
    try {
      doc = mupdf.Document.openDocument(bytes, 'application/pdf')
    } catch (error) {
      throw new EngineError('damaged', error instanceof Error ? error.message : String(error))
    }
    const pdf = doc.asPDF()
    if (!pdf) {
      doc.destroy()
      throw new EngineError('not-pdf', 'Not a PDF document')
    }
    const id = `doc${++this.counter}`
    const entry: DocEntry = {
      id,
      doc: pdf,
      ready: false,
      pages: new Map(),
      stext: new Map(),
      savedPosition: 0,
      hasSignedSignatures: false,
      redacted: false
    }
    this.docs.set(id, entry)
    if (pdf.needsPassword()) return { status: 'needs-password', docId: id, retry: false }
    this.finishOpen(entry)
    return { status: 'ok', info: this.info(id) }
  }

  authenticate(docId: string, password: string): OpenResult {
    const entry = this.entry(docId, false)
    if (entry.ready) return { status: 'ok', info: this.info(docId) }
    if (!entry.doc.authenticatePassword(password)) return { status: 'needs-password', docId, retry: true }
    entry.password = password
    this.finishOpen(entry)
    return { status: 'ok', info: this.info(docId) }
  }

  close(docId: string): void {
    const entry = this.docs.get(docId)
    if (!entry) return
    this.dropCaches(entry)
    this.docs.delete(docId)
    entry.doc.destroy()
  }

  info(docId: string): DocInfo {
    const entry = this.entry(docId)
    const doc = entry.doc
    const count = doc.countPages()
    const labels = readPageLabels(doc, count)
    const pages: PageInfo[] = []
    for (let i = 0; i < count; i++) pages.push({ ...this.pageGeometry(doc, i), label: labels[i] })
    const meta = (key: string): string => doc.getMetaData(key) ?? ''
    const metadata: DocMetadata = {
      title: meta('info:Title'),
      author: meta('info:Author'),
      subject: meta('info:Subject'),
      keywords: meta('info:Keywords'),
      creator: meta('info:Creator'),
      producer: meta('info:Producer'),
      creationDate: meta('info:CreationDate'),
      modDate: meta('info:ModDate'),
      format: meta('format'),
      encryption: meta('encryption')
    }
    let outline: OutlineNode[] = []
    try {
      outline = convertOutline(doc.loadOutline())
    } catch {
      outline = []
    }
    const acroFields = child(rootOf(doc), 'AcroForm', 'Fields')
    return {
      docId,
      pages,
      outline,
      metadata,
      permissions: {
        print: doc.hasPermission('print'),
        copy: doc.hasPermission('copy'),
        edit: doc.hasPermission('edit'),
        annotate: doc.hasPermission('annotate'),
        form: doc.hasPermission('form'),
        assemble: doc.hasPermission('assemble')
      },
      hasForms: acroFields.isArray() && acroFields.length > 0,
      hasSignedSignatures: entry.hasSignedSignatures,
      wasRepaired: doc.wasRepaired()
    }
  }

  history(docId: string): HistoryState {
    return this.historyOf(this.entry(docId))
  }

  renderPage(docId: string, pageIndex: number, scale: number, clip?: Rect): RenderedImage {
    const entry = this.entry(docId)
    const page = this.page(entry, pageIndex)
    const b = page.getBounds()
    const full: Rect = [0, 0, Math.max(1, Math.ceil((b[2] - b[0]) * scale)), Math.max(1, Math.ceil((b[3] - b[1]) * scale))]
    let box = full
    if (clip) {
      const c = intersectRect(full, [Math.floor(clip[0]), Math.floor(clip[1]), Math.ceil(clip[2]), Math.ceil(clip[3])])
      if (!isEmptyRect(c)) box = c
    }
    const matrix = mupdf.Matrix.concat(mupdf.Matrix.translate(-b[0], -b[1]), mupdf.Matrix.scale(scale, scale))
    const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, box, true)
    try {
      pix.clear(255)
      const device = new mupdf.DrawDevice(matrix, pix)
      try {
        page.run(device, mupdf.Matrix.identity)
        device.close()
      } finally {
        device.destroy()
      }
      return { width: pix.getWidth(), height: pix.getHeight(), x: pix.getX(), y: pix.getY(), pixels: copyPixels(pix) }
    } finally {
      pix.destroy()
    }
  }

  renderAnnotation(docId: string, pageIndex: number, id: string, scale: number): RenderedImage {
    const entry = this.entry(docId)
    const page = this.page(entry, pageIndex)
    const annot = this.findAnnot(page, pageIndex, id)
    const b = page.getBounds()
    const matrix = mupdf.Matrix.concat(mupdf.Matrix.translate(-b[0], -b[1]), mupdf.Matrix.scale(scale, scale))
    const pix = annot.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true)
    try {
      return { width: pix.getWidth(), height: pix.getHeight(), x: pix.getX(), y: pix.getY(), pixels: copyPixels(pix) }
    } finally {
      pix.destroy()
    }
  }

  renderForPrint(docId: string, pageIndex: number, dpi: number): Uint8Array<ArrayBuffer> {
    const entry = this.entry(docId)
    const page = this.page(entry, pageIndex)
    const b = page.getBounds()
    const scale = dpi / 72
    const matrix = mupdf.Matrix.concat(mupdf.Matrix.translate(-b[0], -b[1]), mupdf.Matrix.scale(scale, scale))
    const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true, 'Print')
    try {
      const jpeg = pix.asJPEG(88)
      const copy = new Uint8Array(jpeg.length)
      copy.set(jpeg)
      return copy
    } finally {
      pix.destroy()
    }
  }

  getTextLines(docId: string, pageIndex: number): TextLine[] {
    const st = this.stext(this.entry(docId), pageIndex)
    const lines: TextLine[] = []
    let current: TextLine | null = null
    st.walk({
      beginLine(bbox) {
        current = {
          bbox: [...bbox] as Rect,
          size: 0,
          font: { name: '', bold: false, italic: false, serif: false, mono: false },
          text: '',
          origin: [bbox[0], bbox[3]],
          color: [0, 0, 0]
        }
      },
      onChar(c, origin, font, size, _quad, color) {
        if (!current) return
        if (current.text.trim().length === 0 && c.trim()) {
          current.size = size
          current.font = {
            name: stripSubsetTag(font.getName()),
            bold: font.isBold(),
            italic: font.isItalic(),
            serif: font.isSerif(),
            mono: font.isMono()
          }
          current.color = toRGB(color) ?? [0, 0, 0]
        }
        if (current.text.length === 0) current.origin = [origin[0], origin[1]]
        current.text += c
      },
      endLine() {
        if (current && current.text.trim().length > 0) lines.push(current)
        current = null
      }
    })
    return lines
  }

  selectText(docId: string, pageIndex: number, a: Point, b: Point, mode: SelectMode): TextSelection {
    const st = this.stext(this.entry(docId), pageIndex)
    let p = a
    let q = b
    if (mode !== 'chars') {
      const h = st.snap(a, b, mode)
      p = [(h[0] + h[4]) / 2, (h[1] + h[5]) / 2]
      q = [(h[2] + h[6]) / 2, (h[3] + h[7]) / 2]
    }
    return { quads: st.highlight(p, q, 2000), text: st.copy(p, q) }
  }

  search(docId: string, query: string, fromPage: number, toPage: number): SearchHit[] {
    const entry = this.entry(docId)
    const needle = query.trim()
    if (!needle) return []
    const hits: SearchHit[] = []
    const last = Math.min(toPage, entry.doc.countPages() - 1)
    for (let i = Math.max(0, fromPage); i <= last; i++) {
      const cached = entry.stext.get(i)
      const st = cached ?? this.page(entry, i).toStructuredText('')
      try {
        for (const quads of st.search(needle, '')) hits.push({ page: i, quads })
      } finally {
        if (!cached) st.destroy()
      }
    }
    return hits
  }

  getLinks(docId: string, pageIndex: number): LinkData[] {
    const entry = this.entry(docId)
    const page = this.page(entry, pageIndex)
    return page.getLinks().map((link) => {
      const rect = normalizeRect(link.getBounds())
      if (link.isExternal()) return { rect, uri: link.getURI(), page: null }
      let target = -1
      try {
        target = entry.doc.resolveLink(link)
      } catch {
        target = -1
      }
      return { rect, uri: null, page: target >= 0 ? target : null }
    })
  }

  getAnnotations(docId: string, pageIndex: number): AnnotData[] {
    const page = this.page(this.entry(docId), pageIndex)
    const out: AnnotData[] = []
    page.getAnnotations().forEach((annot, index) => {
      if (IGNORED_TYPES.has(annot.getType())) return
      out.push(this.annotData(annot, pageIndex, annotId(annot, pageIndex, index)))
    })
    return out
  }

  listAnnotations(docId: string): AnnotData[] {
    const entry = this.entry(docId)
    const out: AnnotData[] = []
    for (let i = 0; i < entry.doc.countPages(); i++) {
      const annots = child(entry.doc.findPage(i), 'Annots')
      if (!annots.isArray() || annots.length === 0) continue
      out.push(...this.getAnnotations(docId, i))
    }
    return out
  }

  createAnnotation(docId: string, pageIndex: number, spec: NewAnnot, author: string): MutationResult & { annot: AnnotData } {
    const entry = this.entry(docId)
    const { result, ...rest } = this.mutate(entry, spec.kind, [pageIndex], () => {
      const page = this.page(entry, pageIndex)
      const annot = page.createAnnotation(KIND_TO_TYPE[spec.kind])
      if (author) annot.setAuthor(author)
      annot.setModificationDate(new Date())
      this.applySpec(entry.doc, annot, spec, pageRotation(page))
      this.updateAppearance(annot)
      const index = page.getAnnotations().indexOf(annot)
      return this.annotData(annot, pageIndex, annotId(annot, pageIndex, index))
    })
    return { ...rest, annot: result }
  }

  updateAnnotation(docId: string, pageIndex: number, id: string, patch: AnnotPatch): MutationResult & { annot: AnnotData } {
    const entry = this.entry(docId)
    const { result, ...rest } = this.mutate(entry, 'edit', [pageIndex], () => {
      const page = this.page(entry, pageIndex)
      const annot = this.findAnnot(page, pageIndex, id)
      const type = annot.getType()
      if (patch.color !== undefined) {
        if (type === 'FreeText') this.setFreeTextFont(annot, { color: patch.color ?? [0, 0, 0] })
        else annot.setColor(patch.color ?? [])
      }
      if (patch.interiorColor !== undefined && annot.hasInteriorColor()) annot.setInteriorColor(patch.interiorColor ?? [])
      if (patch.opacity !== undefined) annot.setOpacity(Math.max(0.05, Math.min(1, patch.opacity)))
      if (patch.borderWidth !== undefined && annot.hasBorder()) annot.setBorderWidth(Math.max(0, patch.borderWidth))
      if (patch.contents !== undefined) annot.setContents(patch.contents)
      if (patch.font && type === 'FreeText') this.setFreeTextFont(annot, patch.font)
      if (patch.arrow !== undefined && annot.hasLineEndingStyles()) {
        annot.setLineEndingStyles('None', patch.arrow ? 'OpenArrow' : 'None')
      }
      annot.setModificationDate(new Date())
      this.updateAppearance(annot)
      return this.annotData(annot, pageIndex, id)
    })
    return { ...rest, annot: result }
  }

  transformAnnotation(docId: string, pageIndex: number, id: string, from: Rect, to: Rect): MutationResult & { annot: AnnotData } {
    const entry = this.entry(docId)
    const { result, ...rest } = this.mutate(entry, 'move', [pageIndex], () => {
      const page = this.page(entry, pageIndex)
      const annot = this.findAnnot(page, pageIndex, id)
      const map = rectMapper(from, to)
      if (annot.hasQuadPoints()) annot.setQuadPoints(annot.getQuadPoints().map((q) => mapQuad(q, map)))
      if (annot.hasInkList()) annot.setInkList(annot.getInkList().map((path) => path.map((p) => map(p))))
      if (annot.hasLine()) {
        const [a, b] = annot.getLine()
        annot.setLine(map(a), map(b))
      }
      if (annot.hasVertices()) annot.setVertices(annot.getVertices().map((p) => map(p)))
      if (annot.hasRect()) annot.setRect(mapRect(annot.getRect(), map))
      annot.setModificationDate(new Date())
      this.updateAppearance(annot)
      return this.annotData(annot, pageIndex, id)
    })
    return { ...rest, annot: result }
  }

  deleteAnnotation(docId: string, pageIndex: number, id: string): MutationResult {
    const entry = this.entry(docId)
    const { result: _ignored, ...rest } = this.mutate(entry, 'delete', [pageIndex], () => {
      const page = this.page(entry, pageIndex)
      page.deleteAnnotation(this.findAnnot(page, pageIndex, id))
    })
    return rest
  }

  setAnnotationHidden(docId: string, pageIndex: number, id: string, hidden: boolean): void {
    const page = this.page(this.entry(docId), pageIndex)
    this.findAnnot(page, pageIndex, id).setHiddenForEditing(hidden)
  }

  getFields(docId: string, pageIndex: number): FieldData[] {
    const page = this.page(this.entry(docId), pageIndex)
    return page.getWidgets().map((widget, index) => this.fieldData(widget, pageIndex, annotId(widget, pageIndex, index)))
  }

  setFieldValue(docId: string, pageIndex: number, id: string, value: string | boolean): MutationResult & { fields: FieldData[] } {
    const entry = this.entry(docId)
    const rest = this.mutate(entry, 'form', [pageIndex], () => {
      const page = this.page(entry, pageIndex)
      const widget = page.getWidgets().find((w, i) => annotId(w, pageIndex, i) === id)
      if (!widget) throw new EngineError('not-found', `Field ${id} not found`)
      if (widget.isReadOnly()) return
      const type = widgetType(widget)
      if (type === 'text') widget.setTextValue(String(value))
      else if (type === 'combobox' || type === 'listbox') widget.setChoiceValue(String(value))
      else if (type === 'checkbox' || type === 'radio') {
        if (Boolean(value) !== widgetIsOn(widget)) widget.toggle()
      }
      widget.update()
      page.update()
    })
    return { history: rest.history, changed: rest.changed, fields: this.getFields(docId, pageIndex) }
  }

  pagesWithRedactions(docId: string): number[] {
    const doc = this.entry(docId).doc
    const pages: number[] = []
    for (let i = 0; i < doc.countPages(); i++) {
      const annots = child(doc.findPage(i), 'Annots')
      if (!annots.isArray()) continue
      for (let k = 0; k < annots.length; k++) {
        const subtype = child(annots.get(k), 'Subtype')
        if (subtype.isName() && subtype.asName() === 'Redact') {
          pages.push(i)
          break
        }
      }
    }
    return pages
  }

  applyRedactions(docId: string, fill: RedactFill): MutationResult & { pages: number[] } {
    const entry = this.entry(docId)
    const pages = this.pagesWithRedactions(docId)
    if (pages.length === 0) return { history: this.historyOf(entry), changed: [], pages }
    const rest = this.mutate(entry, 'redact-apply', pages, () => {
      for (const i of pages) {
        const page = this.page(entry, i)
        const areas = page
          .getAnnotations()
          .filter((a) => a.getType() === 'Redact')
          .map((a) => (a.hasQuadPoints() && a.getQuadPoints().length > 0 ? quadsBounds(a.getQuadPoints() as Quad[])! : normalizeRect(a.getRect())))
        this.removeFieldsUnder(entry.doc, page, areas)
        page.applyRedactions(
          fill === 'black',
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE
        )
        page.getObject().delete('Thumb')
      }
    })
    entry.redacted = true
    return { history: rest.history, changed: rest.changed, pages }
  }

  private removeFieldsUnder(doc: mupdf.PDFDocument, page: mupdf.PDFPage, areas: Rect[]): void {
    const fields = child(rootOf(doc), 'AcroForm', 'Fields')
    for (const widget of [...page.getWidgets()]) {
      const rect = normalizeRect(widget.getRect())
      if (!areas.some((a) => !isEmptyRect(intersectRect(a, rect)))) continue
      try {
        const type = widgetType(widget)
        if (type === 'text') widget.setTextValue('')
        else if (type === 'combobox' || type === 'listbox') widget.setChoiceValue('')
        else if ((type === 'checkbox' || type === 'radio') && widgetIsOn(widget)) widget.toggle()
      } catch {
      }
      const num = widget.getObject().asIndirect()
      if (num > 0 && fields.isArray()) removeFieldReference(fields, num)
      page.deleteAnnotation(widget)
    }
  }

  planTextEdit(docId: string, pageIndex: number, line: TextLine, text?: string): TextEditPlan {
    const entry = this.entry(docId)
    return planLineEdit(analyzeLine(this.page(entry, pageIndex), line), text)
  }

  replaceTextLine(docId: string, pageIndex: number, line: TextLine, text: string, options: TextEditOptions = {}): MutationResult {
    const entry = this.entry(docId)
    const { result: _r, ...rest } = this.mutate(entry, 'edit-text', [pageIndex], () => {
      const page = this.page(entry, pageIndex)
      const analysis = analyzeLine(page, line)
      removeLine(page, line.bbox)
      writeLine(entry.doc, page, analysis, text, options.fonts ?? [], options.size)
      page.update()
    })
    entry.redacted = true
    return rest
  }

  rotatePages(docId: string, pages: number[], delta: number): MutationResult {
    const entry = this.entry(docId)
    const { result: _r, ...rest } = this.mutate(entry, 'rotate', 'all', () => {
      for (const i of pages) {
        const obj = entry.doc.findPage(i)
        const current = obj.getInheritable('Rotate')
        obj.put('Rotate', normalizeRotation((current.isNumber() ? current.asNumber() : 0) + delta))
      }
    })
    return rest
  }

  deletePages(docId: string, pages: number[]): MutationResult {
    const entry = this.entry(docId)
    const count = entry.doc.countPages()
    const drop = [...new Set(pages)].filter((i) => i >= 0 && i < count)
    if (drop.length >= count) throw new EngineError('invalid', 'Cannot delete all pages')
    const { result: _r, ...rest } = this.mutate(entry, 'delete-pages', 'all', () => removePages(entry.doc, drop))
    entry.redacted = true
    return rest
  }

  movePages(docId: string, order: number[]): MutationResult {
    const entry = this.entry(docId)
    const count = entry.doc.countPages()
    const valid = order.length === count && new Set(order).size === count && order.every((i) => i >= 0 && i < count)
    if (!valid) throw new EngineError('invalid', 'Order must be a permutation of all pages')
    const { result: _r, ...rest } = this.mutate(entry, 'move-pages', 'all', () => reorderPages(entry.doc, order))
    return rest
  }

  insertBlankPage(docId: string, at: number, width: number, height: number): MutationResult {
    const entry = this.entry(docId)
    const { result: _r, ...rest } = this.mutate(entry, 'insert-page', 'all', () => {
      const obj = entry.doc.addPage([0, 0, width, height], 0, {}, '')
      entry.doc.insertPage(at, obj)
    })
    return rest
  }

  insertPagesFrom(docId: string, at: number, bytes: Uint8Array, password?: string): MutationResult & { count: number } {
    const entry = this.entry(docId)
    let source: mupdf.Document
    try {
      source = mupdf.Document.openDocument(bytes, 'application/pdf')
    } catch (error) {
      throw new EngineError('damaged', error instanceof Error ? error.message : String(error))
    }
    const src = source.asPDF()
    if (!src) {
      source.destroy()
      throw new EngineError('not-pdf', 'Not a PDF document')
    }
    try {
      if (src.needsPassword() && !(password && src.authenticatePassword(password))) {
        throw new EngineError('invalid', 'needs-password')
      }
      const count = src.countPages()
      const { result: _r, ...rest } = this.mutate(entry, 'insert-pages', 'all', () => this.graftPages(entry.doc, src, at))
      return { ...rest, count }
    } finally {
      src.destroy()
    }
  }

  extractPages(docId: string, pages: number[]): Uint8Array<ArrayBuffer> {
    const entry = this.entry(docId)
    const count = entry.doc.countPages()
    const wanted = [...new Set(pages)].filter((i) => i >= 0 && i < count)
    if (wanted.length === 0) throw new EngineError('invalid', 'No pages to extract')
    const copy = this.copyOf(entry)
    try {
      const keep = new Set(wanted)
      removePages(copy, Array.from({ length: count }, (_, i) => i).filter((i) => !keep.has(i)))
      const sorted = [...wanted].sort((a, b) => a - b)
      const order = wanted.map((p) => sorted.indexOf(p))
      if (order.some((v, i) => v !== i)) reorderPages(copy, order)
      const names = child(rootOf(copy), 'Names')
      if (names.isDictionary()) names.delete('EmbeddedFiles')
      return bytesOf(copy.saveToBuffer(SAVE_OPTIONS))
    } finally {
      copy.destroy()
    }
  }

  private copyOf(entry: DocEntry): mupdf.PDFDocument {
    const copy = mupdf.Document.openDocument(bytesOf(entry.doc.saveToBuffer(SAVE_OPTIONS)), 'application/pdf').asPDF()!
    if (copy.needsPassword() && !copy.authenticatePassword(entry.password ?? '')) {
      copy.destroy()
      throw new EngineError('invalid', 'Copy could not be decrypted')
    }
    return copy
  }

  private graftPages(dst: mupdf.PDFDocument, src: mupdf.PDFDocument, at: number): void {
    const count = src.countPages()
    const widgets: mupdf.PDFObject[] = []
    const pageIndex = new Map<number, number>()
    for (let i = 0; i < count; i++) pageIndex.set(src.findPage(i).asIndirect(), i)
    for (let i = 0; i < count; i++) {
      const annots = child(src.findPage(i), 'Annots')
      for (let k = 0; annots.isArray() && k < annots.length; k++) {
        const annot = annots.get(k)
        if (!annot.isDictionary()) continue
        annot.delete('P')
        const popup = annot.get('Popup')
        if (popup.isDictionary()) popup.delete('P')
        for (const action of actionsOf(annot)) {
          const dest = action.get('D')
          if (!isName(action.get('S'), 'GoTo') || !dest.isArray() || !dest.get(0).isIndirect()) continue
          const target = pageIndex.get(dest.get(0).asIndirect())
          if (target === undefined) action.delete('D')
          else dest.put(0, target)
        }
        if (isName(annot.get('Subtype'), 'Widget')) {
          stripSignature(annot)
          widgets.push(annot)
        }
      }
    }
    const map = dst.newGraftMap()
    try {
      for (let i = 0; i < count; i++) map.graftPage(at + i, src, i)
      for (let i = 0; i < count; i++) {
        const annots = child(src.findPage(i), 'Annots')
        if (!annots.isArray()) continue
        const target = dst.findPage(at + i)
        const list = dst.newArray()
        for (let k = 0; k < annots.length; k++) {
          const annot = annots.get(k)
          if (!annot.isDictionary() || isName(annot.get('Subtype'), 'Link')) continue
          const copy = map.graftObject(annot)
          copy.put('P', target)
          const popup = copy.get('Popup')
          if (popup.isDictionary()) popup.put('P', target)
          for (const action of actionsOf(copy)) {
            const dest = action.get('D')
            if (isName(action.get('S'), 'GoTo') && dest.isArray() && dest.get(0).isInteger()) dest.put(0, dst.findPage(at + dest.get(0).asNumber()))
          }
          list.push(copy)
        }
        if (list.length > 0) target.put('Annots', list)
      }
      mergeFields(dst, src, map, widgets)
    } finally {
      map.destroy()
    }
    for (let i = 0; i < count; i++) {
      const source = src.loadPage(i)
      const links = source.getLinks()
      if (links.length > 0) {
        const page = dst.loadPage(at + i)
        for (const link of links) {
          const target = link.isExternal() ? -1 : src.resolveLink(link)
          const uri = link.isExternal() ? link.getURI() : target >= 0 ? `#page=${at + target + 1}` : null
          if (uri) page.createLink(link.getBounds(), uri)
        }
        page.destroy()
      }
      source.destroy()
    }
  }

  undo(docId: string): MutationResult {
    const entry = this.entry(docId)
    if (!entry.doc.canUndo()) return { history: this.historyOf(entry), changed: [] }
    entry.doc.undo()
    this.dropCaches(entry)
    return { history: this.historyOf(entry), changed: 'all' }
  }

  redo(docId: string): MutationResult {
    const entry = this.entry(docId)
    if (!entry.doc.canRedo()) return { history: this.historyOf(entry), changed: [] }
    entry.doc.redo()
    this.dropCaches(entry)
    return { history: this.historyOf(entry), changed: 'all' }
  }

  save(docId: string, options: SaveOptions = {}): Uint8Array<ArrayBuffer> {
    const entry = this.entry(docId)
    if (options.flatten) {
      const copy = this.copyOf(entry)
      try {
        copy.bake(true, true)
        return bytesOf(copy.saveToBuffer(SAVE_OPTIONS))
      } finally {
        copy.destroy()
      }
    }
    const incremental = entry.hasSignedSignatures && !entry.redacted && entry.doc.canBeSavedIncrementally()
    return bytesOf(entry.doc.saveToBuffer(incremental ? 'incremental' : SAVE_OPTIONS))
  }

  journalPosition(docId: string): number {
    return this.entry(docId).doc.getJournal().position
  }

  markSaved(docId: string, position?: number): HistoryState {
    const entry = this.entry(docId)
    const current = entry.doc.getJournal().position
    entry.savedPosition = position ?? current
    return this.historyOf(entry)
  }

  private finishOpen(entry: DocEntry): void {
    const doc = entry.doc
    try {
      doc.disableJS()
    } catch {
    }
    doc.enableJournal()
    entry.savedPosition = doc.getJournal().position
    entry.hasSignedSignatures = visitFields(child(rootOf(doc), 'AcroForm', 'Fields'), (field) => {
      const ft = field.get('FT')
      return ft.isName() && ft.asName() === 'Sig' && !field.get('V').isNull()
    })
    entry.ready = true
  }

  private entry(docId: string, mustBeReady = true): DocEntry {
    const entry = this.docs.get(docId)
    if (!entry) throw new EngineError('not-found', `Document ${docId} is not open`)
    if (mustBeReady && !entry.ready) throw new EngineError('invalid', 'Document is locked with a password')
    return entry
  }

  private pageGeometry(doc: mupdf.PDFDocument, index: number): Omit<PageInfo, 'label'> {
    const obj = doc.findPage(index)
    const media = rectFromObject(obj.getInheritable('MediaBox')) ?? [0, 0, 612, 792]
    let box = rectFromObject(obj.getInheritable('CropBox')) ?? media
    box = intersectRect(box, media)
    if (isEmptyRect(box)) box = isEmptyRect(media) ? [0, 0, 612, 792] : media
    const unitObj = obj.get('UserUnit')
    const unit = unitObj.isNumber() && unitObj.asNumber() > 0 ? unitObj.asNumber() : 1
    const rotObj = obj.getInheritable('Rotate')
    const rotation = normalizeRotation(rotObj.isNumber() ? rotObj.asNumber() : 0)
    const w = (box[2] - box[0]) * unit
    const h = (box[3] - box[1]) * unit
    return rotation % 180 === 0 ? { width: w, height: h, rotation } : { width: h, height: w, rotation }
  }

  private page(entry: DocEntry, index: number): mupdf.PDFPage {
    if (index < 0 || index >= entry.doc.countPages()) throw new EngineError('not-found', `Page ${index} does not exist`)
    let page = entry.pages.get(index)
    if (page) {
      entry.pages.delete(index)
    } else {
      page = entry.doc.loadPage(index)
    }
    entry.pages.set(index, page)
    if (entry.pages.size > PAGE_CACHE_SIZE) {
      const oldest = entry.pages.keys().next().value as number
      entry.pages.delete(oldest)
      entry.stext.get(oldest)?.destroy()
      entry.stext.delete(oldest)
    }
    return page
  }

  private stext(entry: DocEntry, index: number): mupdf.StructuredText {
    let st = entry.stext.get(index)
    if (st) {
      entry.stext.delete(index)
    } else {
      st = this.page(entry, index).toStructuredText('')
    }
    entry.stext.set(index, st)
    if (entry.stext.size > STEXT_CACHE_SIZE) {
      const oldest = entry.stext.keys().next().value as number
      entry.stext.get(oldest)?.destroy()
      entry.stext.delete(oldest)
    }
    return st
  }

  private dropCaches(entry: DocEntry): void {
    entry.pages.clear()
    for (const st of entry.stext.values()) st.destroy()
    entry.stext.clear()
  }

  private invalidate(entry: DocEntry, changed: Changed): void {
    if (changed === 'all') {
      this.dropCaches(entry)
      return
    }
    for (const i of changed) {
      entry.stext.get(i)?.destroy()
      entry.stext.delete(i)
      const page = entry.pages.get(i)
      if (page) {
        page._annots = null
        page._widgets = null
      }
    }
  }

  private historyOf(entry: DocEntry): HistoryState {
    const journal = entry.doc.getJournal()
    return {
      canUndo: entry.doc.canUndo(),
      canRedo: entry.doc.canRedo(),
      dirty: journal.position !== entry.savedPosition,
      undoLabel: journal.position > 0 ? (journal.steps[journal.position - 1] ?? null) : null,
      redoLabel: journal.position < journal.steps.length ? (journal.steps[journal.position] ?? null) : null
    }
  }

  private mutate<T>(entry: DocEntry, label: string, changed: Changed, fn: () => T): MutationResult & { result: T } {
    if (entry.doc.getJournal().position < entry.savedPosition) entry.savedPosition = -1
    entry.doc.beginOperation(label)
    let result: T
    try {
      result = fn()
      entry.doc.endOperation()
    } catch (error) {
      try {
        entry.doc.abandonOperation()
      } catch {
      }
      this.dropCaches(entry)
      throw error
    }
    this.invalidate(entry, changed)
    return { result, history: this.historyOf(entry), changed }
  }

  private findAnnot(page: mupdf.PDFPage, pageIndex: number, id: string): mupdf.PDFAnnotation {
    const found =
      page.getAnnotations().find((a, i) => annotId(a, pageIndex, i) === id) ??
      page.getWidgets().find((w, i) => annotId(w, pageIndex, i) === id)
    if (!found) throw new EngineError('not-found', `Annotation ${id} not found on page ${pageIndex}`)
    return found
  }

  private updateAppearance(annot: mupdf.PDFAnnotation): void {
    const obj = annot.getObject()
    const image = obj.get(IMAGE_KEY)
    if (image.isNull()) {
      annot.update()
      return
    }
    const rotation = obj.get(IMAGE_ROTATION_KEY)
    const [x0, y0, x1, y1] = annot.getRect()
    const w = Math.max(1, x1 - x0)
    const h = Math.max(1, y1 - y0)
    annot.setAppearance(
      null,
      null,
      mupdf.Matrix.rotate(rotation.isNumber() ? rotation.asNumber() : 0),
      [0, 0, w, h],
      { XObject: { Im0: image } },
      `q ${w.toFixed(3)} 0 0 ${h.toFixed(3)} 0 0 cm /Im0 Do Q`
    )
  }

  private applySpec(doc: mupdf.PDFDocument, annot: mupdf.PDFAnnotation, spec: NewAnnot, rotation: number): void {
    const setRole = (role: AnnotRole): void => {
      annot.getObject().put(ROLE_KEY, doc.newName(role))
    }
    switch (spec.kind) {
      case 'highlight':
      case 'underline':
      case 'strikeout':
      case 'squiggly':
        annot.setColor(spec.color)
        annot.setQuadPoints(spec.quads)
        if (spec.opacity !== undefined) annot.setOpacity(spec.opacity)
        if (spec.contents) annot.setContents(spec.contents)
        break
      case 'freetext':
        annot.setRect(normalizeRect(spec.rect))
        annot.setDefaultAppearance(spec.font, spec.size, spec.color)
        annot.setContents(spec.text)
        annot.setBorderWidth(0)
        if (spec.role) setRole(spec.role)
        break
      case 'ink':
        annot.setColor(spec.color)
        annot.setBorderWidth(spec.width)
        annot.setInkList(spec.paths)
        if (spec.opacity !== undefined) annot.setOpacity(spec.opacity)
        if (spec.role) setRole(spec.role)
        break
      case 'square':
      case 'circle':
        annot.setRect(normalizeRect(spec.rect))
        annot.setColor(spec.color)
        annot.setInteriorColor(spec.fill ?? [])
        annot.setBorderWidth(spec.width)
        if (spec.opacity !== undefined) annot.setOpacity(spec.opacity)
        break
      case 'line':
        annot.setLine(spec.a, spec.b)
        annot.setColor(spec.color)
        annot.setBorderWidth(spec.width)
        annot.setLineEndingStyles('None', spec.arrow ? 'OpenArrow' : 'None')
        if (spec.opacity !== undefined) annot.setOpacity(spec.opacity)
        break
      case 'note':
        annot.setRect([spec.point[0], spec.point[1], spec.point[0] + 20, spec.point[1] + 20])
        annot.setColor(spec.color)
        annot.setIcon('Comment')
        annot.setContents(spec.contents)
        break
      case 'stamp': {
        annot.setRect(normalizeRect(spec.rect))
        const image = new mupdf.Image(spec.png)
        try {
          if (rotation === 0) {
            annot.setStampImage(image)
          } else {
            annot.getObject().put(IMAGE_KEY, doc.addImage(image))
            annot.getObject().put(IMAGE_ROTATION_KEY, rotation)
          }
        } finally {
          image.destroy()
        }
        setRole(spec.role)
        break
      }
      case 'redact':
        if (spec.quads && spec.quads.length > 0) annot.setQuadPoints(spec.quads)
        if (spec.rect) annot.setRect(normalizeRect(spec.rect))
        break
    }
  }

  private setFreeTextFont(annot: mupdf.PDFAnnotation, font: Partial<{ name: string; size: number; color: RGB }>): void {
    const da = annot.getDefaultAppearance()
    const current = toRGB(da.color) ?? [0, 0, 0]
    annot.setDefaultAppearance(font.name ?? da.font ?? 'Helv', font.size ?? (da.size || 12), font.color ?? current)
  }

  private annotData(annot: mupdf.PDFAnnotation, page: number, id: string): AnnotData {
    const type = annot.getType()
    const flags = annot.getFlags()
    const data: AnnotData = {
      id,
      page,
      kind: TYPE_TO_KIND[type] ?? 'other',
      subtype: type,
      bounds: normalizeRect(annot.getBounds()),
      color: toRGB(annot.getColor()),
      interiorColor: annot.hasInteriorColor() ? toRGB(annot.getInteriorColor()) : null,
      opacity: annot.getOpacity(),
      borderWidth: annot.hasBorder() ? annot.getBorderWidth() : 0,
      contents: annot.getContents() ?? '',
      author: annot.hasAuthor() ? annot.getAuthor() : '',
      modified: safeTime(() => annot.getModificationDate()),
      role: readRole(annot),
      locked: (flags & (mupdf.PDFAnnotation.IS_LOCKED | mupdf.PDFAnnotation.IS_READ_ONLY)) !== 0
    }
    if (annot.hasQuadPoints()) data.quads = annot.getQuadPoints() as Quad[]
    if (annot.hasInkList()) data.ink = annot.getInkList()
    if (annot.hasLine()) {
      const [a, b] = annot.getLine()
      data.line = [a, b]
    }
    if (annot.hasLineEndingStyles()) data.lineEnding = annot.getLineEndingStyles()
    if (annot.hasVertices()) data.vertices = annot.getVertices()
    if (type === 'FreeText') {
      const da = annot.getDefaultAppearance()
      data.font = { name: da.font, size: da.size, color: toRGB(da.color) ?? [0, 0, 0] }
    }
    if (annot.hasIcon()) data.icon = annot.getIcon()
    return data
  }

  private fieldData(widget: mupdf.PDFWidget, page: number, id: string): FieldData {
    const type = widgetType(widget)
    const flags = widget.getFieldFlags()
    let fontSize = 0
    try {
      fontSize = widget.getDefaultAppearance().size
    } catch {
      fontSize = 0
    }
    const isText = type === 'text'
    const isChoice = type === 'combobox' || type === 'listbox'
    return {
      id,
      page,
      rect: normalizeRect(widget.getRect()),
      type,
      name: widget.getName(),
      label: widget.getLabel(),
      value: widget.getValue(),
      checked: type === 'checkbox' || type === 'radio' ? widgetIsOn(widget) : false,
      options: isChoice ? widget.getOptions() : [],
      multiline: isText && widget.isMultiline(),
      password: isText && widget.isPassword(),
      readOnly: widget.isReadOnly(),
      required: (flags & mupdf.PDFWidget.FIELD_IS_REQUIRED) !== 0,
      comb: isText && widget.isComb(),
      maxLen: isText ? widget.getMaxLen() : 0,
      fontSize,
      signed: type === 'signature' && !widget.getObject().getInheritable('V').isNull()
    }
  }
}
