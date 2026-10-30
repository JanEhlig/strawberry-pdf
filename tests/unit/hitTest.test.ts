import { describe, expect, it } from 'vitest'
import type { AnnotData } from '@renderer/engine/types'
import { handlesFor, hitAnnotation, hitHandle, resizeRect } from '@renderer/viewer/overlay/hitTest'

function annot(partial: Partial<AnnotData>): AnnotData {
  return {
    id: partial.id ?? '1',
    page: 0,
    kind: 'square',
    subtype: 'Square',
    bounds: [100, 100, 200, 200],
    color: [0, 0, 0],
    interiorColor: null,
    opacity: 1,
    borderWidth: 2,
    contents: '',
    author: '',
    modified: null,
    role: null,
    locked: false,
    ...partial
  }
}

describe('Hit-Test', () => {
  it('trifft ungefüllte Rechtecke nur am Rand', () => {
    const a = annot({})
    expect(hitAnnotation([a], [100, 150], 3)).toBe(a)
    expect(hitAnnotation([a], [150, 150], 3)).toBeNull()
  })

  it('trifft gefüllte Rechtecke überall', () => {
    const a = annot({ interiorColor: [1, 1, 0] })
    expect(hitAnnotation([a], [150, 150], 3)).toBe(a)
  })

  it('bevorzugt die oberste Anmerkung', () => {
    const lower = annot({ id: 'a', interiorColor: [1, 0, 0] })
    const upper = annot({ id: 'b', interiorColor: [0, 1, 0] })
    expect(hitAnnotation([lower, upper], [150, 150], 3)?.id).toBe('b')
  })

  it('trifft Freihandlinien nur in der Nähe des Strichs', () => {
    const ink = annot({ kind: 'ink', ink: [[[100, 100], [200, 200]]], bounds: [99, 99, 201, 201] })
    expect(hitAnnotation([ink], [150, 151], 3)).toBe(ink)
    expect(hitAnnotation([ink], [180, 110], 3)).toBeNull()
  })

  it('trifft Markierungen über ihre Quads', () => {
    const hl = annot({ kind: 'highlight', quads: [[100, 100, 200, 100, 100, 112, 200, 112]], bounds: [98, 98, 202, 114] })
    expect(hitAnnotation([hl], [150, 105], 2)).toBe(hl)
    expect(hitAnnotation([hl], [150, 140], 2)).toBeNull()
  })
})

describe('Anfasser', () => {
  it('findet Eck-Anfasser', () => {
    expect(hitHandle([100, 100, 200, 200], [201, 199], 4, ['nw', 'ne', 'se', 'sw'])).toBe('se')
  })

  it('Stempel behalten beim Skalieren das Seitenverhältnis', () => {
    const r = resizeRect([0, 0, 200, 100], 'se', 100, 0, true)
    expect(r[2] - r[0]).toBeCloseTo(300)
    expect(r[3] - r[1]).toBeCloseTo(150)
  })

  it('hält eine Mindestgröße ein', () => {
    const r = resizeRect([0, 0, 100, 100], 'e', -500, 0, false)
    expect(r[2] - r[0]).toBeGreaterThanOrEqual(6)
  })

  it('Markierungen haben keine Anfasser', () => {
    expect(handlesFor(annot({ kind: 'highlight' }))).toEqual([])
    expect(handlesFor(annot({ kind: 'stamp' }))).toHaveLength(4)
  })
})
