import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/engine/client', () => ({ engine: () => ({}), EngineCallError: class extends Error {} }))
vi.mock('@renderer/dialogs/PasswordDialog', () => ({ askPassword: async () => null }))
vi.mock('@renderer/platform', () => ({ platform: {} }))
vi.mock('@renderer/state/appStore', () => ({ toast: () => undefined }))
vi.mock('@renderer/i18n', () => ({ t: (k: string) => k }))

const { reorder } = await import('@renderer/state/pages')

describe('Seiten umsortieren', () => {
  it('verschiebt eine Seite nach vorne', () => {
    expect(reorder(5, [3], 0)).toEqual([3, 0, 1, 2, 4])
  })
  it('verschiebt eine Seite ans Ende', () => {
    expect(reorder(5, [0], 5)).toEqual([1, 2, 3, 4, 0])
  })
  it('verschiebt mehrere Seiten als Block', () => {
    expect(reorder(6, [1, 4], 3)).toEqual([0, 2, 1, 4, 3, 5])
  })
  it('lässt die Reihenfolge, wenn sich nichts ändert', () => {
    expect(reorder(4, [2], 2)).toEqual([0, 1, 2, 3])
    expect(reorder(4, [2], 3)).toEqual([0, 1, 2, 3])
  })
})
