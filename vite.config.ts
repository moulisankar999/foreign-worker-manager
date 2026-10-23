import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Two builds from the same code:
//  - default (`npm run build`): web app at VITE_BASE (default / for the custom domain https://fw.sunrisebayumas.com;
//    use VITE_BASE=/foreign-worker-manager/ to serve from the github.io project path instead) -> dist/
//  - native (`npm run build:native`): relative paths for the Android/iOS app (Capacitor) -> dist-native/
// The public link used in messages is VITE_APP_PUBLIC_URL (see src/lib/platform.ts).
const withSlash = (b: string) => (b.startsWith('/') ? b : '/' + b).replace(/\/?$/, '/')
export default defineConfig(({ mode }) => ({
  base: mode === 'native' ? './' : withSlash(loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE || process.env.VITE_BASE || '/'),
  build: mode === 'native' ? { outDir: 'dist-native' } : undefined,
  plugins: [react()],
  preview: { port: 4180, host: true },
}))
