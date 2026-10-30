import type { FontName, Point, Rect } from '@renderer/engine/types'
import { CSS_FONT } from '@renderer/tools/tools'

let measureCtx: CanvasRenderingContext2D | null = null

function context(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!
  return measureCtx
}

export const FREETEXT_LINE_HEIGHT = 1.18
export const FREETEXT_PAD = 3

export function measureText(text: string, font: FontName | string, size: number): { width: number; height: number } {
  const ctx = context()
  ctx.font = `${size}px ${CSS_FONT[font] ?? CSS_FONT.Helv}`
  const lines = text.split('\n')
  let width = 0
  for (const line of lines) width = Math.max(width, ctx.measureText(line || ' ').width)
  return {
    width: Math.ceil(width + size * 0.5 + FREETEXT_PAD * 2),
    height: Math.ceil(lines.length * size * FREETEXT_LINE_HEIGHT + FREETEXT_PAD * 2)
  }
}

export function freeTextRect(origin: Point, text: string, font: FontName | string, size: number, page: { width: number; height: number }): Rect {
  const { width, height } = measureText(text, font, size)
  const x0 = Math.max(0, Math.min(origin[0], page.width - width))
  const y0 = Math.max(0, Math.min(origin[1], page.height - height))
  return [x0, y0, x0 + width, y0 + height]
}

export function checkPaths(center: Point, size: number): Point[][] {
  const [cx, cy] = center
  const s = size / 2
  return [[[cx - s, cy], [cx - s * 0.25, cy + s * 0.75], [cx + s, cy - s * 0.85]]]
}

export function crossPaths(center: Point, size: number): Point[][] {
  const [cx, cy] = center
  const s = size / 2
  return [
    [[cx - s, cy - s], [cx + s, cy + s]],
    [[cx + s, cy - s], [cx - s, cy + s]]
  ]
}

export function formatToday(tag: string): string {
  return new Date().toLocaleDateString(tag, { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function rectAround(center: Point, width: number, aspect: number): Rect {
  const height = width / Math.max(0.01, aspect)
  return [center[0] - width / 2, center[1] - height / 2, center[0] + width / 2, center[1] + height / 2]
}

export function fitInto(target: Rect, aspect: number, margin = 2): Rect {
  const w = target[2] - target[0] - margin * 2
  const h = target[3] - target[1] - margin * 2
  let width = w
  let height = w / aspect
  if (height > h) {
    height = h
    width = h * aspect
  }
  const cx = (target[0] + target[2]) / 2
  const cy = (target[1] + target[3]) / 2
  return [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2]
}

export function clampToPage(r: Rect, page: { width: number; height: number }): Rect {
  const w = r[2] - r[0]
  const h = r[3] - r[1]
  const x0 = Math.max(0, Math.min(r[0], page.width - w))
  const y0 = Math.max(0, Math.min(r[1], page.height - h))
  return [x0, y0, x0 + w, y0 + h]
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
