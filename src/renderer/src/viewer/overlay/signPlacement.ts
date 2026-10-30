import type { SavedSignature } from '@shared/api'
import { pointInRect } from '@renderer/engine/geometry'
import type { Point, Rect } from '@renderer/engine/types'
import { locale } from '@renderer/i18n'
import { authorName, setTool, updateToolSettings, useApp } from '@renderer/state/appStore'
import type { DocStore } from '@renderer/state/docStore'
import { newSignature } from '@renderer/state/signatures'
import { checkPaths, clampToPage, crossPaths, dataUrlToBytes, fitInto, formatToday, freeTextRect, rectAround } from '../placement'

async function resolveSignature(): Promise<SavedSignature | null> {
  const { toolSettings, signatures, tempSignatures } = useApp.getState()
  const item = toolSettings.sign.item
  if (item?.kind === 'signature') {
    const found = [...signatures, ...tempSignatures].find((s) => s.id === item.id)
    if (found) return found
  }
  if (!item && signatures.length > 0) return signatures[0]
  const created = await newSignature()
  if (created) updateToolSettings('sign', { item: { kind: 'signature', id: created.id } })
  return created
}

export async function placeSignatureInRect(store: DocStore, page: number, target: Rect): Promise<void> {
  const signature = await resolveSignature()
  if (!signature) return
  const rect = fitInto(target, signature.width / signature.height)
  await insertSignature(store, page, rect, signature)
}

async function insertSignature(store: DocStore, page: number, rect: Rect, signature: SavedSignature): Promise<void> {
  const annot = await store
    .getState()
    .createAnnotation(page, { kind: 'stamp', rect, png: dataUrlToBytes(signature.dataUrl), role: 'signature' }, authorName())
  setTool('select')
  store.getState().select({ page, id: annot.id })
}

export async function placeSignItem(store: DocStore, page: number, point: Point, size: { width: number; height: number }): Promise<void> {
  const app = useApp.getState()
  const item = app.toolSettings.sign.item
  const s = store.getState()
  const author = authorName()

  if (item?.kind === 'check' || item?.kind === 'cross') {
    const paths = item.kind === 'check' ? checkPaths(point, 14) : crossPaths(point, 12)
    await s.createAnnotation(page, { kind: 'ink', paths, color: app.toolSettings.text.color, width: 1.8, role: item.kind }, author)
    return
  }
  if (item?.kind === 'image') {
    const width = Math.min(200, size.width * 0.4)
    const rect = clampToPage(rectAround(point, width, item.width / item.height), size)
    const annot = await s.createAnnotation(page, { kind: 'stamp', rect, png: dataUrlToBytes(item.dataUrl), role: 'image' }, author)
    setTool('select')
    store.getState().select({ page, id: annot.id })
    return
  }
  if (item?.kind === 'date') {
    const { font, size: fontSize, color } = app.toolSettings.text
    const text = formatToday(locale())
    const rect = freeTextRect([point[0], point[1] - fontSize * 0.7], text, font, fontSize, size)
    await s.createAnnotation(page, { kind: 'freetext', rect, text, font, size: fontSize, color, role: 'date' }, author)
    return
  }

  const data = await s.ensurePageData(page)
  const field = data?.fields.find((f) => f.type === 'signature' && !f.signed && pointInRect(point, f.rect))
  const signature = await resolveSignature()
  if (!signature) return
  const aspect = signature.width / signature.height
  const width = Math.min(170, size.width * 0.3)
  const rect = field ? fitInto(field.rect, aspect) : clampToPage(rectAround(point, width, aspect), size)
  await insertSignature(store, page, rect, signature)
}
