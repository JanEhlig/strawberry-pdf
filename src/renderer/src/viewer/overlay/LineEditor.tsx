import { TriangleAlert } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { displayFontName } from '@shared/fontNames'
import type { TextEditPlan, TextLine } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { toast } from '@renderer/state/appStore'
import { editorFont, type EditorFont } from '@renderer/state/fonts'
import { rgbToCss } from '@renderer/tools/tools'
import { FontSize } from '@renderer/ui'
import { useDocStore } from '../context'

const PLAN_DELAY = 150
const BAR_SPACE = 46

export function LineEditor({ page, line, scale }: { page: number; line: TextLine; scale: number }): React.JSX.Element {
  const store = useDocStore()
  const [value, setValue] = useState(line.text)
  const [size, setSize] = useState(line.size)
  const [plan, setPlan] = useState<TextEditPlan | null>(null)
  const [font, setFont] = useState<EditorFont | null>(null)
  const [missing, setMissing] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const edited = useRef(false)
  const latest = useRef({ value, size, plan })
  latest.current = { value, size, plan }

  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  useEffect(() => {
    let alive = true
    store
      .getState()
      .planTextEdit(page, line)
      .then((result) => {
        if (!alive) return
        setPlan(result)
        setSize(result.size)
        if (!edited.current) {
          setValue(result.text)
          requestAnimationFrame(() => ref.current?.select())
        }
      })
      .catch(() => undefined)
    editorFont(line.font)
      .then((result) => alive && setFont(result))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [store, page, line])

  useEffect(() => {
    if (!edited.current) return
    const timer = setTimeout(() => {
      store
        .getState()
        .planTextEdit(page, line, value)
        .then((result) => setMissing(result.missing))
        .catch(() => undefined)
    }, PLAN_DELAY)
    return () => clearTimeout(timer)
  }, [store, page, line, value])

  const commit = async (cancel: boolean): Promise<void> => {
    if (done.current) return
    done.current = true
    const s = store.getState()
    if (s.editing?.kind === 'line-edit') s.setEditing(null)
    const current = latest.current
    const original = current.plan?.text ?? line.text
    const resized = Math.abs(current.size - (current.plan?.size ?? line.size)) > 0.01
    if (cancel || (current.value === original && !resized)) return
    try {
      await s.replaceTextLine(page, line, current.value, resized ? current.size : undefined)
    } catch (error) {
      toast(t('error.generic', { message: error instanceof Error ? error.message : String(error) }), 'error')
    }
  }

  useEffect(() => () => void commit(false), [])

  const [x0, y0, x1, y1] = line.bbox
  const ratio = size / (line.size || size || 1)
  const height = (y1 - y0) * ratio * scale
  const barTop = y0 * scale >= BAR_SPACE ? y0 * scale - BAR_SPACE : y0 * scale + height + 10
  const substitute = missing.length > 0 && !font?.installed
  return (
    <>
      <div
        className="line-editor-bar"
        style={{ left: x0 * scale, top: barTop }}
        role="toolbar"
        aria-label={t('text.edit')}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <span className="line-editor-font" data-tip={font?.label ?? displayFontName(line.font.name)}>
          {font?.label ?? displayFontName(line.font.name)}
        </span>
        {substitute && (
          <span className="line-editor-substitute" data-tip={t('lineEdit.substitute', { chars: missing })}>
            <TriangleAlert size={15} aria-label={t('lineEdit.substitute', { chars: missing })} />
          </span>
        )}
        <span className="selection-bar-sep" />
        <FontSize value={size} onChange={setSize} />
      </div>
      <input
        ref={ref}
        className="line-editor"
        value={value}
        spellCheck={false}
        aria-label={t('text.edit')}
        onChange={(e) => {
          edited.current = true
          setValue(e.target.value)
        }}
        onBlur={() => void commit(false)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            e.preventDefault()
            void commit(false)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            void commit(true)
          }
        }}
        style={{
          left: x0 * scale - 3,
          top: y0 * scale - 2,
          minWidth: (x1 - x0) * scale + 24,
          height: height + 4,
          fontFamily: font?.family ?? (line.font.mono ? 'monospace' : line.font.serif ? 'serif' : 'sans-serif'),
          fontWeight: font?.weight ?? (line.font.bold ? 700 : 400),
          fontStyle: font?.style ?? (line.font.italic ? 'italic' : 'normal'),
          fontSize: size * scale,
          color: rgbToCss(line.color)
        }}
      />
    </>
  )
}
