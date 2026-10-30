import '@fontsource/great-vibes/latin-ext-400.css'
import '@fontsource/great-vibes/latin-400.css'
import '@fontsource/dancing-script/latin-ext-400.css'
import '@fontsource/dancing-script/latin-400.css'
import '@fontsource/caveat/latin-ext-400.css'
import '@fontsource/caveat/latin-400.css'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import { Eraser, ImageUp, PenLine, Type } from 'lucide-react'
import type { RGB } from '@renderer/engine/types'
import { t } from '@renderer/i18n'
import { contentBounds, removeLightBackground, tintInk, type PixelBounds } from '@renderer/lib/signatureImage'
import { authorName, openDialog } from '@renderer/state/appStore'
import { rgbToCss, type NamedColor } from '@renderer/tools/tools'
import { Button, Dialog, Segmented, Swatches } from '@renderer/ui'
import './SignatureDialog.css'

export interface CreatedSignature {
  dataUrl: string
  width: number
  height: number
  kind: 'drawn' | 'typed' | 'image'
  keep: boolean
}

type Tab = 'draw' | 'type' | 'image'
type ImageState = { status: 'empty' | 'loading' | 'error' } | { status: 'ready'; data: ImageData }

interface StrokePoint {
  x: number
  y: number
  w: number
}
type Stroke = StrokePoint[]

interface ActiveStroke {
  pointerId: number
  points: Stroke
  rect: DOMRect
  time: number
  speed: number
  pen: boolean
}

interface Png {
  dataUrl: string
  width: number
  height: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const INKS: NamedColor[] = [
  { name: 'sign.inkBlack', rgb: [0x1a / 255, 0x1a / 255, 0x1a / 255] },
  { name: 'sign.inkBlue', rgb: [0x2f / 255, 0x3f / 255, 0xcb / 255] }
]

const FONTS = [
  { family: 'Great Vibes', size: 44 },
  { family: 'Dancing Script', size: 36 },
  { family: 'Caveat', size: 42 }
] as const
type FontFamily = (typeof FONTS)[number]['family']

const KIND: Record<Tab, CreatedSignature['kind']> = { draw: 'drawn', type: 'typed', image: 'image' }

const WEIGHTS = [
  { label: 'sign.weight.fine', ink: 0.6, text: 0 },
  { label: 'sign.weight.medium', ink: 1, text: 0.012 },
  { label: 'sign.weight.bold', ink: 1.6, text: 0.03 },
  { label: 'sign.weight.heavy', ink: 2.4, text: 0.052 }
] as const

let lastWeight = 1

const PAD_W = 560
const PAD_H = 220
const MIN_WIDTH = 1.2
const MAX_WIDTH = 3.4
const START_WIDTH = 2.3
const MIN_STEP = 0.75

const EXPORT_SCALE = 3
const MAX_SIDE = 1200
const MAX_UPSCALE = 2
const PADDING = 0.06
const TYPE_SIZE = 120
const MAX_IMAGE_SIDE = 1600

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function context2d(canvas: HTMLCanvasElement, readBack = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', readBack ? { willReadFrequently: true } : undefined)
  if (!ctx) throw new Error('Canvas 2D is not available')
  return ctx
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

function prepareInk(ctx: CanvasRenderingContext2D, scale: number, color: string): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.fillStyle = color
}

function paintSegments(ctx: CanvasRenderingContext2D, points: Stroke, from: number, to: number, weight: number): void {
  for (let i = from; i < to; i++) {
    const p = points[i]
    const next = points[i + 1]
    ctx.beginPath()
    ctx.lineWidth = p.w * weight
    if (i === 0) {
      ctx.moveTo(p.x, p.y)
      ctx.lineTo((p.x + next.x) / 2, (p.y + next.y) / 2)
    } else {
      const prev = points[i - 1]
      ctx.moveTo((prev.x + p.x) / 2, (prev.y + p.y) / 2)
      ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2)
    }
    ctx.stroke()
  }
}

function paintTail(ctx: CanvasRenderingContext2D, points: Stroke, weight: number): void {
  const last = points[points.length - 1]
  ctx.beginPath()
  if (points.length === 1) {
    ctx.arc(last.x, last.y, last.w * 0.8 * weight, 0, Math.PI * 2)
    ctx.fill()
    return
  }
  const prev = points[points.length - 2]
  ctx.lineWidth = last.w * weight
  ctx.moveTo((prev.x + last.x) / 2, (prev.y + last.y) / 2)
  ctx.lineTo(last.x, last.y)
  ctx.stroke()
}

