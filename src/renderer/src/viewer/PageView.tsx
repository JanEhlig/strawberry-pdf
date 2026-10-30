import { memo, useEffect, useRef, useState } from 'react'
import { Priority, engine } from '@renderer/engine/client'
import { isAbortError } from '@renderer/engine/renderQueue'
import type { Rect } from '@renderer/engine/types'
import { useDoc } from './context'
import { baseRenderScale, type PageBox } from './layout'
import { PageOverlay } from './overlay/PageOverlay'

interface Props {
  index: number
  box: PageBox
  scale: number
  dpr: number
  version: number
  detailRect: string | null
}

interface DetailTile {
  css: Rect
  version: number
  scale: number
}

function draw(canvas: HTMLCanvasElement, bitmap: ImageBitmap): void {
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  bitmap.close()
}

export const PageView = memo(function PageView({ index, box, scale, dpr, version, detailRect }: Props) {
  const docId = useDoc((s) => s.docId)
  const size = useDoc((s) => s.info.pages[index])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const detailRef = useRef<HTMLCanvasElement>(null)
  const hasDrawn = useRef(false)
  const lastBase = useRef(0)
  const [drawnVersion, setDrawnVersion] = useState(0)
  const [drawnScale, setDrawnScale] = useState(0)
  const [detail, setDetail] = useState<DetailTile | null>(null)

  const wanted = scale * dpr
  const base = baseRenderScale(size, wanted)

  useEffect(() => {
    const controller = new AbortController()
    const zooming = hasDrawn.current && Math.abs(lastBase.current - base) > 1e-6
    lastBase.current = base
    const timer = window.setTimeout(
      () => {
        engine()
          .renderPage(docId, index, base, { priority: Priority.visible, signal: controller.signal, version })
          .then((img) => {
            const canvas = canvasRef.current
            if (!canvas || controller.signal.aborted) {
              img.bitmap.close()
              return
            }
            draw(canvas, img.bitmap)
            hasDrawn.current = true
            setDrawnVersion(version)
            setDrawnScale(base)
          })
          .catch((error) => {
            if (!isAbortError(error)) console.warn('Seite konnte nicht gerendert werden', error)
          })
      },
      zooming ? 80 : 0
    )
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [docId, index, base, version])

  useEffect(() => {
    if (!detailRect) {
      setDetail(null)
      return
    }
    const visible = detailRect.split(',').map(Number) as Rect
    if (
      detail &&
      detail.version === version &&
      Math.abs(detail.scale - wanted) < 1e-6 &&
      visible[0] >= detail.css[0] &&
      visible[1] >= detail.css[1] &&
      visible[2] <= detail.css[2] &&
      visible[3] <= detail.css[3]
    ) {
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      const margin = 160
      const css: Rect = [
        Math.max(0, visible[0] - margin),
        Math.max(0, visible[1] - margin),
        Math.min(box.width, visible[2] + margin),
        Math.min(box.height, visible[3] + margin)
      ]
      const clip: Rect = [css[0] * dpr, css[1] * dpr, css[2] * dpr, css[3] * dpr]
      engine()
        .renderPage(docId, index, wanted, { clip, priority: Priority.detail, signal: controller.signal, version })
        .then((img) => {
          const canvas = detailRef.current
          if (!canvas || controller.signal.aborted) {
            img.bitmap.close()
            return
          }
          draw(canvas, img.bitmap)
          setDetail({
            css: [img.x / dpr, img.y / dpr, (img.x + img.width) / dpr, (img.y + img.height) / dpr],
            version,
            scale: wanted
          })
        })
        .catch((error) => {
          if (!isAbortError(error)) console.warn('Detail konnte nicht gerendert werden', error)
        })
    }, 120)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [detailRect, version, wanted, docId, index, dpr, box.width, box.height])

  const showDetail = detail !== null && detail.version === version && Math.abs(detail.scale - wanted) < 1e-6 && detailRect !== null

  return (
    <div
      className="page"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      data-page={index}
      data-version={version}
      data-drawn={drawnVersion}
      data-scale={base.toFixed(4)}
      data-drawn-scale={drawnScale.toFixed(4)}
    >
      <canvas ref={canvasRef} className="page-canvas" aria-hidden="true" />
      <canvas
        ref={detailRef}
        className="page-detail"
        aria-hidden="true"
        style={
          showDetail
            ? { left: detail.css[0], top: detail.css[1], width: detail.css[2] - detail.css[0], height: detail.css[3] - detail.css[1] }
            : { display: 'none' }
        }
      />
      <PageOverlay index={index} scale={scale} dpr={dpr} width={box.width} height={box.height} drawnVersion={drawnVersion} />
    </div>
  )
})
