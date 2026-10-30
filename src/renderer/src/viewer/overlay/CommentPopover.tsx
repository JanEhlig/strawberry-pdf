import { Trash } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AnnotData } from '@renderer/engine/types'
import { locale, t, type MessageKey } from '@renderer/i18n'
import { Button, IconButton } from '@renderer/ui'
import { useDocStore } from '../context'

export function annotLabel(a: AnnotData): string {
  if (a.role === 'signature') return t('annot.kind.signature')
  if (a.role === 'image') return t('annot.kind.image')
  return t(`annot.kind.${a.kind}` as MessageKey)
}

export function opensComment(a: AnnotData): boolean {
  return a.kind === 'note' || (!!a.contents && a.kind !== 'freetext' && a.kind !== 'redact')
}

export function formatDate(time: number | null): string {
  if (!time) return ''
  return new Date(time).toLocaleString(locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function CommentPopover({ annot, scale, pageWidth }: { annot: AnnotData; scale: number; pageWidth: number }): React.JSX.Element {
  const store = useDocStore()
  const [text, setText] = useState(annot.contents)
  const edited = useRef(false)
  const latest = useRef({ text, contents: annot.contents })
  latest.current = { text, contents: annot.contents }
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  useEffect(() => {
    if (!edited.current) setText(annot.contents)
  }, [annot.contents])

  useEffect(() => {
    return () => {
      const { text, contents } = latest.current
      if (edited.current && text !== contents) void store.getState().updateAnnotation(annot.page, annot.id, { contents: text })
    }
  }, [store, annot.page, annot.id])

  const close = (): void => store.getState().setEditing(null)
  const [x0, y0, x1] = annot.bounds
  const width = 260
  const right = x1 * scale + 12
  const left = right + width > pageWidth * scale + 180 ? x0 * scale - width - 12 : right

  return (
    <div
      className="comment-popover"
      style={{ left, top: y0 * scale }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) close()
      }}
      role="dialog"
      aria-label={t('annot.comment')}
    >
      <div className="comment-head">
        <span className="comment-kind">{annotLabel(annot)}</span>
        <span className="comment-meta">
          {annot.author}
          {annot.author && annot.modified ? ', ' : ''}
          {formatDate(annot.modified)}
        </span>
      </div>
      <textarea
        ref={ref}
        className="comment-text"
        value={text}
        placeholder={t('annot.commentPlaceholder')}
        onChange={(e) => {
          edited.current = true
          setText(e.target.value)
        }}
        readOnly={annot.locked}
        rows={4}
      />
      <div className="comment-foot">
        {!annot.locked && (
          <IconButton
            small
            danger
            label={t('annot.delete')}
            onClick={() => {
              edited.current = false
              close()
              void store.getState().deleteAnnotation(annot.page, annot.id)
            }}
          >
            <Trash size={16} />
          </IconButton>
        )}
        <Button variant="primary" onClick={close}>
          {t('common.done')}
        </Button>
      </div>
    </div>
  )
}