function paintStroke(ctx: CanvasRenderingContext2D, points: Stroke, weight: number): void {
  paintSegments(ctx, points, 0, points.length - 1, weight)
  paintTail(ctx, points, weight)
}

function toPad(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  return { x: ((clientX - rect.left) / rect.width) * PAD_W, y: ((clientY - rect.top) / rect.height) * PAD_H }
}

function pressureWidth(pressure: number): number {
  return MIN_WIDTH + (MAX_WIDTH - MIN_WIDTH) * Math.pow(clamp(pressure > 0 ? pressure : 0.5, 0, 1), 0.8)
}

function addPoint(stroke: ActiveStroke, event: PointerEvent): void {
  const { x, y } = toPad(stroke.rect, event.clientX, event.clientY)
  const last = stroke.points[stroke.points.length - 1]
  const distance = Math.hypot(x - last.x, y - last.y)
  if (distance < MIN_STEP) return
  const elapsed = Math.max(1, event.timeStamp - stroke.time)
  stroke.time = event.timeStamp
  stroke.speed = 0.7 * (distance / elapsed) + 0.3 * stroke.speed
  const target = stroke.pen ? pressureWidth(event.pressure) : clamp(MAX_WIDTH / (1 + stroke.speed * 0.8), MIN_WIDTH, MAX_WIDTH)
  stroke.points.push({ x, y, w: last.w + (target - last.w) * 0.35 })
}

function renderStrokes(strokes: Stroke[], color: string, scale: number, weight: number): HTMLCanvasElement {
  const factor = EXPORT_SCALE * scale
  const canvas = makeCanvas(PAD_W * factor, PAD_H * factor)
  const ctx = context2d(canvas, true)
  prepareInk(ctx, factor, color)
  for (const points of strokes) paintStroke(ctx, points, weight)
  return canvas
}

async function loadFont(family: FontFamily, text: string): Promise<void> {
  try {
    await document.fonts.load(`${TYPE_SIZE}px "${family}"`, text)
  } catch {
  }
}

function renderText(text: string, family: FontFamily, color: string, scale: number, stroke: number): HTMLCanvasElement {
  const size = TYPE_SIZE * scale
  const font = `${size}px "${family}"`
  const probe = context2d(makeCanvas(1, 1))
  probe.font = font
  const m = probe.measureText(text)
  const margin = Math.ceil(size * 0.3)
  const left = Math.ceil(m.actualBoundingBoxLeft)
  const ascent = Math.ceil(m.actualBoundingBoxAscent)
  const canvas = makeCanvas(left + Math.ceil(m.actualBoundingBoxRight) + 2 * margin, ascent + Math.ceil(m.actualBoundingBoxDescent) + 2 * margin)
  const ctx = context2d(canvas, true)
  ctx.font = font
  ctx.fillStyle = color
  ctx.fillText(text, margin + left, margin + ascent)
  if (stroke > 0) {
    ctx.lineWidth = size * stroke
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.strokeText(text, margin + left, margin + ascent)
  }
  return canvas
}

async function prepareImage(file: Blob): Promise<ImageData | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = makeCanvas(bitmap.width * scale, bitmap.height * scale)
    const ctx = context2d(canvas, true)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const { width, height } = canvas
    const data = ctx.getImageData(0, 0, width, height)
    removeLightBackground(data.data, width, height)
    const bounds = contentBounds(data.data, width, height, 24)
    return bounds ? cropImage(data, bounds) : null
  } finally {
    bitmap.close()
  }
}

function cropImage(source: ImageData, [x0, y0, x1, y1]: PixelBounds): ImageData {
  const pad = Math.max(2, Math.round(Math.max(x1 - x0, y1 - y0) * PADDING))
  const out = new ImageData(x1 - x0 + 2 * pad, y1 - y0 + 2 * pad)
  for (let y = y0; y < y1; y++) {
    out.data.set(source.data.subarray((y * source.width + x0) * 4, (y * source.width + x1) * 4), ((y - y0 + pad) * out.width + pad) * 4)
  }
  return out
}

