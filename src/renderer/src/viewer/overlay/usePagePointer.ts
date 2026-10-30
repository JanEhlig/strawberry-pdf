import { useCallback, useRef, useState } from 'react'
import { engine } from '@renderer/engine/client'
import { rectFromPoints, rectToQuad, simplifyPath } from '@renderer/engine/geometry'
import type { AnnotData, LinkData, Point, Quad, Rect, SelectMode } from '@renderer/engine/types'
import { authorName, setTool, useApp } from '@renderer/state/appStore'
import type { DocStore } from '@renderer/state/docStore'
import { useViewer } from '../context'
import { opensComment } from './CommentPopover'
import { clickCount } from './clickCount'
import { handlesFor, hitAnnotation, hitHandle, hitLink, hitTextLine, keepsAspect, resizeRect, type Handle } from './hitTest'
import { followLink } from './links'
import { placeSignItem } from './signPlacement'

export type Draft =
  | { kind: 'ink'; points: Point[] }
  | { kind: 'shape'; rect: Rect; a: Point; b: Point }
  | { kind: 'quads'; quads: Quad[]; purpose: 'markup' | 'redact' }
  | { kind: 'area'; rect: Rect; purpose: 'markup' | 'redact' }

export interface DragState {
  annot: AnnotData
  mode: 'move' | 'resize'
  handle?: Handle
  rect: Rect
}

type Gesture =
  | { kind: 'text'; anchor: Point; mode: SelectMode; purpose: 'select' | 'markup' | 'redact'; moved: boolean; startClient: [number, number] }
  | { kind: 'area'; start: Point; purpose: 'markup' | 'redact' }
  | { kind: 'ink'; points: Point[] }
  | { kind: 'shape'; start: Point }
  | {
      kind: 'annot'
      annot: AnnotData
      mode: 'move' | 'resize'
      handle?: Handle
      start: Point
      startClient: [number, number]
      started: boolean
      ready?: Promise<void>
    }
  | { kind: 'pan'; x: number; y: number; left: number; top: number }
  | { kind: 'link'; link: LinkData; startClient: [number, number]; start: Point; overText: boolean }
  | { kind: 'click'; point: Point }

type TextGesture = Extract<Gesture, { kind: 'text' }>

interface Down {
  clientX: number
  clientY: number
  shiftKey: boolean
  altKey: boolean
}

interface PointerInfo {
  point: Point
  clientX: number
  clientY: number
  shiftKey: boolean
}

interface Options {
  store: DocStore
  index: number
  scale: number
  pageSize: { width: number; height: number }
  beginGhost: (annot: AnnotData) => Promise<void>
  endGhost: (annot: AnnotData, to: Rect | null) => Promise<void>
}

const DRAG_THRESHOLD = 4

