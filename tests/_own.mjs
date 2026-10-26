// TEST is shared with other work: a suite only ever deletes what IT created.
// Its users are recognised by the suite's own e-mail prefix; its records, requests, documents, notifications and
// tracker rows by those users' ids; its fixed fixture ids carry a per-run suffix (rid('O1') → 'O1-<run>').
export const RUN = Date.now().toString(36)
export const rid = (base) => `${base}-${RUN}`

async function listAll(admin) {
  const out = []
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    out.push(...data.users)
    if (data.users.length < 1000) break
  }
  return out
}

// Delete only the users whose e-mail starts with `prefix` (plus everything they created), and records whose id ends with this run's suffix.
export async function cleanupOwn(admin, prefix, { keepIds = [] } = {}) {
  const users = (await listAll(admin)).filter((u) => (u.email || '').startsWith(prefix) && /@example\.com$/.test(u.email) && !keepIds.includes(u.id))
  // accounts the app deleted (soft-deleted auth user: e-mail/phone scrambled, profile kept as a tombstone) are found by the profile's e-mail
  const tomb = ((await admin.from('profiles').select('id, email').like('email', `${prefix}%@example.com`)).data || []).filter((p) => !keepIds.includes(p.id) && !users.some((u) => u.id === p.id))
  users.push(...tomb.map((p) => ({ id: p.id })))
  const ids = users.map((u) => u.id)
  const del = async (t, f) => { try { await f(admin.from(t).delete()) } catch { /* table may not exist on this branch */ } }
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const reqIds = ((await admin.from('requests').select('id').in('created_by', chunk)).data || []).map((r) => r.id)
    if (reqIds.length) { await del('notification_deliveries', (q) => q.in('event_id', [-1])); await del('notification_events', (q) => q.in('request_id', reqIds)) }
    await del('notification_deliveries', (q) => q.in('user_id', chunk))
    await del('notification_events', (q) => q.in('actor', chunk))
    await del('documents', (q) => q.in('uploaded_by', chunk))
    await del('hr_tasks', (q) => q.in('created_by', chunk))
    await del('requests', (q) => q.in('created_by', chunk))
    await del('pdpa_breaches', (q) => q.in('created_by', chunk))
    await del('grievance_links', (q) => q.in('updated_by', chunk))
    await del('grievances', (q) => q.in('updated_by', chunk))
    await del('records', (q) => q.in('updated_by', chunk))
  }
  await del('records', (q) => q.like('id', `%-${RUN}`))
  await del('grievances', (q) => q.like('outlet_id', `%-${RUN}`))
  await del('hr_tasks', (q) => q.like('worker_id', `%-${RUN}`))
  await del('notification_events', (q) => q.like('worker_id', `%-${RUN}`))
  for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {})
  for (let i = 0; i < ids.length; i += 100) await del('profiles', (q) => q.in('id', ids.slice(i, i + 100)))
  return ids.length
}

// The suite's own CEO: set directly (other work's users may already exist, so "first sign-up becomes CEO" cannot be relied on).
export async function makeCeo(admin, id) {
  const { error } = await admin.from('profiles').update({ role: 'super_admin', status: 'active' }).eq('id', id)
  if (error) throw error
}

// Settings a suite changes are put back afterwards so other work on TEST keeps its configuration.
export async function keepConfig(admin, keys) {
  const { data } = await admin.from('app_config').select('key,value').in('key', keys)
  const saved = data || []
  return async () => { for (const k of keys) { const row = saved.find((r) => r.key === k); if (row) await admin.from('app_config').upsert(row); else await admin.from('app_config').delete().eq('key', k) } }
}

// "last CEO" guard on a shared TEST project: inside ONE transaction that is always rolled back, make the suite's CEO
// the only CEO, then try the change as that user. Nothing is kept. Returns 'refused:<msg>' or 'updated:<n>'.
export async function soleCeoProbe(ref, sid, setClause) {
  const { execSync } = await import('node:child_process'); const fs = await import('node:fs')
  if (!/^[0-9a-f-]{36}$/.test(sid) || !/^[a-z_]+ = '[a-z_]+'$/.test(setClause) || !/^[a-z]{20}$/.test(ref)) throw new Error('bad probe args')
  const f = `/tmp/fw-soleceo-${RUN}-${Math.random().toString(36).slice(2)}.sql`
  fs.writeFileSync(f, `do $$ declare res text; n int; begin
  update public.profiles set role = 'viewer' where role in ('super_admin','admin') and id <> '${sid}' and coalesce(status, '') <> 'deleted';
  perform set_config('request.jwt.claims', json_build_object('sub','${sid}','role','authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.profiles set ${setClause} where id = '${sid}';
    get diagnostics n = row_count; res := 'updated:' || n;
  exception when others then res := 'refused:' || sqlerrm; end;
  raise exception 'FWM_RESULT[%]', res;
end $$;`)
  try { const out = execSync(`/workspace/tools/q.sh ${ref} ${f}`, { encoding: 'utf8' }); return (/FWM_RESULT\[(.*?)\]/.exec(out) || [, 'no result: ' + out.slice(0, 200)])[1] }
  finally { fs.rmSync(f, { force: true }) }
}

// add list items (companies, hostels…) to an app_config { items: [...] } key WITHOUT removing or renaming anything that is
// already there; the returned undo re-reads the live list and removes only the items this call added (and puts back
// the original logo of any item it found, since tests set/clear logos on 'main').
export async function addItems(admin, key, items) {
  const read = async () => (await admin.from('app_config').select('value').eq('key', key).maybeSingle()).data?.value
  const v = (await read()) || { items: [] }, have = v.items || []
  const added = items.filter((i) => !have.some((h) => h.id === i.id)).map((i) => i.id)
  const kept = Object.fromEntries(have.filter((h) => items.some((i) => i.id === h.id)).map((h) => [h.id, h.logo]))
  if (added.length) await admin.from('app_config').upsert({ key, value: { ...v, items: [...have, ...items.filter((i) => added.includes(i.id))] } })
  return async () => {
    const cur = (await read()) || { items: [] }
    const next = (cur.items || []).filter((i) => !added.includes(i.id)).map((i) => (i.id in kept ? (kept[i.id] === undefined ? (({ logo, ...r }) => r)(i) : { ...i, logo: kept[i.id] }) : i))
    await admin.from('app_config').update({ value: { ...cur, items: next } }).eq('key', key)
  }
}
