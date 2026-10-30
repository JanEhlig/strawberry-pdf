import { describe, expect, it } from 'vitest'
import {
  MAX_BASE_PIXELS,
  PX_PER_PT,
  baseRenderScale,
  computeLayout,
  dominantPage,
  fitZoom,
  stepZoom,
  visibleRange
} from '@renderer/viewer/layout'

const A4 = { width: 595, height: 842 }
const LANDSCAPE = { width: 842, height: 595 }

describe('Layout', () => {
  it('stapelt Seiten mittig mit Abstand', () => {
    const layout = computeLayout([A4, LANDSCAPE, A4], 1, 800)
    expect(layout.scale).toBeCloseTo(PX_PER_PT)
    expect(layout.boxes[0].width).toBe(Math.round(595 * PX_PER_PT))
    expect(layout.width).toBeGreaterThanOrEqual(Math.round(842 * PX_PER_PT))
    expect(layout.boxes[1].left).toBeLessThan(layout.boxes[0].left)
    expect(layout.boxes[1].top).toBeGreaterThan(layout.boxes[0].top + layout.boxes[0].height)
  })

  it('findet sichtbare Seiten und die dominante Seite', () => {
    const layout = computeLayout(Array.from({ length: 50 }, () => A4), 1, 1000)
    const top = layout.boxes[10].top + 5
    expect(visibleRange(layout, top, 900, 0)).toEqual([10, 10])
    expect(visibleRange(layout, top, 1200, 0)).toEqual([10, 11])
    expect(dominantPage(layout, top, 900)).toBe(10)
    expect(visibleRange(layout, 0, 900, 1)).toEqual([0, 1])
  })

  it('berechnet Einpass-Zoomstufen', () => {
    const width = fitZoom(A4, 595, 'width', 1200, 800)
    const page = fitZoom(A4, 595, 'page', 1200, 800)
    expect(width).toBeGreaterThan(page)
    expect(fitZoom(A4, 595, 'auto', 3000, 2000)).toBe(1.25)
  })

  it('springt zwischen Zoomstufen', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.05, -1)).toBe(1)
  })

  it('begrenzt die Basis-Bitmap bei hohem Zoom', () => {
    const wanted = 4 * PX_PER_PT * 2
    const scale = baseRenderScale(A4, wanted)
    expect(scale).toBeLessThan(wanted)
    expect(A4.width * A4.height * scale * scale).toBeLessThanOrEqual(MAX_BASE_PIXELS + 1)
    expect(baseRenderScale(A4, 1.5)).toBe(1.5)
  })
})
