import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { developmentCsp } from './config/development-csp.ts'

// Browser-only harness for renderer tests. The desktop app uses electron.vite.config.ts.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), developmentCsp()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
})
