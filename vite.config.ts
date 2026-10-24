import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const PKG_VERSION: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const BUILT = new Date().toISOString()
// public version.json (version + build time only) — read by the CEO health monitor to confirm what the website serves
const versionFile = () => ({ name: 'fwm-version-json', generateBundle(this: { emitFile: (f: { type: 'asset'; fileName: string; source: string }) => void }) {
  this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ app: 'FW Manager', version: PKG_VERSION, built: BUILT }) + '\n' })
} })

// Two builds from the same code:
//  - default (`npm run build`): web app at VITE_BASE (default / for the custom domain https://fw.sunrisebayumas.com;
//    use VITE_BASE=/foreign-worker-manager/ to serve from the github.io project path instead) -> dist/
//  - native (`npm run build:native`): relative paths for the Android/iOS app (Capacitor) -> dist-native/
// The public link used in messages is VITE_APP_PUBLIC_URL (see src/lib/platform.ts).
const withSlash = (b: string) => (b.startsWith('/') ? b : '/' + b).replace(/\/?$/, '/')
export default defineConfig(({ mode }) => ({
  base: mode === 'native' ? './' : withSlash(loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE || process.env.VITE_BASE || '/'),
  build: mode === 'native' ? { outDir: 'dist-native' } : undefined,
  define: { __BUILD_TIME__: JSON.stringify(BUILT) },
  plugins: [react(), versionFile()],
  preview: { port: 4180, host: true },
}))
