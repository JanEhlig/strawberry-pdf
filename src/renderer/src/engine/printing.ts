import * as mupdf from 'mupdf'
import type { PrintRenderOptions } from './types'

const JPEG_QUALITY = 88

function printMatrix(bounds: mupdf.Rect, scale: number, turn: boolean): mupdf.Matrix {
  let matrix = mupdf.Matrix.concat(mupdf.Matrix.translate(-bounds[0], -bounds[1]), mupdf.Matrix.scale(scale, scale))
  if (turn) matrix = mupdf.Matrix.concat(matrix, mupdf.Matrix.rotate(-90))
  const [x0, y0] = mupdf.Rect.transform(bounds, matrix)
  return mupdf.Matrix.concat(matrix, mupdf.Matrix.translate(-x0, -y0))
}

function printable(annotation: mupdf.PDFAnnotation): boolean {
  const flags = annotation.getFlags()
  return (flags & mupdf.PDFAnnotation.IS_PRINT) !== 0 && (flags & mupdf.PDFAnnotation.IS_HIDDEN) === 0
}

function drawFormFields(page: mupdf.PDFPage, pixmap: mupdf.Pixmap, matrix: mupdf.Matrix): void {
  const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
  try {
    for (const widget of page.getWidgets()) {
      if (printable(widget)) widget.run(device, matrix)
    }
  } finally {
    device.close()
  }
}

export function renderPrintPage(page: mupdf.PDFPage, options: PrintRenderOptions): Uint8Array<ArrayBuffer> {
  const matrix = printMatrix(page.getBounds(), options.dpi / 72, options.turn)
  const space = options.gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB
  const pixmap = page.toPixmap(matrix, space, false, options.markups, 'Print')
  try {
    if (!options.markups) drawFormFields(page, pixmap, matrix)
    return pixmap.asJPEG(JPEG_QUALITY).slice()
  } finally {
    pixmap.destroy()
  }
}
