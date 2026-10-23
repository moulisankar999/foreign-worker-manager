import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.moulisankar.fwmanager',
  appName: 'FW Manager',
  webDir: 'dist-native',
  backgroundColor: '#f6f7f9',
  android: { allowMixedContent: false },
  plugins: {
    LocalNotifications: { smallIcon: 'ic_stat_fwm', iconColor: '#0f766e' },
  },
}

export default config
