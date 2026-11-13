import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject
} from 'react'
import { Minus, Plus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { dismissToast, openDialog, useApp } from '@renderer/state/appStore'
import type { RGB } from '@renderer/engine/types'
import { FONT_SIZES, rgbToCss, sameColor, type NamedColor } from '@renderer/tools/tools'
import { t } from '@renderer/i18n'
import './ui.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  variant = 'secondary',
  large,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; large?: boolean }): React.JSX.Element {
  return <button type="button" className={`btn btn-${variant}${large ? ' btn-large' : ''}${className ? ` ${className}` : ''}`} {...rest} />
}

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; pressed?: boolean; small?: boolean; danger?: boolean }
>(function IconButton({ label, pressed, small, danger, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-btn${small ? ' small' : ''}${danger ? ' danger' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      data-tip={label}
      aria-pressed={pressed === undefined ? undefined : pressed}
      {...rest}
    >
      {children}
    </button>
  )
})

export function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null)
  useEffect(() => {
    let timer = 0
    let target: Element | null = null
    const show = (el: Element): void => {
      const text = el.getAttribute('data-tip')
      if (!text) return
      const r = el.getBoundingClientRect()
      const above = r.bottom + 44 > window.innerHeight
      setTip({ text, x: r.left + r.width / 2, y: above ? r.top - 8 : r.bottom + 8, above })
    }
    const over = (e: Event): void => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
      if (el === target) return
      target = el
      window.clearTimeout(timer)
      setTip(null)
      if (el) timer = window.setTimeout(() => show(el), 550)
    }
    const hide = (): void => {
      window.clearTimeout(timer)
      target = null
      setTip(null)
    }
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])
  const ref = useRef<HTMLDivElement>(null)
  const [left, setLeft] = useState(0)
  useLayoutEffect(() => {
    if (!tip || !ref.current) return
    const w = ref.current.offsetWidth
    setLeft(Math.max(8, Math.min(window.innerWidth - w - 8, tip.x - w / 2)))
  }, [tip])
  if (!tip) return null
  return createPortal(
    <div
      ref={ref}
      className="tooltip"
      role="tooltip"
      style={{ left, top: tip.above ? undefined : tip.y, bottom: tip.above ? window.innerHeight - tip.y : undefined }}
    >
      {tip.text}
    </div>,
    document.body
  )
}

