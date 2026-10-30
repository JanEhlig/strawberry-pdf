import type { SavedSignature } from '@shared/api'
import { createSignature } from '@renderer/dialogs/SignatureDialog'
import { platform } from '@renderer/platform'
import { updateToolSettings, useApp } from './appStore'

function persist(list: SavedSignature[]): void {
  useApp.setState({ signatures: list })
  void platform.saveStore('signatures', list)
}

export function removeSignature(id: string): void {
  useApp.setState((s) => ({ tempSignatures: s.tempSignatures.filter((x) => x.id !== id) }))
  persist(useApp.getState().signatures.filter((s) => s.id !== id))
  const item = useApp.getState().toolSettings.sign.item
  if (item?.kind === 'signature' && item.id === id) updateToolSettings('sign', { item: null })
}

export async function newSignature(): Promise<SavedSignature | null> {
  const created = await createSignature()
  if (!created) return null
  const signature: SavedSignature = {
    id: `sig-${Date.now().toString(36)}`,
    kind: created.kind,
    dataUrl: created.dataUrl,
    width: created.width,
    height: created.height,
    createdAt: Date.now()
  }
  if (created.keep) persist([signature, ...useApp.getState().signatures].slice(0, 8))
  else useApp.setState((s) => ({ tempSignatures: [...s.tempSignatures, signature] }))
  return signature
}
