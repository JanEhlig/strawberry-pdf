import type { Point, Quad, SearchHit } from '@renderer/engine/types'
import { useApp } from '@renderer/state/appStore'
import { rgbToCss } from '@renderer/tools/tools'
import type { Draft } from './usePagePointer'

function quadPoints(q: Quad): string {
  return `${q[0]},${q[1]} ${q[2]},${q[3]} ${q[6]},${q[7]} ${q[4]},${q[5]}`
}

export function QuadShapes({ quads, className }: { quads: Quad[]; className: string }): React.JSX.Element {
  return (
    <>
      {quads.map((q, i) => (
        <polygon key={i} className={className} points={quadPoints(q)} />
      ))}
    </>
  )
}

export function SearchHits({ hits, current }: { hits: SearchHit[]; current: SearchHit | null }): React.JSX.Element {
  return (
    <>
      {hits.map((hit, i) => (
        <QuadShapes key={i} quads={hit.quads} className={hit === current ? 'search-hit current' : 'search-hit'} />
      ))}
    </>
  )
}

function arrowHead(a: Point, b: Point, width: number): string {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  const len = 6 + width * 2.5
  const spread = Math.PI / 7
  const p1: Point = [b[0] - len * Math.cos(angle - spread), b[1] - len * Math.sin(angle - spread)]
  const p2: Point = [b[0] - len * Math.cos(angle + spread), b[1] - len * Math.sin(angle + spread)]
  return `M${p1[0]},${p1[1]} L${b[0]},${b[1]} L${p2[0]},${p2[1]}`
}

export function DraftShape({ draft }: { draft: Draft }): React.JSX.Element | null {
  const settings = useApp((s) => s.toolSettings)
  switch (draft.kind) {
    case 'ink':
      return (
        <polyline
          className="draft-ink"
          points={draft.points.map((p) => p.join(',')).join(' ')}
          stroke={rgbToCss(settings.draw.color)}
          strokeWidth={settings.draw.width}
        />
      )
    case 'shape': {
      const { type, color, fill, width } = settings.shapes
      const [x0, y0, x1, y1] = draft.rect
      const stroke = rgbToCss(color)
      if (type === 'square')
        return <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} stroke={stroke} strokeWidth={width} fill={rgbToCss(fill)} />
      if (type === 'circle')
        return (
          <ellipse cx={(x0 + x1) / 2} cy={(y0 + y1) / 2} rx={(x1 - x0) / 2} ry={(y1 - y0) / 2} stroke={stroke} strokeWidth={width} fill={rgbToCss(fill)} />
        )
      return (
        <g stroke={stroke} strokeWidth={width} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <line x1={draft.a[0]} y1={draft.a[1]} x2={draft.b[0]} y2={draft.b[1]} />
          {type === 'arrow' && <path d={arrowHead(draft.a, draft.b, width)} />}
        </g>
      )
    }
    case 'quads': {
      if (draft.purpose === 'redact') return <QuadShapes quads={draft.quads} className="draft-redact" />
      const { type, color } = settings.markup
      const css = rgbToCss(color)
      if (type === 'highlight') {
        return (
          <g fill={css} style={{ mixBlendMode: 'multiply' }}>
            {draft.quads.map((q, i) => (
              <polygon key={i} points={quadPoints(q)} />
            ))}
          </g>
        )
      }
      return (
        <g stroke={css} strokeWidth={1.4}>
          {draft.quads.map((q, i) => {
            const t = type === 'underline' ? 0.92 : 0.55
            const y1 = q[1] + (q[5] - q[1]) * t
            const y2 = q[3] + (q[7] - q[3]) * t
            return <line key={i} x1={q[0]} y1={y1} x2={q[2]} y2={y2} />
          })}
        </g>
      )
    }
    case 'area': {
      const [x0, y0, x1, y1] = draft.rect
      if (draft.purpose === 'redact') return <rect className="draft-redact" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
      return (
        <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={rgbToCss(settings.markup.color)} style={{ mixBlendMode: 'multiply' }} />
      )
    }
  }
}
