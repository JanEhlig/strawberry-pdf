import { engine } from '@renderer/engine/client'
import type { DecimalMark, ExportFormat } from '@renderer/engine/types'
import { locale, t } from '@renderer/i18n'
import { platform, SaveError } from '@renderer/platform'
import { dismissToast, toast, type TabEntry } from './appStore'
import { saveErrorMessage } from './files'
import { settlePendingRedactions } from './redactions'

function decimalMark(): DecimalMark {
  const decimal = new Intl.NumberFormat(locale()).formatToParts(1.5).find((part) => part.type === 'decimal')
  return decimal?.value === ',' ? ',' : '.'
}

export async function exportTab(tab: TabEntry, format: ExportFormat): Promise<void> {
  await tab.store.getState().idle()
  if (!(await settlePendingRedactions(tab))) return
  const { docId, fileName, filePath, info } = tab.store.getState()
  const progress = toast(t('toast.exporting'), 'info', undefined, Math.min(60_000, 2000 + info.pages.length * 300))
  try {
    const bytes = await engine().call('exportDocument', docId, format, { sheetLabel: t('export.sheet'), decimalMark: decimalMark() })
    dismissToast(progress)
    const target = await platform.saveAs(`${fileName.replace(/\.pdf$/i, '')}.${format}`, filePath, bytes, format)
    if (!target) return
    const path = target.path
    const open = path ? { label: t('common.open'), run: () => platform.openPath(path) } : undefined
    toast(t('toast.exported', { name: target.name }), 'success', open, 6000)
  } catch (error) {
    dismissToast(progress)
    const message = error instanceof Error ? error.message : String(error)
    toast(error instanceof SaveError ? saveErrorMessage(error) : t('error.exportFailed', { message }), 'error', undefined, 8000)
  }
}
