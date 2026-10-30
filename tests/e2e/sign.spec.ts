import { expect, test } from '@playwright/test'
import { closeAll, waitForRender, drag, inspect, launch, pagePoint, saveWithShortcut, waitForPage, workingCopy } from './helpers'

test.afterEach(closeAll)

test('zeichnet eine Signatur, setzt sie ein und verwendet sie wieder', async () => {
  const file = workingCopy('sample.pdf')
  const { app, win } = await launch([file])
  await waitForPage(win, 0)

  await win.keyboard.press('s')
  const target = await pagePoint(win, 0, 300, 420)
  await win.mouse.click(target.x, target.y)

  const dialog = win.getByRole('dialog', { name: /Signatur erstellen|Create signature/ })
  await expect(dialog).toBeVisible()
  const pad = dialog.locator('canvas').first()
  const box = await pad.boundingBox()
  if (!box) throw new Error('Zeichenfläche fehlt')
  await win.mouse.move(box.x + 40, box.y + box.height * 0.6)
  await win.mouse.down()
  for (let i = 0; i <= 40; i++) {
    const x = box.x + 40 + i * ((box.width - 80) / 40)
    const y = box.y + box.height * 0.55 + Math.sin(i / 4) * box.height * 0.18
    await win.mouse.move(x, y)
  }
  await win.mouse.up()
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/08-signatur-dialog.png' })
  await dialog.getByRole('button', { name: /Signatur einsetzen|Insert signature/ }).click()
  await expect(dialog).toHaveCount(0)

  await expect(win.locator('.annot-selection')).toBeVisible()
  await waitForRender(win)
  await win.screenshot({ path: 'test-results/09-signatur-gesetzt.png' })

  await win.keyboard.press('s')
  const second = await pagePoint(win, 0, 300, 540)
  await win.mouse.click(second.x, second.y)
  await expect(win.getByRole('dialog')).toHaveCount(0)

  await win.keyboard.press('v')
  const center = await pagePoint(win, 0, 300, 540)
  await drag(win, center, { x: center.x + 60, y: center.y - 20 })

  await saveWithShortcut(win)
  const result = inspect(file)
  const stamps = result.annots.filter((a) => a.type === 'Stamp')
  expect(stamps).toHaveLength(2)
  expect(stamps.every((s) => s.role === 'signature')).toBe(true)
  await app.close()
})

test('Strichstärke macht die Unterschrift dicker, auch nachträglich', async () => {
  const { win } = await launch([workingCopy('sample.pdf')])
  await waitForPage(win, 0)

  await win.keyboard.press('s')
  const target = await pagePoint(win, 0, 300, 420)
  await win.mouse.click(target.x, target.y)
  const dialog = win.getByRole('dialog', { name: 'Signatur erstellen' })
  const pad = dialog.locator('canvas').first()
  const box = await pad.boundingBox()
  if (!box) throw new Error('Zeichenfläche fehlt')
  await win.mouse.move(box.x + 60, box.y + box.height * 0.5)
  await win.mouse.down()
  for (let i = 0; i <= 30; i++) {
    await win.mouse.move(box.x + 60 + i * 12, box.y + box.height * 0.5 + Math.sin(i / 3) * 30)
  }
  await win.mouse.up()

  const ink = (): Promise<number> =>
    pad.evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let count = 0
      for (let i = 3; i < data.length; i += 4) if (data[i] > 128) count++
      return count
    })
  const weight = (name: string) => dialog.getByRole('button', { name, exact: true })

  await expect(weight('Mittel')).toHaveAttribute('aria-pressed', 'true')
  const medium = await ink()
  await weight('Sehr kräftig').click()
  const heavy = await ink()
  await weight('Fein').click()
  const fine = await ink()
  expect(heavy).toBeGreaterThan(medium * 1.8)
  expect(fine).toBeLessThan(medium * 0.8)

  await weight('Kräftig').click()
  await win.screenshot({ path: 'test-results/32-strichstaerke.png' })
  await dialog.getByRole('button', { name: 'Tippen', exact: true }).click()
  await expect(weight('Kräftig')).toHaveAttribute('aria-pressed', 'true')
  await expect(dialog.locator('.sig-font-sample').first()).toHaveCSS('-webkit-text-stroke-width', /^[1-9]/)
  await dialog.getByRole('button', { name: 'Bild', exact: true }).click()
  await expect(weight('Kräftig')).toHaveCount(0)
})
