import { locale, t, type MessageKey } from '@renderer/i18n'
import { openDialog, type TabEntry } from '@renderer/state/appStore'
import { Button, Dialog } from '@renderer/ui'

export function parsePdfDate(value: string): Date | null {
  const m = value.match(/^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/)
  if (!m) return null
  const [, y, mo = '01', d = '01', h = '00', mi = '00', s = '00', sign, oh = '00', om = '00'] = m
  let time = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
  if (sign === '+' || sign === '-') {
    const offset = (+oh * 60 + +om) * 60_000
    time += sign === '+' ? -offset : offset
  }
  const date = new Date(time)
  return Number.isNaN(date.getTime()) ? null : date
}

const PAPER: [string, number, number][] = [
  ['A4', 595, 842],
  ['A3', 842, 1191],
  ['A5', 420, 595],
  ['Letter', 612, 792],
  ['Legal', 612, 1008]
]

export function describePageSize(width: number, height: number): string {
  const mm = (pt: number): number => Math.round((pt / 72) * 25.4)
  const lo = Math.min(width, height)
  const hi = Math.max(width, height)
  const name = PAPER.find(([, w, h]) => Math.abs(w - lo) < 3 && Math.abs(h - hi) < 3)?.[0]
  return `${mm(width)} × ${mm(height)} mm${name ? ` (${name})` : ''}`
}

export function formatBytes(bytes: number): string {
  const tag = locale()
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString(tag, { maximumFractionDigits: 1 })} KB`
  return `${(bytes / 1024 / 1024).toLocaleString(tag, { maximumFractionDigits: 1 })} MB`
}

function PropertiesDialog({ tab, close }: { tab: TabEntry; close: () => void }): React.JSX.Element {
  const s = tab.store.getState()
  const { metadata, pages, hasForms } = s.info
  const tag = locale()
  const date = (value: string): string => {
    const d = parsePdfDate(value)
    return d ? d.toLocaleString(tag, { dateStyle: 'medium', timeStyle: 'short' }) : value
  }
  const first = pages[0]
  const rows: [MessageKey, string][] = [
    ['props.file', `${s.fileName} · ${formatBytes(s.fileSize)}`],
    ['props.location', s.filePath ? s.filePath.replace(/[\\/][^\\/]*$/, '') : ''],
    ['props.docTitle', metadata.title],
    ['props.author', metadata.author],
    ['props.subject', metadata.subject],
    ['props.keywords', metadata.keywords],
    ['props.creator', metadata.creator],
    ['props.producer', metadata.producer],
    ['props.created', metadata.creationDate ? date(metadata.creationDate) : ''],
    ['props.modified', metadata.modDate ? date(metadata.modDate) : ''],
    ['props.pages', String(pages.length)],
    ['props.pageSize', first ? describePageSize(first.width, first.height) : ''],
    ['props.format', metadata.format],
    ['props.encryption', metadata.encryption && metadata.encryption !== 'None' ? metadata.encryption : t('props.no')],
    ['props.forms', hasForms ? t('props.yes') : t('props.no')]
  ]
  return (
    <Dialog
      title={t('props.title')}
      wide
      onClose={close}
      footer={
        <Button variant="primary" onClick={close}>
          {t('common.close')}
        </Button>
      }
    >
      <dl className="props-list">
        {rows
          .filter(([, value]) => value)
          .map(([key, value]) => (
            <div key={key} className="props-row">
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </Dialog>
  )
}

export function openProperties(tab: TabEntry): void {
  void openDialog<void>((close) => <PropertiesDialog tab={tab} close={() => close()} />)
}
