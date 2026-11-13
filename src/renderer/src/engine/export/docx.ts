import { contentMargins, type ExportBlock, type ExportImage, type ExportLine, type ExportPage, type ExportParagraph, type ExportTable } from './model'
import { escapeXml } from './xml'
import { crc32, zip, type ZipEntry } from './zip'

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const tw = (pt: number): number => Math.max(0, Math.round(pt * 20))
const emu = (pt: number): number => Math.max(1, Math.round(pt * 12700))

interface Media {
  id: number
  name: string
  data: Uint8Array
  key: string
}

interface Context {
  media: Media[]
  drawings: number
}

function hex(color: [number, number, number]): string {
  return color.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

function runKey(line: ExportLine): string {
  const { family, bold, italic, size } = line.font
  return `${family}|${bold}|${italic}|${Math.round(size * 2)}|${hex(line.color)}|${Math.round(line.spacing * 20)}`
}

function runXml(line: ExportLine, text: string): string {
  const { family, bold, italic, size } = line.font
  const font = escapeXml(family)
  const half = Math.max(2, Math.round(size * 2))
  const color = hex(line.color)
  return (
    `<w:r><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/>` +
    (bold ? '<w:b/><w:bCs/>' : '') +
    (italic ? '<w:i/><w:iCs/>' : '') +
    (color !== '000000' ? `<w:color w:val="${color}"/>` : '') +
    (line.spacing ? `<w:spacing w:val="${Math.round(line.spacing * 20)}"/>` : '') +
    `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
  )
}

function lineSpacing(p: ExportParagraph): string {
  if (p.lines.length < 2) return ''
  const gaps = p.lines.slice(1).map((l, i) => l.bbox[3] - p.lines[i].bbox[3]).filter((g) => g > 0)
  if (gaps.length === 0) return ''
  gaps.sort((a, b) => a - b)
  return ` w:line="${tw(gaps[gaps.length >> 1])}" w:lineRule="exact"`
}

const JC: Record<ExportParagraph['align'], string> = { left: '', center: 'center', right: 'right', justify: 'both' }

function paragraphXml(p: ExportParagraph, indent: number, before: number): string {
  const runs: string[] = []
  let current: ExportLine | null = null
  let text = ''
  for (const line of p.lines) {
    if (current && runKey(current) === runKey(line)) {
      text += line.text
      continue
    }
    if (current) runs.push(runXml(current, text))
    current = line
    text = line.text
  }
  if (current) runs.push(runXml(current, text.trimEnd()))
  const jc = JC[p.align] ? `<w:jc w:val="${JC[p.align]}"/>` : ''
  const ind = indent > 1 ? `<w:ind w:left="${tw(indent)}"/>` : ''
  return `<w:p><w:pPr><w:spacing w:before="${tw(before)}" w:after="0"${lineSpacing(p)}/>${ind}${jc}</w:pPr>${runs.join('')}</w:p>`
}

function spacer(height: number): string {
  return height > 2 ? `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${tw(height)}" w:lineRule="exact"/></w:pPr></w:p>` : ''
}

function tableXml(table: ExportTable, indent: number): string {
  const border = (side: string): string => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`
  const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')
  const grid = table.columns.map((w) => `<w:gridCol w:w="${tw(w)}"/>`).join('')
  const rows = table.rows
    .map((cells, r) => {
      const tcs = cells
        .map((paragraphs, i) => {
          const body = paragraphs.length ? paragraphs.map((p) => paragraphXml(p, 0, 0)).join('') : '<w:p/>'
          return `<w:tc><w:tcPr><w:tcW w:w="${tw(table.columns[i])}" w:type="dxa"/></w:tcPr>${body}</w:tc>`
        })
        .join('')
      return `<w:tr><w:trPr><w:trHeight w:val="${tw(table.heights[r] ?? 0)}" w:hRule="atLeast"/></w:trPr>${tcs}</w:tr>`
    })
    .join('')
  const width = tw(table.columns.reduce((a, b) => a + b, 0))
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblInd w:w="${tw(indent)}" w:type="dxa"/>` +
    `<w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows}</w:tbl>`
  )
}

function imageXml(image: ExportImage, media: Media, drawing: number, indent: number, before: number): string {
  const cx = emu(image.bbox[2] - image.bbox[0])
  const cy = emu(image.bbox[3] - image.bbox[1])
  const ind = indent > 1 ? `<w:ind w:left="${tw(indent)}"/>` : ''
  return (
    `<w:p><w:pPr><w:spacing w:before="${tw(before)}" w:after="0"/>${ind}</w:pPr><w:r><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${drawing}" name="Image ${drawing}"/>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${drawing}" name="${media.name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rImage${media.id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
  )
}

function sectionXml(page: ExportPage, margins: [number, number, number, number]): string {
  const [left, top, right, bottom] = margins
  const orient = page.width > page.height ? ' w:orient="landscape"' : ''
  return (
    `<w:sectPr><w:pgSz w:w="${tw(page.width)}" w:h="${tw(page.height)}"${orient}/>` +
    `<w:pgMar w:top="${tw(top)}" w:right="${tw(right)}" w:bottom="${tw(bottom)}" w:left="${tw(left)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`
  )
}

function pageXml(page: ExportPage, context: Context, margins: [number, number, number, number]): string {
  const [left, top] = margins
  let cursor = top
  const parts: string[] = []
  for (const block of page.blocks) {
    const before = Math.max(0, block.bbox[1] - cursor)
    const indent = Math.max(0, block.bbox[0] - left)
    parts.push(blockXml(block, context, indent, before))
    cursor = Math.max(cursor, block.bbox[3])
  }
  return parts.join('')
}

function mediaFor(image: ExportImage, media: Media[]): Media {
  const key = `${crc32(image.data)}:${image.data.length}`
  const existing = media.find((m) => m.key === key)
  if (existing) return existing
  const id = media.length + 1
  const entry: Media = { id, name: `image${id}.${image.format === 'jpeg' ? 'jpg' : 'png'}`, data: image.data, key }
  media.push(entry)
  return entry
}

function blockXml(block: ExportBlock, context: Context, indent: number, before: number): string {
  if (block.kind === 'paragraph') return paragraphXml(block, indent, before)
  if (block.kind === 'table') return spacer(before) + tableXml(block, indent)
  return imageXml(block, mediaFor(block, context.media), ++context.drawings, indent, before)
}

const STYLES =
  XML_HEAD +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
  '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="72" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="72" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>'

export function writeDocx(pages: ExportPage[]): Uint8Array<ArrayBuffer> {
  const context: Context = { media: [], drawings: 0 }
  const { media } = context
  const body = pages
    .map((page, i) => {
      const margins = contentMargins(page, page.blocks)
      const content = pageXml(page, context, margins)
      const section = sectionXml(page, margins)
      return i < pages.length - 1 ? `${content}<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${section}</w:pPr></w:p>` : content + section
    })
    .join('')
  const document = `${XML_HEAD}<w:document ${NS}><w:body>${body || '<w:p/>'}</w:body></w:document>`
  const imageRels = media
    .map((m) => `<Relationship Id="rImage${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`)
    .join('')
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data:
        XML_HEAD +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    },
    {
      name: '_rels/.rels',
      data:
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>'
    },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    {
      name: 'word/_rels/document.xml.rels',
      data:
        XML_HEAD +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        imageRels +
        '</Relationships>'
    },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data }))
  ]
  return zip(entries)
}
