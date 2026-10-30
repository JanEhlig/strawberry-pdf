import type { StrawberryApi } from '../shared/api'

declare global {
  interface Window {
    strawberry?: StrawberryApi
  }
}

export {}
