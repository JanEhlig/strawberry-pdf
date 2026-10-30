import { expect, test, type Page } from '@playwright/test'
import { closeAll, waitForRender, drag, inspect, launch, pagePoint, saveWithShortcut, waitForPage, workingCopy } from './helpers'

test.afterEach(closeAll)

async function gotoPage(win: Page, n: number): Promise<void> {
  const input = win.locator('.page-input input')
  await input.click()
  await input.fill(String(n))
  await input.press('Enter')
  await waitForPage(win, n - 1)
}

test('öffnet eine PDF, markiert Text und speichert', async () => {
  const file = workingCopy('sample.pdf')
  const { app, win } = await launch([file])
  await waitForPage(win, 0)
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/01-geoeffnet.png' })

  await drag(win, await pagePoint(win, 0, 74, 84), await pagePoint(win, 0, 360, 84))
  const bar = win.locator('.selection-bar')
  await expect(bar).toBeVisible()
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/02-auswahl.png' })
  await bar.locator('button').first().click()
  await expect(win.locator('.tab-dirty')).toBeVisible()
  await saveWithShortcut(win)
  await expect(win.locator('.tab-dirty')).toHaveCount(0)

  const result = inspect(file)
  expect(result.annots).toContainEqual(expect.objectContaining({ page: 0, type: 'Highlight' }))
  await app.close()
})

test('schreibt Text, zeichnet, setzt eine Notiz und Rückgängig funktioniert', async () => {
  const file = workingCopy('sample.pdf')
  const { app, win } = await launch([file])
  await waitForPage(win, 0)

  await win.keyboard.press('t')
  const textAt = await pagePoint(win, 0, 300, 420)
  await win.mouse.click(textAt.x, textAt.y)
  const editor = win.locator('.freetext-editor')
  await expect(editor).toBeVisible()
  await editor.type('Grüße aus Köln')
  await editor.press('Control+Enter')
  await expect(editor).toHaveCount(0)

  await win.keyboard.press('d')
  await drag(win, await pagePoint(win, 0, 100, 600), await pagePoint(win, 0, 260, 640), 20)

  await win.keyboard.press('n')
  const noteAt = await pagePoint(win, 0, 520, 200)
  await win.mouse.click(noteAt.x, noteAt.y)
  const popover = win.locator('.comment-popover textarea')
  await expect(popover).toBeVisible()
  await popover.fill('Bitte prüfen')
  await win.locator('.comment-popover .btn-primary').click()
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/03-anmerkungen.png' })

  await win.keyboard.press('Escape')
  await win.keyboard.press('Control+z')
  await win.keyboard.press('Control+z')
  await win.keyboard.press('Control+y')
  await win.keyboard.press('Control+y')
  await saveWithShortcut(win)

  const result = inspect(file)
  const types = result.annots.filter((a) => a.page === 0).map((a) => a.type)
  expect(types).toEqual(expect.arrayContaining(['FreeText', 'Ink', 'Text']))
  expect(result.annots.find((a) => a.type === 'FreeText')?.contents).toBe('Grüße aus Köln')
  expect(result.annots.find((a) => a.type === 'Text')?.contents).toBe('Bitte prüfen')
  await app.close()
})

test('schwärzt Text dauerhaft', async () => {
  const file = workingCopy('sample.pdf')
  const { app, win } = await launch([file])
  await waitForPage(win, 0)
  await gotoPage(win, 5)

  await win.keyboard.press('x')
  await drag(win, await pagePoint(win, 4, 72, 156), await pagePoint(win, 4, 520, 156))
  const apply = win.getByRole('button', { name: /Schwärzungen anwenden|Apply redactions/ })
  await expect(apply).toBeVisible()
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/04-schwaerzen-markiert.png' })
  await apply.click()
  await win.getByRole('button', { name: /Endgültig schwärzen|Redact permanently/ }).click()
  await expect(win.locator('.toast')).toBeVisible()
  await saveWithShortcut(win)
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/05-geschwaerzt.png' })

  const result = inspect(file)
  expect(result.text[4]).not.toContain('GEHEIM')
  expect(result.text[4]).toContain('IBAN')
  expect(result.annots.filter((a) => a.type === 'Redact')).toHaveLength(0)
  await app.close()
})

test('füllt ein Formular aus', async () => {
  const file = workingCopy('form.pdf')
  const { app, win } = await launch([file])
  await waitForPage(win, 0)

  const name = await pagePoint(win, 0, 150, 842 - 703)
  await win.mouse.click(name.x, name.y)
  const input = win.locator('input.field-editor')
  await expect(input).toBeVisible()
  await input.fill('Jan Müller')
  await input.press('Enter')
  await expect(input).toHaveCount(0)

  const checkbox = await pagePoint(win, 0, 81, 842 - 537)
  await win.mouse.click(checkbox.x, checkbox.y)
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/06-formular.png' })
  await saveWithShortcut(win)

  const result = inspect(file)
  expect(result.fields.find((f) => f.name === 'name')?.value).toBe('Jan Müller')
  expect(result.fields.find((f) => f.name === 'zustimmung')?.value).not.toBe('Off')
  await app.close()
})

test('dreht eine Seite über die Miniaturen', async () => {
  const file = workingCopy('sample.pdf')
  const { app, win } = await launch([file])
  await waitForPage(win, 0)
  const thumb = win.locator('.thumb').first()
  await thumb.hover()
  await thumb.getByRole('button', { name: /Nach rechts drehen|Rotate right/ }).click()
  await expect(win.locator('.tab-dirty')).toBeVisible()
  await saveWithShortcut(win)
  expect(inspect(file).rotation[0]).toBe(90)
  await app.close()
})

test('fragt beim Schließen nach ungespeicherten Änderungen', async () => {
  const file = workingCopy('sample.pdf')
  const { app, win } = await launch([file])
  await waitForPage(win, 0)
  await win.keyboard.press('d')
  await drag(win, await pagePoint(win, 0, 100, 500), await pagePoint(win, 0, 200, 520))
  await expect(win.locator('.tab-dirty')).toBeVisible()

  await win.keyboard.press('Control+w')
  const dialog = win.getByRole('dialog', { name: /Änderungen speichern|Save changes/ })
  await expect(dialog).toBeVisible()
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/07-ungespeichert.png' })
  await dialog.getByRole('button', { name: /Abbrechen|Cancel/ }).click()
  await expect(win.locator('.tab')).toHaveCount(1)

  await win.keyboard.press('Control+w')
  await win.getByRole('dialog').getByRole('button', { name: /Nicht speichern|Don't save/ }).click()
  await expect(win.locator('.tab')).toHaveCount(0)
  expect(inspect(file).annots).toHaveLength(0)
  await app.close()
})
