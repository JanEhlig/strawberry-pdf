import { app } from 'electron'
import { mkdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { RecentFile, StoreKey } from '@shared/api'
import { writeFileAtomic } from './atomicWrite'

export { writeFileAtomic }

const MAX_RECENT = 12

function storePath(name: string): string {
  return join(app.getPath('userData'), `${name}.json`)
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(storePath(name), 'utf8')) as T
  } catch {
    return null
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFileAtomic(storePath(name), Buffer.from(JSON.stringify(value, null, 2), 'utf8'))
}

export function loadStore<T>(key: StoreKey): Promise<T | null> {
  return readJson<T>(key)
}

export function saveStore(key: StoreKey, value: unknown): Promise<void> {
  return writeJson(key, value)
}

export async function getRecent(): Promise<RecentFile[]> {
  return (await readJson<RecentFile[]>('recent')) ?? []
}

export async function addRecent(path: string): Promise<RecentFile[]> {
  const list = (await getRecent()).filter((r) => r.path.toLowerCase() !== path.toLowerCase())
  list.unshift({ path, name: basename(path), openedAt: Date.now() })
  const trimmed = list.slice(0, MAX_RECENT)
  await writeJson('recent', trimmed)
  app.addRecentDocument(path)
  return trimmed
}

export async function removeRecent(path: string): Promise<RecentFile[]> {
  const list = (await getRecent()).filter((r) => r.path.toLowerCase() !== path.toLowerCase())
  await writeJson('recent', list)
  return list
}
