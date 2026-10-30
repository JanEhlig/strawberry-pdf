import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FIXTURES, closeAll, inspect, launch, saveWithShortcut, waitForPage, workingCopy } from './helpers'

test.afterEach(closeAll)

const pagesButton = (win: Page) => win.locator('.tool-tray').getByRole('button', { name: 'Seiten', exact: true })
const trayButton = (win: Page, name: string) => win.locator('.tool-tray').getByRole('button', { name, exact: true })

async function dropPdf(win: Page, name: string, target: { x: number; y: number }): Promise<void> {
  const base64 = readFileSync(join(FIXTURES, name)).toString('base64')
  await win.evaluate(
    ({ base64, name, x, y }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], name, { type: 'application/pdf' }))
      const scroller = document.querySelector('.org-scroll')!
      for (const type of ['dragenter', 'dragover', 'drop']) {
        scroller.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y }))
      }
    },
    { base64, name, ...target }
  )
}

test('Seiten ordnen: aktuelle Seite löschen, Rückgängig, verschieben', async () => {
  const file = workingCopy('sample.pdf')
  const { win } = await launch([file])
  await waitForPage(win, 0)

  await pagesButton(win).click()
  const cards = win.locator('.org-card')
  await expect(cards).toHaveCount(6)
  await expect(win.locator('.org-card.selected')).toHaveAttribute('data-index', '0')
  await expect(win.locator('.org-card canvas').first()).toBeVisible()
  await win.waitForTimeout(400)
  await win.screenshot({ path: 'test-results/30-seiten-ordnen.png' })

  await trayButton(win, 'Löschen').click()
  await expect(cards).toHaveCount(5)
  await expect(win.locator('.toast').filter({ hasText: '1 Seite gelöscht' })).toBeVisible()
  await win.keyboard.press('Control+z')
  await expect(cards).toHaveCount(6)

  const target = await cards.nth(2).boundingBox()
  if (!target) throw new Error('Karte fehlt')
  await cards.nth(0).dragTo(cards.nth(2), { targetPosition: { x: target.width - 12, y: target.height / 2 } })
  await expect(win.locator('.org-card.selected')).toHaveAttribute('data-index', '2')

  await win.keyboard.press('ArrowRight')
  await expect(win.locator('.org-card.selected')).toHaveAttribute('data-index', '3')
  await win.keyboard.press('Delete')
  await expect(cards).toHaveCount(5)

  await cards.nth(4).click()
  await win.keyboard.press('Escape')
  await expect(win.locator('.org-card.selected')).toHaveCount(0)
  await expect(win.locator('.org')).toHaveCount(1)
  await win.keyboard.press('Escape')
  await expect(win.locator('.org')).toHaveCount(0)
  await expect(win.locator('.page-count')).toContainText('5')

  await saveWithShortcut(win)
  const result = inspect(file)
  expect(result.pages).toBe(5)
  expect(result.text[0]).toContain('Anlage 1')
  expect(result.text[2]).toContain('Mietvertrag')
  expect(result.text[3]).toContain('Vertrauliche Angaben')
})

test('PDF in die Seitenübersicht ziehen fügt sie an der Stelle ein', async () => {
  const file = workingCopy('sample.pdf')
  const { win } = await launch([file])
  await waitForPage(win, 0)
  await pagesButton(win).click()
  const cards = win.locator('.org-card')
  await expect(cards).toHaveCount(6)

  const second = await cards.nth(1).boundingBox()
  if (!second) throw new Error('Karte fehlt')
  await dropPdf(win, 'form.pdf', { x: second.x + 10, y: second.y + second.height / 2 })
  await expect(cards).toHaveCount(7)
  await expect(win.locator('.org-card.selected')).toHaveAttribute('data-index', '1')
  await expect(win.locator('.toast').filter({ hasText: '1 Seite eingefügt' })).toBeVisible()

  await saveWithShortcut(win)
  const result = inspect(file)
  expect(result.pages).toBe(7)
  expect(result.text[0]).toContain('Mietvertrag')
  expect(result.text[2]).toContain('Anlage 1')
  expect(result.fields.filter((f) => f.page === 1).length).toBeGreaterThan(0)
})

test('PDFs vom Startbildschirm zusammenfügen und speichern', async () => {
  const first = workingCopy('sample.pdf')
  const second = workingCopy('form.pdf')
  const target = join(mkdtempSync(join(tmpdir(), 'strawberry-combine-')), 'Gesamt.pdf')
  const { app, win } = await launch([])
  await app.evaluate(
    ({ dialog }, { paths, target }) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
    },
    { paths: [first, second], target }
  )

  await win.getByRole('button', { name: 'PDFs zusammenfügen' }).click()
  await expect(win.locator('.org-card')).toHaveCount(7)
  await expect(win.locator('.tab', { hasText: 'Zusammengefügt' })).toBeVisible()
  await expect(win.locator('.toast').filter({ hasText: '2 PDFs zusammengefügt' })).toBeVisible()
  await win.screenshot({ path: 'test-results/31-zusammengefuegt.png' })

  await saveWithShortcut(win)
  const result = inspect(target)
  expect(result.pages).toBe(7)
  expect(result.text[6]).toBe(inspect(second).text[0])
})

test('Doppelklick auf eine Karte öffnet die Seite', async () => {
  const { win } = await launch([workingCopy('sample.pdf')])
  await waitForPage(win, 0)
  await pagesButton(win).click()
  await win.locator('.org-card').nth(3).dblclick()
  await expect(win.locator('.org')).toHaveCount(0)
  await expect(win.locator('.page-input input')).toHaveValue('4')
})

test('Pfeil nach unten springt genau eine Zeile weiter', async () => {
  const { win } = await launch([workingCopy('sample.pdf')])
  await waitForPage(win, 0)
  await pagesButton(win).click()
  await expect(win.locator('.org-grid')).toBeFocused()
  const columns = await win.locator('.org-inner').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
  await win.keyboard.press('ArrowDown')
  await expect(win.locator('.org-card.selected')).toHaveAttribute('data-index', String(Math.min(5, columns)))
  await expect(win.locator('.org-grid')).toHaveAttribute('aria-activedescendant', `org-card-${Math.min(5, columns)}`)
})
