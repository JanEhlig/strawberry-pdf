import { describe, expect, it } from 'vitest'
import { contentBounds, removeLightBackground, tintInk } from '@renderer/lib/signatureImage'

type Rgba = [number, number, number, number]

const WHITE: Rgba = [255, 255, 255, 255]
const CLEAR: Rgba = [0, 0, 0, 0]
const INK: Rgba = [25, 25, 30, 255]

function image(width: number, height: number, color: Rgba): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set(color, i)
  return pixels
}

function fill(pixels: Uint8ClampedArray, width: number, [x0, y0, x1, y1]: number[], color: Rgba): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) pixels.set(color, (y * width + x) * 4)
}

const pixel = (pixels: Uint8ClampedArray, width: number, x: number, y: number): number[] =>
  Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))

describe('contentBounds', () => {
  it('liefert null für ein leeres Bild', () => {
    expect(contentBounds(image(12, 8, CLEAR), 12, 8)).toBeNull()
  })

  it('umschließt einen gezeichneten Block (x1/y1 exklusiv)', () => {
    const px = image(20, 12, CLEAR)
    fill(px, 20, [3, 4, 9, 7], INK)
    expect(contentBounds(px, 20, 12)).toEqual([3, 4, 9, 7])
  })

  it('findet Pixel bis an den Bildrand', () => {
    const px = image(20, 12, CLEAR)
    fill(px, 20, [19, 11, 20, 12], INK)
    fill(px, 20, [0, 2, 1, 3], INK)
    expect(contentBounds(px, 20, 12)).toEqual([0, 2, 20, 12])
  })

  it('übergeht fast durchsichtige Pixel bis zur Schwelle', () => {
    const px = image(10, 10, CLEAR)
    fill(px, 10, [4, 5, 5, 6], [0, 0, 0, 6])
    expect(contentBounds(px, 10, 10)).toBeNull()
    expect(contentBounds(px, 10, 10, 2)).toEqual([4, 5, 5, 6])
  })

  it('prüft die Puffergröße', () => {
    expect(() => contentBounds(new Uint8ClampedArray(10), 4, 4)).toThrow(RangeError)
  })
})

describe('removeLightBackground', () => {
  it('macht Weiß durchsichtig', () => {
    const px = image(16, 16, WHITE)
    removeLightBackground(px, 16, 16)
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(0)
  })

  it('lässt dunkle Tinte deckend und dunkel', () => {
    const px = image(32, 16, WHITE)
    fill(px, 32, [8, 4, 24, 8], INK)
    removeLightBackground(px, 32, 16)
    const [r, g, b, a] = pixel(px, 32, 12, 6)
    expect(a).toBe(255)
    expect(Math.max(r, g, b)).toBeLessThan(60)
    expect(pixel(px, 32, 2, 12)[3]).toBe(0)
  })

  it('stellt graues Papier mit Helligkeitsverlauf frei (Foto)', () => {
    const width = 96
    const height = 32
    const px = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = 150 + x
        px.set([v, v, v, 255], (y * width + x) * 4)
      }
    }
    const stroke = [10, 14, 86, 18]
    fill(px, width, stroke, [35, 35, 40, 255])
    removeLightBackground(px, width, height)
    let paperAlpha = 0
    let inkAlpha = 255
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const a = px[(y * width + x) * 4 + 3]
        const inStroke = x >= stroke[0] && x < stroke[2] && y >= stroke[1] && y < stroke[3]
        if (inStroke) inkAlpha = Math.min(inkAlpha, a)
        else paperAlpha = Math.max(paperAlpha, a)
      }
    }
    expect(paperAlpha).toBe(0)
    expect(inkAlpha).toBe(255)
  })

  it('blendet helle Kanten weich aus und behält ihre Tintenfarbe', () => {
    const px = image(32, 32, WHITE)
    fill(px, 32, [16, 16, 17, 17], [190, 190, 190, 255])
    removeLightBackground(px, 32, 32)
    const [r, , , a] = pixel(px, 32, 16, 16)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(255)
    expect(r).toBeLessThan(190)
  })

  it('berücksichtigt Schwelle und Weichheit', () => {
    const grey = (): Uint8ClampedArray => {
      const px = image(32, 32, WHITE)
      fill(px, 32, [10, 10, 11, 11], [128, 128, 128, 255])
      return px
    }
    const normal = grey()
    removeLightBackground(normal, 32, 32)
    expect(pixel(normal, 32, 10, 10)[3]).toBe(255)
    const strict = grey()
    removeLightBackground(strict, 32, 32, { threshold: 0.45, softness: 0.05 })
    expect(pixel(strict, 32, 10, 10)[3]).toBe(0)
  })

  it('lässt freigestellte Bilder mit Transparenz unverändert', () => {
    const px = image(24, 24, CLEAR)
    fill(px, 24, [6, 8, 18, 14], [10, 10, 10, 255])
    fill(px, 24, [2, 2, 3, 3], [10, 10, 10, 100])
    removeLightBackground(px, 24, 24)
    expect(pixel(px, 24, 10, 10)[3]).toBe(255)
    expect(pixel(px, 24, 2, 2)[3]).toBe(100)
    expect(pixel(px, 24, 20, 20)[3]).toBe(0)
  })

  it('lässt ein ganz dunkles Bild deckend', () => {
    const px = image(8, 8, [0, 0, 0, 255])
    removeLightBackground(px, 8, 8)
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255)
  })
})

describe('tintInk', () => {
  it('färbt sichtbare Pixel ein und behält Alpha', () => {
    const px = new Uint8ClampedArray([10, 200, 30, 255, 240, 240, 240, 128, 5, 6, 7, 0])
    tintInk(px, 3, 1, [47, 63, 203])
    expect(Array.from(px)).toEqual([47, 63, 203, 255, 47, 63, 203, 128, 5, 6, 7, 0])
  })
})
