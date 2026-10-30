import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { DocActions, DocState, DocStore } from '@renderer/state/docStore'

export const DocContext = createContext<DocStore | null>(null)

export function useDocStore(): DocStore {
  const store = useContext(DocContext)
  if (!store) throw new Error('DocContext fehlt')
  return store
}

export function useDoc<T>(selector: (state: DocState & DocActions) => T): T {
  return useStore(useDocStore(), selector)
}

export interface ViewerApi {
  scrollElement(): HTMLDivElement | null
  zoomAt(zoom: number, clientX: number, clientY: number): void
}

export const ViewerContext = createContext<ViewerApi | null>(null)

export function useViewer(): ViewerApi {
  const api = useContext(ViewerContext)
  if (!api) throw new Error('ViewerContext fehlt')
  return api
}
