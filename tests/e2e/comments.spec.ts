import { expect, test } from '@playwright/test'
import { closeAll, inspect, launch, pagePoint, saveWithShortcut, waitForPage, workingCopy } from './helpers'

test.afterEach(closeAll)

test('ein Klick auf eine Notiz klappt den Kommentar direkt auf', async () => {
  const file = workingCopy('sample.pdf')
  const { win } = await launch([file])
  await waitForPage(win, 0)

  await win.keyboard.press('n')
  const noteAt = await pagePoint(win, 0, 520, 200)
  await win.mouse.click(noteAt.x, noteAt.y)
  const text = win.locator('.comment-popover textarea')
  await text.fill('Bitte prüfen')
  await win.locator('.comment-popover .btn-primary').click()
  await expect(text).toHaveCount(0)

  await win.mouse.click(noteAt.x, noteAt.y)
  await expect(text).toHaveValue('Bitte prüfen')

  const empty = await pagePoint(win, 0, 560, 60)
  await win.mouse.click(empty.x, empty.y)
  await expect(text).toHaveCount(0)

  await win.getByRole('button', { name: /^Kommentare$/ }).click()
  await win.locator('.comment-item').click()
  await expect(text).toHaveValue('Bitte prüfen')
  await text.press('Escape')
  await expect(text).toHaveCount(0)

  await win.keyboard.press('n')
  await win.mouse.click(noteAt.x, noteAt.y)
  await expect(text).toHaveValue('Bitte prüfen')
  await expect(win.locator('.comment-item')).toHaveCount(1)
  await text.press('Escape')

  await saveWithShortcut(win)
  const notes = inspect(file).annots.filter((a) => a.type === 'Text')
  expect(notes).toHaveLength(1)
  expect(notes[0].contents).toBe('Bitte prüfen')
})
