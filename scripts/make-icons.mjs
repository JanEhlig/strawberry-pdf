import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mupdf from 'mupdf'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512]
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const SMALL_MAX = 32
const VIEW = 512
const TILE_INSET = 32

const RGB = mupdf.ColorSpace.DeviceRGB
const KAPPA = 0.5522847498

const SHAPES = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'],
  polygon: ['points'],
  path: ['d']
}
const SKIPPED = new Set(['title', 'desc', 'metadata'])
const ROOT_ATTRS = new Set(['xmlns', 'version', 'viewBox', 'width', 'height'])
const PAINT = {
  fill: parseColor,
  stroke: parseColor,
  'fill-opacity': parseUnit,
  'stroke-opacity': parseUnit,
  'stroke-width': parseNumber,
  'stroke-miterlimit': parseNumber,
  'fill-rule': (v) => oneOf(v, { nonzero: false, evenodd: true }),
  'stroke-linecap': (v) => oneOf(v, { butt: 'Butt', round: 'Round', square: 'Square' }),
  'stroke-linejoin': (v) => oneOf(v, { miter: 'Miter', round: 'Round', bevel: 'Bevel' })
}
const DEFAULT_PAINT = {
  fill: [0, 0, 0],
  stroke: null,
  'fill-opacity': 1,
  'stroke-opacity': 1,
  'stroke-width': 1,
  'stroke-miterlimit': 4,
  'fill-rule': false,
  'stroke-linecap': 'Butt',
  'stroke-linejoin': 'Miter'
}

function fail(message) {
  throw new Error(`SVG: ${message}`)
}

function parseNumber(value) {
  const n = Number(String(value).trim().replace(/px$/, ''))
  if (!Number.isFinite(n)) fail(`keine Zahl: „${value}“`)
  return n
}

function parseUnit(value) {
  return Math.min(1, Math.max(0, parseNumber(value)))
}

function oneOf(value, map) {
  if (!Object.hasOwn(map, value)) fail(`Wert „${value}“ nicht unterstützt`)
  return map[value]
}

function parseColor(value) {
  const v = value.trim().toLowerCase()
  if (v === 'none' || v === 'transparent') return null
  if (v === 'white') return [1, 1, 1]
  if (v === 'black') return [0, 0, 0]
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v)?.[1]
  if (!hex) fail(`Farbe „${value}“ nicht unterstützt (nur #rgb, #rrggbb, white, black, none)`)
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
}

function numbers(text) {
  return (text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number)
}

function parseSvg(text) {
  const src = text.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>]*>/g, '')
  const top = { name: '#', attrs: {}, children: [] }
  const stack = [top]
  for (const [, close, name, rest, selfClose] of src.matchAll(/<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g)) {
    if (close) {
      if (stack.pop().name !== name) fail(`unerwartetes </${name}>`)
      continue
    }
    const attrs = {}
    for (const [, key, a, b] of rest.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[key] = (a ?? b).replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[e])
    }
    const node = { name, attrs, children: [] }
    stack.at(-1).children.push(node)
    if (!selfClose) stack.push(node)
  }
  if (stack.length !== 1) fail('Element nicht geschlossen')
  const svg = top.children[0]
  if (svg?.name !== 'svg') fail('Wurzelelement <svg> fehlt')
  if (numbers(svg.attrs.viewBox ?? '').join(' ') !== `0 0 ${VIEW} ${VIEW}`) fail(`viewBox muss "0 0 ${VIEW} ${VIEW}" sein`)
  return svg
}

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ]
}

function parseTransform(text) {
  let m = [1, 0, 0, 1, 0, 0]
  const rest = text.replace(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g, (_, fn, args) => {
    const v = numbers(args)
    const [a = 0, b, c] = v
    const rad = (a * Math.PI) / 180
    let t
    if (fn === 'matrix') t = v
    else if (fn === 'translate') t = [1, 0, 0, 1, a, b ?? 0]
    else if (fn === 'scale') t = [a, 0, 0, b ?? a, 0, 0]
    else if (fn === 'skewX') t = [1, 0, Math.tan(rad), 1, 0, 0]
    else if (fn === 'skewY') t = [1, Math.tan(rad), 0, 1, 0, 0]
    else {
      const [cx, cy] = [b ?? 0, c ?? 0]
      const turn = [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]
      t = mul(mul([1, 0, 0, 1, cx, cy], turn), [1, 0, 0, 1, -cx, -cy])
    }
    if (t.length !== 6) fail(`transform „${text}“ nicht lesbar`)
    m = mul(m, t)
    return ''
  })
  if (rest.replace(/[\s,]/g, '')) fail(`transform „${text}“ nicht lesbar`)
  return m
}

