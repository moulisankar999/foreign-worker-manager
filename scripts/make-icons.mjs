// Generates native app icons/splash sources (assets/) and the Android notification icon from public/icon.svg
import sharp from 'sharp'
import fs from 'node:fs'
const glyph = `<circle cx="256" cy="190" r="78" fill="#fff"/><path d="M116 410c10-80 70-130 140-130s130 50 140 130" fill="#fff"/><circle cx="380" cy="130" r="54" fill="#f59e0b"/><path d="M380 100v34M380 150v6" stroke="#fff" stroke-width="16" stroke-linecap="round"/>`
const svg = (inner, bg = '') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${inner}</svg>`)
const out = (p, buf, size) => sharp(buf, { density: 600 }).resize(size, size).png().toFile(p)
fs.mkdirSync('assets', { recursive: true })
await out('assets/icon-only.png', svg(glyph, '<rect width="512" height="512" fill="#0f766e"/>'), 1024)
await out('assets/icon-foreground.png', svg(`<g transform="translate(256 256) scale(.62) translate(-256 -270)">${glyph}</g>`), 1024)
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#0f766e' } }).png().toFile('assets/icon-background.png')
const splash = await sharp(svg(`<g transform="translate(256 256) scale(.3) translate(-256 -256)"><rect width="512" height="512" rx="112" fill="#0f766e"/>${glyph}</g>`), { density: 1200 }).resize(2732, 2732).png().toBuffer()
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#f6f7f9' } }).composite([{ input: splash }]).png().toFile('assets/splash.png')
await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#0b1f1d' } }).composite([{ input: splash }]).png().toFile('assets/splash-dark.png')
// Android status-bar notification icon: white silhouette on transparent
const mono = svg(`<circle cx="256" cy="190" r="90" fill="#fff"/><path d="M96 430c10-90 80-145 160-145s150 55 160 145z" fill="#fff"/>`)
const res = 'android/app/src/main/res'
for (const [d, s] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]) {
  fs.mkdirSync(`${res}/drawable-${d}`, { recursive: true })
  await out(`${res}/drawable-${d}/ic_stat_fwm.png`, mono, s)
}
console.log('icons done')
