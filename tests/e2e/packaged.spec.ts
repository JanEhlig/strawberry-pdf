import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROOT, waitForPage, waitForRender, workingCopy } from './helpers'

const EXE = join(ROOT, 'release', 'win-unpacked', 'Strawberry PDF.exe')

test.skip(!existsSync(EXE), 'Erst mit npm run dist bauen')

test('gepackte App öffnet eine PDF per Kommandozeile (wie Doppelklick)', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'strawberry-packaged-'))
  const app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${userData}`, workingCopy('sample.pdf')] })
  try {
    const win = await app.firstWindow()
    await waitForPage(win, 0)
    await waitForRender(win)
    await expect(win.locator('.tab')).toHaveCount(1)
    await win.screenshot({ path: 'test-results/29-gepackt.png' })
  } finally {
    await app.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined)
  }
})