function roundedRect(p, x, y, w, h, rx, ry) {
  if (rx <= 0 || ry <= 0) return p.rect(x, y, x + w, y + h)
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  p.moveTo(x + rx, y)
  p.lineTo(x + w - rx, y)
  p.curveTo(x + w - rx + kx, y, x + w, y + ry - ky, x + w, y + ry)
  p.lineTo(x + w, y + h - ry)
  p.curveTo(x + w, y + h - ry + ky, x + w - rx + kx, y + h, x + w - rx, y + h)
  p.lineTo(x + rx, y + h)
  p.curveTo(x + rx - kx, y + h, x, y + h - ry + ky, x, y + h - ry)
  p.lineTo(x, y + ry)
  p.curveTo(x, y + ry - ky, x + rx - kx, y, x + rx, y)
  p.closePath()
}

function arcTo(p, x0, y0, rx, ry, angle, large, sweep, x, y) {
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if ((x0 === x && y0 === y) || !rx || !ry) return p.lineTo(x, y)
  const phi = (angle * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x0 - x) / 2
  const dy = (y0 - y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const q = rx * rx * y1 * y1 + ry * ry * x1 * x1
  const f = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - q) / q))
  const cxp = (f * rx * y1) / ry
  const cyp = (-f * ry * x1) / rx
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2
  const t0 = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx)
  let dt = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx) - t0
  if (sweep && dt < 0) dt += 2 * Math.PI
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9)
  const h = dt / n
  const k = (4 / 3) * Math.tan(h / 4)
  const at = (ex, ey) => [cx + rx * cos * ex - ry * sin * ey, cy + rx * sin * ex + ry * cos * ey]
  for (let i = 0, t = t0; i < n; i++, t += h) {
    const [c1, s1, c2, s2] = [Math.cos(t), Math.sin(t), Math.cos(t + h), Math.sin(t + h)]
    p.curveTo(...at(c1 - k * s1, s1 + k * c1), ...at(c2 + k * s2, s2 - k * c2), ...at(c2, s2))
  }
}

function pathData(p, d) {
  let i = 0
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++
  }
  const hasNumber = () => (skip(), i < d.length && /[-+.\d]/.test(d[i]))
  const num = () => {
    skip()
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i))
    if (!m) fail(`Pfad nicht lesbar bei „${d.slice(i, i + 16)}“`)
    i += m[0].length
    return Number(m[0])
  }
  const flag = () => {
    skip()
    const c = d[i++]
    if (c !== '0' && c !== '1') fail(`Bogen-Flag erwartet bei „${d.slice(i - 1, i + 15)}“`)
    return c === '1'
  }
  let [x, y, sx, sy, kx, ky, prev] = [0, 0, 0, 0, 0, 0, '']
  while ((skip(), i < d.length)) {
    let cmd = d[i++]
    if (!/[MLHVCSQTAZ]/i.test(cmd)) fail(`Pfadbefehl „${cmd}“ unbekannt`)
    do {
      const rel = cmd === cmd.toLowerCase()
      const ox = rel ? x : 0
      const oy = rel ? y : 0
      const C = cmd.toUpperCase()
      if (C === 'M') {
        x = ox + num()
        y = oy + num()
        p.moveTo(x, y)
        ;[sx, sy] = [x, y]
        cmd = rel ? 'l' : 'L'
      } else if (C === 'L' || C === 'H' || C === 'V') {
        if (C !== 'V') x = ox + num()
        if (C !== 'H') y = oy + num()
        p.lineTo(x, y)
      } else if (C === 'C' || C === 'S') {
        const [x1, y1] = C === 'C' ? [ox + num(), oy + num()] : /[CS]/.test(prev) ? [2 * x - kx, 2 * y - ky] : [x, y]
        kx = ox + num()
        ky = oy + num()
        x = ox + num()
        y = oy + num()
        p.curveTo(x1, y1, kx, ky, x, y)
      } else if (C === 'Q' || C === 'T') {
        const [qx, qy] = C === 'Q' ? [ox + num(), oy + num()] : /[QT]/.test(prev) ? [2 * x - kx, 2 * y - ky] : [x, y]
        const [x0, y0] = [x, y]
        x = ox + num()
        y = oy + num()
        p.curveTo(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y)
        ;[kx, ky] = [qx, qy]
      } else if (C === 'A') {
        const [rx, ry, angle, large, sweep] = [num(), num(), num(), flag(), flag()]
        const [x0, y0] = [x, y]
        x = ox + num()
        y = oy + num()
        arcTo(p, x0, y0, rx, ry, angle, large, sweep, x, y)
      } else {
        p.closePath()
        ;[x, y] = [sx, sy]
      }
      prev = C
    } while (prev !== 'Z' && hasNumber())
  }
}

