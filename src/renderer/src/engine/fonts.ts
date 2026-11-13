import type { TextFont } from './types'

export function stripSubsetTag(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '')
}

export function builtinFontFor(font: TextFont): string {
  const n = stripSubsetTag(font.name).toLowerCase()
  const mono = font.mono || /courier|mono|consol|code/.test(n)
  const serif = !mono && (font.serif || (/times|serif|roman|georgia|garamond|minion|cambria|book/.test(n) && !/sans/.test(n)))
  const bold = font.bold || /bold|black|heavy|semibold|demi/.test(n)
  const italic = font.italic || /italic|oblique/.test(n)
  if (serif) return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman'
  const suffix = bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''
  return (mono ? 'Courier' : 'Helvetica') + suffix
}

const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f
}

export function winAnsiCode(ch: string): number | null {
  const extra = WIN_ANSI_EXTRA[ch]
  if (extra !== undefined) return extra
  const code = ch.codePointAt(0) ?? -1
  if (code < 0x20 || code > 0xff || (code >= 0x7f && code <= 0x9f)) return null
  return code
}

export const WIN_ANSI_CHARS: readonly string[] = [
  ...Array.from({ length: 0xe0 }, (_, i) => String.fromCharCode(0x20 + i)).filter((ch) => winAnsiCode(ch) !== null),
  ...Object.keys(WIN_ANSI_EXTRA)
]
