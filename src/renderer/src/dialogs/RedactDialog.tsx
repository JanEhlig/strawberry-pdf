import { useState } from 'react'
import type { RedactFill } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { openDialog } from '@renderer/state/appStore'
import { Button, Dialog } from '@renderer/ui'

function RedactDialog({ count, close }: { count: number; close: (fill: RedactFill | null) => void }): React.JSX.Element {
  const [fill, setFill] = useState<RedactFill>('black')
  return (
    <Dialog
      title={t('redact.dialogTitle')}
      onClose={() => close(null)}
      footer={
        <>
          <Button onClick={() => close(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={() => close(fill)}>
            {t('redact.confirm')}
          </Button>
        </>
      }
    >
      <p>{t('redact.dialogBody', { n: count })}</p>
      <div className="redact-choices" role="radiogroup">
        {(['black', 'white'] as const).map((option) => (
          <label key={option} className={`redact-choice${fill === option ? ' active' : ''}`}>
            <input type="radio" name="redact-fill" checked={fill === option} onChange={() => setFill(option)} />
            <span className={`redact-swatch ${option}`} aria-hidden="true" />
            <span>{option === 'black' ? t('redact.black') : t('redact.white')}</span>
          </label>
        ))}
      </div>
    </Dialog>
  )
}

export function confirmRedactions(count: number): Promise<RedactFill | null> {
  return openDialog<RedactFill | null>((close) => <RedactDialog count={count} close={close} />)
}