export function usePagePointer({ store, index, scale, pageSize, beginGhost, endGhost }: Options) {
  const viewer = useViewer()
  const gesture = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [cursor, setCursor] = useState('default')
  const [hover, setHover] = useState<Point | null>(null)
  const [selecting, setSelecting] = useState(false)
  const selectionRequest = useRef<{ inflight: boolean; pending: { g: TextGesture; focus: Point } | null }>({ inflight: false, pending: null })
  const queue = useRef<Promise<void>>(Promise.resolve())
  const beginning = useRef(0)
  const finishRef = useRef<(info: PointerInfo, cancelled: boolean) => Promise<void>>(async () => undefined)
  const beginRef = useRef<(p: Point, down: Down, clicks: number) => Promise<void>>(async () => undefined)
  const lastQuads = useRef<Quad[]>([])

  const toPoint = useCallback(
    (e: { clientX: number; clientY: number; currentTarget: EventTarget }): Point => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const x = (e.clientX - r.left) / scale
      const y = (e.clientY - r.top) / scale
      return [Math.max(0, Math.min(pageSize.width, x)), Math.max(0, Math.min(pageSize.height, y))]
    },
    [scale, pageSize.width, pageSize.height]
  )

  const tolerance = 5 / scale

  const requestSelection = useCallback(
    (g: TextGesture, focus: Point) => {
      const state = selectionRequest.current
      if (state.inflight) {
        state.pending = { g, focus }
        return
      }
      state.inflight = true
      const { docId } = store.getState()
      void engine()
        .call('selectText', docId, index, g.anchor, focus, g.mode)
        .then((sel) => {
          if (state.pending) return
          if (gesture.current !== g && g.purpose !== 'select') return
          lastQuads.current = sel.quads
          if (g.purpose === 'select') {
            store.getState().setTextSel(sel.quads.length ? { page: index, anchor: g.anchor, focus, quads: sel.quads, text: sel.text } : null)
          } else {
            setDraft({ kind: 'quads', quads: sel.quads, purpose: g.purpose })
          }
        })
        .finally(() => {
          state.inflight = false
          const next = state.pending
          state.pending = null
          if (next) requestSelection(next.g, next.focus)
        })
    },
    [store, index]
  )

  const updateCursor = useCallback(
    (p: Point) => {
      const { tool } = useApp.getState()
      const s = store.getState()
      const data = s.pageData[index]
      if (data && !data.lines && tool !== 'draw' && tool !== 'shapes') void s.ensureLines(index)
      const overText = !!hitTextLine(data?.lines ?? null, p, 1)
      if (tool === 'select') {
        const sel = s.selection?.page === index ? data?.annots.find((a) => a.id === s.selection?.id) : undefined
        if (sel) {
          const h = hitHandle(sel.bounds, p, 6 / scale, handlesFor(sel))
          if (h) {
            setCursor(h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'ne' || h === 'sw' ? 'nesw-resize' : 'nwse-resize')
            return
          }
        }
        const annot = data ? hitAnnotation(data.annots, p, tolerance) : null
        if (annot) return setCursor(annot.id === s.selection?.id && !annot.locked ? 'move' : 'pointer')
        if (data && hitLink(data.links, p)) return setCursor('pointer')
        return setCursor(overText ? 'text' : 'grab')
      }
      if (tool === 'markup' || tool === 'redact') return setCursor(overText ? 'text' : 'crosshair')
      if (tool === 'text') return setCursor('text')
      if (tool === 'sign') return setCursor('none')
      if (tool === 'note' && data && hitAnnotation(data.annots, p, tolerance)?.kind === 'note') return setCursor('pointer')
      return setCursor('crosshair')
    },
    [store, index, scale, tolerance]
  )

  const enqueue = useCallback((step: () => Promise<void>) => {
    queue.current = queue.current.then(step).catch((error) => console.warn('Aktion fehlgeschlagen', error))
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return
      e.preventDefault()
      const clicks = clickCount()
      const editing = store.getState().editing
      if (editing && editing.kind !== 'comment') {
        ;(document.activeElement as HTMLElement | null)?.blur()
        return
      }
      const p = toPoint(e)
      e.currentTarget.setPointerCapture(e.pointerId)
      const down = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, altKey: e.altKey }
      beginning.current++
      enqueue(async () => {
        try {
          await beginRef.current(p, down, clicks)
        } finally {
          beginning.current--
        }
      })
    },
    [store, toPoint, enqueue]
  )

  beginRef.current = async (p: Point, e: Down, clicks: number): Promise<void> => {
    const s = store.getState()
    const { tool } = useApp.getState()
    if (tool === 'draw') {
      s.select(null)
      gesture.current = { kind: 'ink', points: [p] }
      setDraft({ kind: 'ink', points: [p] })
      return
    }
    if (tool === 'shapes') {
      s.select(null)
      gesture.current = { kind: 'shape', start: p }
      return
    }
    const needsText = tool === 'select' || tool === 'markup' || tool === 'redact' || tool === 'text'
    const data = await s.ensurePageData(index)
    const lines = needsText ? await s.ensureLines(index) : null
    const overText = !!hitTextLine(lines, p, 1)

    if (tool === 'note') {
      const existing = data ? hitAnnotation(data.annots, p, tolerance) : null
      if (existing?.kind === 'note') {
        setTool('select')
        s.select({ page: index, id: existing.id })
        s.setEditing({ kind: 'comment', page: index, id: existing.id })
        return
      }
    }

    if (tool === 'text') {
      s.select(null)
      const existing = data ? hitAnnotation(data.annots, p, tolerance) : null
      if (existing?.kind === 'freetext' && !existing.locked) {
        s.setEditing({ kind: 'freetext-edit', page: index, id: existing.id })
        return
      }
    }

    if (tool === 'select') {
      const selected = s.selection?.page === index ? data?.annots.find((a) => a.id === s.selection?.id) : undefined
      if (selected && clicks < 2) {
        const handle = hitHandle(selected.bounds, p, 6 / scale, handlesFor(selected))
        if (handle) {
          gesture.current = { kind: 'annot', annot: selected, mode: 'resize', handle, start: p, startClient: [e.clientX, e.clientY], started: false }
          return
        }
      }
      const annot = data ? hitAnnotation(data.annots, p, tolerance) : null
      if (annot) {
        s.select({ page: index, id: annot.id })
        if (clicks >= 2) {
          gesture.current = null
          if (annot.kind === 'freetext' && !annot.locked) s.setEditing({ kind: 'freetext-edit', page: index, id: annot.id })
          else s.setEditing({ kind: 'comment', page: index, id: annot.id })
          return
        }
        if (annot.locked) {
          gesture.current = null
          if (opensComment(annot)) s.setEditing({ kind: 'comment', page: index, id: annot.id })
          return
        }
        gesture.current = { kind: 'annot', annot, mode: 'move', start: p, startClient: [e.clientX, e.clientY], started: false }
        return
      }
      s.select(null)
      if (s.editing?.kind === 'comment') s.setEditing(null)
      const link = data ? hitLink(data.links, p) : null
      if (link) {
        gesture.current = { kind: 'link', link, startClient: [e.clientX, e.clientY], start: p, overText }
        return
      }
      if (overText) {
        const mode: SelectMode = clicks >= 3 ? 'lines' : clicks === 2 ? 'words' : 'chars'
        if (e.shiftKey && s.textSel?.page === index) {
          const g: Gesture = { kind: 'text', anchor: s.textSel.anchor, mode: 'chars', purpose: 'select', moved: true, startClient: [e.clientX, e.clientY] }
          gesture.current = g
          requestSelection(g, p)
          return
        }
        const g: Gesture = { kind: 'text', anchor: p, mode, purpose: 'select', moved: mode !== 'chars', startClient: [e.clientX, e.clientY] }
        gesture.current = g
        setSelecting(true)
        if (mode === 'chars') s.setTextSel(null)
        else requestSelection(g, p)
        return
      }
      s.setTextSel(null)
      const scroller = viewer.scrollElement()
      if (scroller) {
        gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }
        setCursor('grabbing')
      }
      return
    }

    s.select(null)
    s.setTextSel(null)
    if (tool === 'markup' || tool === 'redact') {
      const purpose = tool === 'markup' ? 'markup' : 'redact'
      lastQuads.current = []
      if (overText || (purpose === 'markup' && !!lines?.length && !e.altKey)) {
        const g: Gesture = { kind: 'text', anchor: p, mode: clicks === 2 ? 'words' : 'chars', purpose, moved: false, startClient: [e.clientX, e.clientY] }
        gesture.current = g
        if (clicks === 2) requestSelection(g, p)
      } else {
        gesture.current = { kind: 'area', start: p, purpose }
      }
      return
    }
    gesture.current = { kind: 'click', point: p }
  }

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const p = toPoint(e)
      const g = gesture.current
      if (!g) {
        updateCursor(p)
        if (useApp.getState().tool === 'sign') setHover(p)
        return
      }
      if (e.buttons === 0 && beginning.current === 0) {
        const info: PointerInfo = { point: p, clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }
        enqueue(() => finishRef.current(info, false))
        return
      }
      switch (g.kind) {
        case 'text':
          g.moved = true
          requestSelection(g, p)
          break
        case 'area':
          setDraft({ kind: 'area', rect: rectFromPoints(g.start, p), purpose: g.purpose })
          break
        case 'ink': {
          const last = g.points[g.points.length - 1]
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) * scale >= 1.5) {
            g.points.push(p)
            setDraft({ kind: 'ink', points: g.points.slice() })
          }
          break
        }
        case 'shape': {
          const b = draftEnd(g.start, p, e.shiftKey, useApp.getState().toolSettings.shapes.type)
          setDraft({ kind: 'shape', rect: rectFromPoints(g.start, b), a: g.start, b })
          break
        }
        case 'annot': {
          if (!g.started) {
            if (Math.hypot(e.clientX - g.startClient[0], e.clientY - g.startClient[1]) < DRAG_THRESHOLD) return
            g.started = true
            g.ready = beginGhost(g.annot)
          }
          const rect = draggedRect(g, p, e.shiftKey, pageSize) ?? g.annot.bounds
          setDrag({ annot: g.annot, mode: g.mode, handle: g.handle, rect })
          break
        }
        case 'pan': {
          const scroller = viewer.scrollElement()
          if (scroller) {
            scroller.scrollLeft = g.left - (e.clientX - g.x)
            scroller.scrollTop = g.top - (e.clientY - g.y)
          }
          break
        }
        case 'link': {
          if (!g.overText || Math.hypot(e.clientX - g.startClient[0], e.clientY - g.startClient[1]) < DRAG_THRESHOLD) break
          const text: Gesture = { kind: 'text', anchor: g.start, mode: 'chars', purpose: 'select', moved: true, startClient: g.startClient }
          gesture.current = text
          setSelecting(true)
          requestSelection(text, p)
          break
        }
        case 'click':
          break
      }
    },
    [toPoint, updateCursor, requestSelection, scale, pageSize.width, pageSize.height, beginGhost, viewer]
  )

  const finish = useCallback(
    async (e: PointerInfo, cancelled: boolean) => {
      const g = gesture.current
      gesture.current = null
      setSelecting(false)
      if (!g) return
      const s = store.getState()
      const app = useApp.getState()
      const p = e.point
      const author = authorName()
      try {
        switch (g.kind) {
          case 'text': {
            if (Math.hypot(e.clientX - g.startClient[0], e.clientY - g.startClient[1]) >= DRAG_THRESHOLD) g.moved = true
            if (g.purpose === 'select') {
              if (!g.moved) s.setTextSel(null)
              else requestSelection(g, p)
              break
            }
            const sel = g.moved || g.mode !== 'chars' ? await engine().call('selectText', s.docId, index, g.anchor, p, g.mode) : null
            setDraft(null)
            if (cancelled || !sel || sel.quads.length === 0) break
            if (g.purpose === 'markup') {
              const { type, color } = app.toolSettings.markup
              await s.createAnnotation(index, { kind: type, quads: sel.quads, color }, author)
            } else {
              await s.createAnnotation(index, { kind: 'redact', quads: sel.quads }, author)
            }
            break
          }
          case 'area': {
            setDraft(null)
            const rect = rectFromPoints(g.start, p)
            if (cancelled || (rect[2] - rect[0]) * scale < 4 || (rect[3] - rect[1]) * scale < 4) break
            if (g.purpose === 'markup') {
              const { color } = app.toolSettings.markup
              await s.createAnnotation(index, { kind: 'highlight', quads: [rectToQuad(rect)], color }, author)
            } else {
              await s.createAnnotation(index, { kind: 'redact', rect }, author)
            }
            break
          }
          case 'ink': {
            setDraft(null)
            if (cancelled || g.points.length < 2) break
            const { color, width } = app.toolSettings.draw
            const path = simplifyPath(g.points, 0.35 / Math.max(0.5, scale / 1.3333))
            await s.createAnnotation(index, { kind: 'ink', paths: [path], color, width }, author)
            break
          }
          case 'shape': {
            setDraft(null)
            if (cancelled) break
            const { type, color, fill, width } = app.toolSettings.shapes
            const end = draftEnd(g.start, p, e.shiftKey, type)
            const rect = rectFromPoints(g.start, end)
            const big = Math.hypot(end[0] - g.start[0], end[1] - g.start[1]) * scale >= 6
            if (!big) break
            if (type === 'line' || type === 'arrow') {
              await s.createAnnotation(index, { kind: 'line', a: g.start, b: end, color, width, arrow: type === 'arrow' }, author)
            } else {
              await s.createAnnotation(index, { kind: type, rect, color, fill, width }, author)
            }
            break
          }
          case 'annot': {
            if (!g.started) {
              if (!cancelled && g.mode === 'move' && opensComment(g.annot)) s.setEditing({ kind: 'comment', page: index, id: g.annot.id })
              break
            }
            const to = cancelled ? null : draggedRect(g, p, e.shiftKey, pageSize)
            await g.ready
            await endGhost(g.annot, to)
            setDrag(null)
            break
          }
          case 'pan':
            updateCursor(p)
            break
          case 'link': {
            const moved = Math.hypot(e.clientX - g.startClient[0], e.clientY - g.startClient[1]) >= DRAG_THRESHOLD
            if (!moved && !cancelled) await followLink(store, g.link)
            break
          }
          case 'click': {
            if (cancelled) break
            await handleClickTool(store, index, g.point, pageSize)
            break
          }
        }
      } catch (error) {
        console.warn('Aktion fehlgeschlagen', error)
        setDraft(null)
        setDrag(null)
      }
    },
    [store, index, toPoint, requestSelection, scale, endGhost, updateCursor, pageSize]
  )

  finishRef.current = finish

  const release = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const info: PointerInfo = { point: toPoint(e), clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }
      enqueue(() => finishRef.current(info, cancelled))
    },
    [enqueue, toPoint]
  )
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => release(e, false), [release])
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => release(e, true), [release])
  const onPointerLeave = useCallback(() => {
    setHover(null)
  }, [])

  return { draft, drag, cursor, hover, selecting, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave }
}

