import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/foreign-worker-manager/',
  plugins: [react()],
  preview: { port: 4180, host: true },
})
