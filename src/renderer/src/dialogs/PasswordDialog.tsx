import { useState } from 'react'
import { openDialog } from '@renderer/state/appStore'
import { Button, Dialog } from '@renderer/ui'
import { t } from '@renderer/i18n'

function PasswordDialog({ name, retry, close }: { name: string; retry: boolean; close: (value: string | null) => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  return (
    <Dialog
      title={t('dialog.passwordTitle')}
      onClose={() => close(null)}
      footer={
        <>
          <Button onClick={() => close(null)}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!value} onClick={() => close(value)}>
            {t('common.open')}
          </Button>
        </>
      }
    >
      <p>{t('dialog.passwordBody', { name })}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (value) close(value)
        }}
      >
        <label className="field">
          <span className="field-label">{t('dialog.passwordLabel')}</span>
          <input
            className={`input${retry ? ' invalid' : ''}`}
            type="password"
            autoFocus
            value={value}
            aria-invalid={retry}
            onChange={(e) => setValue(e.target.value)}
          />
          {retry && <span className="field-hint" style={{ color: 'var(--danger)' }}>{t('dialog.passwordWrong')}</span>}
        </label>
      </form>
    </Dialog>
  )
}

export function askPassword(name: string, retry: boolean): Promise<string | null> {
  return openDialog<string | null>((close) => <PasswordDialog name={name} retry={retry} close={close} />)
}
