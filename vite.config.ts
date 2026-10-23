import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Two builds from the same code:
//  - default (`npm run build`): GitHub Pages web app at /foreign-worker-manager/ -> dist/
//  - native (`npm run build:native`): relative paths for the Android/iOS app (Capacitor) -> dist-native/
export default defineConfig(({ mode }) => ({
  base: mode === 'native' ? './' : '/foreign-worker-manager/',
  build: mode === 'native' ? { outDir: 'dist-native' } : undefined,
  plugins: [react()],
  preview: { port: 4180, host: true },
}))
