import type { EngineArgs, EngineMethod, EngineResult, RenderedBitmap, WorkerError, WorkerResponse } from './protocol'
import { RenderQueue } from './renderQueue'
import type { Rect } from './types'

export class EngineCallError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'EngineCallError'
  }
}

export const Priority = {
  visible: 0,
  detail: 1,
  nearby: 2,
  thumbnail: 5,
  print: 9
} as const

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export class EngineClient {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, Pending>()
  private readyPromise: Promise<void>
  private renders = new RenderQueue<RenderedBitmap>(1, (r) => r.bitmap.close())
  private crashed: EngineCallError | null = null
  private crashListeners = new Set<(error: EngineCallError) => void>()

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'strawberry-engine' })
    let markReady!: () => void
    let markFailed!: (error: unknown) => void
    this.readyPromise = new Promise<void>((resolve, reject) => {
      markReady = resolve
      markFailed = reject
    })
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data
      if ('ready' in msg) {
        markReady()
        return
      }
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      if (msg.ok) entry.resolve(msg.result)
      else entry.reject(new EngineCallError((msg.error as WorkerError).code, msg.error.message))
    }
    this.worker.onerror = (event) => {
      const error = new EngineCallError('crashed', event.message || 'Engine worker crashed')
      this.crashed = error
      markFailed(error)
      for (const p of this.pending.values()) p.reject(error)
      this.pending.clear()
      for (const listener of this.crashListeners) listener(error)
    }
  }

  ready(): Promise<void> {
    return this.readyPromise
  }

  onCrash(listener: (error: EngineCallError) => void): () => void {
    this.crashListeners.add(listener)
    return () => this.crashListeners.delete(listener)
  }

  call<M extends EngineMethod>(method: M, ...args: EngineArgs<M>): Promise<EngineResult<M>> {
    return this.send(method, args, [])
  }

  callTransfer<M extends EngineMethod>(method: M, transfer: Transferable[], ...args: EngineArgs<M>): Promise<EngineResult<M>> {
    return this.send(method, args, transfer)
  }

  renderPage(
    docId: string,
    page: number,
    scale: number,
    options: { clip?: Rect; priority: number; signal?: AbortSignal; version: number }
  ): Promise<RenderedBitmap> {
    const clipKey = options.clip ? options.clip.map((v) => Math.round(v)).join(',') : 'full'
    const key = `${docId}|${page}|${scale.toFixed(4)}|${clipKey}|${options.version}`
    return this.renders.schedule(
      key,
      options.priority,
      () => this.call('renderPage', docId, page, scale, options.clip) as Promise<RenderedBitmap>,
      options.signal
    )
  }

  private send<M extends EngineMethod>(method: M, args: unknown[], transfer: Transferable[]): Promise<EngineResult<M>> {
    if (this.crashed) return Promise.reject(this.crashed)
    const id = ++this.seq
    return new Promise<EngineResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ id, method, args }, transfer)
    })
  }
}

let shared: EngineClient | null = null

export function engine(): EngineClient {
  if (!shared) shared = new EngineClient()
  return shared
}
