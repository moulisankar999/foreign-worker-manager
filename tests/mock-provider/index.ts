// TEST PROJECT ONLY — fake SMS/email provider for automated tests. Never deploy to the live project.
// Deployed by tests/deploy-test-functions.sh (which refuses the live project ref).
// Mimics OneWaySMS (GET /sms?apiusername=…&mobileno=…&message=… → "<mtid>") and Brevo (POST /email → {messageId}).
// Every call is logged into public.mock_provider_log (test project only) so tests can assert what would have been sent.
import { createClient } from 'npm:@supabase/supabase-js@2'
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
Deno.serve(async (req) => {
  const u = new URL(req.url)
  const path = u.pathname.replace(/^.*mock-provider/, '') || '/'
  const body = req.method === 'POST' ? await req.text() : ''
  const q = Object.fromEntries(u.searchParams)
  await db.from('mock_provider_log').insert({ method: req.method, path, query: q, body, has_key: !!req.headers.get('api-key') })
  if (path.startsWith('/sms')) {
    if (q.apipassword !== 'mock-pass') return new Response('-100')
    if (/https?:|www\./i.test(q.message || '')) return new Response('-500') // emulate carrier URL block
    return new Response(String(100000 + Math.floor(Math.random() * 899999)))
  }
  if (path.startsWith('/email')) {
    if (req.headers.get('api-key') !== 'mock-brevo-key') return new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 })
    return new Response(JSON.stringify({ messageId: '<mock-' + crypto.randomUUID() + '@mock>' }), { status: 201, headers: { 'Content-Type': 'application/json' } })
  }
  // Meta Graph API (WhatsApp Cloud API): /graph/{ver}/{phone_id}/messages and /graph/{ver}/{waba}/message_templates
  if (path.startsWith('/graph/')) {
    const J = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    if (req.headers.get('authorization') !== 'Bearer mock-wa-token') return J({ error: { code: 190, message: 'Invalid OAuth access token' } }, 401)
    if (path.endsWith('/messages')) {
      const m = JSON.parse(body || '{}')
      if (String(m.to).endsWith('0000')) return J({ error: { code: 131026, message: 'Message undeliverable' } }, 400) // "not on WhatsApp"
      return J({ messaging_product: 'whatsapp', contacts: [{ input: m.to, wa_id: m.to }], messages: [{ id: 'wamid.MOCK' + crypto.randomUUID().replaceAll('-', ''), message_status: 'accepted' }] })
    }
    if (path.endsWith('/message_templates')) {
      if (req.method === 'POST') return J({ id: String(Date.now()), status: 'PENDING', category: 'UTILITY' })
      return J({ data: [{ name: 'hello_world', language: 'en_US', status: 'APPROVED', category: 'UTILITY', id: '1' }, { name: 'fwm_ticket_ready', language: 'en', status: 'APPROVED', category: 'UTILITY', id: '2' }] })
    }
  }
  return new Response('not found', { status: 404 })
})
