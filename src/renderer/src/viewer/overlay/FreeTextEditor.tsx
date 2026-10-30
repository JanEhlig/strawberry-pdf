import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Point } from '@renderer/engine/types'
import { authorName, useApp } from '@renderer/state/appStore'
import type { Editing } from '@renderer/state/docStore'
import { CSS_FONT, rgbToCss } from '@renderer/tools/tools'
import { useDoc, useDocStore } from '../context'
import { FREETEXT_LINE_HEIGHT, FREETEXT_PAD, freeTextRect, measureText } from '../placement'

type TextEditing = Extract<Editing, { kind: 'freetext-new' } | { kind: 'freetext-edit' }>

export function FreeTextEditor({ editing, scale }: { editing: TextEditing; scale: number }): React.JSX.Element | null {
  const store = useDocStore()
  const pageSize = useDoc((s) => s.info.pages[editing.page])
  const annot = useDoc((s) =>
    editing.kind === 'freetext-edit' ? s.pageData[editing.page]?.annots.find((a) => a.id === editing.id) : undefined
  )
  const toolText = useApp((s) => s.toolSettings.text)
  const font = annot?.font ?? { name: toolText.font, size: toolText.size, color: toolText.color }
  const origin = useMemo<Point>(() => {
    if (annot) return [annot.bounds[0], annot.bounds[1]]
    if (editing.kind === 'freetext-new') return [editing.point[0], Math.max(0, editing.point[1] - font.size * 0.75)]
    return [0, 0]
  }, [annot?.id])
  const [text, setText] = useState(annot?.contents ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  const done = useRef(false)
  const edited = useRef(false)

  useEffect(() => {
    if (!edited.current && annot) setText(annot.contents)
  }, [annot?.contents])

  useEffect(() => {
    if (editing.kind !== 'freetext-edit') return
    void store.getState().setAnnotationHidden(editing.page, editing.id, true)
  }, [store, editing])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const latest = useRef({ text, annot, font, origin, pageSize, toolText })
  latest.current = { text, annot, font, origin, pageSize, toolText }

  const commit = async (cancel: boolean): Promise<void> => {
    if (done.current) return
    done.current = true
    const { text: current, annot: target, font: f, origin: o, pageSize: size, toolText: tool } = latest.current
    const s = store.getState()
    const value = current.replace(/\s+$/, '')
    const open = s.editing
    if (open?.kind === editing.kind && open.page === editing.page) s.setEditing(null)
    try {
      if (editing.kind === 'freetext-new') {
        if (!cancel && value) {
          const rect = freeTextRect(o, value, f.name, f.size, size)
          await s.createAnnotation(editing.page, { kind: 'freetext', rect, text: value, font: tool.font, size: f.size, color: f.color }, authorName())
        }
      } else if (target && edited.current) {
        if (!cancel && !value) {
          await s.deleteAnnotation(editing.page, target.id)
        } else {
          if (!cancel && value !== target.contents) {
            await s.updateAnnotation(editing.page, target.id, { contents: value })
            const needed = freeTextRect(o, value, f.name, f.size, size)
            const b = target.bounds
            const width = Math.max(b[2] - b[0], needed[2] - needed[0])
            const height = Math.max(b[3] - b[1], needed[3] - needed[1])
            if (width > b[2] - b[0] + 0.5 || height > b[3] - b[1] + 0.5) {
              await s.transformAnnotation(editing.page, target.id, b, [b[0], b[1], b[0] + width, b[1] + height])
            }
          }
        }
      }
    } finally {
      if (target && (cancel || value || !edited.current)) await s.setAnnotationHidden(editing.page, target.id, false).catch(() => undefined)
    }
  }

  useEffect(() => () => void commit(false), [])

  if (editing.kind === 'freetext-edit' && !annot) return null
  const size = measureText(text || ' ', font.name, font.size)
  const minWidth = editing.kind === 'freetext-new' ? 140 : (annot!.bounds[2] - annot!.bounds[0]) * scale
  return (
    <textarea
      ref={ref}
      className="freetext-editor"
      value={text}
      spellCheck={false}
      aria-label="Text"
      onChange={(e) => {
        edited.current = true
        setText(e.target.value)
      }}
      onBlur={() => void commit(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') {
          e.preventDefault()
          void commit(true)
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          void commit(false)
        }
      }}
      style={{
        left: origin[0] * scale,
        top: origin[1] * scale,
        width: Math.max(minWidth, size.width * scale + 24),
        height: size.height * scale + 4,
        padding: `${FREETEXT_PAD * scale}px`,
        fontFamily: CSS_FONT[font.name] ?? CSS_FONT.Helv,
        fontSize: font.size * scale,
        lineHeight: FREETEXT_LINE_HEIGHT,
        color: rgbToCss(font.color)
      }}
    />
  )
}
