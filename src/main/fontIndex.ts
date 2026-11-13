import type { FileHandle } from 'node:fs/promises'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { faceOffsets, sfntTables, type SfntTable } from '@shared/sfnt'

export interface InstalledFont {
  file: string
  index: number
  family: string
  subfamily: string
  postscript: string
  weight: number
  italic: boolean
  mono: boolean
}

const FONT_FILE = /\.(ttf|otf|ttc|otc)$/i
const HEADER_BYTES = 64 * 1024

export function fontDirectories(platform = process.platform, env = process.env): string[] {
  if (platform === 'win32') {
    const dirs = [join(env.WINDIR ?? 'C:\\Windows', 'Fonts')]
    if (env.LOCALAPPDATA) dirs.push(join(env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'))
    return dirs
  }
  if (platform === 'darwin') return ['/System/Library/Fonts', '/Library/Fonts', join(homedir(), 'Library', 'Fonts')]
  return ['/usr/share/fonts', '/usr/local/share/fonts', join(homedir(), '.local', 'share', 'fonts'), join(homedir(), '.fonts')]
}

function decodeName(view: DataView, offset: number, length: number, utf16: boolean): string {
  let out = ''
  if (utf16) {
    for (let i = 0; i + 1 < length; i += 2) out += String.fromCharCode(view.getUint16(offset + i))
  } else {
    for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i))
  }
  return out
}

export function parseNames(view: DataView): Map<number, string> {
  const names = new Map<number, string>()
  const rank = new Map<number, number>()
  const count = view.getUint16(2)
  const strings = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12
    if (record + 12 > view.byteLength) break
    const platformId = view.getUint16(record)
    const encoding = view.getUint16(record + 2)
    const language = view.getUint16(record + 4)
    const id = view.getUint16(record + 6)
    const length = view.getUint16(record + 8)
    const offset = strings + view.getUint16(record + 10)
    if (offset + length > view.byteLength) continue
    const windows = platformId === 3 && (encoding === 1 || encoding === 10)
    const score = windows ? (language === 0x0409 ? 3 : 2) : platformId === 0 ? 2 : platformId === 1 && encoding === 0 ? 1 : 0
    if (score === 0 || score <= (rank.get(id) ?? 0)) continue
    rank.set(id, score)
    names.set(id, decodeName(view, offset, length, platformId !== 1).trim())
  }
  return names
}

export function describeFace(names: Map<number, string>, os2: DataView | null, post: DataView | null): Omit<InstalledFont, 'file' | 'index'> | null {
  const family = names.get(16) || names.get(1)
  if (!family) return null
  const subfamily = names.get(17) || names.get(2) || 'Regular'
  const weight = os2 && os2.byteLength >= 6 ? os2.getUint16(4) : /bold|black|heavy/i.test(subfamily) ? 700 : 400
  const selection = os2 && os2.byteLength >= 64 ? os2.getUint16(62) : 0
  return {
    family,
    subfamily,
    postscript: names.get(6) ?? '',
    weight: weight || 400,
    italic: (selection & 1) === 1 || /italic|oblique/i.test(subfamily),
    mono: !!post && post.byteLength >= 16 && post.getUint32(12) !== 0
  }
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<DataView> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, position)
  return new DataView(buffer.buffer, buffer.byteOffset, bytesRead)
}

async function tableView(handle: FileHandle, table: SfntTable | undefined): Promise<DataView | null> {
  if (!table || table.length === 0 || table.length > 4 * 1024 * 1024) return null
  return readAt(handle, table.offset, table.length)
}

async function readFaces(file: string): Promise<InstalledFont[]> {
  const handle = await open(file, 'r')
  try {
    const head = await readAt(handle, 0, HEADER_BYTES)
    const faces: InstalledFont[] = []
    const offsets = faceOffsets(head)
    for (let index = 0; index < offsets.length; index++) {
      const offset = offsets[index]
      const directory = offset + 12 <= head.byteLength ? head : await readAt(handle, offset, 4096)
      const tables = sfntTables(directory, directory === head ? offset : 0)
      const names = await tableView(handle, tables.get('name'))
      if (!names) continue
      const face = describeFace(parseNames(names), await tableView(handle, tables.get('OS/2')), await tableView(handle, tables.get('post')))
      if (face) faces.push({ file, index, ...face })
    }
    return faces
  } finally {
    await handle.close()
  }
}

async function listFiles(dir: string, depth = 0): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory() && depth < 3) files.push(...(await listFiles(path, depth + 1)))
    else if (FONT_FILE.test(entry.name)) files.push(path)
  }
  return files
}

export async function scanFonts(dirs = fontDirectories()): Promise<InstalledFont[]> {
  const files = (await Promise.all(dirs.map((dir) => listFiles(dir)))).flat()
  const fonts: InstalledFont[] = []
  for (const file of files) {
    try {
      fonts.push(...(await readFaces(file)))
    } catch {
    }
  }
  return fonts
}

let index: Promise<InstalledFont[]> | null = null

export function installedFonts(): Promise<InstalledFont[]> {
  index ??= scanFonts()
  return index
}
