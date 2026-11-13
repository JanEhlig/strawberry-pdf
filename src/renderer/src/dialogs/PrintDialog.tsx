import { useEffect, useId, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DuplexMode, PaperSize, PrinterSummary, PrintOrientation, PrintPreferences, PrintScaling } from '@shared/api'
import { PAPER_SIZES } from '@shared/paper'
import { engine } from '@renderer/engine/client'
import { t } from '@renderer/i18n'
import { openDialog, useApp, type TabEntry } from '@renderer/state/appStore'
import {
  paperSize,
  placePage,
  planPrint,
  selectPages,
  turned,
  type PageChoice,
  type PlannedPage,
  type PrintRequest,
  type Size
} from '@renderer/state/printPlan'
import { Button, Dialog, IconButton, Segmented } from '@renderer/ui'
import './PrintDialog.css'

const PREVIEW_DPI = 72
const MAX_COPIES = 999

function usePreview(docId: string, page: PlannedPage | undefined, gray: boolean, markups: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const latest = useRef<string | null>(null)
  const index = page?.index ?? -1
  const turn = page?.turn ?? false
  useEffect(
    () => () => {
      if (latest.current) URL.revokeObjectURL(latest.current)
    },
    []
  )
  useEffect(() => {
    if (index < 0) return
    let live = true
    engine()
      .call('renderForPrint', docId, index, { dpi: PREVIEW_DPI, gray, markups, turn })
      .then((bytes) => {
        if (!live) return
        const next = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
        if (latest.current) URL.revokeObjectURL(latest.current)
        latest.current = next
        setUrl(next)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [docId, index, turn, gray, markups])
  return url
}

function Preview({
  docId,
  page,
  size,
  paper,
  scaling,
  gray,
  markups
}: {
  docId: string
  page: PlannedPage | undefined
  size: Size | undefined
  paper: Size
  scaling: PrintScaling
  gray: boolean
  markups: boolean
}): React.JSX.Element {
  const url = usePreview(docId, page, gray, markups)
  const place = size && page ? placePage(turned(size, page.turn), paper, scaling) : null
  return (
    <svg className="print-sheet" viewBox={`0 0 ${paper.width} ${paper.height}`} aria-hidden="true">
      <rect className="print-sheet-paper" width={paper.width} height={paper.height} />
      {url && place && <image href={url} x={place.x} y={place.y} width={place.width} height={place.height} preserveAspectRatio="none" />}
    </svg>
  )
}

function copiesOf(text: string): number {
  const value = Math.round(Number(text))
  return Number.isFinite(value) ? Math.min(MAX_COPIES, Math.max(1, value)) : 1
}

function PrintDialog({
  tab,
  printers,
  initial,
  close
}: {
  tab: TabEntry
  printers: PrinterSummary[]
  initial: PrintPreferences
  close: (request: PrintRequest | null) => void
}): React.JSX.Element {
  const { docId, info, currentPage } = tab.store.getState()
  const locale = useApp((s) => s.env?.locale ?? navigator.language)
  const id = useId()
  const [preferences, setPreferences] = useState(initial)
  const [copiesText, setCopiesText] = useState('1')
  const [collate, setCollate] = useState(true)
  const [choice, setChoice] = useState<PageChoice>('all')
  const [range, setRange] = useState('')
  const [shown, setShown] = useState(0)

  const count = info.pages.length
  const copies = copiesOf(copiesText)
  const pages = selectPages(choice, range, count, currentPage)
  const plan = planPrint(info.pages, pages ?? [], preferences.orientation)
  const paper = paperSize(preferences.paper, locale, plan.landscape)
  const position = Math.min(shown, Math.max(0, plan.pages.length - 1))
  const previewPage = plan.pages[position]
  const printer = printers.find((p) => p.name === preferences.printer) ?? null
  const invalidRange = choice === 'range' && range.trim() !== '' && pages === null
  const ready = !!printer && !!pages?.length

  useEffect(() => document.getElementById(`${id}-submit`)?.focus(), [id])

  const update = (patch: Partial<PrintPreferences>): void => setPreferences((current) => ({ ...current, ...patch }))
  const submit = (): void => {
    if (printer && pages?.length) close({ kind: 'print', preferences: { ...preferences, printer: printer.name }, printer, copies, collate, pages })
  }

  return (
    <Dialog
      title={t('print.title')}
      className="print-dialog"
      onClose={() => close(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => close({ kind: 'system' })}>
            {t('print.system')}
          </Button>
          <span className="spacer" />
          <Button onClick={() => close(null)}>{t('common.cancel')}</Button>
          <Button id={`${id}-submit`} variant="primary" disabled={!ready} onClick={submit}>
            {t('print.submit')}
          </Button>
        </>
      }
    >
      <div className="print-layout">
        <form
          className="print-settings"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="field-label" htmlFor={`${id}-printer`}>
            {t('print.printer')}
          </label>
          <select
            id={`${id}-printer`}
            className="input"
            value={printer?.name ?? ''}
            disabled={printers.length === 0}
            onChange={(e) => update({ printer: e.target.value })}
          >
            {printers.length === 0 && <option value="">{t('print.noPrinter')}</option>}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.isDefault ? t('print.defaultPrinter', { name: p.displayName }) : p.displayName}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor={`${id}-copies`}>
            {t('print.copies')}
          </label>
          <div className="print-inline">
            <input
              id={`${id}-copies`}
              className="input print-copies"
              type="number"
              min={1}
              max={MAX_COPIES}
              value={copiesText}
              onChange={(e) => setCopiesText(e.target.value)}
              onBlur={() => setCopiesText(String(copies))}
            />
            <label className="check">
              <input type="checkbox" checked={collate} disabled={copies < 2} onChange={(e) => setCollate(e.target.checked)} />
              {t('print.collate')}
            </label>
          </div>

          <span className="field-label">{t('print.pages')}</span>
          <div className="print-pages">
            <Segmented<PageChoice>
              label={t('print.pages')}
              value={choice}
              onChange={(next) => {
                setChoice(next)
                setShown(0)
              }}
              options={[
                { id: 'all', label: t('print.all') },
                { id: 'current', label: t('print.current') },
                { id: 'range', label: t('print.range') }
              ]}
            />
            {choice === 'range' && (
              <input
                className={`input${invalidRange ? ' invalid' : ''}`}
                aria-label={t('print.rangeLabel')}
                aria-invalid={invalidRange}
                placeholder="1-3, 5"
                autoFocus
                value={range}
                onChange={(e) => {
                  setRange(e.target.value)
                  setShown(0)
                }}
              />
            )}
            {invalidRange && <span className="print-error">{t('print.rangeInvalid', { count })}</span>}
          </div>

          <label className="field-label" htmlFor={`${id}-paper`}>
            {t('print.paper')}
          </label>
          <select
            id={`${id}-paper`}
            className="input"
            value={preferences.paper}
            onChange={(e) => update({ paper: e.target.value as PaperSize | 'printer' })}
          >
            <option value="printer">{t('print.printerDefault')}</option>
            {Object.keys(PAPER_SIZES).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          <label className="field-label" htmlFor={`${id}-scaling`}>
            {t('print.scaling')}
          </label>
          <select
            id={`${id}-scaling`}
            className="input"
            value={preferences.scaling}
            onChange={(e) => update({ scaling: e.target.value as PrintScaling })}
          >
            <option value="fit">{t('print.fit')}</option>
            <option value="actual">{t('print.actual')}</option>
            <option value="shrink">{t('print.shrink')}</option>
          </select>

          <label className="field-label" htmlFor={`${id}-orientation`}>
            {t('print.orientation')}
          </label>
          <select
            id={`${id}-orientation`}
            className="input"
            value={preferences.orientation}
            onChange={(e) => update({ orientation: e.target.value as PrintOrientation })}
          >
            <option value="auto">{t('print.auto')}</option>
            <option value="portrait">{t('print.portrait')}</option>
            <option value="landscape">{t('print.landscape')}</option>
          </select>

          <label className="field-label" htmlFor={`${id}-duplex`}>
            {t('print.duplex')}
          </label>
          <select
            id={`${id}-duplex`}
            className="input"
            value={preferences.duplex}
            onChange={(e) => update({ duplex: e.target.value as DuplexMode | 'printer' })}
          >
            <option value="printer">{t('print.printerDefault')}</option>
            <option value="simplex">{t('print.duplexOff')}</option>
            <option value="longEdge">{t('print.longEdge')}</option>
            <option value="shortEdge">{t('print.shortEdge')}</option>
          </select>

          <div className="print-checks">
            <label className="check">
              <input type="checkbox" checked={preferences.gray} onChange={(e) => update({ gray: e.target.checked })} />
              {t('print.gray')}
            </label>
            <label className="check">
              <input type="checkbox" checked={preferences.markups} onChange={(e) => update({ markups: e.target.checked })} />
              {t('print.markups')}
            </label>
          </div>
        </form>

        <div className="print-preview">
          <Preview
            docId={docId}
            page={previewPage}
            size={previewPage ? info.pages[previewPage.index] : undefined}
            paper={paper}
            scaling={preferences.scaling}
            gray={preferences.gray}
            markups={preferences.markups}
          />
          <div className="print-nav">
            <IconButton small label={t('print.previous')} disabled={position === 0} onClick={() => setShown(position - 1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <span className="tabular">{t('print.preview', { page: plan.pages.length ? position + 1 : 0, count: plan.pages.length })}</span>
            <IconButton small label={t('print.next')} disabled={position >= plan.pages.length - 1} onClick={() => setShown(position + 1)}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
        </div>
      </div>
    </Dialog>
  )
}

export function askPrint(tab: TabEntry, printers: PrinterSummary[], initial: PrintPreferences): Promise<PrintRequest | null> {
  return openDialog<PrintRequest | null>((close) => <PrintDialog tab={tab} printers={printers} initial={initial} close={close} />)
}
