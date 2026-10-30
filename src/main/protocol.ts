import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'

export const APP_SCHEME = 'app'
export const APP_ORIGIN = `${APP_SCHEME}://bundle`

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
}

export function registerAppSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true }
    }
  ])
}

export function handleAppScheme(rootDir: string): void {
  const root = normalize(rootDir + sep)
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const filePath = normalize(join(root, relative))
    if (!filePath.startsWith(root)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const data = await readFile(filePath)
      const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(data), { headers: { 'content-type': type } })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
