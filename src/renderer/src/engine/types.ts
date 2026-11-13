export type Rect = [number, number, number, number]
export type Point = [number, number]
export type Quad = [number, number, number, number, number, number, number, number]
export type RGB = [number, number, number]

export interface PageInfo {
  width: number
  height: number
  rotation: number
  label: string | null
}

export interface OutlineNode {
  title: string
  page: number | null
  uri: string | null
  open: boolean
  children: OutlineNode[]
}

export interface DocPermissions {
  print: boolean
  copy: boolean
  edit: boolean
  annotate: boolean
  form: boolean
  assemble: boolean
}

export interface DocMetadata {
  title: string
  author: string
  subject: string
  keywords: string
  creator: string
  producer: string
  creationDate: string
  modDate: string
  format: string
  encryption: string
}

export interface DocInfo {
  docId: string
  pages: PageInfo[]
  outline: OutlineNode[]
  metadata: DocMetadata
  permissions: DocPermissions
  hasForms: boolean
  hasSignedSignatures: boolean
  wasRepaired: boolean
}

export type OpenResult =
  | { status: 'ok'; info: DocInfo }
  | { status: 'needs-password'; docId: string; retry: boolean }

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
  undoLabel: string | null
  redoLabel: string | null
}

export type Changed = number[] | 'all'

export interface MutationResult {
  history: HistoryState
  changed: Changed
}

export interface RenderedImage {
  width: number
  height: number
  x: number
  y: number
  pixels: Uint8ClampedArray<ArrayBuffer>
}

export type AnnotKind =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  | 'freetext'
  | 'ink'
  | 'square'
  | 'circle'
  | 'line'
  | 'polygon'
  | 'polyline'
  | 'note'
  | 'stamp'
  | 'redact'
  | 'other'

export type FontName = 'Helv' | 'TiRo' | 'Cour'

export type AnnotRole = 'signature' | 'image' | 'check' | 'cross' | 'date'

export interface AnnotFont {
  name: string
  size: number
  color: RGB
}

export interface AnnotData {
  id: string
  page: number
  kind: AnnotKind
  subtype: string
  bounds: Rect
  color: RGB | null
  interiorColor: RGB | null
  opacity: number
  borderWidth: number
  contents: string
  author: string
  modified: number | null
  quads?: Quad[]
  ink?: Point[][]
  line?: [Point, Point]
  lineEnding?: { start: string; end: string }
  vertices?: Point[]
  font?: AnnotFont
  icon?: string
  role: AnnotRole | null
  locked: boolean
}

export type MarkupKind = 'highlight' | 'underline' | 'strikeout' | 'squiggly'

export type NewAnnot =
  | { kind: MarkupKind; quads: Quad[]; color: RGB; opacity?: number; contents?: string }
  | { kind: 'freetext'; rect: Rect; text: string; font: FontName; size: number; color: RGB; role?: 'date' }
  | { kind: 'ink'; paths: Point[][]; color: RGB; width: number; opacity?: number; role?: 'check' | 'cross' }
  | { kind: 'square' | 'circle'; rect: Rect; color: RGB; fill: RGB | null; width: number; opacity?: number }
  | { kind: 'line'; a: Point; b: Point; color: RGB; width: number; arrow: boolean; opacity?: number }
  | { kind: 'note'; point: Point; contents: string; color: RGB }
  | { kind: 'stamp'; rect: Rect; png: Uint8Array; role: 'signature' | 'image' }
  | { kind: 'redact'; quads?: Quad[]; rect?: Rect }

export interface AnnotPatch {
  color?: RGB | null
  interiorColor?: RGB | null
  opacity?: number
  borderWidth?: number
  contents?: string
  font?: Partial<{ name: FontName; size: number; color: RGB }>
  arrow?: boolean
}

export type FieldType = 'text' | 'checkbox' | 'radio' | 'combobox' | 'listbox' | 'button' | 'signature' | 'unknown'

export interface FieldData {
  id: string
  page: number
  rect: Rect
  type: FieldType
  name: string
  label: string
  value: string
  checked: boolean
  options: string[]
  multiline: boolean
  password: boolean
  readOnly: boolean
  required: boolean
  comb: boolean
  maxLen: number
  fontSize: number
  signed: boolean
}

export interface LinkData {
  rect: Rect
  uri: string | null
  page: number | null
}

export interface TextSelection {
  quads: Quad[]
  text: string
}

export type SelectMode = 'chars' | 'words' | 'lines'

export interface SearchHit {
  page: number
  quads: Quad[]
}

export interface TextFont {
  name: string
  bold: boolean
  italic: boolean
  serif: boolean
  mono: boolean
}

export interface TextLine {
  bbox: Rect
  size: number
  font: TextFont
  text: string
  origin: Point
  color: RGB
}

export interface TextEditPlan {
  text: string
  font: TextFont
  size: number
  missing: string
}

export interface FontProgram {
  name: string
  data: Uint8Array
  index: number
}

export interface TextEditOptions {
  fonts?: FontProgram[]
  size?: number
}

export type RedactFill = 'black' | 'white'

export type ExportFormat = 'docx' | 'xlsx'

export type DecimalMark = ',' | '.'

export interface ExportOptions {
  sheetLabel: string
  decimalMark: DecimalMark
}

export interface PrintRenderOptions {
  dpi: number
  gray: boolean
  markups: boolean
  turn: boolean
}

export interface SaveOptions {
  flatten?: boolean
}
