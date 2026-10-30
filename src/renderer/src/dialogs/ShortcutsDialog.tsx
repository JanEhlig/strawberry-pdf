import { t, type MessageKey } from '@renderer/i18n'
import { openDialog } from '@renderer/state/appStore'
import { Button, Dialog, Kbd } from '@renderer/ui'

const KEYS: { keys: string[]; label: MessageKey }[] = [
  { keys: ['key.ctrl', 'O'], label: 'menu.open' },
  { keys: ['key.ctrl', 'S'], label: 'menu.save' },
  { keys: ['key.ctrl', 'key.shift', 'S'], label: 'menu.saveAs' },
  { keys: ['key.ctrl', 'P'], label: 'menu.print' },
  { keys: ['key.ctrl', 'W'], label: 'common.close' },
  { keys: ['key.ctrl', 'Z'], label: 'action.undo' },
  { keys: ['key.ctrl', 'Y'], label: 'action.redo' },
  { keys: ['key.ctrl', 'C'], label: 'selection.copy' },
  { keys: ['key.ctrl', 'F'], label: 'search.placeholder' },
  { keys: ['key.ctrl', '+'], label: 'nav.zoomIn' },
  { keys: ['key.ctrl', '−'], label: 'nav.zoomOut' },
  { keys: ['key.ctrl', '0'], label: 'nav.actualSize' },
  { keys: ['F4'], label: 'action.sidebar' },
  { keys: ['V'], label: 'tool.select' },
  { keys: ['H'], label: 'tool.markup' },
  { keys: ['T'], label: 'tool.text' },
  { keys: ['D'], label: 'tool.draw' },
  { keys: ['R'], label: 'tool.shapes' },
  { keys: ['N'], label: 'tool.note' },
  { keys: ['S'], label: 'tool.sign' },
  { keys: ['X'], label: 'tool.redact' },
  { keys: ['key.del'], label: 'annot.delete' },
  { keys: ['key.ctrl', 'A'], label: 'shortcuts.organizeAll' },
  { keys: ['key.del'], label: 'shortcuts.organizeDelete' }
]

function ShortcutsDialog({ close }: { close: () => void }): React.JSX.Element {
  return (
    <Dialog
      title={t('shortcuts.title')}
      wide
      onClose={close}
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      <dl className="shortcut-list">
        {KEYS.map((item) => (
          <div key={item.keys.join('+') + item.label} className="shortcut-row">
            <dt>{t(item.label).replace(/\s*\(.*\)$/, '').replace(/\s*…$/, '')}</dt>
            <dd>
              {item.keys.map((k) => (
                <Kbd key={k}>{k.startsWith('key.') ? t(k as MessageKey) : k}</Kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}

export function openShortcuts(): void {
  void openDialog<void>((close) => <ShortcutsDialog close={() => close()} />)
}