function tintedCopy(data: ImageData, ink: RGB): ImageData {
  const copy = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height)
  tintInk(copy.data, copy.width, copy.height, [Math.round(ink[0] * 255), Math.round(ink[1] * 255), Math.round(ink[2] * 255)])
  return copy
}

function imageCanvas(data: ImageData): HTMLCanvasElement {
  const canvas = makeCanvas(data.width, data.height)
  context2d(canvas, true).putImageData(data, 0, 0)
  return canvas
}

function inkBox(canvas: HTMLCanvasElement): Box | null {
  const { width, height } = canvas
  const b = contentBounds(context2d(canvas, true).getImageData(0, 0, width, height).data, width, height)
  return b && { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }
}

const paddingOf = (box: Box): number => Math.max(2, Math.round(Math.max(box.w, box.h) * PADDING))
const paddedSide = (box: Box): number => Math.max(box.w, box.h) + 2 * paddingOf(box)

function exportPng(render: (scale: number) => HTMLCanvasElement, vector: boolean): Png | null {
  let canvas = render(1)
  let box = inkBox(canvas)
  if (!box) return null
  let scale = Math.min(MAX_SIDE / paddedSide(box), MAX_UPSCALE)
  if (vector && Math.abs(scale - 1) > 0.01) {
    canvas = render(scale)
    box = inkBox(canvas)
    if (!box) return null
    scale = Math.min(1, MAX_SIDE / paddedSide(box))
  }
  const pad = paddingOf(box)
  const out = makeCanvas((box.w + 2 * pad) * scale, (box.h + 2 * pad) * scale)
  const ctx = context2d(out)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, box.x, box.y, box.w, box.h, pad * scale, pad * scale, box.w * scale, box.h * scale)
  return { dataUrl: out.toDataURL('image/png'), width: out.width, height: out.height }
}

function DrawPad({
  strokes,
  color,
  weight,
  empty,
  onChange
}: {
  strokes: RefObject<Stroke[]>
  color: string
  weight: number
  empty: boolean
  onChange: (count: number) => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const active = useRef<ActiveStroke | null>(null)

  const inkContext = useCallback((): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = context2d(canvas)
    prepareInk(ctx, canvas.width / PAD_W, color)
    return ctx
  }, [color])

  const repaint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const blank = context2d(canvas)
    blank.setTransform(1, 0, 0, 1, 0, 0)
    blank.clearRect(0, 0, canvas.width, canvas.height)
    const ctx = inkContext()
    if (!ctx) return
    for (const points of strokes.current) {
      if (points === active.current?.points) paintSegments(ctx, points, 0, points.length - 1, weight)
      else paintStroke(ctx, points, weight)
    }
  }, [inkContext, strokes, weight])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let media: MediaQueryList | null = null
    const resize = (): void => {
      const cssWidth = canvas.clientWidth
      if (cssWidth === 0) return
      const scale = (cssWidth / PAD_W) * (window.devicePixelRatio || 1)
      const width = Math.round(PAD_W * scale)
      const height = Math.round(PAD_H * scale)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      repaint()
    }
    const watchResolution = (): void => {
      media?.removeEventListener('change', onResolution)
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      media.addEventListener('change', onResolution)
    }
    const onResolution = (): void => {
      watchResolution()
      resize()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    watchResolution()
    resize()
    return () => {
      observer.disconnect()
      media?.removeEventListener('change', onResolution)
    }
  }, [repaint])

  const down = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (active.current || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = e.currentTarget.getBoundingClientRect()
    const pen = e.pointerType === 'pen'
    const points: Stroke = [{ ...toPad(rect, e.clientX, e.clientY), w: pen ? pressureWidth(e.pressure) : START_WIDTH }]
    active.current = { pointerId: e.pointerId, points, rect, time: e.timeStamp, speed: 0, pen }
    strokes.current.push(points)
    onChange(strokes.current.length)
  }

  const move = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stroke = active.current
    if (!stroke || e.pointerId !== stroke.pointerId) return
    const before = stroke.points.length
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? []
    for (const sample of samples.length > 0 ? samples : [e.nativeEvent]) addPoint(stroke, sample)
    if (stroke.points.length === before) return
    const ctx = inkContext()
    if (ctx) paintSegments(ctx, stroke.points, Math.max(0, before - 1), stroke.points.length - 1, weight)
  }

  const end = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const stroke = active.current
    if (!stroke || e.pointerId !== stroke.pointerId) return
    active.current = null
    const ctx = inkContext()
    if (ctx) paintTail(ctx, stroke.points, weight)
  }

  const clear = (): void => {
    if (empty) return
    active.current = null
    strokes.current = []
    repaint()
    onChange(0)
  }

  return (
    <>
      <div className="sig-paper sig-pad">
        <span className="sig-baseline" aria-hidden="true" />
        {empty && (
          <span className="sig-pad-hint" aria-hidden="true">
            {t('sign.drawHint')}
          </span>
        )}
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t('sign.drawHint')}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onLostPointerCapture={end}
        />
      </div>
      <div className="sig-actions">
        <Button variant="ghost" aria-disabled={empty} onClick={clear}>
          <Eraser size={16} aria-hidden="true" />
          {t('sign.clear')}
        </Button>
      </div>
    </>
  )
}

