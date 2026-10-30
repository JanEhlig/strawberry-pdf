import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../../src/main/atomicWrite'

const errorCode = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'ok'
  } catch (error) {
    return (JSON.parse((error as Error).message) as { code: string }).code
  }
}

describe('Atomares Speichern', () => {
  it('ersetzt den Inhalt und hinterlässt keine Temp-Datei', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-atomic-'))
    const file = join(dir, 'vertrag.pdf')
    writeFileSync(file, 'alt')
    await writeFileAtomic(file, new TextEncoder().encode('neu'))
    expect(readFileSync(file, 'utf8')).toBe('neu')
    expect(readdirSync(dir)).toEqual(['vertrag.pdf'])
  })

  it('lässt schreibgeschützte Originale unversehrt und meldet „keine Berechtigung“', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-atomic-'))
    const file = join(dir, 'schreibgeschuetzt.pdf')
    writeFileSync(file, 'original')
    chmodSync(file, 0o444)
    try {
      expect(await errorCode(writeFileAtomic(file, new TextEncoder().encode('neu')))).toBe('denied')
      expect(readFileSync(file, 'utf8')).toBe('original')
      expect(readdirSync(dir)).toEqual(['schreibgeschuetzt.pdf'])
    } finally {
      chmodSync(file, 0o666)
    }
  })

  it('meldet einen fehlenden Ordner verständlich', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ks-atomic-'))
    expect(await errorCode(writeFileAtomic(join(dir, 'gibtsnicht', 'x.pdf'), new Uint8Array([1])))).toBe('not-found')
  })
})
