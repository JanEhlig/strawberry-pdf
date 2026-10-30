import { LogoMark } from '@renderer/chrome/LogoMark'
import { t } from '@renderer/i18n'
import { openDialog, useApp } from '@renderer/state/appStore'
import { Button, Dialog } from '@renderer/ui'

function AboutDialog({ close }: { close: () => void }): React.JSX.Element {
  const version = useApp((s) => s.env?.version ?? '1.0.0')
  return (
    <Dialog
      title={t('about.title')}
      onClose={close}
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      <div className="about-head">
        <LogoMark size={44} />
        <div>
          <div className="about-name">{t('app.name')}</div>
          <div className="about-version">
            {t('app.tagline')} · {t('about.version', { v: version })}
          </div>
        </div>
      </div>
      <p>{t('about.license')}</p>
      <p className="about-credits">{t('about.credits')}</p>
    </Dialog>
  )
}

export function openAbout(): void {
  void openDialog<void>((close) => <AboutDialog close={() => close()} />)
}
