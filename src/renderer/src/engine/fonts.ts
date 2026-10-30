export function standardFontFor(name: string): string {
  const n = name.replace(/^[A-Z]{6}\+/, '').toLowerCase()
  const family = /times|serif|roman|georgia|garamond|minion|cambria|book/.test(n) && !/sans/.test(n) ? 'Times' : /courier|mono|consol|code/.test(n) ? 'Courier' : 'Helvetica'
  const bold = /bold|black|heavy|semibold|demi/.test(n)
  const italic = /italic|oblique/.test(n)
  if (family === 'Times') return bold && italic ? 'Times-BoldItalic' : bold ? 'Times-Bold' : italic ? 'Times-Italic' : 'Times-Roman'
  const suffix = bold && italic ? '-BoldOblique' : bold ? '-Bold' : italic ? '-Oblique' : ''
  return family + suffix
}

const WIN_ANSI_EXTRA: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a,
  '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f
}

export function encodeWinAnsi(text: string): Uint8Array {
  const out: number[] = []
  for (const ch of text) {
    let code = WIN_ANSI_EXTRA[ch] ?? ch.codePointAt(0) ?? 63
    if (code > 255 || (code >= 0x80 && code <= 0x9f && !(ch in WIN_ANSI_EXTRA))) code = 63
    if (code === 0x28 || code === 0x29 || code === 0x5c) out.push(0x5c)
    out.push(code)
  }
  return new Uint8Array(out)
}
