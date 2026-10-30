const MAX_SIDE = 2400

export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function loadImageFile(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = bitmap
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    if (scale === 1) return { dataUrl: await readAsDataUrl(file), width, height }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png'
    return { dataUrl: canvas.toDataURL(type, 0.9), width: canvas.width, height: canvas.height }
  } finally {
    bitmap.close()
  }
}
