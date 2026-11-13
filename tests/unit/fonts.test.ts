import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fontDirectories, scanFonts, type InstalledFont } from '../../src/main/fontIndex'
import { matchFonts, weightOf } from '../../src/main/fontMatch'
import { displayFontName, splitFontName } from '@shared/fontNames'

const face = (file: string, family: string, postscript: string, weight = 400, italic = false, mono = false): InstalledFont => ({
  file,
  index: 0,
  family,
  subfamily: '',
  postscript,
  weight,
  italic,
  mono
})

const installed = [
  face('arial.ttf', 'Arial', 'ArialMT'),
  face('arialbd.ttf', 'Arial', 'Arial-BoldMT', 700),
  face('ariali.ttf', 'Arial', 'Arial-ItalicMT', 400, true),
  face('calibri.ttf', 'Calibri', 'Calibri'),
  face('calibril.ttf', 'Calibri', 'Calibri-Light', 300),
  face('times.ttf', 'Times New Roman', 'TimesNewRomanPSMT'),
  face('timesbd.ttf', 'Times New Roman', 'TimesNewRomanPS-BoldMT', 700),
  face('cour.ttf', 'Courier New', 'CourierNewPSMT', 400, false, true),
  face('segoeui.ttf', 'Segoe UI', 'SegoeUI'),
  face('msyh.ttc', 'Microsoft YaHei', 'MicrosoftYaHei')
]

const query = (name: string, flags: Partial<{ bold: boolean; italic: boolean; serif: boolean; mono: boolean }> = {}, text = '') => ({
  name,
  bold: false,
  italic: false,
  serif: false,
  mono: false,
  text,
  ...flags
})

describe('Schriftzuordnung', () => {
  it('zerlegt PDF-Schriftnamen in Familie und Stil', () => {
    expect(splitFontName('BCDEEE+TimesNewRomanPS-BoldMT')).toEqual({ family: 'TimesNewRomanPS', style: 'BoldMT' })
    expect(splitFontName('Arial,BoldItalic')).toEqual({ family: 'Arial', style: 'BoldItalic' })
    expect(splitFontName('Calibri')).toEqual({ family: 'Calibri', style: '' })
    expect([weightOf('Light'), weightOf('SemiBold'), weightOf('BoldMT'), weightOf('Black')]).toEqual([300, 600, 700, 900])
    expect(displayFontName('BCDGEE+TimesNewRomanPS-BoldMT')).toBe('Times New Roman')
    expect(displayFontName('FrutigerLTStd-Roman')).toBe('Frutiger LT Std')
    expect(displayFontName('Calibri')).toBe('Calibri')
  })

  it('findet die installierte Originalschrift samt Schnitt', () => {
    expect(matchFonts(installed, query('BCDEEE+Calibri'))[0]).toMatchObject({ file: 'calibri.ttf', exact: true })
    expect(matchFonts(installed, query('Calibri-Light'))[0]).toMatchObject({ file: 'calibril.ttf', exact: true })
    expect(matchFonts(installed, query('BCDGEE+TimesNewRomanPS-BoldMT', { bold: true, serif: true }))[0]).toMatchObject({ file: 'timesbd.ttf' })
    expect(matchFonts(installed, query('Arial-ItalicMT', { italic: true }))[0]).toMatchObject({ file: 'ariali.ttf' })
    expect(matchFonts(installed, query('Arial,Bold'))[0]).toMatchObject({ file: 'arialbd.ttf' })
  })

  it('weicht für fremde Schriften auf eine passende Art aus', () => {
    const sans = matchFonts(installed, query('FrutigerLTStd-Roman'))
    expect(sans[0]).toMatchObject({ family: 'Arial', exact: false })
    expect(matchFonts(installed, query('Minion-Bold', { serif: true, bold: true }))[0]).toMatchObject({ file: 'timesbd.ttf', exact: false })
    expect(matchFonts(installed, query('Inconsolata', { mono: true }))[0]).toMatchObject({ family: 'Courier New' })
  })

  it('ergänzt Schriften für andere Schriftsysteme', () => {
    const families = matchFonts(installed, query('Calibri', {}, '你好')).map((f) => f.family)
    expect(families).toContain('Microsoft YaHei')
    expect(families[0]).toBe('Calibri')
  })
})

describe.skipIf(process.platform !== 'win32' || !existsSync('C:/Windows/Fonts/arial.ttf'))('installierte Schriften', () => {
  it('liest Namen, Schnitt und Familie der Windows-Schriften', async () => {
    const fonts = await scanFonts(fontDirectories().slice(0, 1))
    expect(fonts.find((f) => f.postscript === 'ArialMT')).toMatchObject({ family: 'Arial', weight: 400, italic: false })
    expect(fonts.find((f) => f.postscript === 'Arial-BoldItalicMT')).toMatchObject({ weight: 700, italic: true })
    expect(fonts.find((f) => f.postscript === 'CourierNewPSMT')?.mono).toBe(true)
    expect(fonts.some((f) => f.file.toLowerCase().endsWith('.ttc') && f.index > 0)).toBe(true)
  })
})
