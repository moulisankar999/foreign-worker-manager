// TEST only: Settings → Remove sample data, as the CEO, through the real UI. Usage: UI_URL=http://localhost:4195/ node tests/sample-remove-ui.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
const { chromium } = createRequire((process.env.PW_PKG || '/workspace/tools/pw') + '/package.json')('playwright')
const UI = process.env.UI_URL, cred = JSON.parse(fs.readFileSync('/tmp/qseed-users.json', 'utf8'))
if (!/localhost/.test(UI)) throw new Error('local TEST build only')
const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await p.goto(UI); await p.fill('#em', cred.users.ceo); await p.fill('#pw', cred.pw); await p.locator('form button[type=submit]').first().click(); await p.waitForTimeout(6000)
await p.goto(UI + '#/settings/data'); await p.waitForTimeout(3000)
await p.getByRole('button', { name: 'Remove sample data…' }).first().click(); await p.getByTestId('sample-preview').waitFor({ timeout: 30000 })
console.log('preview:', (await p.getByTestId('sample-preview').innerText()).replace(/\s+/g, ' ').slice(0, 900))
await p.screenshot({ path: '/workspace/screens-142/remove-sample-preview.png' })
await p.fill('#sample-confirm', 'REMOVE'); await p.getByRole('button', { name: 'Remove sample data', exact: true }).last().click()
await p.getByText(/Removed the sample data/).first().waitFor({ timeout: 120000 })
console.log('result:', await p.getByText(/Removed the sample data/).first().innerText())
await b.close()
