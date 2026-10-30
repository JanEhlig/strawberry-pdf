import { Plus, X } from 'lucide-react'
import { useStore } from 'zustand'
import { t } from '@renderer/i18n'
import { useApp, type TabEntry } from '@renderer/state/appStore'
import { activateTab, closeTab, promptOpen } from '@renderer/state/files'
import { IconButton } from '@renderer/ui'
import { LogoMark } from './LogoMark'

function Tab({ tab, active }: { tab: TabEntry; active: boolean }): React.JSX.Element {
  const name = useStore(tab.store, (s) => s.fileName)
  const dirty = useStore(tab.store, (s) => s.history.dirty)
  return (
    <div
      className={`tab${active ? ' active' : ''}`}
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={name}
      onPointerDown={(e) => {
        if (e.button === 0) activateTab(tab.id)
      }}
      onAuxClick={(e) => {
        if (e.button === 1) void closeTab(tab.id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') activateTab(tab.id)
      }}
    >
      <span className="tab-name">{name.replace(/\.pdf$/i, '')}</span>
      {dirty && <span className="tab-dirty" aria-label={t('tabs.unsaved')} data-tip={t('tabs.unsaved')} />}
      <button
        type="button"
        className="tab-close"
        aria-label={t('tabs.close')}
        data-tip={t('tabs.close')}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => void closeTab(tab.id)}
      >
        <X size={14} strokeWidth={2.2} />
      </button>
    </div>
  )
}

export function TitleBar(): React.JSX.Element {
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeId)
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <LogoMark size={18} />
        {tabs.length === 0 && <span className="titlebar-name">{t('app.name')}</span>}
      </div>
      <div className="tabs" role="tablist">
        {tabs.map((tab) => (
          <Tab key={tab.id} tab={tab} active={tab.id === activeId} />
        ))}
        {tabs.length > 0 && (
          <IconButton small className="tab-add" label={t('tabs.open')} onClick={() => void promptOpen()}>
            <Plus size={16} />
          </IconButton>
        )}
      </div>
      <div className="titlebar-drag" />
    </header>
  )
}
