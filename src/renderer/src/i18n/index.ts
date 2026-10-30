import type { LanguageId } from '@shared/api'
import { de, type MessageKey } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { it } from './it'
import { nl } from './nl'
import { pl } from './pl'
import { pt } from './pt'

export type Language = LanguageId
export type { MessageKey }

const catalogs: Record<Language, Record<MessageKey, string>> = { de, en, fr, es, it, nl, pl, pt }

export const LANGUAGES: { id: Language; name: string; locale: string }[] = [
  { id: 'de', name: 'Deutsch', locale: 'de-DE' },
  { id: 'en', name: 'English', locale: 'en-GB' },
  { id: 'es', name: 'Español', locale: 'es-ES' },
  { id: 'fr', name: 'Français', locale: 'fr-FR' },
  { id: 'it', name: 'Italiano', locale: 'it-IT' },
  { id: 'nl', name: 'Nederlands', locale: 'nl-NL' },
  { id: 'pl', name: 'Polski', locale: 'pl-PL' },
  { id: 'pt', name: 'Português', locale: 'pt-BR' }
]

let current: Language = 'de'

export function resolveLanguage(setting: 'auto' | Language, locale: string): Language {
  if (setting !== 'auto') return setting
  const prefix = locale.toLowerCase().slice(0, 2)
  return LANGUAGES.find((l) => l.id === prefix)?.id ?? 'en'
}

export function setLanguage(language: Language): void {
  current = language
  document.documentElement.lang = language
}

export function getLanguage(): Language {
  return current
}

export function locale(): string {
  return LANGUAGES.find((l) => l.id === current)!.locale
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogs[current][key] ?? de[key] ?? key
  if (!params) return template
  return template
    .replace(/\{(\w+)\|([^|}]*)\|([^}]*)\}/g, (_, name: string, one: string, many: string) => (params[name] === 1 ? one : many))
    .replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`))
}

export function opLabel(op: string | null): string | null {
  if (!op) return null
  const key = `op.${op}` as MessageKey
  return key in de ? t(key) : op
}
