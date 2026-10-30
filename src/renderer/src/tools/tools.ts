import type { FontName, RGB } from '@renderer/engine/types'
import type { MessageKey } from '@renderer/i18n'

export type ToolId = 'select' | 'markup' | 'text' | 'draw' | 'shapes' | 'note' | 'sign' | 'redact'
export type MarkupType = 'highlight' | 'underline' | 'strikeout'
export type ShapeType = 'square' | 'circle' | 'line' | 'arrow'
export type SignItem =
  | { kind: 'signature'; id: string }
  | { kind: 'check' }
  | { kind: 'cross' }
  | { kind: 'date' }
  | { kind: 'image'; dataUrl: string; width: number; height: number }

export interface ToolSettings {
  markup: { type: MarkupType; color: RGB }
  text: { font: FontName; size: number; color: RGB }
  draw: { color: RGB; width: number }
  shapes: { type: ShapeType; color: RGB; fill: RGB | null; width: number }
  note: { color: RGB }
  sign: { item: SignItem | null }
}

export interface NamedColor {
  name: MessageKey
  rgb: RGB
}

const hex = (value: string): RGB => {
  const n = parseInt(value.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

export const MARKER_COLORS: NamedColor[] = [
  { name: 'color.yellow', rgb: hex('#FFD83D') },
  { name: 'color.green', rgb: hex('#7ED957') },
  { name: 'color.blue', rgb: hex('#6CC4FF') },
  { name: 'color.pink', rgb: hex('#FF7EB6') },
  { name: 'color.orange', rgb: hex('#FFAA4C') }
]

export const INK_COLORS: NamedColor[] = [
  { name: 'color.black', rgb: hex('#1A1A1A') },
  { name: 'color.blue', rgb: hex('#2F3FCB') },
  { name: 'color.red', rgb: hex('#D93A3F') },
  { name: 'color.green', rgb: hex('#1E8E5A') },
  { name: 'color.orange', rgb: hex('#E8772E') },
  { name: 'color.purple', rgb: hex('#7A4FD6') }
]

export const FILL_COLORS: NamedColor[] = [
  { name: 'color.white', rgb: hex('#FFFFFF') },
  { name: 'color.yellow', rgb: hex('#FFF3B0') },
  { name: 'color.blue', rgb: hex('#D9ECFF') },
  { name: 'color.green', rgb: hex('#DDF5D8') },
  { name: 'color.pink', rgb: hex('#FFE0EE') }
]

export const STROKE_WIDTHS = [1, 2, 3, 5, 8]
export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72]
export const FONTS: FontName[] = ['Helv', 'TiRo', 'Cour']

export const CSS_FONT: Record<string, string> = {
  Helv: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  TiRo: '"Times New Roman", Times, "Liberation Serif", serif',
  Cour: '"Courier New", Courier, "Liberation Mono", monospace'
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  markup: { type: 'highlight', color: MARKER_COLORS[0].rgb },
  text: { font: 'Helv', size: 12, color: INK_COLORS[0].rgb },
  draw: { color: INK_COLORS[1].rgb, width: 2 },
  shapes: { type: 'square', color: INK_COLORS[2].rgb, fill: null, width: 2 },
  note: { color: MARKER_COLORS[0].rgb },
  sign: { item: null }
}

export const TOOL_SHORTCUTS: Record<string, ToolId> = {
  v: 'select',
  h: 'markup',
  t: 'text',
  d: 'draw',
  r: 'shapes',
  n: 'note',
  s: 'sign',
  x: 'redact'
}

export function rgbToCss(rgb: RGB | null | undefined, alpha = 1): string {
  if (!rgb) return 'transparent'
  const [r, g, b] = rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255))
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`
}

export function sameColor(a: RGB | null | undefined, b: RGB | null | undefined): boolean {
  if (!a || !b) return a === b
  return a.every((v, i) => Math.abs(v - b[i]) < 0.02)
}
