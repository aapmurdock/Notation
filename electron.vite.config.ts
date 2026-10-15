import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { developmentCsp } from './config/development-csp.ts'

export default defineConfig({
  main: { build: { externalizeDeps: true } },
  preload: {
    build: {
      externalizeDeps: true,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    plugins: [react(), developmentCsp()],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
})
