import { engine } from '@renderer/engine/client'
import type { RedactFill } from '@renderer/engine/types'
import { confirmRedactions } from '@renderer/dialogs/RedactDialog'
import { t } from '@renderer/i18n'
import { choose } from '@renderer/ui'
import { toast, type TabEntry } from './appStore'

export async function applyRedactions(tab: TabEntry, fill: RedactFill): Promise<boolean> {
  const s = tab.store.getState()
  try {
    await s.applyMutation(await engine().call('applyRedactions', s.docId, fill))
    toast(t('redact.done'), 'success', undefined, 2000)
    return true
  } catch (error) {
    toast(t('error.generic', { message: error instanceof Error ? error.message : String(error) }), 'error')
    return false
  }
}

export async function confirmAndApplyRedactions(tab: TabEntry): Promise<boolean> {
  const count = tab.store.getState().redactions
  if (count === 0) return true
  const fill = await confirmRedactions(count)
  return fill ? applyRedactions(tab, fill) : false
}

export async function settlePendingRedactions(tab: TabEntry): Promise<boolean> {
  const count = tab.store.getState().redactions
  if (count === 0) return true
  const choice = await choose({
    title: t('redact.pendingTitle'),
    body: t('redact.pendingBody', { n: count }),
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'keep', label: t('redact.saveWithout') },
      { id: 'apply', label: t('redact.applyNow'), variant: 'danger' }
    ],
    cancel: 'cancel'
  })
  if (choice === 'cancel') return false
  if (choice === 'apply') return confirmAndApplyRedactions(tab)
  return true
}
