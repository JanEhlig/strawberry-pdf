import { beforeAll, describe, expect, it, vi } from 'vitest'
import { LANGUAGES, resolveLanguage, setLanguage, t, type MessageKey } from '@renderer/i18n'
import { de } from '@renderer/i18n/de'

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)[}|]/g)].map((m) => m[1]).sort()

describe('Übersetzungen', () => {
  beforeAll(() => vi.stubGlobal('document', { documentElement: {} }))

  it('wählt Einzahl und Mehrzahl passend zur Anzahl', () => {
    setLanguage('de')
    expect(t('pages.inserted', { n: 1 })).toBe('1 Seite eingefügt')
    expect(t('pages.inserted', { n: 3 })).toBe('3 Seiten eingefügt')
    expect(t('organize.deleted', { n: 2 })).toBe('2 Seiten gelöscht')
    expect(t('organize.selected', { n: 2, total: 6 })).toBe('2 von 6 ausgewählt')
  })

  it.each(LANGUAGES.map((l) => l.id))('%s hat jeden Text mit denselben Platzhaltern', (id) => {
    setLanguage(id)
    for (const key of Object.keys(de) as MessageKey[]) {
      const params = Object.fromEntries(placeholders(de[key]).map((p) => [p, 2]))
      const text = t(key, params)
      expect(text, key).not.toBe(key)
      expect(text, key).not.toMatch(/\{\w+\}|—| – /)
    }
    setLanguage('de')
  })

  it('nimmt die Systemsprache und sonst Englisch', () => {
    expect(resolveLanguage('auto', 'fr-CA')).toBe('fr')
    expect(resolveLanguage('auto', 'pt-PT')).toBe('pt')
    expect(resolveLanguage('auto', 'ja-JP')).toBe('en')
    expect(resolveLanguage('it', 'de-DE')).toBe('it')
  })
})
