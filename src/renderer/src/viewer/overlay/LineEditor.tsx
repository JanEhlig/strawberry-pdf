import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { standardFontFor } from '@renderer/engine/fonts'
import type { TextLine } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { toast } from '@renderer/state/appStore'
import { rgbToCss } from '@renderer/tools/tools'
import { useDocStore } from '../context'

function cssFontFor(name: string): { family: string; weight: number; style: string } {
  const base = standardFontFor(name)
  const family = base.startsWith('Times')
    ? '"Times New Roman", Times, serif'
    : base.startsWith('Courier')
      ? '"Courier New", Courier, monospace'
      : 'Helvetica, Arial, sans-serif'
  return { family, weight: /Bold/.test(base) ? 700 : 400, style: /Italic|Oblique/.test(base) ? 'italic' : 'normal' }
}

export function LineEditor({ page, line, scale }: { page: number; line: TextLine; scale: number }): React.JSX.Element {
  const store = useDocStore()
  const [value, setValue] = useState(line.text)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const font = cssFontFor(line.font)

  useLayoutEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const latestValue = useRef(value)
  latestValue.current = value

  const commit = async (cancel: boolean): Promise<void> => {
    if (done.current) return
    done.current = true
    const s = store.getState()
    if (s.editing?.kind === 'line-edit') s.setEditing(null)
    const text = latestValue.current
    if (cancel || text === line.text) return
    try {
      await s.replaceTextLine(page, line, text)
    } catch (error) {
      toast(t('error.generic', { message: error instanceof Error ? error.message : String(error) }), 'error')
    }
  }

  useEffect(() => () => void commit(false), [])

  const [x0, y0, x1, y1] = line.bbox
  return (
    <input
      ref={ref}
      className="line-editor"
      value={value}
      spellCheck={false}
      aria-label={t('text.edit')}
      onChange={(e) => setValue(e.target.value)}
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
        width: `${Math.max(value.length, 4) * 0.62 * line.size * scale + 24}px`,
        height: (y1 - y0) * scale + 4,
        fontFamily: font.family,
        fontWeight: font.weight,
        fontStyle: font.style,
        fontSize: line.size * scale,
        color: rgbToCss(line.color)
      }}
    />
  )
}
