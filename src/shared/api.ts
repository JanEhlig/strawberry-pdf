export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

export type ThemeSetting = 'system' | 'light' | 'dark'
export type LanguageId = 'de' | 'en' | 'fr' | 'es' | 'it' | 'nl' | 'pl' | 'pt'
export type LanguageSetting = 'auto' | LanguageId

export type PaperSize = 'A4' | 'A3' | 'A5' | 'Letter' | 'Legal'
export type PrintScaling = 'fit' | 'actual' | 'shrink'
export type PrintOrientation = 'auto' | 'portrait' | 'landscape'
export type DuplexMode = 'simplex' | 'longEdge' | 'shortEdge'

export interface PrintPreferences {
  printer: string
  paper: PaperSize | 'printer'
  scaling: PrintScaling
  orientation: PrintOrientation
  duplex: DuplexMode | 'printer'
  gray: boolean
  markups: boolean
}

export interface Settings {
  authorName: string
  theme: ThemeSetting
  language: LanguageSetting
  highlightFields: boolean
  print: PrintPreferences
}

export interface SavedSignature {
  id: string
  kind: 'drawn' | 'typed' | 'image'
  dataUrl: string
  width: number
  height: number
  createdAt: number
}

export interface AppEnvironment {
  platform: string
  userName: string
  locale: string
  version: string
  isPackaged: boolean
}

export type StoreKey = 'settings' | 'signatures'

export interface WriteFileError {
  code: 'locked' | 'denied' | 'not-found' | 'unknown'
  message: string
}

export type SaveKind = 'pdf' | 'docx' | 'xlsx'

export interface FontQuery {
  name: string
  bold: boolean
  italic: boolean
  serif: boolean
  mono: boolean
  text: string
}

export interface SystemFont {
  file: string
  index: number
  family: string
  postscript: string
  weight: number
  italic: boolean
  exact: boolean
}

export interface PrinterSummary {
  name: string
  displayName: string
  isDefault: boolean
}

export interface PrintSettings {
  printer: string
  copies: number
  collate: boolean
  paper: PaperSize | 'printer'
  landscape: boolean
  duplex: DuplexMode | 'printer'
  color: boolean
  scaling: PrintScaling
}

export interface PrintJob {
  pages: Uint8Array[]
  sizes: { width: number; height: number }[]
  title: string
  settings?: PrintSettings
}

export interface StrawberryApi {
  getEnvironment(): Promise<AppEnvironment>
  showOpenDialog(): Promise<string[]>
  showSaveDialog(defaultPath: string, kind: SaveKind): Promise<string | null>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array): Promise<void>
  getPathForFile(file: File): string
  getRecent(): Promise<RecentFile[]>
  addRecent(path: string): Promise<RecentFile[]>
  removeRecent(path: string): Promise<RecentFile[]>
  loadStore<T>(key: StoreKey): Promise<T | null>
  saveStore(key: StoreKey, value: unknown): Promise<void>
  takeInitialFiles(): Promise<string[]>
  onOpenFiles(callback: (paths: string[]) => void): () => void
  setUnsaved(unsaved: boolean): void
  onCloseRequested(callback: () => void): () => void
  closeWindow(): void
  openExternal(url: string): Promise<void>
  showItemInFolder(path: string): void
  openPath(path: string): Promise<void>
  openDefaultAppsSettings(): void
  setTitleBarColors(colors: { color: string; symbolColor: string }): void
  setWindowTitle(title: string): void
  getPrinters(): Promise<PrinterSummary[]>
  print(job: PrintJob): Promise<boolean>
  matchFonts(query: FontQuery): Promise<SystemFont[]>
  readFont(file: string): Promise<Uint8Array>
}
