import {
  ArrowUpRight,
  Calendar,
  Check,
  Circle,
  Highlighter,
  ImageUp,
  MessageSquare,
  Plus,
  Slash,
  Square,
  Strikethrough,
  Trash,
  Underline,
  X
} from 'lucide-react'
import { useStore } from 'zustand'
import type { AnnotData, AnnotPatch, FontName, RGB } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { toast, updateToolSettings, useApp, type TabEntry } from '@renderer/state/appStore'
import { confirmAndApplyRedactions } from '@renderer/state/redactions'
import { newSignature, removeSignature } from '@renderer/state/signatures'
import { annotLabel } from '@renderer/viewer/overlay/CommentPopover'
import { loadImageFile, pickImageFile } from '@renderer/lib/imageFile'
import { freeTextRect } from '@renderer/viewer/placement'
import {
  FILL_COLORS,
  FONTS,
  INK_COLORS,
  MARKER_COLORS,
  STROKE_WIDTHS,
  type MarkupType,
  type ShapeType
} from '@renderer/tools/tools'
import { Button, FontSize, IconButton, Segmented, Swatches } from '@renderer/ui'

function Widths({ value, onChange }: { value: number; onChange: (w: number) => void }): React.JSX.Element {
  return (
    <div className="widths" role="group" aria-label={t('option.width')}>
      {STROKE_WIDTHS.map((w) => (
        <button
          key={w}
          type="button"
          className="width-btn"
          aria-pressed={Math.abs(value - w) < 0.01}
          aria-label={`${t('option.width')} ${w}`}
          data-tip={`${t('option.width')} ${w} pt`}
          onClick={() => onChange(w)}
        >
          <span style={{ width: 4 + w * 1.6, height: 4 + w * 1.6 }} />
        </button>
      ))}
    </div>
  )
}

const Sep = (): React.JSX.Element => <span className="capsule-sep" />

function MarkupOptions(): React.JSX.Element {
  const { type, color } = useApp((s) => s.toolSettings.markup)
  return (
    <>
      <Segmented<MarkupType>
        label={t('tool.markup')}
        value={type}
        onChange={(next) => updateToolSettings('markup', { type: next, color: next === 'highlight' ? MARKER_COLORS[0].rgb : INK_COLORS[2].rgb })}
        options={[
          { id: 'highlight', label: t('markup.highlight'), icon: <Highlighter size={16} /> },
          { id: 'underline', label: t('markup.underline'), icon: <Underline size={16} /> },
          { id: 'strikeout', label: t('markup.strikeout'), icon: <Strikethrough size={16} /> }
        ]}
        compact
      />
      <Sep />
      <Swatches
        label={t('option.color')}
        colors={type === 'highlight' ? MARKER_COLORS : INK_COLORS}
        value={color}
        onChange={(c) => c && updateToolSettings('markup', { color: c })}
      />
    </>
  )
}

function TextOptions(): React.JSX.Element {
  const { font, size, color } = useApp((s) => s.toolSettings.text)
  return (
    <>
      <Segmented<FontName>
        label={t('option.font')}
        value={font}
        onChange={(f) => updateToolSettings('text', { font: f })}
        options={FONTS.map((f) => ({ id: f, label: t(`font.${f}`) }))}
        compact
      />
      <Sep />
      <FontSize value={size} onChange={(s) => updateToolSettings('text', { size: s })} />
      <Sep />
      <Swatches label={t('option.color')} colors={INK_COLORS} value={color} onChange={(c) => c && updateToolSettings('text', { color: c })} />
    </>
  )
}

function DrawOptions(): React.JSX.Element {
  const { color, width } = useApp((s) => s.toolSettings.draw)
  return (
    <>
      <Swatches label={t('option.color')} colors={INK_COLORS} value={color} onChange={(c) => c && updateToolSettings('draw', { color: c })} />
      <Sep />
      <Widths value={width} onChange={(w) => updateToolSettings('draw', { width: w })} />
    </>
  )
}

