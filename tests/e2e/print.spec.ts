import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeAll, inspect, launch, waitForPage, workingCopy } from './helpers'

test.afterEach(closeAll)

interface Printed {
  options: Electron.WebContentsPrintOptions
  html: string
  pdf: string
}

async function stubPrinting(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const printed: Printed[] = []
    Object.assign(globalThis, { printed })
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents)
    proto.getPrintersAsync = async () => [
      { name: 'Empfang', displayName: 'Empfang', description: '', options: {} },
      { name: 'Büro', displayName: 'Büro', description: '', options: {} }
    ]
    proto.print = function (this: Electron.WebContents, options: Electron.WebContentsPrintOptions, callback: (success: boolean, reason: string) => void) {
      const margin = options.margins?.marginType === 'none' ? 0 : 0.17
      void Promise.all([
        this.executeJavaScript('document.documentElement.outerHTML') as Promise<string>,
        this.printToPDF({
          pageSize: options.pageSize ?? 'A4',
          landscape: !!options.landscape,
          printBackground: true,
          margins: { top: margin, bottom: margin, left: margin, right: margin }
        })
      ]).then(([html, pdf]) => {
        printed.push({ options, html, pdf: pdf.toString('base64') })
        callback(true, '')
      })
    }
  })
}

const near = (value: number, expected: number): void => expect(Math.abs(value - expected)).toBeLessThan(2)

const jobs = (app: ElectronApplication): Promise<Printed[]> => app.evaluate(() => (globalThis as unknown as { printed: Printed[] }).printed)

function savePdf(job: Printed): string {
  const file = join(mkdtempSync(join(tmpdir(), 'strawberry-print-')), 'druck.pdf')
  writeFileSync(file, Buffer.from(job.pdf, 'base64'))
  return file
}

async function openPrintDialog(win: Page): Promise<ReturnType<Page['getByRole']>> {
  await win.keyboard.press('Control+p')
  const dialog = win.getByRole('dialog', { name: 'Drucken' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('Eigener Druckdialog: Drucker, Exemplare, Bereich, Graustufen, Beidseitig und gemerkte Einstellungen', async () => {
  const { app, win } = await launch([workingCopy('sample.pdf')])
  await waitForPage(win, 0)
  await stubPrinting(app)

  let dialog = await openPrintDialog(win)
  await expect(dialog.getByLabel('Drucker', { exact: true })).toHaveValue('Empfang')
  await expect(dialog.getByText('Seite 1 von 6')).toBeVisible()
  await dialog.getByLabel('Drucker', { exact: true }).selectOption('Büro')
  await dialog.getByLabel('Exemplare').fill('2')
  await dialog.getByRole('button', { name: 'Bereich' }).click()
  await dialog.getByLabel('Seitenbereich').fill('2-9')
  await expect(dialog.getByText('Seiten von 1 bis 6 angeben')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Drucken', exact: true })).toBeDisabled()
  await dialog.getByLabel('Seitenbereich').fill('2-3')
  await expect(dialog.getByText('Seite 1 von 2')).toBeVisible()
  await dialog.getByLabel('Graustufen').check()
  await dialog.getByLabel('Beidseitig').selectOption('longEdge')
  await dialog.getByLabel('Papier', { exact: true }).selectOption('A4')
  await win.screenshot({ path: 'test-results/40-druckdialog.png' })
  await dialog.getByRole('button', { name: 'Drucken', exact: true }).click()
  await expect(win.locator('.toast').filter({ hasText: 'An „Büro“ gesendet' })).toBeVisible()

  let [job] = await jobs(app)
  expect(job.options).toMatchObject({
    silent: true,
    deviceName: 'Büro',
    copies: 2,
    collate: true,
    color: false,
    duplexMode: 'longEdge',
    pageSize: 'A4',
    landscape: false,
    margins: { marginType: 'printableArea' }
  })
  expect(job.html.match(/class="sheet"/g)).toHaveLength(2)
  expect(job.html).not.toContain('--w: 842pt')

  dialog = await openPrintDialog(win)
  await expect(dialog.getByLabel('Drucker', { exact: true })).toHaveValue('Büro')
  await expect(dialog.getByLabel('Graustufen')).toBeChecked()
  await expect(dialog.getByLabel('Beidseitig')).toHaveValue('longEdge')
  await expect(dialog.getByLabel('Exemplare')).toHaveValue('1')
  await win.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await jobs(app)).length).toBe(2)
  job = (await jobs(app))[1]
  expect(job.options).toMatchObject({ deviceName: 'Büro', copies: 1, color: false })
  expect(job.html.match(/class="sheet"/g)).toHaveLength(6)
})

test('Druckbild: angepasst auf Hochformat mit gedrehten Querseiten, Originalgröße im Querformat', async () => {
  const { app, win } = await launch([workingCopy('sample.pdf')])
  await waitForPage(win, 0)
  await stubPrinting(app)

  let dialog = await openPrintDialog(win)
  await dialog.getByRole('button', { name: 'Drucken', exact: true }).click()
  await expect.poll(async () => (await jobs(app)).length).toBe(1)
  let result = inspect(savePdf((await jobs(app))[0]))
  expect(result.pages).toBe(6)
  for (const [width, height] of result.sizes) {
    near(width, 595)
    near(height, 842)
  }
  expect(result.images).toHaveLength(6)
  for (const { bbox } of result.images) {
    near(bbox[0], 12.2)
    near(bbox[2] - bbox[0], 571)
  }

  dialog = await openPrintDialog(win)
  await dialog.getByRole('button', { name: 'Bereich' }).click()
  await dialog.getByLabel('Seitenbereich').fill('3-4')
  await dialog.getByLabel('Größe').selectOption('actual')
  await dialog.getByRole('button', { name: 'Drucken', exact: true }).click()
  await expect.poll(async () => (await jobs(app)).length).toBe(2)
  const job = (await jobs(app))[1]
  expect(job.options).toMatchObject({ landscape: true, margins: { marginType: 'none' }, usePrinterDefaultPageSize: true })
  result = inspect(savePdf(job))
  expect(result.sizes).toHaveLength(2)
  for (const [width, height] of result.sizes) {
    near(width, 842)
    near(height, 595)
  }
  expect(result.images).toHaveLength(2)
  for (const { bbox } of result.images) {
    near(bbox[0], 0)
    near(bbox[2], 842)
  }
})

test('Windows-Druckdialog bleibt als Ausweg erreichbar', async () => {
  const { app, win } = await launch([workingCopy('form.pdf')])
  await waitForPage(win, 0)
  await stubPrinting(app)
  const dialog = await openPrintDialog(win)
  await dialog.getByRole('button', { name: 'Windows-Druckdialog …' }).click()
  await expect.poll(async () => (await jobs(app)).length).toBe(1)
  const [job] = await jobs(app)
  expect(job.options).toEqual({ silent: false, printBackground: true, margins: { marginType: 'printableArea' } })
  expect(job.html).toContain('<body class="fit">')
})
