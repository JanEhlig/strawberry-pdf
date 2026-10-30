import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, closeAll, launch, waitForPage, waitForRender } from './helpers'

test.afterEach(closeAll)

function makeLargePdf(): string {
  const dir = mkdtempSync(join(tmpdir(), 'strawberry-large-'))
  const target = join(dir, 'gross.pdf')
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'make-large.mjs'), join(ROOT, 'tests', 'fixtures', 'sample.pdf'), target, '600'], { cwd: ROOT })
  return target
}

test('große PDF öffnet schnell und springt flüssig', async () => {
  const file = makeLargePdf()
  const started = Date.now()
  const { win } = await launch([file])
  await waitForPage(win, 0)
  const opened = Date.now() - started
  console.log(`600 Seiten bis zur ersten gerenderten Seite: ${opened} ms`)
  expect(opened).toBeLessThan(8000)
  await expect(win.locator('.page-count')).toContainText('600')

  expect(await win.locator('.page').count()).toBeLessThan(8)

  const t0 = Date.now()
  const input = win.locator('.page-input input')
  await input.click()
  await input.fill('555')
  await input.press('Enter')
  await waitForPage(win, 554)
  await waitForRender(win)
  console.log(`Sprung zu Seite 555 und gerendert: ${Date.now() - t0} ms`)
  await win.screenshot({ path: 'test-results/26-gross.png' })

  const s0 = Date.now()
  await win.keyboard.press('Control+f')
  await win.locator('.search-input').fill('GEHEIM')
  await expect(win.locator('.search-status')).toContainText(/von 100|of 100/, { timeout: 30_000 })
  console.log(`Suche über 600 Seiten: ${Date.now() - s0} ms`)
  await win.keyboard.press('Escape')

  const current = Number(await win.locator('.page-input input').inputValue()) - 1
  const o0 = Date.now()
  await win.locator('.tool-tray').getByRole('button', { name: 'Seiten', exact: true }).click()
  await expect(win.locator('.org-card')).toHaveCount(600)
  await expect(win.locator('.org-card.selected')).toHaveAttribute('data-index', String(current))
  await expect(win.locator('.org-card.selected canvas')).toBeVisible()
  console.log(`Seitenübersicht mit 600 Seiten: ${Date.now() - o0} ms`)
  expect(await win.locator('.org-card canvas').count()).toBeLessThan(80)
  await win.screenshot({ path: 'test-results/33-gross-seiten.png' })
})