function shapePath(name, a) {
  const n = (key) => (a[key] === undefined ? 0 : parseNumber(a[key]))
  const p = new mupdf.Path()
  if (name === 'rect') {
    const [w, h] = [n('width'), n('height')]
    const rx = Math.min(w / 2, a.rx !== undefined ? n('rx') : n('ry'))
    const ry = Math.min(h / 2, a.ry !== undefined ? n('ry') : n('rx'))
    if (w > 0 && h > 0) roundedRect(p, n('x'), n('y'), w, h, rx, ry)
  } else if (name === 'circle' || name === 'ellipse') {
    const [rx, ry] = name === 'circle' ? [n('r'), n('r')] : [n('rx'), n('ry')]
    if (rx > 0 && ry > 0) roundedRect(p, n('cx') - rx, n('cy') - ry, 2 * rx, 2 * ry, rx, ry)
  } else if (name === 'line') {
    p.moveTo(n('x1'), n('y1'))
    p.lineTo(n('x2'), n('y2'))
  } else if (name === 'path') {
    pathData(p, a.d ?? '')
  } else {
    const pts = numbers(a.points ?? '')
    for (let i = 0; i + 1 < pts.length; i += 2) i ? p.lineTo(pts[i], pts[i + 1]) : p.moveTo(pts[i], pts[i + 1])
    if (name === 'polygon') p.closePath()
  }
  return p
}

function draw(dev, node, ctm, inherited, area) {
  if (SKIPPED.has(node.name)) return
  const isGroup = node.name === 'svg' || node.name === 'g'
  if (!isGroup && !SHAPES[node.name]) fail(`<${node.name}> wird nicht unterstützt`)
  const { style, ...attrs } = node.attrs
  for (const declaration of (style ?? '').split(';')) {
    const [key, ...value] = declaration.split(':')
    if (key.trim()) attrs[key.trim()] = value.join(':').trim()
  }
  const paint = { ...inherited }
  for (const [key, value] of Object.entries(attrs)) {
    if (PAINT[key]) paint[key] = PAINT[key](value)
    else if (
      !['id', 'opacity', 'transform'].includes(key) &&
      !key.includes(':') &&
      !/^(data|aria)-/.test(key) &&
      !(node.name === 'svg' && ROOT_ATTRS.has(key)) &&
      !SHAPES[node.name]?.includes(key)
    )
      fail(`Attribut „${key}“ an <${node.name}> wird nicht unterstützt`)
  }
  const m = attrs.transform ? mul(ctm, parseTransform(attrs.transform)) : ctm
  const opacity = attrs.opacity === undefined ? 1 : parseUnit(attrs.opacity)
  if (opacity === 0) return
  if (opacity < 1) dev.beginGroup(area, RGB, true, false, 'Normal', opacity)
  if (isGroup) {
    for (const child of node.children) draw(dev, child, m, paint, area)
  } else {
    const path = shapePath(node.name, attrs)
    if (paint.fill && node.name !== 'line') dev.fillPath(path, paint['fill-rule'], m, RGB, paint.fill, paint['fill-opacity'])
    if (paint.stroke && paint['stroke-width'] > 0) {
      const stroke = new mupdf.StrokeState({
        lineWidth: paint['stroke-width'],
        lineCap: paint['stroke-linecap'],
        lineJoin: paint['stroke-linejoin'],
        miterLimit: paint['stroke-miterlimit']
      })
      dev.strokePath(path, stroke, m, RGB, paint.stroke, paint['stroke-opacity'])
      stroke.destroy()
    }
    path.destroy()
  }
  if (opacity < 1) dev.endGroup()
}

function fitMatrix(size) {
  const pad = Math.floor((size * TILE_INSET) / VIEW)
  const s = (size - 2 * pad) / (VIEW - 2 * TILE_INSET)
  const t = pad - TILE_INSET * s + 1e-3
  return [s, 0, 0, s, t, t]
}

