import { engine } from '@renderer/engine/client'
import { t } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import { toast, type TabEntry } from './appStore'
import { settlePendingRedactions } from './redactions'

const PRINT_DPI = 200

export async function printTab(tab: TabEntry): Promise<void> {
  if (!(await settlePendingRedactions(tab))) return
  const state = tab.store.getState()
  const count = state.info.pages.length
  toast(t('toast.printing'), 'info', undefined, Math.min(20_000, 1500 + count * 250))
  try {
    const pages: Uint8Array[] = []
    for (let i = 0; i < count; i++) {
      pages.push(await engine().call('renderForPrint', state.docId, i, count > 60 ? 150 : PRINT_DPI))
    }
    const sizes = state.info.pages.map((p) => ({ width: p.width, height: p.height }))
    if (platform.isDesktop) {
      await platform.print({ pages, sizes, title: state.fileName })
      return
    }
    printInBrowser(pages, sizes)
  } catch (error) {
    toast(t('error.generic', { message: error instanceof Error ? error.message : String(error) }), 'error')
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