export function Popover({
  anchor,
  onClose,
  children,
  placement = 'bottom-start',
  className,
  label
}: {
  anchor: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  placement?: 'bottom-start' | 'bottom-end' | 'bottom' | 'top'
  className?: string
  label?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const a = anchor.current
    const el = ref.current
    if (!a || !el) return
    const r = a.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = placement === 'bottom-end' ? r.right - w : placement === 'bottom' || placement === 'top' ? r.left + r.width / 2 - w / 2 : r.left
    let top = placement === 'top' ? r.top - h - 6 : r.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left))
    setPos({ left, top })
  }, [anchor, placement])

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return
      onCloseRef.current()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className={`popover${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body
  )
}

export function MenuItem({
  icon,
  hint,
  danger,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; hint?: string; danger?: boolean }): React.JSX.Element {
  return (
    <button type="button" role="menuitem" className={`menu-item${danger ? ' danger' : ''}`} {...rest}>
      {icon && <span className="menu-icon">{icon}</span>}
      <span>{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  )
}

export function MenuSeparator(): React.JSX.Element {
  return <div className="menu-sep" role="separator" />
}

const openDialogs: (HTMLDivElement | null)[] = []

export function Dialog({
  title,
  children,
  footer,
  onClose,
  wide,
  className
}: {
  title: string
  children?: ReactNode
  footer?: ReactNode
  onClose: () => void
  wide?: boolean
  className?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = ref.current
    const focusable = el?.querySelector<HTMLElement>('[autofocus], input, textarea, select, .btn-primary, .btn-danger, button')
    focusable?.focus()
    openDialogs.push(el)
    const key = (e: KeyboardEvent): void => {
      if (openDialogs[openDialogs.length - 1] !== el) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
      }
      if (e.key === 'Tab' && el && !el.contains(document.activeElement)) {
        e.preventDefault()
        el.querySelector<HTMLElement>('input, textarea, select, button')?.focus()
        return
      }
      if (e.key === 'Tab' && el) {
        const items = Array.from(el.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex="0"]')).filter(
          (n) => !n.hasAttribute('disabled')
        )
        if (items.length === 0) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      openDialogs.splice(openDialogs.indexOf(el), 1)
      previous?.focus?.()
    }
  }, [])
  return (
    <div className="dialog-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`dialog${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2 className="dialog-title">{title}</h2>
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function DialogHost(): React.JSX.Element {
  const dialogs = useApp((s) => s.dialogs)
  return <>{dialogs.map((d) => <div key={d.id}>{d.node}</div>)}</>
}

export interface Choice<T extends string> {
  id: T
  label: string
  variant?: Variant
}

export function choose<T extends string>(options: { title: string; body?: ReactNode; choices: Choice<T>[]; cancel: T }): Promise<T> {
  return openDialog<T>((close) => (
    <Dialog
      title={options.title}
      onClose={() => close(options.cancel)}
      footer={options.choices.map((c, i) => (
        <Button key={c.id} variant={c.variant ?? 'secondary'} autoFocus={i === options.choices.length - 1} onClick={() => close(c.id)}>
          {c.label}
        </Button>
      ))}
    >
      {typeof options.body === 'string' ? <p>{options.body}</p> : options.body}
    </Dialog>
  ))
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  compact,
  label
}: {
  value: T
  options: { id: T; label: string; icon?: ReactNode; hideLabel?: boolean }[]
  onChange: (value: T) => void
  compact?: boolean
  label: string
}): React.JSX.Element {
  return (
    <div className={`segmented${compact ? ' compact' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={o.id === value}
          aria-label={o.label}
          data-tip={o.hideLabel ? o.label : undefined}
          onClick={() => onChange(o.id)}
        >
          {o.icon}
          {!o.hideLabel && o.label}
        </button>
      ))}
    </div>
  )
}

export function Swatches({
  colors,
  value,
  onChange,
  allowNone,
  label,
  disabled
}: {
  colors: NamedColor[]
  value: RGB | null
  onChange: (rgb: RGB | null) => void
  allowNone?: boolean
  label: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="swatches" role="group" aria-label={label} aria-disabled={disabled}>
      {allowNone && (
        <button
          type="button"
          className="swatch swatch-none"
          aria-pressed={!disabled && value === null}
          disabled={disabled}
          aria-label={t('option.noFill')}
          data-tip={t('option.noFill')}
          onClick={() => onChange(null)}
        >
          <span className="swatch-dot" />
        </button>
      )}
      {colors.map((c) => (
        <button
          key={c.name + c.rgb.join()}
          type="button"
          className="swatch"
          aria-pressed={!disabled && sameColor(value, c.rgb)}
          disabled={disabled}
          aria-label={t(c.name)}
          data-tip={t(c.name)}
          onClick={() => onChange(c.rgb)}
        >
          <span className="swatch-dot" style={{ background: rgbToCss(c.rgb) }} />
        </button>
      ))}
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast ${item.tone}`}>
          <span>{item.message}</span>
          {item.action && (
            <button
              type="button"
              onClick={() => {
                item.action?.run()
                dismissToast(item.id)
              }}
            >
              {item.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

export function FontSize({ value, onChange }: { value: number; onChange: (size: number) => void }): React.JSX.Element {
  const index = FONT_SIZES.findIndex((s) => s >= value - 0.01)
  const smaller = FONT_SIZES[Math.max(0, (index === -1 ? FONT_SIZES.length : index) - 1)]
  const larger = FONT_SIZES[Math.min(FONT_SIZES.length - 1, index === -1 ? FONT_SIZES.length - 1 : FONT_SIZES[index] > value + 0.01 ? index : index + 1)]
  return (
    <div className="stepper" role="group" aria-label={t('option.size')}>
      <IconButton small label={t('option.smaller')} onClick={() => onChange(smaller)}>
        <Minus size={15} />
      </IconButton>
      <span className="stepper-value tabular">{Math.round(value)} pt</span>
      <IconButton small label={t('option.larger')} onClick={() => onChange(larger)}>
        <Plus size={15} />
      </IconButton>
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return <kbd className="kbd">{children}</kbd>
}
