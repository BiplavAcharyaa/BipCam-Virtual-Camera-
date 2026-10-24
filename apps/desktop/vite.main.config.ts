import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist/main'),
    emptyOutDir: true,
    lib: {
      entry: {
        main: resolve(__dirname, 'src/main/main.ts'),
        preload: resolve(__dirname, 'src/main/preload.ts')
      },
      formats: ['cjs'],
      fileName: (_format, entryName) => `${entryName}.js`
    },
    rollupOptions: {
      external: [
        'electron',
        'node:fs',
        'node:path',
        'node:os',
        'node:http',
        'node:https',
        'node:net',
        'node:child_process',
        'node:crypto',
        'node:url',
        'ws',
        'selfsigned'
      ]
    }
  }
})
