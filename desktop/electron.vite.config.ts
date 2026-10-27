import { resolve } from 'node:path'

import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    // Bundle zod (shared protocol schemas) so the packaged app needs no
    // node_modules at runtime; package.json excludes them from app.asar.
    build: {
      externalizeDeps: { exclude: ['zod', 'electron-updater'] },
      rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') },
    },
  },
  preload: {
    // Sandboxed preload scripts can only load Electron's built-in bridge APIs.
    // Keep zod in the bundle instead of emitting a require() call that the
    // sandbox cannot resolve.
    build: {
      externalizeDeps: { exclude: ['zod'] },
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        output: { format: 'cjs', entryFileNames: 'index.js' },
      },
    },
  },
  renderer: {
    worker: { format: 'es' },
    build: {
      // electron-vite leaves output unminified by default; minifying halves the
      // JavaScript Chromium has to parse before the first paint.
      minify: 'esbuild',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
  },
})
