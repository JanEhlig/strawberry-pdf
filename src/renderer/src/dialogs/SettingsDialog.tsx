import { useState } from 'react'
import type { LanguageSetting, Settings, ThemeSetting } from '@shared/api'
import { LANGUAGES, t } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import { openDialog, useApp } from '@renderer/state/appStore'
import { applySettings } from '@renderer/state/settings'
import { Button, Dialog, Segmented } from '@renderer/ui'

function SettingsDialog({ close }: { close: () => void }): React.JSX.Element {
  const current = useApp((s) => s.settings)
  const env = useApp((s) => s.env)
  const [name, setName] = useState(current.authorName)

  const update = (patch: Partial<Settings>): void =>
    applySettings({ ...useApp.getState().settings, authorName: name.trim(), ...patch })

  return (
    <Dialog
      title={t('settings.title')}
      onClose={() => {
        update({ authorName: name.trim() })
        close()
      }}
      footer={
        <Button
          variant="primary"
          onClick={() => {
            update({ authorName: name.trim() })
            close()
          }}
        >
          {t('common.done')}
        </Button>
      }
    >
      <label className="field">
        <span className="field-label">{t('settings.name')}</span>
        <input className="input" value={name} placeholder={env?.userName ?? ''} onChange={(e) => setName(e.target.value)} />
        <span className="field-hint">{t('settings.nameHint')}</span>
      </label>
      <div className="field">
        <span className="field-label">{t('settings.theme')}</span>
        <Segmented<ThemeSetting>
          label={t('settings.theme')}
          value={current.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { id: 'system', label: t('settings.theme.system') },
            { id: 'light', label: t('settings.theme.light') },
            { id: 'dark', label: t('settings.theme.dark') }
          ]}
        />
      </div>
      <div className="field">
        <span className="field-label">{t('settings.language')}</span>
        <select
          className="input"
          aria-label={t('settings.language')}
          value={current.language}
          onChange={(e) => update({ language: e.target.value as LanguageSetting })}
        >
          <option value="auto">{t('settings.language.auto')}</option>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={current.highlightFields} onChange={(e) => update({ highlightFields: e.target.checked })} />
          {t('settings.fields')}
        </label>
      </div>
      {platform.isDesktop && (
        <div className="field settings-default-app">
          <span className="field-label">{t('settings.defaultApp')}</span>
          <span className="field-hint">{t('settings.defaultAppHint')}</span>
          <div>
            <Button onClick={() => platform.openDefaultAppsSettings()}>{t('settings.defaultAppButton')}</Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export function openSettings(): void {
  void openDialog<void>((close) => <SettingsDialog close={() => close()} />)
}
