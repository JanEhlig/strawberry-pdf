import type { FontQuery, SystemFont } from '@shared/api'
import { splitFontName } from '@shared/fontNames'
import type { InstalledFont } from './fontIndex'

const SANS = ['Arial', 'Helvetica', 'Segoe UI', 'Calibri', 'Verdana', 'Liberation Sans', 'DejaVu Sans']
const SERIF = ['Times New Roman', 'Times', 'Georgia', 'Cambria', 'Liberation Serif', 'DejaVu Serif']
const MONO = ['Courier New', 'Consolas', 'Courier', 'Menlo', 'Liberation Mono', 'DejaVu Sans Mono']
const BROAD = ['Segoe UI', 'Arial Unicode MS', 'Arial', 'Noto Sans', 'DejaVu Sans']

const SCRIPTS: [RegExp, string[]][] = [
  [/[぀-ヿㇰ-ㇿ]/, ['Yu Gothic', 'Meiryo', 'MS Gothic', 'Hiragino Sans', 'Noto Sans CJK JP']],
  [/[가-힯ᄀ-ᇿ]/, ['Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans CJK KR']],
  [/[㐀-鿿豈-﫿]/, ['Microsoft YaHei', 'SimSun', 'PingFang SC', 'Noto Sans CJK SC', 'Yu Gothic']],
  [/[฀-๿]/, ['Leelawadee UI', 'Tahoma', 'Thonburi']],
  [/[ऀ-෿]/, ['Nirmala UI', 'Kohinoor Devanagari', 'Noto Sans Devanagari']],
  [/[֐-ۿݐ-ݿ]/, ['Segoe UI', 'Arial', 'Tahoma', 'Geeza Pro']]
]

export function normalizeName(name: string): string {
  return name
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function familyKey(family: string): string {
  return normalizeName(family).replace(/(psmt|ps|mt)$/, '')
}

export function weightOf(style: string): number {
  const s = style.toLowerCase()
  if (/thin|hairline/.test(s)) return 100
  if (/(extra|ultra)light/.test(s)) return 200
  if (/light/.test(s)) return 300
  if (/medium/.test(s)) return 500
  if (/(semi|demi)bold|demi/.test(s)) return 600
  if (/(extra|ultra)bold/.test(s)) return 800
  if (/black|heavy/.test(s)) return 900
  if (/bold/.test(s)) return 700
  return 400
}

function distance(font: InstalledFont, weight: number, italic: boolean): number {
  return Math.abs(font.weight - weight) / 100 + (font.italic !== italic ? 4 : 0)
}

function bestOfFamily(fonts: InstalledFont[], family: string, weight: number, italic: boolean): InstalledFont | null {
  const key = familyKey(family)
  const members = fonts.filter((f) => familyKey(f.family) === key)
  members.sort((a, b) => distance(a, weight, italic) - distance(b, weight, italic))
  return members[0] ?? null
}

function toSystemFont(font: InstalledFont, exact: boolean): SystemFont {
  return { file: font.file, index: font.index, family: font.family, postscript: font.postscript, weight: font.weight, italic: font.italic, exact }
}

export function matchFonts(fonts: InstalledFont[], query: FontQuery): SystemFont[] {
  const { family, style } = splitFontName(query.name)
  const weight = Math.max(weightOf(style), query.bold ? 700 : 0)
  const italic = query.italic || /italic|oblique/i.test(style)
  const postscript = normalizeName(query.name)
  const key = familyKey(family)
  const result: SystemFont[] = []
  const add = (font: InstalledFont | null, exact: boolean): void => {
    if (font && !result.some((r) => r.file === font.file && r.index === font.index)) result.push(toSystemFont(font, exact))
  }

  const own = fonts.filter((f) => normalizeName(f.postscript) === postscript || familyKey(f.family) === key || familyKey(splitFontName(f.postscript).family) === key)
  own.sort((a, b) => {
    const exactA = normalizeName(a.postscript) === postscript ? 0 : 1
    const exactB = normalizeName(b.postscript) === postscript ? 0 : 1
    return exactA - exactB || distance(a, weight, italic) - distance(b, weight, italic)
  })
  add(own[0] ?? null, true)

  const kind = query.mono ? MONO : query.serif ? SERIF : SANS
  for (const name of kind) {
    const font = bestOfFamily(fonts, name, weight, italic)
    if (font) {
      add(font, false)
      break
    }
  }

  for (const [pattern, families] of SCRIPTS) {
    if (!pattern.test(query.text)) continue
    for (const name of families) {
      const font = bestOfFamily(fonts, name, 400, false)
      if (font) {
        add(font, false)
        break
      }
    }
  }

  for (const name of BROAD) {
    const font = bestOfFamily(fonts, name, weight, italic)
    if (font) {
      add(font, false)
      break
    }
  }
  return result
}