function ShapeOptions(): React.JSX.Element {
  const { type, color, fill, width } = useApp((s) => s.toolSettings.shapes)
  const closed = type === 'square' || type === 'circle'
  return (
    <>
      <Segmented<ShapeType>
        label={t('tool.shapes')}
        value={type}
        onChange={(next) => updateToolSettings('shapes', { type: next })}
        options={[
          { id: 'square', label: t('shape.square'), icon: <Square size={16} />, hideLabel: true },
          { id: 'circle', label: t('shape.circle'), icon: <Circle size={16} />, hideLabel: true },
          { id: 'line', label: t('shape.line'), icon: <Slash size={16} />, hideLabel: true },
          { id: 'arrow', label: t('shape.arrow'), icon: <ArrowUpRight size={16} />, hideLabel: true }
        ]}
        compact
      />
      <Sep />
      <Swatches label={t('option.color')} colors={INK_COLORS} value={color} onChange={(c) => c && updateToolSettings('shapes', { color: c })} />
      <Sep />
      <Swatches
        label={t('option.fill')}
        colors={FILL_COLORS}
        value={fill}
        allowNone
        disabled={!closed}
        onChange={(c) => updateToolSettings('shapes', { fill: c })}
      />
      <Sep />
      <Widths value={width} onChange={(w) => updateToolSettings('shapes', { width: w })} />
    </>
  )
}

function NoteOptions(): React.JSX.Element {
  const color = useApp((s) => s.toolSettings.note.color)
  return <Swatches label={t('option.color')} colors={MARKER_COLORS} value={color} onChange={(c) => c && updateToolSettings('note', { color: c })} />
}

