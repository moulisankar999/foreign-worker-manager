// whatsapp-webhook: Meta WhatsApp Cloud API webhook (delivery receipts + inbound replies).
// Callback URL: https://<project>.supabase.co/functions/v1/whatsapp-webhook   (deploy with --no-verify-jwt)
// Secrets: WA_VERIFY_TOKEN (any random string you also type into Meta's webhook form), WA_APP_SECRET (Meta app secret).
// GET  = Meta's verification handshake (hub.mode / hub.verify_token / hub.challenge)
// POST = events, accepted only with a valid X-Hub-Signature-256 (HMAC-SHA256 of the raw body with WA_APP_SECRET)
import { createClient } from 'npm:@supabase/supabase-js@2'

const env = (k: string) => (Deno.env.get(k) || '').trim()

async function validSignature(raw: string, header: string | null) {
  const secret = env('WA_APP_SECRET')
  if (!secret || !header?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  const got = header.slice(7).toLowerCase()
  if (got.length !== hex.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i) // constant time
  return diff === 0
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && !!env('WA_VERIFY_TOKEN') && url.searchParams.get('hub.verify_token') === env('WA_VERIFY_TOKEN')
    return ok ? new Response(url.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('Forbidden', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  if (!(await validSignature(raw, req.headers.get('x-hub-signature-256')))) return new Response('Invalid signature', { status: 401 })
  let body: any
  try { body = JSON.parse(raw) } catch { return new Response('Bad JSON', { status: 400 }) }
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  const out = { statuses: 0, messages: 0 }
  for (const entry of body?.entry || []) {
    for (const ch of entry?.changes || []) {
      const v = ch?.value || {}
      for (const s of v.statuses || []) {
        const err = (s.errors || []).map((e: any) => `${e.code || ''} ${e.title || ''} ${e.error_data?.details || ''}`.trim()).join('; ')
        await db.rpc('wa_status_update', { p_wamid: s.id, p_status: s.status, p_error: err ? 'WhatsApp: ' + err : null })
        out.statuses++
      }
      const names: Record<string, string> = {}
      for (const c of v.contacts || []) names[c.wa_id] = c.profile?.name || ''
      for (const m of v.messages || []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type}]`
        await db.rpc('wa_inbound_log', { p_wamid: m.id, p_from: m.from, p_name: names[m.from] || null, p_type: m.type, p_text: text, p_context: m.context?.id || null, p_payload: m })
        out.messages++
      }
    }
  }
  return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
