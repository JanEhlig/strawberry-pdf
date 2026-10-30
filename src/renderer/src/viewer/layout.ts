export const PX_PER_PT = 96 / 72
export const PAGE_GAP = 18
export const PAD_Y = 28
export const PAD_X = 32
export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8]

export interface PageSize {
  width: number
  height: number
}

export interface PageBox {
  top: number
  left: number
  width: number
  height: number
}

export interface Layout {
  boxes: PageBox[]
  width: number
  height: number
  scale: number
}

export function computeLayout(pages: PageSize[], zoom: number, viewportWidth: number): Layout {
  const scale = zoom * PX_PER_PT
  let maxWidth = 0
  for (const p of pages) maxWidth = Math.max(maxWidth, p.width * scale)
  const width = Math.max(viewportWidth, Math.ceil(maxWidth) + PAD_X * 2)
  const boxes: PageBox[] = []
  let top = PAD_Y
  for (const p of pages) {
    const w = Math.round(p.width * scale)
    const h = Math.round(p.height * scale)
    boxes.push({ top, left: Math.round((width - w) / 2), width: w, height: h })
    top += h + PAGE_GAP
  }
  const height = pages.length === 0 ? 0 : top - PAGE_GAP + PAD_Y
  return { boxes, width, height, scale }
}

export function pageIndexAt(layout: Layout, y: number): number {
  const { boxes } = layout
  let lo = 0
  let hi = boxes.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (boxes[mid].top + boxes[mid].height < y) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function visibleRange(layout: Layout, scrollTop: number, viewportHeight: number, overscan = 1): [number, number] {
  if (layout.boxes.length === 0) return [0, -1]
  const first = pageIndexAt(layout, scrollTop)
  let last = first
  const bottom = scrollTop + viewportHeight
  while (last + 1 < layout.boxes.length && layout.boxes[last + 1].top < bottom) last++
  return [Math.max(0, first - overscan), Math.min(layout.boxes.length - 1, last + overscan)]
}

export function dominantPage(layout: Layout, scrollTop: number, viewportHeight: number): number {
  const [first, last] = visibleRange(layout, scrollTop, viewportHeight, 0)
  let best = first
  let bestArea = -1
  const bottom = scrollTop + viewportHeight
  for (let i = first; i <= last; i++) {
    const b = layout.boxes[i]
    const visible = Math.min(bottom, b.top + b.height) - Math.max(scrollTop, b.top)
    if (visible > bestArea) {
      bestArea = visible
      best = i
    }
  }
  return best
}

export type FitKind = 'width' | 'page' | 'auto'

export function fitZoom(page: PageSize, maxPageWidth: number, kind: FitKind, viewportWidth: number, viewportHeight: number): number {
  const availW = Math.max(100, viewportWidth - PAD_X * 2 - 2)
  const availH = Math.max(100, viewportHeight - PAD_Y * 2 - 2)
  const widthZoom = availW / (maxPageWidth * PX_PER_PT)
  const pageZoom = Math.min(availW / (page.width * PX_PER_PT), availH / (page.height * PX_PER_PT))
  const zoom = kind === 'width' ? widthZoom : kind === 'page' ? pageZoom : Math.min(widthZoom, 1.25)
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > current + 0.001) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? MIN_ZOOM
}

export const MAX_BASE_PIXELS = 6_000_000

export function baseRenderScale(page: PageSize, wantedScale: number): number {
  const pixels = page.width * page.height * wantedScale * wantedScale
  if (pixels <= MAX_BASE_PIXELS) return wantedScale
  return Math.sqrt(MAX_BASE_PIXELS / (page.width * page.height))
}