function TypePanel({
  name,
  font,
  color,
  stroke,
  onName,
  onFont,
  onSubmit
}: {
  name: string
  font: FontFamily
  color: string
  stroke: number
  onName: (name: string) => void
  onFont: (font: FontFamily) => void
  onSubmit: () => void
}): React.JSX.Element {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const text = name.trim()

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
  }, [])

  return (
    <>
      <label className="field">
        <span className="field-label">{t('sign.name')}</span>
        <input
          ref={inputRef}
          className="input"
          value={name}
          placeholder={t('sign.typeHint')}
          maxLength={80}
          spellCheck={false}
          autoComplete="name"
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
      </label>
      <div className="field">
        <span id={`${id}-label`} className="field-label">
          {t('sign.fontStyle')}
        </span>
        <div className="sig-fonts" role="radiogroup" aria-labelledby={`${id}-label`}>
          {FONTS.map((f) => (
            <label key={f.family} className="sig-font">
              <input
                type="radio"
                className="sr-only"
                name={`${id}-font`}
                checked={font === f.family}
                aria-label={f.family}
                onChange={() => onFont(f.family)}
              />
              <span
                className={`sig-font-sample${text ? '' : ' placeholder'}`}
                style={{
                  fontFamily: `"${f.family}"`,
                  fontSize: f.size,
                  color,
                  WebkitTextStroke: stroke > 0 ? `${f.size * stroke}px ${color}` : undefined
                }}
                aria-hidden="true"
              >
                {text || t('sign.typeHint')}
              </span>
            </label>
          ))}
        </div>
      </div>
    </>
  )
}

function ImagePanel({ image, ink, onFile }: { image: ImageState; ink: RGB; onFile: (file: File) => void }): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const [over, setOver] = useState(false)
  const ready = image.status === 'ready'
  const loading = image.status === 'loading'
  const pick = (): void => fileRef.current?.click()

  useLayoutEffect(() => {
    const canvas = previewRef.current
    if (!canvas || image.status !== 'ready') return
    const tinted = tintedCopy(image.data, ink)
    canvas.width = tinted.width
    canvas.height = tinted.height
    context2d(canvas).putImageData(tinted, 0, 0)
  }, [image, ink])

  const dragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setOver(true)
  }

  const drop = (e: ReactDragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <>
      <div
        className={`sig-paper sig-drop${ready ? ' filled' : ''}${over ? ' over' : ''}`}
        aria-busy={loading}
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
        }}
        onDrop={drop}
        onPointerDown={(e) => e.preventDefault()}
        onClick={ready || loading ? undefined : pick}
      >
        {ready ? (
          <canvas ref={previewRef} className="sig-drop-preview" role="img" aria-label={t('sign.tab.image')} />
        ) : (
          !loading && (
            <span className="sig-drop-empty">
              <ImageUp size={22} aria-hidden="true" />
              {t('sign.imageEmpty')}
            </span>
          )
        )}
      </div>
      <div className="sig-image-row">
        <Button onClick={pick}>
          <ImageUp size={16} aria-hidden="true" />
          {t('sign.imagePick')}
        </Button>
        <span className="field-hint">{t('sign.imageHint')}</span>
      </div>
      {image.status === 'error' && (
        <div className="sig-error" role="alert">
          {t('sign.imageError')}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </>
  )
}

