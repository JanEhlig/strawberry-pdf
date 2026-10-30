import { t } from '@renderer/i18n'
import type { OpenedFile } from '@renderer/platform'
import { deletePages, extractPages, insertBlankPage, insertFile, movePages, rotatePages } from '@renderer/state/pages'
import { toast, type TabEntry } from '@renderer/state/appStore'

function insertionPoint(tab: TabEntry): number {
  const { selectedPages, info } = tab.store.getState()
  return selectedPages.length > 0 ? Math.max(...selectedPages) + 1 : info.pages.length
}

function showPages(tab: TabEntry, from: number, count: number): void {
  const s = tab.store.getState()
  s.setSelectedPages(Array.from({ length: count }, (_, i) => from + i))
  s.goTo(from)
}

export async function insertPdfs(tab: TabEntry, at = insertionPoint(tab), files?: OpenedFile[]): Promise<void> {
  let count = 0
  if (files) for (const file of files) count += await insertFile(tab, at + count, file, true)
  else count = await insertFile(tab, at, undefined, true)
  if (count === 0) return
  showPages(tab, at, count)
  toast(t('pages.inserted', { n: count }), 'success')
}

export async function insertBlank(tab: TabEntry): Promise<void> {
  const at = insertionPoint(tab)
  if (await insertBlankPage(tab, at - 1)) showPages(tab, at, 1)
}

export function rotateSelected(tab: TabEntry, delta: number): void {
  const pages = tab.store.getState().selectedPages
  if (pages.length > 0) void rotatePages(tab, pages, delta)
}

export function extractSelected(tab: TabEntry): void {
  const pages = tab.store.getState().selectedPages
  if (pages.length > 0) void extractPages(tab, pages)
}

const deleting = new WeakSet<TabEntry>()

export async function removePages(tab: TabEntry, pages = tab.store.getState().selectedPages): Promise<void> {
  if (pages.length === 0 || deleting.has(tab)) return
  deleting.add(tab)
  try {
    if (await deletePages(tab, pages)) {
      toast(t('organize.deleted', { n: pages.length }), 'info', { label: t('common.undo'), run: () => void tab.store.getState().undo() })
    }
  } finally {
    deleting.delete(tab)
  }
}

export async function moveTo(tab: TabEntry, pages: number[], target: number): Promise<void> {
  if (!(await movePages(tab, pages, target))) return
  const first = tab.store.getState().selectedPages[0]
  if (first !== undefined) tab.store.getState().goTo(first)
}

export function selectPage(tab: TabEntry, index: number): void {
  const s = tab.store.getState()
  s.setSelectedPages([index])
  s.goTo(index)
}

export function openPage(tab: TabEntry, index: number): void {
  const s = tab.store.getState()
  s.setOrganize(false)
  s.goTo(index)
}

export function leaveOrganize(tab: TabEntry): void {
  tab.store.getState().setOrganize(false)
}
