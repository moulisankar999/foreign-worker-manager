import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// FW Worker: a second, separate app (worker self-service) built from worker/index.html + src/worker.
// Web:    npm run build:worker         → dist-worker/        (served at VITE_WORKER_BASE, default /worker/)
// Native: npm run build:worker:native  → dist-worker-native/ (Capacitor, relative paths)
const root = fileURLToPath(new URL('.', import.meta.url))
export default defineConfig(({ mode }) => {
  const native = mode === 'native'
  return {
    root: fileURLToPath(new URL('./worker', import.meta.url)),
    envDir: root,
    publicDir: 'public',
    base: native ? './' : process.env.VITE_WORKER_BASE || '/worker/',
    plugins: [react()],
    server: { port: 5174, fs: { allow: [root] } },
    preview: { port: 4181, host: true },
    build: { outDir: native ? '../dist-worker-native' : '../dist-worker', emptyOutDir: true },
  }
})
