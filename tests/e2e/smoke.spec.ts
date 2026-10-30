import { expect, test } from '@playwright/test'
import { closeAll, launch } from './helpers'

test.afterEach(closeAll)

test('startet mit Startbildschirm', async () => {
  const { app, win } = await launch()
  await expect(win.getByRole('button', { name: /PDF öffnen|Open PDF/ }).first()).toBeVisible({ timeout: 20_000 })
  await win.screenshot({ path: 'test-results/00-start.png' })
  await app.close()
})
