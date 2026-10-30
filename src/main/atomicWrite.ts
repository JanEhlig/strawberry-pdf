import { constants } from 'node:fs'
import { access, open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { WriteFileError } from '../shared/api'

function classify(error: unknown): WriteFileError {
  const code = (error as NodeJS.ErrnoException)?.code
  const message = error instanceof Error ? error.message : String(error)
  if (code === 'EBUSY' || code === 'EPERM') return { code: 'locked', message }
  if (code === 'EACCES' || code === 'EROFS') return { code: 'denied', message }
  if (code === 'ENOENT') return { code: 'not-found', message }
  return { code: 'unknown', message }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

export async function writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  try {
    if (await exists(path)) {
      try {
        await access(path, constants.W_OK)
      } catch (error) {
        const denied = new Error((error as Error).message) as NodeJS.ErrnoException
        denied.code = 'EACCES'
        throw denied
      }
    }
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, path)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => undefined)
    const wrapped = new Error(JSON.stringify(classify(error)))
    wrapped.name = 'WriteFileError'
    throw wrapped
  }
}
