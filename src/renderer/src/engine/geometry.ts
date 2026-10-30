import type { Point, Quad, Rect } from './types'

export function rectWidth(r: Rect): number {
  return r[2] - r[0]
}

export function rectHeight(r: Rect): number {
  return r[3] - r[1]
}

export function normalizeRect(r: Rect): Rect {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return normalizeRect([a[0], a[1], b[0], b[1]])
}

export function isEmptyRect(r: Rect): boolean {
  return r[2] <= r[0] || r[3] <= r[1]
}

export function intersectRect(a: Rect, b: Rect): Rect {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]
}

export function unionRect(a: Rect, b: Rect): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

export function inflateRect(r: Rect, by: number): Rect {
  return [r[0] - by, r[1] - by, r[2] + by, r[3] + by]
}

export function pointInRect(p: Point, r: Rect): boolean {
  return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]
}

export function quadBounds(q: Quad): Rect {
  const xs = [q[0], q[2], q[4], q[6]]
  const ys = [q[1], q[3], q[5], q[7]]
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

export function quadsBounds(quads: Quad[]): Rect | null {
  if (quads.length === 0) return null
  return quads.map(quadBounds).reduce(unionRect)
}

export function rectToQuad(r: Rect): Quad {
  return [r[0], r[1], r[2], r[1], r[0], r[3], r[2], r[3]]
}

export function pointInQuad(p: Point, q: Quad): boolean {
  const poly: Point[] = [
    [q[0], q[1]],
    [q[2], q[3]],
    [q[6], q[7]],
    [q[4], q[5]]
  ]
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % 4]
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (cross !== 0) {
      const s = Math.sign(cross)
      if (sign === 0) sign = s
      else if (s !== sign) return false
    }
  }
  return true
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const x = a[0] + t * dx
  const y = a[1] + t * dy
  return Math.hypot(p[0] - x, p[1] - y)
}

export function distanceToPolyline(p: Point, points: Point[]): number {
  if (points.length === 0) return Infinity
  if (points.length === 1) return Math.hypot(p[0] - points[0][0], p[1] - points[0][1])
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]))
  return best
}

export function rectMapper(from: Rect, to: Rect): (p: Point) => Point {
  const fw = rectWidth(from)
  const fh = rectHeight(from)
  const sx = fw === 0 ? 1 : rectWidth(to) / fw
  const sy = fh === 0 ? 1 : rectHeight(to) / fh
  return (p) => [to[0] + (p[0] - from[0]) * sx, to[1] + (p[1] - from[1]) * sy]
}

export function mapRect(r: Rect, map: (p: Point) => Point): Rect {
  const a = map([r[0], r[1]])
  const b = map([r[2], r[3]])
  return rectFromPoints(a, b)
}

export function mapQuad(q: Quad, map: (p: Point) => Point): Quad {
  const out: number[] = []
  for (let i = 0; i < 8; i += 2) {
    const [x, y] = map([q[i], q[i + 1]])
    out.push(x, y)
  }
  return out as Quad
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]
}

export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop()!
    let maxDist = 0
    let index = -1
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(points[i], points[start], points[end])
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > tolerance) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}
