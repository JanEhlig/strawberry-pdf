import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FieldData } from '@renderer/engine/types'
import { useApp } from '@renderer/state/appStore'
import { useDoc, useDocStore } from '../context'
import { placeSignatureInRect } from './signPlacement'

const EDITABLE = new Set(['text', 'checkbox', 'radio', 'combobox', 'listbox', 'signature'])

export function FieldLayer({ page, fields, scale }: { page: number; fields: FieldData[]; scale: number }): React.JSX.Element | null {
  const store = useDocStore()
  const tool = useApp((s) => s.tool)
  const highlight = useApp((s) => s.settings.highlightFields)
  const editing = useDoc((s) => (s.editing?.kind === 'field' && s.editing.page === page ? s.editing.id : null))
  const interactive = tool === 'select' || tool === 'sign'
  const visible = fields.filter((f) => EDITABLE.has(f.type) && !f.readOnly && !(f.type === 'signature' && f.signed))
  if (visible.length === 0) return null

  const activate = async (field: FieldData): Promise<void> => {
    const s = store.getState()
    s.select(null)
    s.setTextSel(null)
    if (field.type === 'checkbox' || field.type === 'radio') {
      await s.setFieldValue(page, field.id, field.type === 'radio' ? true : !field.checked)
      return
    }
    if (field.type === 'signature') {
      await placeSignatureInRect(store, page, field.rect)
      return
    }
    s.setEditing({ kind: 'field', page, id: field.id })
  }

  return (
    <>
      {visible.map((field) => {
        const [x0, y0, x1, y1] = field.rect
        const isEditing = editing === field.id
        const signatureOnlyInSign = tool === 'sign' && field.type !== 'signature'
        return (
          <div
            key={field.id}
            className={`form-field type-${field.type}${highlight ? ' tinted' : ''}${field.required ? ' required' : ''}`}
            style={{
              left: x0 * scale,
              top: y0 * scale,
              width: (x1 - x0) * scale,
              height: (y1 - y0) * scale,
              pointerEvents: interactive && !signatureOnlyInSign && !isEditing ? 'auto' : 'none'
            }}
            role={field.type === 'checkbox' ? 'checkbox' : field.type === 'radio' ? 'radio' : 'button'}
            aria-checked={field.type === 'checkbox' || field.type === 'radio' ? field.checked : undefined}
            aria-label={field.label || field.name}
            tabIndex={interactive ? 0 : -1}
            data-field-id={field.id}
            data-tip={field.label || undefined}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              if (e.button === 0) void activate(field)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                void activate(field)
              }
            }}
          />
        )
      })}
      {editing && (
        <FieldEditor
          key={editing}
          page={page}
          field={fields.find((f) => f.id === editing)!}
          fields={visible}
          scale={scale}
          onNext={(next) => {
            if (next && (next.type === 'text' || next.type === 'combobox' || next.type === 'listbox')) {
              void activate(next)
              return
            }
            store.getState().setEditing(null)
            if (next) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field-id="${next.id}"]`)?.focus())
          }}
        />
      )}
    </>
  )
}

function fieldFontSize(field: FieldData): number {
  if (field.fontSize > 0) return field.fontSize
  const h = field.rect[3] - field.rect[1]
  return field.multiline ? 11 : Math.max(8, Math.min(14, h * 0.62))
}

function FieldEditor({
  page,
  field,
  fields,
  scale,
  onNext
}: {
  page: number
  field: FieldData | undefined
  fields: FieldData[]
  scale: number
  onNext: (next: FieldData | null) => void
}): React.JSX.Element | null {
  const store = useDocStore()
  const [value, setValue] = useState(field?.value ?? '')
  const done = useRef(false)
  const edited = useRef(false)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!edited.current && field) setValue(field.value)
  }, [field?.value])

  useEffect(() => {
    if (!field || (field.type !== 'text' && field.type !== 'combobox')) return
    void store.getState().setAnnotationHidden(page, field.id, true)
    return () => void store.getState().setAnnotationHidden(page, field.id, false)
  }, [store, page, field?.id, field?.type])

  useLayoutEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select?.()
  }, [])

  const latest = useRef({ value, field })
  latest.current = { value, field }
  useEffect(
    () => () => {
      const { value: pending, field: current } = latest.current
      if (done.current || !current) return
      done.current = true
      const s = store.getState()
      if (current.type === 'text' && edited.current && pending !== current.value) void s.setFieldValue(page, current.id, pending)
      if (s.editing?.kind === 'field' && s.editing.id === current.id) s.setEditing(null)
    },
    [store, page]
  )

  if (!field) return null

  const commit = async (next: FieldData | null | undefined, newValue = value): Promise<void> => {
    if (done.current) return
    done.current = true
    if (edited.current && newValue !== field.value) await store.getState().setFieldValue(page, field.id, newValue)
    if (next === undefined) store.getState().setEditing(null)
    else onNext(next)
  }
  const nextField = (backwards: boolean): FieldData | null => {
    const order = fields.filter((f) => f.type !== 'signature')
    const i = order.findIndex((f) => f.id === field.id)
    return order[i + (backwards ? -1 : 1)] ?? null
  }

  const [x0, y0, x1, y1] = field.rect
  const style: React.CSSProperties = {
    left: x0 * scale,
    top: y0 * scale,
    width: (x1 - x0) * scale,
    height: (y1 - y0) * scale,
    fontSize: fieldFontSize(field) * scale
  }

  if (field.type === 'combobox' || field.type === 'listbox') {
    return (
      <div className="field-options" style={{ left: x0 * scale, top: (field.type === 'combobox' ? y1 : y0) * scale, minWidth: (x1 - x0) * scale }} role="listbox">
        {field.options.map((option) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={option === field.value}
            className={option === field.value ? 'selected' : undefined}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              edited.current = true
              void commit(undefined, option)
            }}
          >
            {option}
          </button>
        ))}
        <ClickAway onAway={() => void commit(undefined, field.value)} />
      </div>
    )
  }

  const common = {
    ref: inputRef,
    className: `field-editor${field.comb ? ' comb' : ''}`,
    value,
    style,
    spellCheck: false,
    maxLength: field.maxLen > 0 ? field.maxLen : undefined,
    'aria-label': field.label || field.name,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      edited.current = true
      setValue(e.target.value)
    },
    onBlur: () => void commit(undefined),
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Tab') {
        e.preventDefault()
        void commit(nextField(e.shiftKey))
      } else if (e.key === 'Escape') {
        e.preventDefault()
        done.current = true
        store.getState().setEditing(null)
      } else if (e.key === 'Enter' && !field.multiline) {
        e.preventDefault()
        void commit(undefined)
      }
    }
  }
  return field.multiline ? <textarea {...common} /> : <input {...common} type={field.password ? 'password' : 'text'} />
}

function ClickAway({ onAway }: { onAway: () => void }): null {
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (!(e.target as Element).closest('.field-options')) onAway()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onAway()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [onAway])
  return null
}
