export class AbortError extends Error {
  constructor() {
    super('aborted')
    this.name = 'AbortError'
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

interface Waiter<T> {
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

interface Job<T> {
  key: string
  priority: number
  run: () => Promise<T>
  waiters: Set<Waiter<T>>
}

export class RenderQueue<T> {
  private jobs = new Map<string, Job<T>>()
  private active = 0

  constructor(
    private readonly concurrency = 1,
    private readonly discard?: (value: T) => void
  ) {}

  get size(): number {
    return this.jobs.size
  }

  schedule(key: string, priority: number, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortError())
        return
      }
      let job = this.jobs.get(key)
      if (job) {
        job.priority = Math.min(job.priority, priority)
      } else {
        job = { key, priority, run, waiters: new Set() }
        this.jobs.set(key, job)
      }
      const waiter: Waiter<T> = { resolve, reject }
      job.waiters.add(waiter)
      const current = job
      signal?.addEventListener(
        'abort',
        () => {
          if (!current.waiters.delete(waiter)) return
          reject(new AbortError())
          if (current.waiters.size === 0 && this.jobs.get(current.key) === current) this.jobs.delete(current.key)
        },
        { once: true }
      )
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.concurrency && this.jobs.size > 0) {
      let best: Job<T> | null = null
      for (const job of this.jobs.values()) if (!best || job.priority < best.priority) best = job
      if (!best) return
      this.jobs.delete(best.key)
      this.active++
      const job = best
      job
        .run()
        .then(
          (value) => {
            if (job.waiters.size === 0) this.discard?.(value)
            for (const w of job.waiters) w.resolve(value)
          },
          (error) => {
            for (const w of job.waiters) w.reject(error)
          }
        )
        .finally(() => {
          this.active--
          this.pump()
        })
    }
  }
}
