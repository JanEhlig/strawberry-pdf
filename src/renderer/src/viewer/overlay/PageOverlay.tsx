import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { engine } from '@renderer/engine/client'
import type { AnnotData, Point, Rect } from '@renderer/engine/types'
import { locale } from '@renderer/i18n'
import { useApp } from '@renderer/state/appStore'
import { useDoc, useDocStore } from '../context'
import { checkPaths, crossPaths, formatToday } from '../placement'
import { CommentPopover } from './CommentPopover'
import { DraftShape, QuadShapes, SearchHits } from './Drafts'
import { FieldLayer } from './FieldLayer'
import { FreeTextEditor } from './FreeTextEditor'
import { LineEditor } from './LineEditor'
import { Ghost, SelectionChrome, type GhostState } from './SelectionChrome'
import { TextSelectionBar } from './TextSelectionBar'
import { usePagePointer } from './usePagePointer'

interface Props {
  index: number
  scale: number
  dpr: number
  width: number
  height: number
  drawnVersion: number
}

export const PageOverlay = memo(function PageOverlay({ index, scale, dpr, width, height, drawnVersion }: Props) {
  const store = useDocStore()
  const docId = useDoc((s) => s.docId)
  const size = useDoc((s) => s.info.pages[index])
  const version = useDoc((s) => s.pageVersion[index])
  const data = useDoc((s) => s.pageData[index])
  const selection = useDoc((s) => (s.selection?.page === index ? s.selection.id : null))
  const textSel = useDoc((s) => (s.textSel?.page === index ? s.textSel : null))
  const editing = useDoc((s) => (s.editing?.page === index ? s.editing : null))
  const search = useDoc((s) => s.search)
  const tool = useApp((s) => s.tool)
  const [ghost, setGhost] = useState<GhostState | null>(null)

  useEffect(() => {
    void store.getState().ensurePageData(index)
  }, [store, index, version])

  const beginGhost = useCallback(
    async (annot: AnnotData) => {
      const s = scale * dpr
      try {
        const img = await engine().call('renderAnnotation', docId, index, annot.id, s)
        setGhost({
          bitmap: img.bitmap,
          area: [img.x / s, img.y / s, (img.x + img.width) / s, (img.y + img.height) / s],
          base: annot.bounds,
          final: null,
          until: null
        })
      } catch {
      }
      await store.getState().setAnnotationHidden(index, annot.id, true)
    },
    [docId, index, scale, dpr, store]
  )

  const endGhost = useCallback(
    async (annot: AnnotData, to: Rect | null) => {
      const s = store.getState()
      setGhost((g) => (g ? { ...g, final: to ?? annot.bounds } : g))
      let moved = false
      try {
        if (to) {
          await s.transformAnnotation(index, annot.id, annot.bounds, to)
          moved = true
        }
      } finally {
        await s.setAnnotationHidden(index, annot.id, false).catch(() => undefined)
        const target = store.getState().pageVersion[index]
        setGhost((g) => (g ? { ...g, final: moved && to ? to : g.base, until: target } : g))
      }
    },
    [store, index]
  )

  useEffect(() => {
    if (ghost && ghost.until !== null && drawnVersion >= ghost.until) {
      ghost.bitmap.close()
      setGhost(null)
    }
  }, [ghost, drawnVersion])

  const pointer = usePagePointer({ store, index, scale, pageSize: size, beginGhost, endGhost })

  const pageHits = useMemo(() => search.hits.filter((h) => h.page === index), [search.hits, index])
  const currentHit = search.index >= 0 ? (search.hits[search.index] ?? null) : null
  const selected = selection ? data?.annots.find((a) => a.id === selection) : undefined
  const redactions = useMemo(() => data?.annots.filter((a) => a.kind === 'redact') ?? [], [data])
  const commentTarget = editing?.kind === 'comment' ? data?.annots.find((a) => a.id === editing.id) : undefined

  return (
    <div
      className="page-overlay"
      style={{ cursor: pointer.cursor }}
      onPointerDown={pointer.onPointerDown}
      onPointerMove={pointer.onPointerMove}
      onPointerUp={pointer.onPointerUp}
      onPointerCancel={pointer.onPointerCancel}
      onPointerLeave={pointer.onPointerLeave}
    >
      <svg className="page-svg" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" width={width} height={height}>
        {redactions.map((r) => (
          <g key={r.id} className="pending-redaction">
            {r.quads && r.quads.length > 0 ? (
              <QuadShapes quads={r.quads} className="redaction-mark" />
            ) : (
              <rect className="redaction-mark" x={r.bounds[0]} y={r.bounds[1]} width={r.bounds[2] - r.bounds[0]} height={r.bounds[3] - r.bounds[1]} />
            )}
          </g>
        ))}
        {pageHits.length > 0 && <SearchHits hits={pageHits} current={currentHit} />}
        {textSel && <QuadShapes quads={textSel.quads} className="text-selection" />}
        {pointer.draft && <DraftShape draft={pointer.draft} />}
        {tool === 'sign' && pointer.hover && <SignPreviewVector point={pointer.hover} />}
      </svg>

      {ghost && <Ghost ghost={ghost} target={pointer.drag?.rect ?? ghost.final ?? ghost.base} scale={scale} />}
      {selected && !editing?.kind.startsWith('freetext') && (
        <SelectionChrome annot={selected} rect={pointer.drag?.rect ?? selected.bounds} scale={scale} />
      )}
      {data && data.fields.length > 0 && <FieldLayer page={index} fields={data.fields} scale={scale} />}
      {editing && (editing.kind === 'freetext-new' || editing.kind === 'freetext-edit') && (
        <FreeTextEditor key={editing.kind === 'freetext-edit' ? editing.id : `${editing.point.join()}`} editing={editing} scale={scale} />
      )}
      {editing?.kind === 'line-edit' && <LineEditor key={editing.line.bbox.join()} page={index} line={editing.line} scale={scale} />}
      {commentTarget && <CommentPopover key={commentTarget.id} annot={commentTarget} scale={scale} pageWidth={size.width} />}
      {textSel && textSel.text.trim() && !pointer.drag && !pointer.selecting && tool === 'select' && <TextSelectionBar sel={textSel} scale={scale} />}
      {tool === 'sign' && pointer.hover && <SignPreviewImage point={pointer.hover} scale={scale} pageWidth={size.width} />}
    </div>
  )
})

