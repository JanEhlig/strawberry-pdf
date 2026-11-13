import type { ReactNode } from 'react'
import { create } from 'zustand'
import type { AppEnvironment, RecentFile, SavedSignature, Settings } from '@shared/api'
import { DEFAULT_TOOL_SETTINGS, type ToolId, type ToolSettings } from '@renderer/tools/tools'
import type { Language } from '@renderer/i18n'
import type { DocStore } from './docStore'

export interface TabEntry {
  id: string
  store: DocStore
}

export type SidebarTab = 'pages' | 'outline' | 'comments'

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'success' | 'error'
  action?: { label: string; run: () => void }
}

export interface DialogEntry {
  id: number
  node: ReactNode
}

export const DEFAULT_SETTINGS: Settings = {
  authorName: '',
  theme: 'system',
  language: 'auto',
  highlightFields: true,
  print: { printer: '', paper: 'printer', scaling: 'fit', orientation: 'auto', duplex: 'printer', gray: false, markups: true }
}

export interface AppState {
  env: AppEnvironment | null
  settings: Settings
  language: Language
  signatures: SavedSignature[]
  tempSignatures: SavedSignature[]
  recent: RecentFile[]
  tabs: TabEntry[]
  activeId: string | null
  tool: ToolId
  toolSettings: ToolSettings
  sidebar: SidebarTab | null
  darkPages: boolean
  dialogs: DialogEntry[]
  toasts: Toast[]
  dragOver: 'open' | 'insert' | null
}

export const useApp = create<AppState>()(() => ({
  env: null,
  settings: DEFAULT_SETTINGS,
  language: 'de',
  signatures: [],
  tempSignatures: [],
  recent: [],
  tabs: [],
  activeId: null,
  tool: 'select',
  toolSettings: DEFAULT_TOOL_SETTINGS,
  sidebar: 'pages',
  darkPages: false,
  dialogs: [],
  toasts: [],
  dragOver: null
}))

export function activeTab(): TabEntry | null {
  const { tabs, activeId } = useApp.getState()
  return tabs.find((t) => t.id === activeId) ?? null
}

export function setTool(tool: ToolId): void {
  useApp.setState({ tool })
}

export function updateToolSettings<K extends keyof ToolSettings>(key: K, patch: Partial<ToolSettings[K]>): void {
  useApp.setState((s) => ({ toolSettings: { ...s.toolSettings, [key]: { ...s.toolSettings[key], ...patch } } }))
}

let toastId = 0

export function toast(message: string, tone: Toast['tone'] = 'info', action?: Toast['action'], timeout = 4200): number {
  const id = ++toastId
  useApp.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone, action }] }))
  setTimeout(() => dismissToast(id), timeout)
  return id
}

export function dismissToast(id: number): void {
  useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}

let dialogId = 0

export function openDialog<T>(render: (close: (result: T) => void) => ReactNode): Promise<T> {
  return new Promise<T>((resolve) => {
    const id = ++dialogId
    const close = (result: T): void => {
      useApp.setState((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) }))
      resolve(result)
    }
    useApp.setState((s) => ({ dialogs: [...s.dialogs, { id, node: render(close) }] }))
  })
}

export function authorName(): string {
  const { settings, env } = useApp.getState()
  return settings.authorName.trim() || env?.userName || ''
}