function SignOptions(): React.JSX.Element {
  const saved = useApp((s) => s.signatures)
  const temp = useApp((s) => s.tempSignatures)
  const signatures = [...saved, ...temp]
  const item = useApp((s) => s.toolSettings.sign.item)
  const activeId = item?.kind === 'signature' ? item.id : item === null ? signatures[0]?.id : null
  return (
    <>
      <div className="sign-list" role="group" aria-label={t('sign.saved')}>
        {signatures.map((sig) => (
          <div key={sig.id} className={`sign-chip${sig.id === activeId ? ' active' : ''}`}>
            <button
              type="button"
              className="sign-chip-main"
              aria-pressed={sig.id === activeId}
              aria-label={t('tool.sign')}
              onClick={() => updateToolSettings('sign', { item: { kind: 'signature', id: sig.id } })}
            >
              <img src={sig.dataUrl} alt="" draggable={false} />
            </button>
            <button type="button" className="sign-chip-remove" aria-label={t('sign.remove')} data-tip={t('sign.remove')} onClick={() => removeSignature(sig.id)}>
              <X size={12} />
            </button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={async () => {
            const sig = await newSignature()
            if (sig) updateToolSettings('sign', { item: { kind: 'signature', id: sig.id } })
          }}
        >
          <Plus size={16} />
          {t('sign.new')}
        </Button>
      </div>
      <Sep />
      <div className="sign-helpers" role="group">
        <IconButton small label={t('sign.check')} pressed={item?.kind === 'check'} onClick={() => updateToolSettings('sign', { item: { kind: 'check' } })}>
          <Check size={17} />
        </IconButton>
        <IconButton small label={t('sign.cross')} pressed={item?.kind === 'cross'} onClick={() => updateToolSettings('sign', { item: { kind: 'cross' } })}>
          <X size={17} />
        </IconButton>
        <IconButton small label={t('sign.date')} pressed={item?.kind === 'date'} onClick={() => updateToolSettings('sign', { item: { kind: 'date' } })}>
          <Calendar size={17} />
        </IconButton>
        <IconButton
          small
          label={t('sign.image')}
          pressed={item?.kind === 'image'}
          onClick={async () => {
            const file = await pickImageFile()
            if (!file) return
            try {
              const image = await loadImageFile(file)
              updateToolSettings('sign', { item: { kind: 'image', ...image } })
            } catch {
              toast(t('sign.imageError'), 'error')
            }
          }}
        >
          <ImageUp size={17} />
        </IconButton>
      </div>
    </>
  )
}

function RedactOptions({ tab }: { tab: TabEntry }): React.JSX.Element {
  const count = useStore(tab.store, (s) => s.redactions)
  return (
    <Button variant="danger" disabled={count === 0} onClick={() => void confirmAndApplyRedactions(tab)}>
      {t('redact.apply')}
    </Button>
  )
}

async function resizeFreeText(tab: TabEntry, annot: AnnotData, size: number): Promise<void> {
  const s = tab.store.getState()
  const updated = await s.updateAnnotation(annot.page, annot.id, { font: { size } })
  const b = updated.bounds
  const needed = freeTextRect([b[0], b[1]], updated.contents, updated.font?.name ?? 'Helv', size, s.info.pages[annot.page])
  const width = Math.max(b[2] - b[0], needed[2] - needed[0])
  const height = Math.max(b[3] - b[1], needed[3] - needed[1])
  if (width > b[2] - b[0] + 0.5 || height > b[3] - b[1] + 0.5) {
    await s.transformAnnotation(annot.page, annot.id, b, [b[0], b[1], b[0] + width, b[1] + height])
  }
}

function AnnotationOptions({ tab, annot }: { tab: TabEntry; annot: AnnotData }): React.JSX.Element {
  const update = (patch: AnnotPatch): void => {
    void tab.store.getState().updateAnnotation(annot.page, annot.id, patch)
  }
  const markup = annot.kind === 'highlight' || annot.kind === 'underline' || annot.kind === 'strikeout' || annot.kind === 'squiggly'
  const colorValue: RGB | null = annot.kind === 'freetext' ? (annot.font?.color ?? null) : annot.color
  const showColor = !annot.locked && annot.kind !== 'stamp' && annot.kind !== 'redact' && annot.kind !== 'other'
  const showWidth = !annot.locked && (annot.kind === 'ink' || annot.kind === 'square' || annot.kind === 'circle' || annot.kind === 'line')
  const showFill = !annot.locked && (annot.kind === 'square' || annot.kind === 'circle')
  return (
    <>
      <span className="capsule-title">{annotLabel(annot)}</span>
      {showColor && (
        <>
          <Sep />
          <Swatches
            label={t('option.color')}
            colors={markup && annot.kind === 'highlight' ? MARKER_COLORS : annot.kind === 'note' ? MARKER_COLORS : INK_COLORS}
            value={colorValue}
            onChange={(c) => c && update({ color: c })}
          />
        </>
      )}
      {showFill && (
        <>
          <Sep />
          <Swatches label={t('option.fill')} colors={FILL_COLORS} value={annot.interiorColor} allowNone onChange={(c) => update({ interiorColor: c })} />
        </>
      )}
      {showWidth && (
        <>
          <Sep />
          <Widths value={annot.borderWidth} onChange={(w) => update({ borderWidth: w })} />
        </>
      )}
      {annot.kind === 'freetext' && annot.font && !annot.locked && (
        <>
          <Sep />
          <FontSize value={annot.font.size} onChange={(size) => void resizeFreeText(tab, annot, size)} />
        </>
      )}
      <Sep />
      <IconButton
        small
        label={annot.contents ? t('annot.comment') : t('annot.addComment')}
        pressed={!!annot.contents}
        onClick={() => tab.store.getState().setEditing({ kind: 'comment', page: annot.page, id: annot.id })}
      >
        <MessageSquare size={17} />
      </IconButton>
      <IconButton small danger label={t('annot.delete')} disabled={annot.locked} onClick={() => void tab.store.getState().deleteAnnotation(annot.page, annot.id)}>
        <Trash size={17} />
      </IconButton>
    </>
  )
}

export function ToolOptions({ tab }: { tab: TabEntry }): React.JSX.Element | null {
  const tool = useApp((s) => s.tool)
  const selected = useStore(tab.store, (s) => (s.selection ? s.pageData[s.selection.page]?.annots.find((a) => a.id === s.selection!.id) : undefined))
  let content: React.ReactNode = null
  if (selected && tool === 'select') content = <AnnotationOptions tab={tab} annot={selected} />
  else if (tool === 'markup') content = <MarkupOptions />
  else if (tool === 'text') content = <TextOptions />
  else if (tool === 'draw') content = <DrawOptions />
  else if (tool === 'shapes') content = <ShapeOptions />
  else if (tool === 'note') content = <NoteOptions />
  else if (tool === 'sign') content = <SignOptions />
  else if (tool === 'redact') content = <RedactOptions tab={tab} />
  if (!content) return null
  return (
    <div className="tool-options" role="toolbar" aria-label={t('option.color')} onPointerDown={(e) => e.stopPropagation()}>
      {content}
    </div>
  )
}