function SignPreviewVector({ point }: { point: Point }): React.JSX.Element | null {
  const item = useApp((s) => s.toolSettings.sign.item)
  if (item?.kind !== 'check' && item?.kind !== 'cross') return null
  const paths = item.kind === 'check' ? checkPaths(point, 14) : crossPaths(point, 12)
  return (
    <g className="sign-preview" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((path, i) => (
        <polyline key={i} points={path.map((p) => p.join(',')).join(' ')} />
      ))}
    </g>
  )
}

function SignPreviewImage({ point, scale, pageWidth }: { point: Point; scale: number; pageWidth: number }): React.JSX.Element | null {
  const item = useApp((s) => s.toolSettings.sign.item)
  const saved = useApp((s) => s.signatures)
  const temp = useApp((s) => s.tempSignatures)
  if (item?.kind === 'check' || item?.kind === 'cross') return null
  if (item?.kind === 'date') {
    return (
      <div className="sign-preview-date" style={{ left: point[0] * scale, top: point[1] * scale }}>
        {formatToday(locale())}
      </div>
    )
  }
  const signature =
    item?.kind === 'image' ? item : item?.kind === 'signature' ? [...saved, ...temp].find((s) => s.id === item.id) : saved[0]
  if (!signature) return <div className="sign-preview-cross" style={{ left: point[0] * scale, top: point[1] * scale }} />
  const width = item?.kind === 'image' ? Math.min(200, pageWidth * 0.4) : Math.min(170, pageWidth * 0.3)
  const height = width / (signature.width / signature.height)
  return (
    <img
      className="sign-preview-img"
      src={signature.dataUrl}
      alt=""
      draggable={false}
      style={{ left: (point[0] - width / 2) * scale, top: (point[1] - height / 2) * scale, width: width * scale, height: height * scale }}
    />
  )
}
