import { createStore, type StoreApi } from 'zustand/vanilla'
import { engine } from '@renderer/engine/client'
import type {
  AnnotData,
  AnnotPatch,
  DocInfo,
  FieldData,
  HistoryState,
  LinkData,
  MutationResult,
  NewAnnot,
  Point,
  Quad,
  Rect,
  SearchHit,
  TextLine
} from '@renderer/engine/types'

export interface PageData {
  version: number
  annots: AnnotData[]
  fields: FieldData[]
  links: LinkData[]
  lines: TextLine[] | null
}

export interface TextSelectionState {
  page: number
  anchor: Point
  focus: Point
  quads: Quad[]
  text: string
}

export type Editing =
  | { kind: 'freetext-new'; page: number; point: Point }
  | { kind: 'freetext-edit'; page: number; id: string }
  | { kind: 'field'; page: number; id: string }
  | { kind: 'comment'; page: number; id: string }
  | { kind: 'line-edit'; page: number; line: TextLine }

export interface NavRequest {
  page: number
  y?: number
  x?: number
  nonce: number
  ifNeeded?: boolean
}

export interface SearchState {
  open: boolean
  query: string
  hits: SearchHit[]
  index: number
  running: boolean
  done: boolean
}

export type FitMode = 'width' | 'page' | 'auto' | null

export interface DocState {
  tabId: string
  docId: string
  fileName: string
  filePath: string | null
  fileSize: number
  info: DocInfo
  pageVersion: number[]
  layoutVersion: number
  zoom: number
  fit: FitMode
  currentPage: number
  nav: NavRequest | null
  pageData: Record<number, PageData>
  selection: { page: number; id: string } | null
  textSel: TextSelectionState | null
  editing: Editing | null
  history: HistoryState
  search: SearchState
  redactions: number
  selectedPages: number[]
  organize: boolean
  allAnnots: AnnotData[] | null
  allAnnotsStamp: number
}

export interface DocActions {
  setZoom(zoom: number, fit?: FitMode): void
  setCurrentPage(page: number): void
  goTo(page: number, opts?: { x?: number; y?: number; ifNeeded?: boolean }): void
  ensurePageData(page: number): Promise<PageData | null>
  ensureLines(page: number): Promise<TextLine[]>
  select(sel: { page: number; id: string } | null): void
  setTextSel(sel: TextSelectionState | null): void
  setEditing(editing: Editing | null): void
  createAnnotation(page: number, spec: NewAnnot, author: string): Promise<AnnotData>
  updateAnnotation(page: number, id: string, patch: AnnotPatch): Promise<AnnotData>
  transformAnnotation(page: number, id: string, from: Rect, to: Rect): Promise<AnnotData>
  deleteAnnotation(page: number, id: string): Promise<void>
  setAnnotationHidden(page: number, id: string, hidden: boolean): Promise<void>
  setFieldValue(page: number, id: string, value: string | boolean): Promise<void>
  applyMutation(result: MutationResult): Promise<void>
  replaceTextLine(page: number, line: TextLine, text: string): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  refreshRedactions(): Promise<void>
  loadAllAnnotations(): Promise<void>
  setSearch(patch: Partial<SearchState>): void
  runSearch(query: string): Promise<void>
  stepSearch(delta: number): void
  setSelectedPages(pages: number[]): void
  setOrganize(on: boolean): void
  bumpPage(page: number): void
}

export type DocStore = StoreApi<DocState & DocActions>

const EMPTY_SEARCH: SearchState = { open: false, query: '', hits: [], index: -1, running: false, done: false }

let navNonce = 0

