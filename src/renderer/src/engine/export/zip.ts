export interface ZipEntry {
  name: string
  data: Uint8Array | string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1

export function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder()
  const files = entries.map((entry) => {
    const name = encoder.encode(entry.name)
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    return { name, data, crc: crc32(data) }
  })
  const localSize = files.reduce((sum, f) => sum + 30 + f.name.length + f.data.length, 0)
  const centralSize = files.reduce((sum, f) => sum + 46 + f.name.length, 0)
  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let offset = 0
  const offsets: number[] = []
  for (const f of files) {
    offsets.push(offset)
    view.setUint32(offset, 0x04034b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 0x0800, true)
    view.setUint16(offset + 8, 0, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, DOS_DATE, true)
    view.setUint32(offset + 14, f.crc, true)
    view.setUint32(offset + 18, f.data.length, true)
    view.setUint32(offset + 22, f.data.length, true)
    view.setUint16(offset + 26, f.name.length, true)
    view.setUint16(offset + 28, 0, true)
    out.set(f.name, offset + 30)
    out.set(f.data, offset + 30 + f.name.length)
    offset += 30 + f.name.length + f.data.length
  }
  const central = offset
  files.forEach((f, i) => {
    view.setUint32(offset, 0x02014b50, true)
    view.setUint16(offset + 4, 20, true)
    view.setUint16(offset + 6, 20, true)
    view.setUint16(offset + 8, 0x0800, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, 0, true)
    view.setUint16(offset + 14, DOS_DATE, true)
    view.setUint32(offset + 16, f.crc, true)
    view.setUint32(offset + 20, f.data.length, true)
    view.setUint32(offset + 24, f.data.length, true)
    view.setUint16(offset + 28, f.name.length, true)
    view.setUint32(offset + 42, offsets[i], true)
    out.set(f.name, offset + 46)
    offset += 46 + f.name.length
  })
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 8, files.length, true)
  view.setUint16(offset + 10, files.length, true)
  view.setUint32(offset + 12, offset - central, true)
  view.setUint32(offset + 16, central, true)
  return out
}
