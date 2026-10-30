import type { Engine } from './core'
import type { RenderedImage } from './types'

export interface RenderedBitmap {
  width: number
  height: number
  x: number
  y: number
  bitmap: ImageBitmap
}

type PublicMethods<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K]
}

export type EngineMethods = PublicMethods<Engine>
export type EngineMethod = keyof EngineMethods

type Wire<T> = T extends RenderedImage ? RenderedBitmap : T

export type EngineArgs<M extends EngineMethod> = Parameters<EngineMethods[M]>
export type EngineResult<M extends EngineMethod> = Wire<ReturnType<EngineMethods[M]>>

export interface WorkerRequest {
  id: number
  method: EngineMethod
  args: unknown[]
}

export interface WorkerError {
  code: string
  message: string
}

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: WorkerError }
  | { id: -1; ready: true }
