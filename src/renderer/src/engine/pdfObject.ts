import type * as mupdf from 'mupdf'

export function child(obj: mupdf.PDFObject, ...path: (string | number)[]): mupdf.PDFObject {
  let current = obj
  for (const key of path) {
    if (current.isNull()) return current
    current = current.get(key)
  }
  return current
}
