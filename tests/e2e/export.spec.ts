import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAll, launch, waitForPage, workingCopy } from './helpers'

test.afterEach(closeAll)

interface Recorded {
  filters: string[][]
  opened: string[]
}

async function stubShell(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog, shell }, dir) => {
    const recorded: Recorded = { filters: [], opened: [] }
    Object.assign(globalThis, { recorded })
    dialog.showSaveDialog = (async (_win: unknown, options: Electron.SaveDialogOptions) => {
      recorded.filters.push(options.filters?.flatMap((f) => f.extensions) ?? [])
      const name = (options.defaultPath ?? '').split(/[\\/]/).pop()
      return { canceled: false, filePath: `${dir}\\${name}` }
    }) as unknown as typeof dialog.showSaveDialog
    shell.openPath = (async (path: string) => {
      recorded.opened.push(path)
      return ''
    }) as typeof shell.openPath
  }, dir)
}

const recorded = (app: ElectronApplication): Promise<Recorded> => app.evaluate(() => (globalThis as unknown as { recorded: Recorded }).recorded)

async function exportAs(win: Page, item: string): Promise<void> {
  await win.getByRole('button', { name: /Weitere Aktionen/ }).click()
  await win.getByRole('menuitem', { name: item }).click()
}

test('Als Word und Excel exportieren und gleich öffnen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'strawberry-export-'))
  const { app, win } = await launch([workingCopy('sample.pdf')])
  await waitForPage(win, 0)
  await stubShell(app, dir)

  await exportAs(win, 'Als Word-Datei exportieren …')
  const done = win.locator('.toast').filter({ hasText: 'Exportiert als „sample.docx“' })
  await expect(done).toBeVisible({ timeout: 20_000 })
  const docx = readFileSync(join(dir, 'sample.docx'))
  expect(docx.subarray(0, 2).toString()).toBe('PK')
  expect(docx.toString('utf8')).toContain('Mietvertrag Musterstraße 12')
  await done.getByRole('button', { name: 'Öffnen' }).click()

  await exportAs(win, 'Als Excel-Datei exportieren …')
  await expect(win.locator('.toast').filter({ hasText: 'Exportiert als „sample.xlsx“' })).toBeVisible({ timeout: 20_000 })
  const xlsx = readFileSync(join(dir, 'sample.xlsx')).toString('utf8')
  expect(xlsx).toContain('name="Seite 1"')
  expect(xlsx).toContain('<v>850</v>')

  const calls = await recorded(app)
  expect(calls.filters).toEqual([['docx'], ['xlsx']])
  expect(calls.opened).toEqual([join(dir, 'sample.docx')])
})
