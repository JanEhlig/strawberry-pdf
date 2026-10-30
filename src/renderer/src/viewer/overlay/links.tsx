import type { LinkData } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import type { DocStore } from '@renderer/state/docStore'
import { choose } from '@renderer/ui'

export async function followLink(store: DocStore, link: LinkData): Promise<void> {
  if (link.page !== null) {
    store.getState().goTo(link.page)
    return
  }
  if (!link.uri || !/^(https?:|mailto:)/i.test(link.uri)) return
  const choice = await choose({
    title: t('dialog.linkTitle'),
    body: (
      <>
        <p>{t('dialog.linkBody')}</p>
        <p style={{ wordBreak: 'break-all', color: 'var(--ink)', fontWeight: 600 }}>{link.uri}</p>
      </>
    ),
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'open', label: t('dialog.linkOpen'), variant: 'primary' }
    ],
    cancel: 'cancel'
  })
  if (choice === 'open') platform.openExternal(link.uri)
}
