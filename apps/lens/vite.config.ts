import { defineConfig } from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  server: { host: true, port: 5173 },
  build: { target: 'esnext', outDir: 'dist', emptyOutDir: true },
})
