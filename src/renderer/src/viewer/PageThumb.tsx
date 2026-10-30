import { memo, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { Priority, engine } from '@renderer/engine/client'
import { isAbortError } from '@renderer/engine/renderQueue'
import type { TabEntry } from '@renderer/state/appStore'

export const Thumb = memo(function Thumb({
  tab,
  index,
  width,
  height,
  version
}: {
  tab: TabEntry
  index: number
  width: number
  height: number
  version: number
}) {
  const docId = useStore(tab.store, (s) => s.docId)
  const page = useStore(tab.store, (s) => s.info.pages[index])
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    const scale = (width * Math.min(2, window.devicePixelRatio || 1)) / page.width
    engine()
      .renderPage(docId, index, scale, { priority: Priority.thumbnail, signal: controller.signal, version })
      .then((img) => {
        const canvas = canvasRef.current
        if (!canvas) return img.bitmap.close()
        canvas.width = img.width
        canvas.height = img.height
        canvas.getContext('2d')?.drawImage(img.bitmap, 0, 0)
        img.bitmap.close()
      })
      .catch((error) => {
        if (!isAbortError(error)) console.warn(error)
      })
    return () => controller.abort()
  }, [docId, index, version, width, page.width])
  return <canvas ref={canvasRef} className="thumb-canvas" style={{ width, height }} aria-hidden="true" />
})
