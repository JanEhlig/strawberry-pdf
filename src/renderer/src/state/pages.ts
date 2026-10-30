import { EngineCallError, engine } from '@renderer/engine/client'
import type { MutationResult } from '@renderer/engine/types'
import { askPassword } from '@renderer/dialogs/PasswordDialog'
import { t } from '@renderer/i18n'
import { platform, type OpenedFile } from '@renderer/platform'
import { toast, type TabEntry } from '@renderer/state/appStore'
import { settlePendingRedactions } from '@renderer/state/redactions'

export function reorder(count: number, moving: number[], target: number): number[] {
  const set = new Set(moving)
  const block = [...set].sort((a, b) => a - b)
  const rest: number[] = []
  for (let i = 0; i < count; i++) if (!set.has(i)) rest.push(i)
  const before = rest.filter((i) => i < target).length
  return [...rest.slice(0, before), ...block, ...rest.slice(before)]
}

async function run(tab: TabEntry, task: () => Promise<MutationResult>): Promise<boolean> {
  try {
    const result = await task()
    await tab.store.getState().applyMutation(result)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast(t('error.generic', { message }), 'error')
    return false
  }
}

export function rotatePages(tab: TabEntry, pages: number[], delta: number): Promise<boolean> {
  const { docId } = tab.store.getState()
  return run(tab, () => engine().call('rotatePages', docId, pages, delta))
}

export async function deletePages(tab: TabEntry, pages: number[]): Promise<boolean> {
  const { docId, info } = tab.store.getState()
  if (pages.length >= info.pages.length) {
    toast(t('pages.cannotDeleteAll'), 'error')
    return false
  }
  const ok = await run(tab, () => engine().call('deletePages', docId, pages))
  if (ok) tab.store.getState().setSelectedPages([])
  return ok
}

export async function movePages(tab: TabEntry, moving: number[], target: number): Promise<boolean> {
  const { docId, info } = tab.store.getState()
  const order = reorder(info.pages.length, moving, target)
  if (order.every((v, i) => v === i)) return false
  const ok = await run(tab, () => engine().call('movePages', docId, order))
  if (ok) {
    const first = order.indexOf(Math.min(...moving))
    tab.store.getState().setSelectedPages(moving.map((_, i) => first + i))
  }
  return ok
}

export function insertBlankPage(tab: TabEntry, after: number): Promise<boolean> {
  const { docId, info } = tab.store.getState()
  const ref = info.pages[Math.max(0, Math.min(after, info.pages.length - 1))]
  const portrait = ref.rotation % 180 === 0
  const width = portrait ? ref.width : ref.height
  const height = portrait ? ref.height : ref.width
  return run(tab, () => engine().call('insertBlankPage', docId, after + 1, width, height))
}

export async function insertFile(tab: TabEntry, at: number, file?: OpenedFile, quiet = false): Promise<number> {
  const files = file ? [file] : await platform.pickPdfFiles()
  let position = at
  for (const f of files) {
    const { docId } = tab.store.getState()
    let password: string | undefined
    for (;;) {
      try {
        const bytes = new Uint8Array(f.data)
        const result = await engine().callTransfer('insertPagesFrom', [bytes.buffer], docId, position, bytes, password)
        await tab.store.getState().applyMutation(result)
        if (!quiet) toast(t('pages.inserted', { n: result.count }), 'success')
        position += result.count
        break
      } catch (error) {
        if (error instanceof EngineCallError && error.message === 'needs-password') {
          const entered = await askPassword(f.name, password !== undefined)
          if (entered === null) break
          password = entered
          continue
        }
        toast(`${t('error.openFailed', { name: f.name })} ${error instanceof Error ? error.message : ''}`, 'error')
        break
      }
    }
  }
  return position - at
}

export async function extractPages(tab: TabEntry, pages: number[]): Promise<void> {
  if (!(await settlePendingRedactions(tab))) return
  const { docId, fileName, filePath } = tab.store.getState()
  const sorted = [...pages].sort((a, b) => a - b)
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = await engine().call('extractPages', docId, sorted)
  } catch (error) {
    toast(t('error.generic', { message: error instanceof Error ? error.message : String(error) }), 'error')
    return
  }
  const stem = fileName.replace(/\.pdf$/i, '')
  const range = sorted.length === 1 ? `${sorted[0] + 1}` : `${sorted[0] + 1}-${sorted[sorted.length - 1] + 1}`
  const target = await platform.saveAs(t('pages.extractName', { name: stem, range }), filePath, bytes)
  if (target) toast(t('pages.extracted', { name: target.name }), 'success')
}