function draftEnd(start: Point, p: Point, shift: boolean, type: string): Point {
  if (!shift) return p
  const dx = p[0] - start[0]
  const dy = p[1] - start[1]
  if (type === 'line' || type === 'arrow') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    const len = Math.hypot(dx, dy)
    return [start[0] + Math.cos(angle) * len, start[1] + Math.sin(angle) * len]
  }
  const size = Math.max(Math.abs(dx), Math.abs(dy))
  return [start[0] + Math.sign(dx || 1) * size, start[1] + Math.sign(dy || 1) * size]
}

function draggedRect(
  g: Extract<Gesture, { kind: 'annot' }>,
  p: Point,
  shift: boolean,
  page: { width: number; height: number }
): Rect | null {
  const dx = p[0] - g.start[0]
  const dy = p[1] - g.start[1]
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null
  const b = g.annot.bounds
  if (g.mode === 'move') {
    const w = b[2] - b[0]
    const h = b[3] - b[1]
    const x0 = Math.max(-w / 2, Math.min(page.width - w / 2, b[0] + dx))
    const y0 = Math.max(-h / 2, Math.min(page.height - h / 2, b[1] + dy))
    return [x0, y0, x0 + w, y0 + h]
  }
  return resizeRect(b, g.handle!, dx, dy, keepsAspect(g.annot) !== shift)
}

async function handleClickTool(store: DocStore, index: number, point: Point, page: { width: number; height: number }): Promise<void> {
  const app = useApp.getState()
  const s = store.getState()
  const author = authorName()
  if (app.tool === 'text') {
    s.setEditing({ kind: 'freetext-new', page: index, point })
    return
  }
  if (app.tool === 'note') {
    const x = Math.max(0, Math.min(page.width - 20, point[0] - 10))
    const y = Math.max(0, Math.min(page.height - 20, point[1] - 10))
    const annot = await s.createAnnotation(index, { kind: 'note', point: [x, y], contents: '', color: app.toolSettings.note.color }, author)
    setTool('select')
    s.select({ page: index, id: annot.id })
    s.setEditing({ kind: 'comment', page: index, id: annot.id })
    return
  }
  if (app.tool === 'sign') {
    await placeSignItem(store, index, point, page)
  }
}
