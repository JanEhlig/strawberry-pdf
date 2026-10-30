import { Check, FilePlus, FileUp, FolderOutput, RotateCcw, RotateCw, Trash, type LucideIcon } from 'lucide-react'
import { useStore } from 'zustand'
import { t, type MessageKey } from '@renderer/i18n'
import type { TabEntry } from '@renderer/state/appStore'
import { extractSelected, insertBlank, insertPdfs, leaveOrganize, removePages, rotateSelected } from './actions'

function TrayButton({
  icon: Icon,
  label,
  hint,
  danger,
  active,
  disabled,
  onClick
}: {
  icon: LucideIcon
  label: MessageKey
  hint?: MessageKey
  danger?: boolean
  active?: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tool plain${danger ? ' danger' : ''}${active ? ' active' : ''}`}
      data-tip={t(hint ?? label)}
      aria-label={t(label)}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="tool-icon">
        <Icon size={19} strokeWidth={1.9} />
      </span>
      <span className="tool-label">{t(label)}</span>
    </button>
  )
}

export function PageTray({ tab }: { tab: TabEntry }): React.JSX.Element {
  const none = useStore(tab.store, (s) => s.selectedPages.length === 0)
  return (
    <div className="tool-tray" role="toolbar" aria-label={t('organize.actions')}>
      <TrayButton icon={FileUp} label="organize.insertFile" hint="organize.insertFile.hint" onClick={() => void insertPdfs(tab)} />
      <TrayButton icon={FilePlus} label="organize.insertBlank" hint="organize.insertBlank.hint" onClick={() => void insertBlank(tab)} />
      <span className="tray-sep" />
      <TrayButton icon={RotateCcw} label="organize.rotateLeft" disabled={none} onClick={() => rotateSelected(tab, -90)} />
      <TrayButton icon={RotateCw} label="organize.rotateRight" disabled={none} onClick={() => rotateSelected(tab, 90)} />
      <TrayButton icon={FolderOutput} label="organize.extract" hint="organize.extract.hint" disabled={none} onClick={() => extractSelected(tab)} />
      <TrayButton icon={Trash} label="organize.delete" hint="organize.delete.hint" danger disabled={none} onClick={() => void removePages(tab)} />
      <span className="tray-sep" />
      <TrayButton icon={Check} label="organize.done" hint="organize.done.hint" active onClick={() => leaveOrganize(tab)} />
    </div>
  )
}
