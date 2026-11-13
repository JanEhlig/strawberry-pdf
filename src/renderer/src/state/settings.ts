import type { Settings } from '@shared/api'
import { resolveLanguage, setLanguage, type Language } from '@renderer/i18n'
import { platform } from '@renderer/platform'
import { DEFAULT_SETTINGS, useApp } from './appStore'

const TITLE_COLORS = {
  light: { color: '#FBFCFB', symbol: '#1C2733' },
  dark: { color: '#262C2D', symbol: '#E7ECEB' }
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

export function resolvedTheme(settings: Settings): 'light' | 'dark' {
  if (settings.theme === 'system') return darkQuery.matches ? 'dark' : 'light'
  return settings.theme
}

function applyTheme(settings: Settings): void {
  const theme = resolvedTheme(settings)
  document.documentElement.dataset.theme = theme
  platform.setTitleBarColors(TITLE_COLORS[theme].color, TITLE_COLORS[theme].symbol)
}

function applyLanguage(settings: Settings): Language {
  const language = resolveLanguage(settings.language, useApp.getState().env?.locale ?? navigator.language)
  setLanguage(language)
  return language
}

export function applySettings(next: Settings, persist = true): void {
  useApp.setState({ settings: next, language: applyLanguage(next) })
  applyTheme(next)
  if (persist) void platform.saveStore('settings', next)
}

export async function loadSettings(): Promise<void> {
  const stored = await platform.loadStore<Partial<Settings>>('settings')
  applySettings({ ...DEFAULT_SETTINGS, ...stored, print: { ...DEFAULT_SETTINGS.print, ...stored?.print } }, false)
  darkQuery.addEventListener('change', () => applyTheme(useApp.getState().settings))
}
