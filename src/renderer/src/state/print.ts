import type { PrintJob, PrintSettings } from '@shared/api'
import { askPrint } from '@renderer/dialogs/PrintDialog'
import { engine } from '@renderer/engine/client'
import { t } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import { dismissToast, toast, useApp, type TabEntry } from './appStore'
import { planPrint, resolvePrinter, turned, type PlannedPage } from './printPlan'
import { settlePendingRedactions } from './redactions'
import { applySettings } from './settings'

const PRINT_DPI = 200
const LARGE_JOB_DPI = 150
const LARGE_JOB = 60

type RenderedJob = Omit<PrintJob, 'settings'>

async function renderJob(tab: TabEntry, planned: PlannedPage[], look: { gray: boolean; markups: boolean }): Promise<RenderedJob | null> {
  const { docId, fileName, info } = tab.store.getState()
  const dpi = planned.length > LARGE_JOB ? LARGE_JOB_DPI : PRINT_DPI
  const progress = toast(t('toast.printing'), 'info', undefined, Math.min(20_000, 1500 + planned.length * 250))
  try {
    const pages: Uint8Array[] = []
    for (const { index, turn } of planned) {
      pages.push(await engine().call('renderForPrint', docId, index, { dpi, turn, gray: look.gray, markups: look.markups }))
    }
    return { pages, sizes: planned.map(({ index, turn }) => turned(info.pages[index], turn)), title: fileName }
  } catch (error) {
    toast(t('error.generic', { message: error instanceof Error ? error.message : String(error) }), 'error')
    return null
  } finally {
    dismissToast(progress)
  }
}

export async function printTab(tab: TabEntry): Promise<void> {
  await tab.store.getState().idle()
  if (!(await settlePendingRedactions(tab))) return
  const { info } = tab.store.getState()
  const everything = info.pages.map((_, index) => ({ index, turn: false }))
  const standard = { gray: false, markups: true }
  if (!platform.isDesktop) {
    const job = await renderJob(tab, everything, standard)
    if (job) printInBrowser(job.pages, job.sizes)
    return
  }
  const printers = await platform.getPrinters()
  const remembered = useApp.getState().settings.print
  const initial = { ...remembered, printer: resolvePrinter(printers, remembered.printer)?.name ?? '' }
  const request = await askPrint(tab, printers, initial)
  if (!request) return
  if (request.kind === 'system') {
    const job = await renderJob(tab, everything, standard)
    if (job) await platform.print(job)
    return
  }
  const { preferences } = request
  applySettings({ ...useApp.getState().settings, print: preferences })
  const plan = planPrint(info.pages, request.pages, preferences.orientation)
  const job = await renderJob(tab, plan.pages, preferences)
  if (!job) return
  const settings: PrintSettings = {
    printer: request.printer.name,
    copies: request.copies,
    collate: request.collate,
    paper: preferences.paper,
    landscape: plan.landscape,
    duplex: preferences.duplex,
    color: !preferences.gray,
    scaling: preferences.scaling
  }
  try {
    if (await platform.print({ ...job, settings })) toast(t('toast.printSent', { name: request.printer.displayName }), 'success', undefined, 3000)
    else toast(t('error.printFailed'), 'error', undefined, 8000)
  } catch {
    toast(t('error.printFailed'), 'error', undefined, 8000)
  }
}

function printInBrowser(pages: Uint8Array[], sizes: { width: number; height: number }[]): void {
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  const first = sizes[0] ?? { width: 595, height: 842 }
  const urls = pages.map((bytes) => URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })))
  doc.open()
  doc.write(
    `<!doctype html><html><head><style>@page{size:${first.width}pt ${first.height}pt;margin:0}html,body{margin:0}` +
      `.pg{width:${first.width}pt;height:${first.height}pt;display:flex;align-items:center;justify-content:center;break-after:page}` +
      `.pg img{max-width:100%;max-height:100%}</style></head><body>${urls.map((u) => `<div class="pg"><img src="${u}"></div>`).join('')}</body></html>`
  )
  doc.close()
  frame.onload = () => {
    frame.contentWindow?.print()
    setTimeout(() => {
      urls.forEach((u) => URL.revokeObjectURL(u))
      frame.remove()
    }, 60_000)
  }
}
