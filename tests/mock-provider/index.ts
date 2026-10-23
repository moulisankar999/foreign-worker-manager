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
  return new Response('not found', { status: 404 })
})