export function createDocStore(init: {
  tabId: string
  docId: string
  fileName: string
  filePath: string | null
  fileSize: number
  info: DocInfo
  history: HistoryState
}): DocStore {
  const store = createStore<DocState & DocActions>()((set, get) => {
    let searchToken = 0
    const loading = new Map<number, Promise<PageData | null>>()
    const linesLoading = new Map<number, Promise<TextLine[]>>()

    const bumpPages = (pages: number[]): void => {
      set((s) => {
        const pageVersion = s.pageVersion.slice()
        for (const p of pages) if (p >= 0 && p < pageVersion.length) pageVersion[p]++
        return { pageVersion }
      })
    }

    const replaceAnnotInPage = (page: number, annot: AnnotData): void => {
      set((s) => {
        const data = s.pageData[page]
        if (!data) return {}
        const exists = data.annots.some((a) => a.id === annot.id)
        const annots = exists ? data.annots.map((a) => (a.id === annot.id ? annot : a)) : [...data.annots, annot]
        return { pageData: { ...s.pageData, [page]: { ...data, annots } } }
      })
    }

    const markAllAnnotsStale = (): void => set((s) => ({ allAnnotsStamp: s.allAnnotsStamp + 1 }))

    return {
      ...init,
      pageVersion: init.info.pages.map(() => 1),
      layoutVersion: 1,
      zoom: 1,
      fit: 'auto',
      currentPage: 0,
      nav: null,
      pageData: {},
      selection: null,
      textSel: null,
      editing: null,
      search: EMPTY_SEARCH,
      redactions: 0,
      selectedPages: [],
      organize: false,
      allAnnots: null,
      allAnnotsStamp: 0,

      setZoom(zoom, fit = null) {
        set({ zoom: Math.max(0.1, Math.min(8, zoom)), fit })
      },

      setCurrentPage(page) {
        if (page !== get().currentPage) set({ currentPage: page })
      },

      goTo(page, opts = {}) {
        const count = get().info.pages.length
        const target = Math.max(0, Math.min(count - 1, page))
        set({ nav: { page: target, x: opts.x, y: opts.y, ifNeeded: opts.ifNeeded, nonce: ++navNonce }, currentPage: target })
      },

      async ensurePageData(page) {
        const { docId, pageVersion, pageData } = get()
        const version = pageVersion[page]
        if (version === undefined) return null
        const existing = pageData[page]
        if (existing && existing.version === version) return existing
        const key = page * 1_000_000 + version
        const pending = loading.get(key)
        if (pending) return pending
        const promise = (async () => {
          try {
            const [annots, fields, links] = await Promise.all([
              engine().call('getAnnotations', docId, page),
              engine().call('getFields', docId, page),
              engine().call('getLinks', docId, page)
            ])
            if (get().pageVersion[page] !== version) return null
            const data: PageData = { version, annots, fields, links, lines: existing?.version === version ? existing.lines : null }
            set((s) => ({ pageData: { ...s.pageData, [page]: data } }))
            return data
          } catch {
            return null
          } finally {
            loading.delete(key)
          }
        })()
        loading.set(key, promise)
        return promise
      },

      async ensureLines(page) {
        const data = (await get().ensurePageData(page)) ?? null
        if (data?.lines) return data.lines
        const version = get().pageVersion[page]
        const key = page * 1_000_000 + version
        let pending = linesLoading.get(key)
        if (!pending) {
          pending = engine().call('getTextLines', get().docId, page)
          linesLoading.set(key, pending)
          void pending.finally(() => linesLoading.delete(key)).catch(() => undefined)
        }
        const lines = await pending
        const current = get().pageData[page]
        if (current && current.version === version && !current.lines) {
          set((s) => ({ pageData: { ...s.pageData, [page]: { ...current, lines } } }))
        }
        return lines
      },

      select(selection) {
        set({ selection, textSel: selection ? null : get().textSel })
      },

      setTextSel(textSel) {
        set({ textSel, selection: textSel ? null : get().selection })
      },

      setEditing(editing) {
        set({ editing })
      },

      async createAnnotation(page, spec, author) {
        const result = await engine().call('createAnnotation', get().docId, page, spec, author)
        set({ history: result.history })
        replaceAnnotInPage(page, result.annot)
        bumpPages([page])
        markAllAnnotsStale()
        if (spec.kind === 'redact') void get().refreshRedactions()
        return result.annot
      },

      async updateAnnotation(page, id, patch) {
        const result = await engine().call('updateAnnotation', get().docId, page, id, patch)
        set({ history: result.history })
        replaceAnnotInPage(page, result.annot)
        bumpPages([page])
        markAllAnnotsStale()
        return result.annot
      },

      async transformAnnotation(page, id, from, to) {
        const result = await engine().call('transformAnnotation', get().docId, page, id, from, to)
        set({ history: result.history })
        replaceAnnotInPage(page, result.annot)
        bumpPages([page])
        markAllAnnotsStale()
        return result.annot
      },

      async deleteAnnotation(page, id) {
        const result = await engine().call('deleteAnnotation', get().docId, page, id)
        set((s) => {
          const data = s.pageData[page]
          return {
            history: result.history,
            selection: s.selection?.id === id ? null : s.selection,
            pageData: data ? { ...s.pageData, [page]: { ...data, annots: data.annots.filter((a) => a.id !== id) } } : s.pageData
          }
        })
        bumpPages([page])
        markAllAnnotsStale()
        void get().refreshRedactions()
      },

      async setAnnotationHidden(page, id, hidden) {
        await engine().call('setAnnotationHidden', get().docId, page, id, hidden)
        bumpPages([page])
      },

      async setFieldValue(page, id, value) {
        const result = await engine().call('setFieldValue', get().docId, page, id, value)
        set((s) => {
          const data = s.pageData[page]
          return {
            history: result.history,
            pageData: data ? { ...s.pageData, [page]: { ...data, fields: result.fields } } : s.pageData
          }
        })
        bumpPages([page])
      },

      async applyMutation(result) {
        if (result.changed === 'all') {
          const info = await engine().call('info', get().docId)
          set((s) => ({
            info,
            history: result.history,
            pageVersion: info.pages.map((_, i) => (s.pageVersion[i] ?? 0) + 1),
            layoutVersion: s.layoutVersion + 1,
            pageData: {},
            selection: null,
            textSel: null,
            editing: null,
            currentPage: Math.min(s.currentPage, info.pages.length - 1),
            selectedPages: s.selectedPages.filter((p) => p < info.pages.length),
            search: s.search.hits.length ? { ...s.search, hits: [], index: -1, done: false } : s.search
          }))
        } else {
          set({ history: result.history })
          set((s) => {
            const pageData = { ...s.pageData }
            for (const p of result.changed as number[]) delete pageData[p]
            return { pageData }
          })
          bumpPages(result.changed)
        }
        markAllAnnotsStale()
        await get().refreshRedactions()
      },

      async replaceTextLine(page, line, text) {
        await get().applyMutation(await engine().call('replaceTextLine', get().docId, page, line, text))
      },

      async undo() {
        await get().applyMutation(await engine().call('undo', get().docId))
      },

      async redo() {
        await get().applyMutation(await engine().call('redo', get().docId))
      },

      async refreshRedactions() {
        const pages = await engine().call('pagesWithRedactions', get().docId)
        if (pages.length === 0) {
          if (get().redactions !== 0) set({ redactions: 0 })
          return
        }
        let count = 0
        for (const p of pages) {
          const data = await get().ensurePageData(p)
          count += data ? data.annots.filter((a) => a.kind === 'redact').length : 1
        }
        set({ redactions: count })
      },

      async loadAllAnnotations() {
        const stamp = get().allAnnotsStamp
        try {
          const list = await engine().call('listAnnotations', get().docId)
          if (get().allAnnotsStamp === stamp) set({ allAnnots: list })
        } catch {
          if (get().allAnnotsStamp === stamp) set({ allAnnots: [] })
        }
      },

      setSearch(patch) {
        set((s) => ({ search: { ...s.search, ...patch } }))
      },

      async runSearch(query) {
        const token = ++searchToken
        const trimmed = query.trim()
        set((s) => ({ search: { ...s.search, query, hits: [], index: -1, running: trimmed.length > 0, done: false } }))
        if (!trimmed) return
        const total = get().info.pages.length
        const start = get().currentPage
        const CHUNK = 12
        const hits: SearchHit[] = []
        for (let from = 0; from < total; from += CHUNK) {
          const chunk = await engine().call('search', get().docId, trimmed, from, Math.min(total - 1, from + CHUNK - 1))
          if (token !== searchToken) return
          hits.push(...chunk)
          const firstIndex = hits.findIndex((h) => h.page >= start)
          set((s) => ({
            search: {
              ...s.search,
              hits: hits.slice(),
              index: s.search.index >= 0 ? s.search.index : firstIndex
            }
          }))
          const sel = get().search
          if (sel.index >= 0 && from === 0 && chunk.length > 0) {
            const hit = sel.hits[sel.index]
            if (hit) get().goTo(hit.page, { y: hit.quads[0]?.[1], ifNeeded: true })
          }
        }
        if (token !== searchToken) return
        set((s) => {
          const index = s.search.index >= 0 ? s.search.index : hits.length > 0 ? 0 : -1
          return { search: { ...s.search, running: false, done: true, index } }
        })
        const final = get().search
        if (final.index >= 0) {
          const hit = final.hits[final.index]
          get().goTo(hit.page, { y: hit.quads[0]?.[1], ifNeeded: true })
        }
      },

      stepSearch(delta) {
        const { hits, index } = get().search
        if (hits.length === 0) return
        const next = (index + delta + hits.length) % hits.length
        set((s) => ({ search: { ...s.search, index: next } }))
        const hit = hits[next]
        get().goTo(hit.page, { y: hit.quads[0]?.[1], ifNeeded: true })
      },

      setSelectedPages(pages) {
        set({ selectedPages: [...new Set(pages)].sort((a, b) => a - b) })
      },

      setOrganize(on) {
        if (on === get().organize) return
        if (!on) {
          set({ organize: false })
          return
        }
        set((s) => ({
          organize: true,
          selection: null,
          textSel: null,
          editing: null,
          search: { ...s.search, open: false },
          selectedPages: [s.currentPage]
        }))
      },

      bumpPage(page) {
        bumpPages([page])
      }
    }
  })
  void store.getState().refreshRedactions()
  return store
}
