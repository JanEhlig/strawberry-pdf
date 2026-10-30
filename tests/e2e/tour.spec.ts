import { expect, test } from '@playwright/test'
import { closeAll, drag, inspect, launch, pagePoint, saveWithShortcut, waitForPage, waitForRender, workingCopy } from './helpers'

test.afterEach(closeAll)

test('Rundgang: Suche, Kommentare, Inhalt, Menü, Einstellungen (dunkel)', async () => {
  const file = workingCopy('sample.pdf')
  const { app, win } = await launch([file])
  await app.evaluate(({ nativeTheme }) => {
    nativeTheme.themeSource = 'dark'
  })
  await waitForPage(win, 0)
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/10-dunkel.png' })

  await win.keyboard.press('Control+f')
  await win.locator('.search-input').fill('Miete')
  await expect(win.locator('.search-status')).toContainText(/von|of/, { timeout: 10_000 })
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/11-suche.png' })
  await win.keyboard.press('Escape')

  await drag(win, await pagePoint(win, 0, 74, 84), await pagePoint(win, 0, 360, 84))
  await win.locator('.selection-bar button').nth(3).click()
  await win.locator('.comment-popover textarea').fill('Adresse prüfen')
  await win.locator('.comment-popover .btn-primary').click()
  await win.getByRole('button', { name: /^Kommentare$/ }).click()
  await expect(win.locator('.comment-item')).toHaveCount(1)
  await expect(win.locator('.comment-preview')).toHaveText('Adresse prüfen')
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/12-kommentare.png' })

  await win.getByRole('button', { name: /^Inhalt$/ }).click()
  await win.getByRole('button', { name: 'Kosten' }).click()
  await expect(win.locator('.page-input input')).toHaveValue('3')
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/13-inhalt.png' })

  await win.getByRole('button', { name: /Weitere Aktionen/ }).click()
  await win.screenshot({ path: 'test-results/14-menue.png' })
  await win.getByRole('menuitem', { name: /Einstellungen/ }).click()
  const dialog = win.getByRole('dialog', { name: 'Einstellungen' })
  await expect(dialog).toBeVisible()
  const name = dialog.locator('input.input').first()
  await name.fill('Jan Ehlig')
  await expect(name).toBeFocused()
  await win.screenshot({ path: 'test-results/15-einstellungen.png' })
  await dialog.getByRole('button', { name: /Fertig/ }).click()

  await saveWithShortcut(win)
  const result = inspect(file)
  expect(result.annots.find((a) => a.type === 'Highlight')?.contents).toBe('Adresse prüfen')
})

test('Rundgang: Text ändern, Formen, Seitenmenü', async () => {
  const file = workingCopy('sample.pdf')
  const { win } = await launch([file])
  await waitForPage(win, 0)

  const line = await pagePoint(win, 0, 200, 126)
  await win.mouse.click(line.x, line.y, { clickCount: 3 })
  await win.getByRole('button', { name: 'Text ändern' }).click()
  const editor = win.locator('.line-editor')
  await expect(editor).toBeVisible()
  await editor.fill('Die Parteien vereinbaren eine Übergabe am 1. März.')
  await win.screenshot({ path: 'test-results/17-text-aendern-editor.png' })
  await editor.press('Enter')
  await expect(editor).toHaveCount(0)
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/18-text-geaendert.png' })

  await win.keyboard.press('r')
  await drag(win, await pagePoint(win, 0, 80, 520), await pagePoint(win, 0, 260, 600))
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/19-formen.png' })

  await win.locator('.thumb').nth(1).click({ button: 'right' })
  await expect(win.getByRole('menuitem', { name: /Leere Seite/ })).toBeVisible()
  await win.screenshot({ path: 'test-results/20-seitenmenue.png' })
  await win.getByRole('menuitem', { name: /Leere Seite/ }).click()
  await expect(win.locator('.page-input .page-count')).toContainText('7')

  await saveWithShortcut(win)
  const result = inspect(file)
  expect(result.pages).toBe(7)
  expect(result.text[0]).toContain('Die Parteien vereinbaren eine Übergabe am 1. März.')
  expect(result.text[0]).not.toContain('Vertragsparteien')
  expect(result.annots.some((a) => a.type === 'Square')).toBe(true)
})
