import { Capacitor, registerPlugin } from '@capacitor/core'

/** True inside the Android / iOS app (Capacitor), false in a browser / PWA. */
export const isNative = () => Capacitor.isNativePlatform()
export const platform = () => Capacitor.getPlatform() as 'android' | 'ios' | 'web'

export const APP_VERSION = '1.1.0'
export { APP_PUBLIC_URL } from './appUrl'
export const ANDROID_APK_URL = 'https://github.com/moulisankar999/foreign-worker-manager/releases/latest/download/FW-Manager.apk'

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1] || '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(blob)
  })
}

/** Save a file into the app cache and open the phone's share sheet (save to Files/Drive, WhatsApp, email…). */
export async function shareFile(filename: string, blob: Blob) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const safe = filename.replace(/[^\w.\-]+/g, '_')
  const res = await Filesystem.writeFile({ path: `share/${safe}`, data: await blobToBase64(blob), directory: Directory.Cache, recursive: true })
  try {
    await Share.share({ title: safe, files: [res.uri], dialogTitle: 'Save or send file' })
  } catch (e) {
    if (!/cancel/i.test(String((e as Error)?.message))) throw e
  }
}

/** Open an https link (e.g. a document attachment) in the in-app browser. */
export async function openExternal(url: string) {
  const { Browser } = await import('@capacitor/browser')
  await Browser.open({ url })
}

interface WebPrintPlugin { print(o: { name: string }): Promise<void> }
const WebPrint = registerPlugin<WebPrintPlugin>('WebPrint')

/** Print the current screen. Android app: system print dialog (printer or "Save as PDF"). */
export async function printPage(name = 'FW Manager') {
  if (platform() === 'android') {
    try { await WebPrint.print({ name }); return } catch (e) { alert('Printing is not available: ' + (e as Error).message); return }
  }
  window.print()
}
