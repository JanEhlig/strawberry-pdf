import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      react(),
      {
        name: 'strawberry-strict-csp',
        apply: 'build',
        transformIndexHtml: (html: string) => html.replace(' ws://localhost:* http://localhost:*', '')
      }
    ],
    optimizeDeps: { exclude: ['mupdf'] },
    worker: { format: 'es' },
    build: { target: 'esnext', chunkSizeWarningLimit: 4096 }
  }
})
