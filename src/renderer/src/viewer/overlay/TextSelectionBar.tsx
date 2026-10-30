import { Copy, Highlighter, MessageSquarePlus, PencilLine, SquareX, Strikethrough, Underline } from 'lucide-react'
import { quadsBounds } from '@renderer/engine/geometry'
import type { Rect, TextLine } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { authorName, setTool, toast, useApp } from '@renderer/state/appStore'
import type { TextSelectionState } from '@renderer/state/docStore'
import { IconButton } from '@renderer/ui'
import { useDoc, useDocStore } from '../context'

export async function copySelection(text: string): Promise<void> {
  await navigator.clipboard.writeText(text.replace(/\r?\n/g, '\n'))
  toast(t('selection.copied'), 'success', undefined, 1600)
}

function singleLine(lines: TextLine[] | null, b: Rect): TextLine | null {
  if (!lines) return null
  const cy = (b[1] + b[3]) / 2
  const hits = lines.filter((l) => cy >= l.bbox[1] && cy <= l.bbox[3] && b[0] < l.bbox[2] && b[2] > l.bbox[0])
  return hits.length === 1 && b[3] - b[1] <= (hits[0].bbox[3] - hits[0].bbox[1]) * 1.6 ? hits[0] : null
}

export function TextSelectionBar({ sel, scale }: { sel: TextSelectionState; scale: number }): React.JSX.Element | null {
  const store = useDocStore()
  const lines = useDoc((s) => s.pageData[sel.page]?.lines ?? null)
  const bounds = quadsBounds(sel.quads)
  if (!bounds) return null
  const line = singleLine(lines, bounds)
  const last = sel.quads[sel.quads.length - 1]
  const anchorX = ((last[2] + last[6]) / 2 + bounds[0]) / 2
  const top = bounds[3] * scale + 8

  const markup = async (kind: 'highlight' | 'underline' | 'strikeout'): Promise<string> => {
    const { toolSettings } = useApp.getState()
    const color = kind === 'highlight' ? toolSettings.markup.color : kind === 'underline' ? [0.18, 0.25, 0.8] : [0.85, 0.2, 0.22]
    const s = store.getState()
    const annot = await s.createAnnotation(sel.page, { kind, quads: sel.quads, color: color as [number, number, number] }, authorName())
    s.setTextSel(null)
    return annot.id
  }

  return (
    <div
      className="selection-bar"
      style={{ left: anchorX * scale, top }}
      onPointerDown={(e) => e.stopPropagation()}
      role="toolbar"
      aria-label={t('tool.markup')}
    >
      <IconButton small label={t('selection.highlight')} onClick={() => void markup('highlight')}>
        <Highlighter size={17} />
      </IconButton>
      <IconButton small label={t('selection.underline')} onClick={() => void markup('underline')}>
        <Underline size={17} />
      </IconButton>
      <IconButton small label={t('selection.strikeout')} onClick={() => void markup('strikeout')}>
        <Strikethrough size={17} />
      </IconButton>
      <span className="selection-bar-sep" />
      <IconButton
        small
        label={t('selection.comment')}
        onClick={async () => {
          const id = await markup('highlight')
          const s = store.getState()
          s.select({ page: sel.page, id })
          s.setEditing({ kind: 'comment', page: sel.page, id })
        }}
      >
        <MessageSquarePlus size={17} />
      </IconButton>
      {line && (
        <IconButton
          small
          label={t('selection.editText')}
          onClick={() => {
            const s = store.getState()
            s.setTextSel(null)
            s.setEditing({ kind: 'line-edit', page: sel.page, line })
          }}
        >
          <PencilLine size={17} />
        </IconButton>
      )}
      <IconButton small label={t('selection.copy')} onClick={() => void copySelection(sel.text)}>
        <Copy size={17} />
      </IconButton>
      <IconButton
        small
        danger
        label={t('selection.redact')}
        onClick={async () => {
          const s = store.getState()
          await s.createAnnotation(sel.page, { kind: 'redact', quads: sel.quads }, authorName())
          s.setTextSel(null)
          setTool('redact')
        }}
      >
        <SquareX size={17} />
      </IconButton>
    </div>
  )
}
