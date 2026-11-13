export interface ToUnicodeMap {
  bytesPerCode: number
  map: Map<number, string>
}

function hexTokens(source: string): string[] {
  return source.match(/<[0-9a-fA-F\s]*>|\[|\]/g) ?? []
}

function hexValue(token: string): string {
  return token.slice(1, -1).replace(/\s+/g, '')
}

function decodeUtf16(hex: string): string {
  const units: number[] = []
  for (let i = 0; i + 4 <= hex.length; i += 4) units.push(parseInt(hex.slice(i, i + 4), 16))
  return String.fromCharCode(...units)
}

function withOffset(hex: string, offset: number): string {
  const text = decodeUtf16(hex)
  if (offset === 0 || text.length === 0) return text
  const last = text.charCodeAt(text.length - 1) + offset
  return text.slice(0, -1) + String.fromCharCode(last)
}

export function parseToUnicode(source: string): ToUnicodeMap {
  const map = new Map<number, string>()
  let bytesPerCode = 0
  for (const block of source.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    const first = hexTokens(block[1])[0]
    if (first) bytesPerCode = Math.max(bytesPerCode, Math.ceil(hexValue(first).length / 2))
  }
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const tokens = hexTokens(block[1])
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const code = hexValue(tokens[i])
      bytesPerCode ||= Math.ceil(code.length / 2)
      map.set(parseInt(code, 16), decodeUtf16(hexValue(tokens[i + 1])))
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const tokens = hexTokens(block[1])
    let i = 0
    while (i + 2 < tokens.length) {
      const lo = parseInt(hexValue(tokens[i]), 16)
      const hi = parseInt(hexValue(tokens[i + 1]), 16)
      bytesPerCode ||= Math.ceil(hexValue(tokens[i]).length / 2)
      if (tokens[i + 2] === '[') {
        let j = i + 3
        for (let code = lo; code <= hi && j < tokens.length && tokens[j] !== ']'; code++, j++) map.set(code, decodeUtf16(hexValue(tokens[j])))
        while (j < tokens.length && tokens[j] !== ']') j++
        i = j + 1
      } else {
        const start = hexValue(tokens[i + 2])
        for (let code = lo; code <= hi && code - lo < 0x10000; code++) map.set(code, withOffset(start, code - lo))
        i += 3
      }
    }
  }
  return { bytesPerCode: bytesPerCode || 1, map }
}

function utf16Hex(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) out += text.charCodeAt(i).toString(16).padStart(4, '0')
  return out
}

export function buildToUnicode(entries: Map<number, string>): string {
  const pairs = [...entries].sort((a, b) => a[0] - b[0]).map(([code, text]) => `<${code.toString(16).padStart(4, '0')}> <${utf16Hex(text)}>`)
  const chunks: string[] = []
  for (let i = 0; i < pairs.length; i += 100) {
    const part = pairs.slice(i, i + 100)
    chunks.push(`${part.length} beginbfchar\n${part.join('\n')}\nendbfchar`)
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...chunks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
    ''
  ].join('\n')
}

export function invertToUnicode(map: Map<number, string>, usable: (code: number) => boolean = () => true): Map<string, number> {
  const inverse = new Map<string, number>()
  for (const [code, text] of map) {
    if ([...text].length !== 1 || inverse.has(text) || !usable(code)) continue
    inverse.set(text, code)
  }
  return inverse
}