function WeightPicker({ value, onChange }: { value: number; onChange: (index: number) => void }): React.JSX.Element {
  return (
    <div className="sig-weights" role="group" aria-label={t('sign.weight')}>
      {WEIGHTS.map((w, i) => (
        <button
          key={w.label}
          type="button"
          className="sig-weight"
          aria-pressed={i === value}
          aria-label={t(w.label)}
          data-tip={t(w.label)}
          onClick={() => onChange(i)}
        >
          <svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
            <path d="M4 11c3-6 6-7 8.5-3s5.5 4 9.5-3" fill="none" stroke="currentColor" strokeWidth={w.ink * 1.5} strokeLinecap="round" />
          </svg>
        </button>
      ))}
    </div>
  )
}

function SignatureDialog({ close }: { close: (result: CreatedSignature | null) => void }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('draw')
  const [ink, setInk] = useState<RGB>(INKS[0].rgb)
  const [weight, setWeight] = useState(lastWeight)
  const [keep, setKeep] = useState(true)
  const strokes = useRef<Stroke[]>([])
  const [strokeCount, setStrokeCount] = useState(0)
  const [name, setName] = useState(authorName)
  const [font, setFont] = useState<FontFamily>(FONTS[0].family)
  const [image, setImage] = useState<ImageState>({ status: 'empty' })
  const [busy, setBusy] = useState(false)
  const loadToken = useRef(0)
  const color = rgbToCss(ink)
  const pen = WEIGHTS[weight]
  const cancel = useCallback(() => close(null), [close])
  const pickWeight = (index: number): void => {
    lastWeight = index
    setWeight(index)
  }

  const ready = !busy && (tab === 'draw' ? strokeCount > 0 : tab === 'type' ? name.trim() !== '' : image.status === 'ready')

  const loadImage = async (file: File): Promise<void> => {
    const token = ++loadToken.current
    setImage({ status: 'loading' })
    const data = await prepareImage(file).catch(() => null)
    if (token === loadToken.current) setImage(data ? { status: 'ready', data } : { status: 'error' })
  }

  const insert = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    try {
      let png: Png | null = null
      if (tab === 'draw') {
        const list = strokes.current
        png = exportPng((scale) => renderStrokes(list, color, scale, pen.ink), true)
      } else if (tab === 'type') {
        const text = name.trim()
        await loadFont(font, text)
        png = exportPng((scale) => renderText(text, font, color, scale, pen.text), true)
      } else if (image.status === 'ready') {
        const canvas = imageCanvas(tintedCopy(image.data, ink))
        png = exportPng(() => canvas, false)
      }
      if (png) close({ ...png, kind: KIND[tab], keep })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('sign.dialogTitle')}
      wide
      className="sig-dialog"
      onClose={cancel}
      footer={
        <>
          <label className="check sig-keep">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            {t('sign.keep')}
          </label>
          <span className="spacer" />
          <Button onClick={cancel}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!ready} onClick={() => void insert()}>
            {t('sign.insert')}
          </Button>
        </>
      }
    >
      <div className="sig-head">
        <Segmented
          value={tab}
          onChange={setTab}
          label={t('sign.dialogTitle')}
          options={[
            { id: 'draw', label: t('sign.tab.draw'), icon: <PenLine size={16} aria-hidden="true" /> },
            { id: 'type', label: t('sign.tab.type'), icon: <Type size={16} aria-hidden="true" /> },
            { id: 'image', label: t('sign.tab.image'), icon: <ImageUp size={16} aria-hidden="true" /> }
          ]}
        />
        <div className="sig-pen">
          {tab !== 'image' && <WeightPicker value={weight} onChange={pickWeight} />}
          <div className="sig-inks">
            <Swatches colors={INKS} value={ink} onChange={(rgb) => rgb && setInk(rgb)} label={t('sign.inkColor')} />
          </div>
        </div>
      </div>
      {tab === 'draw' && <DrawPad strokes={strokes} color={color} weight={pen.ink} empty={strokeCount === 0} onChange={setStrokeCount} />}
      {tab === 'type' && (
        <TypePanel
          name={name}
          font={font}
          color={color}
          stroke={pen.text}
          onName={setName}
          onFont={setFont}
          onSubmit={() => void insert()}
        />
      )}
      {tab === 'image' && <ImagePanel image={image} ink={ink} onFile={(file) => void loadImage(file)} />}
    </Dialog>
  )
}

export function createSignature(): Promise<CreatedSignature | null> {
  return openDialog<CreatedSignature | null>((close) => <SignatureDialog close={close} />)
}
