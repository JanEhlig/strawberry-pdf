import { Combine, FileText, FolderOpen, FolderSearch, X } from 'lucide-react'
import { locale, t } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import { useApp } from '@renderer/state/appStore'
import { combineFiles, openPaths, promptOpen } from '@renderer/state/files'
import { Button, IconButton, Kbd } from '@renderer/ui'
import { LogoMark } from '@renderer/chrome/LogoMark'
import './start.css'

function relativeDay(time: number): string {
  const tag = locale()
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(time).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 1) return new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }).format(-days, 'day')
  return new Date(time).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })
}

export function StartScreen(): React.JSX.Element {
  const recent = useApp((s) => s.recent)
  return (
    <div className="start">
      <div className="start-grid">
        <section className="start-sheet" aria-label={t('start.open')}>
          <div className="start-holes" aria-hidden="true">
            <span />
            <span />
          </div>
          <LogoMark size={52} />
          <h1 className="start-title">{t('app.name')}</h1>
          <p className="start-lead">{t('start.lead')}</p>
          <Button variant="primary" large onClick={() => void promptOpen()}>
            <FolderOpen size={19} />
            {t('start.open')}
          </Button>
          <p className="start-shortcut">
            <Kbd>{t('key.ctrl')}</Kbd> <Kbd>O</Kbd>
          </p>
          <Button variant="ghost" className="start-combine" onClick={() => void combineFiles()}>
            <Combine size={17} />
            {t('start.combine')}
          </Button>
        </section>

        {platform.isDesktop && (
          <section className="start-recent" aria-labelledby="recent-title">
            <h2 id="recent-title">{t('start.recent')}</h2>
            {recent.length === 0 ? (
              <p className="start-empty">{t('start.recentEmpty')}</p>
            ) : (
              <ul>
                {recent.map((file) => (
                  <li key={file.path} className="recent-row">
                    <button type="button" className="recent-open" onClick={() => void openPaths([file.path])} title={file.path}>
                      <span className="recent-icon">
                        <FileText size={18} />
                      </span>
                      <span className="recent-text">
                        <span className="recent-name">{file.name.replace(/\.pdf$/i, '')}</span>
                        <span className="recent-path">{file.path.replace(/[\\/][^\\/]*$/, '')}</span>
                      </span>
                      <span className="recent-date">{relativeDay(file.openedAt)}</span>
                    </button>
                    <span className="recent-actions">
                      <IconButton small label={t('start.showInFolder')} onClick={() => platform.showItemInFolder(file.path)}>
                        <FolderSearch size={15} />
                      </IconButton>
                      <IconButton
                        small
                        label={t('start.remove')}
                        onClick={() => void platform.removeRecent(file.path).then((list) => useApp.setState({ recent: list }))}
                      >
                        <X size={15} />
                      </IconButton>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
