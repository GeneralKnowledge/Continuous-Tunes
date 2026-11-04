/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // @strudel/web (~650 kB) is its own lazily loaded chunk, fetched on first Play.
    // CMUdict (~3.9 MB, ~1 MB gzipped) is another, fetched the first time the Speech tab opens.
    chunkSizeWarningLimit: 4000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // pink-trombone-mod ships ESM with extensionless relative imports, which Node's own loader
    // rejects; let Vite transform it like source.
    server: { deps: { inline: ['pink-trombone-mod'] } },
  },
})
