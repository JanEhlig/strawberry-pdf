export function splitFontName(name: string): { family: string; style: string } {
  const bare = name.replace(/^[A-Z]{6}\+/, '')
  const cut = Math.max(bare.lastIndexOf('-'), bare.lastIndexOf(','))
  return cut > 0 ? { family: bare.slice(0, cut), style: bare.slice(cut + 1) } : { family: bare, style: '' }
}

export function displayFontName(name: string): string {
  const { family } = splitFontName(name)
  return family
    .replace(/(PSMT|PS|MT)$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}
