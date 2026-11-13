import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '..', '..')
export const FIXTURES = join(ROOT, 'tests', 'fixtures')
export const QUIET = ['-r', join(ROOT, 'tests', 'e2e', 'offscreen.cjs')]

export interface LaunchedApp {
  app: ElectronApplication
  win: Page
  userData: string
}

const running: ElectronApplication[] = []

export async function closeAll(): Promise<void> {
  for (const app of running.splice(0)) {
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => undefined)
    await app.close().catch(() => undefined)
  }
}

export async function launch(files: string[] = [], userData = mkdtempSync(join(tmpdir(), 'strawberry-e2e-'))): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: [...QUIET, join(ROOT, 'out', 'main', 'index.js'), `--user-data-dir=${userData}`, ...files],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_RENDERER_URL: '' }
  })
  running.push(app)
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await win.setViewportSize({ width: 1360, height: 900 }).catch(() => undefined)
  return { app, win, userData }
}

export function workingCopy(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'strawberry-doc-'))
  const target = join(dir, name)
  copyFileSync(join(FIXTURES, name), target)
  return target
}

export interface Inspection {
  pages: number
  annots: { page: number; type: string; contents: string; role: string | null; rect: number[] }[]
  fields: { page: number; name: string; value: string }[]
  text: string[]
  lines: { page: number; text: string; font: string; size: number }[]
  rotation: number[]
  sizes: [number, number][]
  images: { page: number; bbox: number[] }[]
}

export function inspect(file: string): Inspection {
  const json = execFileSync(process.execPath, [join(ROOT, 'tests', 'e2e', 'inspect.mjs'), file], { cwd: ROOT, encoding: 'utf8' })
  return JSON.parse(json) as Inspection
}

export async function waitForPage(win: Page, index = 0): Promise<void> {
  const canvas = win.locator(`.page[data-page="${index}"] .page-canvas`)
  await expect(canvas).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => canvas.evaluate((c: HTMLCanvasElement) => c.width), { timeout: 20_000 }).toBeGreaterThan(10)
}

export async function waitForRender(win: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        win
          .locator('.page')
          .evaluateAll((pages) =>
            pages.every(
              (p) => p.getAttribute('data-version') === p.getAttribute('data-drawn') && p.getAttribute('data-scale') === p.getAttribute('data-drawn-scale')
            )
          ),
      { timeout: 10_000 }
    )
    .toBe(true)
}

export async function pagePoint(win: Page, index: number, x: number, y: number, pageWidthPt = 595): Promise<{ x: number; y: number }> {
  const box = await win.locator(`.page[data-page="${index}"]`).boundingBox()
  if (!box) throw new Error(`Seite ${index} nicht sichtbar`)
  const scale = box.width / pageWidthPt
  return { x: box.x + x * scale, y: box.y + y * scale }
}

export async function drag(win: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps })
  await win.mouse.up()
}

export async function saveWithShortcut(win: Page): Promise<void> {
  await win.keyboard.press('Control+s')
  await expect(win.locator('.toast').filter({ hasText: /Gespeichert|Saved/ })).toBeVisible({ timeout: 15_000 })
}
