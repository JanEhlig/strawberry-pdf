import { useEffect, useRef } from 'react'
import type { AnnotData, Rect } from '@renderer/engine/types'
import { handlePosition, handlesFor } from './hitTest'

export function SelectionChrome({ annot, rect, scale }: { annot: AnnotData; rect: Rect; scale: number }): React.JSX.Element {
  const handles = handlesFor(annot)
  const [x0, y0, x1, y1] = rect
  return (
    <div className="annot-selection" style={{ left: x0 * scale, top: y0 * scale, width: (x1 - x0) * scale, height: (y1 - y0) * scale }}>
      {handles.map((h) => {
        const [hx, hy] = handlePosition(rect, h)
        return <span key={h} className="annot-handle" style={{ left: (hx - x0) * scale, top: (hy - y0) * scale }} />
      })}
    </div>
  )
}

export interface GhostState {
  bitmap: ImageBitmap
  area: Rect
  base: Rect
  final: Rect | null
  until: number | null
}

export function Ghost({ ghost, target, scale }: { ghost: GhostState; target: Rect; scale: number }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    canvas.width = ghost.bitmap.width
    canvas.height = ghost.bitmap.height
    canvas.getContext('2d')?.drawImage(ghost.bitmap, 0, 0)
  }, [ghost.bitmap])
  const { base, area } = ghost
  const sx = (target[2] - target[0]) / Math.max(1e-6, base[2] - base[0])
  const sy = (target[3] - target[1]) / Math.max(1e-6, base[3] - base[1])
  const left = target[0] + (area[0] - base[0]) * sx
  const top = target[1] + (area[1] - base[1]) * sy
  const width = (area[2] - area[0]) * sx
  const height = (area[3] - area[1]) * sy
  return (
    <canvas
      ref={ref}
      className="annot-ghost"
      aria-hidden="true"
      style={{ left: left * scale, top: top * scale, width: width * scale, height: height * scale }}
    />
  )
}
