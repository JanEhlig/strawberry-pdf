import {
  distanceToPolyline,
  distanceToSegment,
  inflateRect,
  pointInQuad,
  pointInRect,
  quadBounds,
  rectHeight,
  rectWidth
} from '@renderer/engine/geometry'
import type { AnnotData, FieldData, LinkData, Point, Rect, TextLine } from '@renderer/engine/types'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const MARKUPS = new Set(['highlight', 'underline', 'strikeout', 'squiggly'])

export function hitAnnotation(annots: AnnotData[], p: Point, tol: number): AnnotData | null {
  for (let i = annots.length - 1; i >= 0; i--) {
    const a = annots[i]
    if (!pointInRect(p, inflateRect(a.bounds, tol))) continue
    if (MARKUPS.has(a.kind) && a.quads) {
      if (a.quads.some((q) => pointInQuad(p, q) || pointInRect(p, inflateRect(quadBounds(q), tol / 2)))) return a
      continue
    }
    const reach = tol + Math.max(1, a.borderWidth) / 2
    if (a.kind === 'ink' && a.ink) {
      if (a.ink.some((path) => distanceToPolyline(p, path) <= reach + 1)) return a
      continue
    }
    if (a.kind === 'line' && a.line) {
      if (distanceToSegment(p, a.line[0], a.line[1]) <= reach + 1) return a
      continue
    }
    if ((a.kind === 'square' || a.kind === 'circle') && !a.interiorColor) {
      if (nearShapeOutline(a, p, reach + 1)) return a
      continue
    }
    return a
  }
  return null
}

function nearShapeOutline(a: AnnotData, p: Point, reach: number): boolean {
  const [x0, y0, x1, y1] = a.bounds
  if (a.kind === 'square') {
    const inside = p[0] > x0 + reach && p[0] < x1 - reach && p[1] > y0 + reach && p[1] < y1 - reach
    return !inside
  }
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = Math.max(1, (x1 - x0) / 2)
  const ry = Math.max(1, (y1 - y0) / 2)
  const d = Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry)
  return Math.abs(d - 1) * Math.min(rx, ry) <= reach
}

export function hitLink(links: LinkData[], p: Point): LinkData | null {
  for (let i = links.length - 1; i >= 0; i--) if (pointInRect(p, links[i].rect)) return links[i]
  return null
}

export function hitField(fields: FieldData[], p: Point): FieldData | null {
  for (let i = fields.length - 1; i >= 0; i--) if (pointInRect(p, fields[i].rect)) return fields[i]
  return null
}

export function hitTextLine(lines: TextLine[] | null, p: Point, tol: number): TextLine | null {
  if (!lines) return null
  for (const line of lines) if (pointInRect(p, inflateRect(line.bbox, tol))) return line
  return null
}

export function hitHandle(bounds: Rect, p: Point, size: number, handles: Handle[]): Handle | null {
  for (const h of handles) {
    const [hx, hy] = handlePosition(bounds, h)
    if (Math.abs(p[0] - hx) <= size && Math.abs(p[1] - hy) <= size) return h
  }
  return null
}

export function handlePosition(b: Rect, h: Handle): Point {
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  switch (h) {
    case 'nw':
      return [b[0], b[1]]
    case 'n':
      return [cx, b[1]]
    case 'ne':
      return [b[2], b[1]]
    case 'e':
      return [b[2], cy]
    case 'se':
      return [b[2], b[3]]
    case 's':
      return [cx, b[3]]
    case 'sw':
      return [b[0], b[3]]
    case 'w':
      return [b[0], cy]
  }
}

export function handlesFor(a: AnnotData): Handle[] {
  if (a.locked) return []
  if (MARKUPS.has(a.kind) || a.kind === 'note' || a.kind === 'other') return []
  if (a.kind === 'stamp') return ['nw', 'ne', 'se', 'sw']
  return HANDLES
}

export function keepsAspect(a: AnnotData): boolean {
  return a.kind === 'stamp'
}

const MIN_SIZE = 6

export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, keepAspect: boolean): Rect {
  let [x0, y0, x1, y1] = start
  if (handle.includes('w')) x0 = Math.min(x0 + dx, x1 - MIN_SIZE)
  if (handle.includes('e')) x1 = Math.max(x1 + dx, x0 + MIN_SIZE)
  if (handle.includes('n')) y0 = Math.min(y0 + dy, y1 - MIN_SIZE)
  if (handle.includes('s')) y1 = Math.max(y1 + dy, y0 + MIN_SIZE)
  if (keepAspect && handle.length === 2) {
    const ratio = rectWidth(start) / Math.max(1e-6, rectHeight(start))
    const w = x1 - x0
    const h = y1 - y0
    if (w / ratio > h) {
      const nh = w / ratio
      if (handle.includes('n')) y0 = y1 - nh
      else y1 = y0 + nh
    } else {
      const nw = h * ratio
      if (handle.includes('w')) x0 = x1 - nw
      else x1 = x0 + nw
    }
  }
  return [x0, y0, x1, y1]
}
