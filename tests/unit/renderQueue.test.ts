import { describe, expect, it, vi } from 'vitest'
import { RenderQueue, isAbortError } from '@renderer/engine/renderQueue'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('RenderQueue', () => {
  it('führt dringende Aufträge zuerst aus', async () => {
    const order: string[] = []
    const gate = deferred<void>()
    const q = new RenderQueue<string>(1)
    const first = q.schedule('blocker', 0, async () => {
      await gate.promise
      order.push('blocker')
      return 'b'
    })
    const low = q.schedule('thumb', 10, async () => (order.push('thumb'), 't'))
    const high = q.schedule('visible', 1, async () => (order.push('visible'), 'v'))
    gate.resolve()
    await Promise.all([first, low, high])
    expect(order).toEqual(['blocker', 'visible', 'thumb'])
  })

  it('fasst gleiche Schlüssel zusammen', async () => {
    const run = vi.fn(async () => 'x')
    const q = new RenderQueue<string>(1)
    const gate = deferred<void>()
    void q.schedule('blocker', 0, async () => (await gate.promise, 'b'))
    const a = q.schedule('same', 1, run)
    const b = q.schedule('same', 1, run)
    gate.resolve()
    expect(await Promise.all([a, b])).toEqual(['x', 'x'])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('startet abgebrochene Aufträge nicht', async () => {
    const run = vi.fn(async () => 'x')
    const q = new RenderQueue<string>(1)
    const gate = deferred<void>()
    void q.schedule('blocker', 0, async () => (await gate.promise, 'b'))
    const controller = new AbortController()
    const p = q.schedule('page', 1, run, controller.signal)
    controller.abort()
    gate.resolve()
    await expect(p).rejects.toSatisfy(isAbortError)
    await new Promise((r) => setTimeout(r, 0))
    expect(run).not.toHaveBeenCalled()
  })

  it('gibt Ergebnisse ohne Abnehmer frei', async () => {
    const discard = vi.fn()
    const q = new RenderQueue<string>(1, discard)
    const gate = deferred<void>()
    const controller = new AbortController()
    const p = q.schedule('page', 1, async () => (await gate.promise, 'bitmap'), controller.signal)
    controller.abort()
    await expect(p).rejects.toSatisfy(isAbortError)
    gate.resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(discard).toHaveBeenCalledWith('bitmap')
  })
})
