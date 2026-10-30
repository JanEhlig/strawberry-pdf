import { expect, test } from '@playwright/test'
import { closeAll, drag, launch, pagePoint, waitForPage, waitForRender, workingCopy } from './helpers'

test.afterEach(closeAll)

test('Dunkles Erscheinungsbild', async () => {
  const { win } = await launch([workingCopy('form.pdf'), workingCopy('sample.pdf')])
  await waitForPage(win, 0)
  await win.getByRole('button', { name: /Weitere Aktionen/ }).click()
  await win.getByRole('menuitem', { name: /Einstellungen/ }).click()
  const dialog = win.getByRole('dialog', { name: 'Einstellungen' })
  await dialog.getByRole('button', { name: 'Dunkel' }).click()
  await expect(win.locator('html')).toHaveAttribute('data-theme', 'dark')
  await win.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  await win.keyboard.press('h')
  await drag(win, await pagePoint(win, 0, 74, 84), await pagePoint(win, 0, 300, 84))
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/21-dunkel-markieren.png' })

  await win.locator('.tab').first().click()
  await waitForPage(win, 0)
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/22-dunkel-formular.png' })

  await win.keyboard.press('s')
  const at = await pagePoint(win, 0, 186, 230)
  await win.mouse.click(at.x, at.y)
  await expect(win.getByRole('dialog', { name: /Signatur erstellen/ })).toBeVisible()
  await win.getByRole('button', { name: 'Tippen' }).click()
  await win.waitForTimeout(400)
  await win.screenshot({ path: 'test-results/23-dunkel-signatur-tippen.png' })
  await win.keyboard.press('Escape')

  await win.keyboard.press('Control+w')
  await win.keyboard.press('Control+w')
  await win.screenshot({ path: 'test-results/25-dunkel-rueckfrage.png' })
  await win.getByRole('dialog').getByRole('button', { name: /Nicht speichern/ }).click()
  await expect(win.locator('.start')).toBeVisible()
  await win.screenshot({ path: 'test-results/24-dunkel-start.png' })
})
