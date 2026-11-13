export interface SfntTable {
  offset: number
  length: number
}

export function tag(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
}

export function faceOffsets(view: DataView): number[] {
  if (view.byteLength < 12) return []
  if (tag(view, 0) !== 'ttcf') return [0]
  const count = view.getUint32(8)
  const offsets: number[] = []
  for (let i = 0; i < count && 12 + i * 4 + 4 <= view.byteLength; i++) offsets.push(view.getUint32(12 + i * 4))
  return offsets
}

export function sfntTables(view: DataView, faceOffset = 0): Map<string, SfntTable> {
  const tables = new Map<string, SfntTable>()
  if (faceOffset + 12 > view.byteLength) return tables
  const count = view.getUint16(faceOffset + 4)
  for (let i = 0; i < count; i++) {
    const record = faceOffset + 12 + i * 16
    if (record + 16 > view.byteLength) break
    tables.set(tag(view, record), { offset: view.getUint32(record + 8), length: view.getUint32(record + 12) })
  }
  return tables
}

export function glyphOutlines(bytes: Uint8Array): ((gid: number) => boolean) | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = sfntTables(view)
  const head = tables.get('head')
  const loca = tables.get('loca')
  const maxp = tables.get('maxp')
  if (!head || !loca || !maxp || head.offset + 52 > view.byteLength || maxp.offset + 6 > view.byteLength) return null
  const long = view.getInt16(head.offset + 50) === 1
  const count = view.getUint16(maxp.offset + 4)
  const entry = long ? 4 : 2
  if (loca.offset + (count + 1) * entry > view.byteLength) return null
  const at = (i: number): number => (long ? view.getUint32(loca.offset + i * 4) : view.getUint16(loca.offset + i * 2) * 2)
  return (gid) => gid >= 0 && gid < count && at(gid + 1) > at(gid)
}