function renderPng(svg, size) {
  const pix = new mupdf.Pixmap(RGB, [0, 0, size, size], true)
  pix.clear()
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix)
  draw(dev, svg, fitMatrix(size), DEFAULT_PAINT, [0, 0, size, size])
  dev.close()
  dev.destroy()
  const px = pix.getPixels()
  const center = ((size >> 1) * size + (size >> 1)) * 4 + 3
  if (px[3] !== 0 || px[center] !== 255) throw new Error(`${size} px: Ecke nicht transparent oder Mitte nicht deckend`)
  const png = Buffer.from(pix.asPNG())
  pix.destroy()
  if (png[25] !== 6) throw new Error(`${size} px: PNG ohne Alphakanal`)
  return png
}

function renderTile(svg, width, height, iconSize) {
  const pix = new mupdf.Pixmap(RGB, [0, 0, width, height], true)
  pix.clear()
  const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix)
  const [s, , , , t] = fitMatrix(iconSize)
  draw(dev, svg, [s, 0, 0, s, t + Math.round((width - iconSize) / 2), t + Math.round((height - iconSize) / 2)], DEFAULT_PAINT, [0, 0, width, height])
  dev.close()
  dev.destroy()
  const png = Buffer.from(pix.asPNG())
  pix.destroy()
  return png
}

const SCALES = [100, 125, 150, 200, 400]
const TILES = [
  { name: 'StoreLogo', width: 50, height: 50, icon: 1 },
  { name: 'Square44x44Logo', width: 44, height: 44, icon: 1 },
  { name: 'Square150x150Logo', width: 150, height: 150, icon: 0.6 },
  { name: 'Wide310x150Logo', width: 310, height: 150, icon: 0.6 }
]
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]

function writeAppxAssets(master, small) {
  const dir = join(root, 'build/appx')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const pick = (size) => (size <= SMALL_MAX ? small : master)
  for (const tile of TILES) {
    for (const scale of SCALES) {
      const width = Math.round((tile.width * scale) / 100)
      const height = Math.round((tile.height * scale) / 100)
      const icon = Math.round(Math.min(width, height) * tile.icon)
      writeFileSync(join(dir, `${tile.name}.scale-${scale}.png`), renderTile(pick(icon), width, height, icon))
    }
  }
  for (const size of TARGET_SIZES) {
    const png = renderTile(pick(size), size, size, size)
    writeFileSync(join(dir, `Square44x44Logo.targetsize-${size}.png`), png)
    writeFileSync(join(dir, `Square44x44Logo.targetsize-${size}_altform-unplated.png`), png)
    writeFileSync(join(dir, `Square44x44Logo.targetsize-${size}_altform-lightunplated.png`), png)
  }
  return readdirSync(dir).length
}

function makeIco(images) {
  const head = Buffer.alloc(6 + 16 * images.length)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i
    head[entry] = head[entry + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, entry + 4)
    head.writeUInt16LE(32, entry + 6)
    head.writeUInt32LE(png.length, entry + 8)
    head.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([head, ...images.map((image) => image.png)])
}

const readSvg = (file) => parseSvg(readFileSync(join(root, file), 'utf8'))
const master = readSvg('build/icon.svg')
const small = existsSync(join(root, 'build/icon-small.svg')) ? readSvg('build/icon-small.svg') : master

mkdirSync(join(root, 'build/icons'), { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })
const pngs = new Map()
for (const size of SIZES) {
  const png = renderPng(size <= SMALL_MAX ? small : master, size)
  pngs.set(size, png)
  writeFileSync(join(root, `build/icons/${size}x${size}.png`), png)
}
writeFileSync(join(root, 'resources/icon.png'), pngs.get(512))
writeFileSync(join(root, 'build/icon.png'), pngs.get(512))
const ico = makeIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size) })))
writeFileSync(join(root, 'build/icon.ico'), ico)

console.log(`build/icon.ico: ${ICO_SIZES.length} Größen, ${ico.length} Bytes`)
for (const size of ICO_SIZES) console.log(`  ${String(size).padStart(3)} px  ${String(pngs.get(size).length).padStart(6)} Bytes`)
console.log('resources/icon.png, build/icon.png (512 px) und build/icons/*.png geschrieben')
console.log(`build/appx: ${writeAppxAssets(master, small)} Kachelbilder für das Store-Paket`)
