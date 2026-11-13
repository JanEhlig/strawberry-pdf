import { displayFontName } from '@shared/fontNames'
import type { FontProgram, TextFont } from '@renderer/engine/types'
import { platform } from '@renderer/platform'

export interface EditorFont {
  family: string
  weight: number
  style: 'normal' | 'italic'
  label: string
  installed: boolean
}

const MAX_FALLBACKS = 4

function generic(font: TextFont): string {
  return font.mono ? 'monospace' : font.serif ? 'serif' : 'sans-serif'
}

export async function editorFont(font: TextFont): Promise<EditorFont> {
  const [match] = await platform.matchFonts({ ...font, text: '' })
  if (match?.exact) {
    return {
      family: `"${match.family}", ${generic(font)}`,
      weight: match.weight,
      style: match.italic ? 'italic' : 'normal',
      label: match.family,
      installed: true
    }
  }
  return {
    family: generic(font),
    weight: font.bold ? 700 : 400,
    style: font.italic ? 'italic' : 'normal',
    label: displayFontName(font.name) || font.name,
    installed: false
  }
}

export async function fontsFor(font: TextFont, missing: string): Promise<FontProgram[]> {
  if (!missing) return []
  const matches = await platform.matchFonts({ ...font, text: missing })
  const programs = await Promise.all(
    matches.slice(0, MAX_FALLBACKS).map(async (match): Promise<FontProgram | null> => {
      try {
        return { name: match.postscript || match.family, data: await platform.readFont(match.file), index: match.index }
      } catch {
        return null
      }
    })
  )
  return programs.filter((program): program is FontProgram => program !== null)
}
