/// <reference lib="webworker" />
import { Engine, EngineError } from './core'
import type { EngineMethod, WorkerRequest, WorkerResponse } from './protocol'
import type { RenderedImage } from './types'

declare const self: DedicatedWorkerGlobalScope

const engine = new Engine()

function isRenderedImage(value: unknown): value is RenderedImage {
  return typeof value === 'object' && value !== null && 'pixels' in value && 'width' in value
}

async function toWire(result: unknown): Promise<{ value: unknown; transfer: Transferable[] }> {
  if (isRenderedImage(result)) {
    const bitmap = await createImageBitmap(new ImageData(result.pixels, result.width, result.height))
    return { value: { width: result.width, height: result.height, x: result.x, y: result.y, bitmap }, transfer: [bitmap] }
  }
  if (result instanceof Uint8Array) {
    return { value: result, transfer: [result.buffer] }
  }
  return { value: result, transfer: [] }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, method, args } = event.data
  try {
    const fn = (engine as unknown as Record<EngineMethod, (...a: unknown[]) => unknown>)[method]
    if (typeof fn !== 'function') throw new EngineError('invalid', `Unknown method ${String(method)}`)
    const result = fn.apply(engine, args)
    const { value, transfer } = await toWire(result)
    const response: WorkerResponse = { id, ok: true, result: value }
    self.postMessage(response, transfer)
  } catch (error) {
    const response: WorkerResponse = {
      id,
      ok: false,
      error: {
        code: error instanceof EngineError ? error.code : 'internal',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    self.postMessage(response)
  }
}

const ready: WorkerResponse = { id: -1, ready: true }
self.postMessage(ready)
