export type PixelBounds = [x0: number, y0: number, x1: number, y1: number]

export interface BackgroundOptions {
  threshold?: number
  softness?: number
}

const LUMA_R = 0.2126
const LUMA_G = 0.7152
const LUMA_B = 0.0722

const MIN_PAPER = 0.4
const DARKEN = 0.25

function checkSize(pixels: Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0 || pixels.length < width * height * 4) {
    throw new RangeError(`Pixel buffer does not match ${width}×${height}`)
  }
}

export function contentBounds(pixels: Uint8ClampedArray, width: number, height: number, alphaThreshold = 8): PixelBounds | null {
  checkSize(pixels, width, height)
  let x0 = width
  let x1 = -1
  let y0 = -1
  let y1 = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * 4
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (pixels[row + x * 4 + 3] > alphaThreshold) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first < 0) continue
    if (y0 < 0) y0 = y
    y1 = y
    if (first < x0) x0 = first
    if (last > x1) x1 = last
  }
  return y0 < 0 ? null : [x0, y0, x1 + 1, y1 + 1]
}

export function removeLightBackground(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: BackgroundOptions = {}
): void {
  checkSize(pixels, width, height)
  if (width === 0 || height === 0) return
  const threshold = options.threshold ?? 0.8
  const softness = Math.max(1e-3, options.softness ?? 0.12)

  const stride = width + 1
  const sums = new Float64Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = pixels[i + 3] / 255
      row += ((LUMA_R * pixels[i] + LUMA_G * pixels[i + 1] + LUMA_B * pixels[i + 2]) / 255) * a + 1 - a
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row
    }
  }

  const radius = Math.max(8, Math.round(Math.max(width, height) / 12))
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius)
    const bottom = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const alpha = pixels[i + 3]
      if (alpha === 0) continue
      const left = Math.max(0, x - radius)
      const right = Math.min(width, x + radius + 1)
      const mean =
        (sums[bottom * stride + right] - sums[top * stride + right] - sums[bottom * stride + left] + sums[top * stride + left]) /
        ((right - left) * (bottom - top))
      const paper = Math.min(1, Math.max(MIN_PAPER, mean))
      const r = Math.min(1, pixels[i] / 255 / paper)
      const g = Math.min(1, pixels[i + 1] / 255 / paper)
      const b = Math.min(1, pixels[i + 2] / 255 / paper)
      const t = (threshold - (LUMA_R * r + LUMA_G * g + LUMA_B * b)) / softness
      if (t <= 0) {
        pixels[i + 3] = 0
        continue
      }
      const cover = t >= 1 ? 1 : t * t * (3 - 2 * t)
      pixels[i] = 255 * inkTone(r, cover)
      pixels[i + 1] = 255 * inkTone(g, cover)
      pixels[i + 2] = 255 * inkTone(b, cover)
      pixels[i + 3] = alpha * cover
    }
  }
}

function inkTone(channel: number, cover: number): number {
  const ink = Math.max(0, 1 - (1 - channel) / cover)
  return ink - DARKEN * ink * (1 - ink)
}

export function tintInk(pixels: Uint8ClampedArray, width: number, height: number, rgb: [number, number, number]): void {
  checkSize(pixels, width, height)
  const [r, g, b] = rgb
  for (let i = 0, end = width * height * 4; i < end; i += 4) {
    if (pixels[i + 3] === 0) continue
    pixels[i] = r
    pixels[i + 1] = g
    pixels[i + 2] = b
  }
}
