import type { CapacitorConfig } from '@capacitor/cli'

// FW Worker native app (Android / iOS). Run Capacitor commands from this folder, e.g. `npm run worker:cap:sync`.
const config: CapacitorConfig = {
  appId: 'com.moulisankar.fwworker',
  appName: 'FW Worker',
  webDir: '../dist-worker-native',
  backgroundColor: '#f8fafc',
  android: { allowMixedContent: false },
}

export default config
