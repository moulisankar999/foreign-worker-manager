-- 019: demo company for Apple's TestFlight review + scoped users only see their own companies / outlets.
-- Additive: new functions and RESTRICTIVE policies (existing policies untouched); three functions re-created
-- (pull_records, notify, notify_digest) with one extra condition each. No data is changed or deleted.

-- ---------------------------------------------------------------- demo company
-- The demo company (id demo-apple, or any company with "demo": true in Settings → Companies) is kept out of the
-- CEO / GM / HR totals, alerts and reports. Only people scoped to it (the reviewer's Outlet Manager login) see it.
create or replace function public.is_demo_company(c text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(c = 'demo-apple' or exists (select 1 from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e
    where e->>'id' = c and coalesce((e->>'demo')::boolean, false)), false)
$$;
create or replace function public.is_demo_outlet(o text) returns boolean language sql stable security definer set search_path = public as $$
  select o is not null and public.is_demo_company(public.outlet_company(o))
$$;
-- may someone with these companies / outlets hear about this outlet? Demo outlets: only if explicitly in their scope.
create or replace function public.demo_ok(p_companies text[], p_outlets text[], p_outlet text) returns boolean language sql stable security definer set search_path = public as $$
  select p_outlet is null or not public.is_demo_outlet(p_outlet)
    or p_outlet = any(coalesce(p_outlets, '{}')) or public.outlet_company(p_outlet) = any(coalesce(p_companies, '{}'))
$$;
revoke execute on function public.demo_ok(text[], text[], text) from public, anon;
grant execute on function public.is_demo_company(text), public.is_demo_outlet(text) to authenticated;

-- ---------------------------------------------------------------- scoped users: own companies / outlets only
-- outlets (records entity 'outlets'): only those in my scope (CEO / GM / unscoped HR: all)
drop policy if exists "outlets in my scope" on public.records;
create policy "outlets in my scope" on public.records as restrictive for select using (entity <> 'outlets' or public.in_my_scope(id));
-- the company list (app_config 'companies'): everyone unscoped reads it; scoped users get their own via my_company_list()
drop policy if exists "companies unscoped only" on public.app_config;
create policy "companies unscoped only" on public.app_config as restrictive for select using (key <> 'companies' or public.is_unscoped());
create or replace function public.my_company_list() returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_active_user() then jsonb_build_object('items', coalesce((
    select jsonb_agg(e.v order by e.i) from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) with ordinality e(v, i)
    where public.is_unscoped() or e.v->>'id' = any(public.my_companies())
       or exists (select 1 from unnest(public.my_outlets()) o where public.outlet_company(o) = e.v->>'id')), '[]'::jsonb)) end
$$;
revoke execute on function public.my_company_list() from public, anon;
grant execute on function public.my_company_list() to authenticated;

-- sync: outlets outside my scope come down as "deleted" (so they disappear from devices that had them)
CREATE OR REPLACE FUNCTION public.pull_records(p_since timestamp with time zone, p_limit integer DEFAULT 500)
 RETURNS TABLE(entity text, id text, data jsonb, deleted boolean, client_ts timestamp with time zone, server_ts timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select public.my_role() as role, public.can_view_salary() as sal, public.is_unscoped() as allw,
                     public.my_outlets() as outs, public.my_companies() as comps, public.can_view_remittance() as rem)
  select r.entity, r.id,
    case when not v.vis then '{}'::jsonb
         when r.entity = 'workers' and not me.sal and not me.rem then r.data - public.salary_keys() - public.remittance_keys()
         when r.entity = 'workers' and not me.sal then r.data - public.salary_keys()
         when r.entity = 'workers' and not me.rem then r.data - public.remittance_keys()
         else r.data end,
    r.deleted or not v.vis, r.client_ts, r.server_ts
  from public.records r cross join me
  cross join lateral (select case
      when r.entity in ('workers','remarks') then me.allw or coalesce(public.scope_ok(me.role, me.comps, me.outs, public.worker_outlet(r.worker_id)), false)
      when r.entity = 'outlets' then me.allw or coalesce(public.scope_ok(me.role, me.comps, me.outs, r.id), false)
      else true end as vis) v
  where me.role is not null and r.server_ts > p_since
  order by r.server_ts
  limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$function$;

-- notifications: demo outlet → only people scoped to it; never SMS / WhatsApp to demo workers
CREATE OR REPLACE FUNCTION public.notify(p_event text, p_worker text, p_request uuid, p_vars jsonb DEFAULT '{}'::jsonb, p_dedupe text DEFAULT NULL::text, p_users uuid[] DEFAULT NULL::uuid[])
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c jsonb := public.cfg('notifications'); ev jsonb; v jsonb; ev_id bigint; w jsonb; q public.requests; outlet text;
  rec record; ch text; addr text; st text; err text; crit boolean; n int := 0; tokens text[]; app text; link text;
  sender text; wphone text; did bigint; reqopt boolean; lang text; wlang text;
begin
  ev := c->'events'->p_event;
  if ev is null or coalesce((ev->>'enabled')::boolean, true) = false then return null; end if;
  crit := coalesce((ev->>'critical')::boolean, false);
  reqopt := coalesce((c->'whatsapp'->>'requireOptIn')::boolean, true);
  lang := coalesce(nullif(c->'whatsapp'->>'language', ''), 'en');
  if p_worker is not null then select data into w from public.records where entity = 'workers' and id = p_worker; end if;
  if p_request is not null then select * into q from public.requests where id = p_request; end if;
  outlet := coalesce(q.outlet_id, w->>'outletId');
  app := coalesce(nullif(c->>'appUrl', ''), 'https://fw.sunrisebayumas.com/');
  link := app || case when p_request is not null then '#/requests/' || p_request
                      when p_worker is not null then '#/workers/' || p_worker else '#/' end;
  sender := coalesce(nullif(c->>'smsSender', ''), 'FWM');
  v := jsonb_build_object(
    'worker', coalesce(w->>'fullName', ''), 'workerNo', coalesce(w->>'workerNo', ''),
    'outlet', coalesce((select data->>'name' from public.records where entity = 'outlets' and id = outlet), ''),
    'company', coalesce((select data->>'companyName' from public.records where entity = 'settings' and id = 'app'), 'FW Manager'),
    'by', coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), ''),
    'link', link, 'go', case when p_request is not null then 'requests/' || p_request when p_worker is not null then 'workers/' || p_worker else '' end,
    'date', to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    || case when q.id is not null then jsonb_build_object('ref', 'R-' || q.ref_no, 'type', public.request_type_label(q.type), 'status', q.status, 'title', q.title,
         'since', to_char(q.updated_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY'),
         'status_ms', case q.status when 'approved' then 'diluluskan' when 'rejected' then 'ditolak' when 'completed' then 'selesai' when 'cancelled' then 'dibatalkan' else q.status end,
         'reason', coalesce((select e->>'label' from jsonb_array_elements(coalesce(public.cfg('emergency_reasons'), '[]'::jsonb)) e where e->>'key' = q.data->>'reasonKey' limit 1), q.data->>'reasonKey', ''))
       else '{}'::jsonb end
    || coalesce(p_vars, '{}'::jsonb);
  begin
    insert into public.notification_events (event, worker_id, request_id, vars, actor, dedupe_key)
    values (p_event, p_worker, p_request, v, auth.uid(), p_dedupe) returning id into ev_id;
  exception when unique_violation then return null; -- already queued (dedupe)
  end;

  select array(select jsonb_array_elements_text(coalesce(ev->'recipients', '[]'::jsonb))) into tokens;
  for rec in
    select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name, p.email, p.phone, p.notify_optout, p.wa_optin
    from public.profiles p
    where p.status = 'active' and (p.id is distinct from auth.uid() or p_users is not null)
      and (case when p_users is not null then p.id = any(p_users) else (
           (p.role = any(tokens) and p.role <> 'outlet_manager')
        or ('outlet_manager' = any(tokens) and p.role = 'outlet_manager' and outlet is not null and public.scope_ok(p.role, p.company_ids, p.outlet_ids, outlet))
        or ('requester' = any(tokens) and q.created_by = p.id)
        or ('participants' = any(tokens) and q.id is not null and (q.created_by = p.id or p.role = 'hr_manager'
              or exists (select 1 from public.request_events e where e.request_id = q.id and e.by = p.id)))
        or ('user_admins' = any(tokens) and (p.role = 'super_admin' or (p.role = 'general_manager' and public.power_of(p.id, 'users.manage')) or (p.role = 'hr_admin' and public.hr_flag('manageUsers'))))
        or ('approver' = any(tokens) and q.id is not null and (case when q.status = 'escalated' then p.id = any(public.top_approvers(q.type)) else p.role = case q.status when 'submitted' then 'hr_manager' when 'recommended' then 'hr_admin' end end))
      ) end)
      -- company / outlet scope: people only hear about workers they can see
      and (p_users is not null or outlet is null or q.created_by = p.id or public.scope_ok(p.role, p.company_ids, p.outlet_ids, outlet))
      -- demo company (Apple review): only people scoped to it hear about it, never the CEO / GM / HR
      and (p_users is not null or outlet is null or public.demo_ok(p.company_ids, p.outlet_ids, outlet))
  loop
    foreach ch in array array['in_app','push','email','sms','whatsapp'] loop
      if not coalesce((ev->'channels'->>ch)::boolean, false) or not public.notify_chan_on(c, ch) then continue; end if;
      if ch = 'whatsapp' and coalesce(ev->>'wa', '') = '' then continue; end if;
      st := 'queued'; err := null; addr := null;
      if not crit and (p_event || ':' || ch = any(rec.notify_optout) or '*:' || ch = any(rec.notify_optout) or p_event || ':*' = any(rec.notify_optout)) then
        continue; -- personal opt-out (non-critical only)
      end if;
      if ch = 'email' then addr := rec.email; elsif ch in ('sms','whatsapp') then addr := public.e164_my(rec.phone); end if;
      if ch in ('email','sms','whatsapp') and addr is null then st := 'skipped'; err := 'no ' || case when ch = 'email' then 'email' else 'mobile number' end || ' on profile';
      elsif ch = 'whatsapp' and reqopt and not rec.wa_optin then st := 'skipped'; err := 'no WhatsApp opt-in';
      end if;
      if ch = 'in_app' then st := 'sent'; end if;
      did := null;
      insert into public.notification_deliveries (event_id, event, user_id, recipient, channel, address, title, body, link, critical, status, last_error, sent_at, dedupe_key,
        wa_template, wa_lang, vars, fallback_body)
      values (ev_id, p_event, rec.id, rec.name, ch, addr,
        public.notify_render(ev->>'title', v),
        case when ch in ('sms','whatsapp') then public.notify_sms_text(ev->>'sms', v, sender)
             when ch = 'email' then coalesce(nullif(public.notify_render(ev->>'email', v), ''), public.notify_render(ev->>'title', v))
             else public.notify_render(coalesce(nullif(ev->>'body', ''), ev->>'title'), v) end,
        link, crit, st, err, case when st = 'sent' then now() end,
        case when p_dedupe is not null then p_dedupe || '|' || rec.id || '|' || ch end,
        case when ch = 'whatsapp' then ev->>'wa' end, case when ch = 'whatsapp' then lang end, case when ch = 'whatsapp' then v end,
        case when ch = 'whatsapp' and coalesce(ev->>'sms', '') <> '' then public.notify_sms_text(ev->>'sms', v, sender) end)
      on conflict (dedupe_key) do nothing returning id into did;
      if did is not null and ch = 'whatsapp' and err = 'no WhatsApp opt-in' then perform public.notify_fallback(did, 'no_whatsapp'); end if;
      n := n + 1;
    end loop;
  end loop;

  -- the worker himself (phone in the worker record): WhatsApp template if opted in, else SMS fallback / SMS if enabled
  if p_worker is not null and not public.is_demo_outlet(outlet) then
    wphone := public.e164_my(w->>'phoneMY');
    if coalesce((ev->'worker'->>'whatsapp')::boolean, false) and coalesce(ev->>'workerWa', '') <> '' and public.notify_chan_on(c, 'whatsapp') then
      wlang := coalesce(nullif(w->>'waLang', ''), nullif(c->'whatsapp'->>'workerLanguage', ''), 'en');
      st := case when wphone is null or (reqopt and not coalesce((w->>'waOptIn')::boolean, false)) then 'skipped' else 'queued' end;
      did := null;
      insert into public.notification_deliveries (event_id, event, recipient, channel, address, title, body, critical, status, last_error, dedupe_key, wa_template, wa_lang, vars, fallback_body)
      values (ev_id, p_event, 'Worker ' || coalesce(w->>'workerNo', ''), 'whatsapp', wphone, public.notify_render(ev->>'title', v),
        public.notify_sms_text(ev->>'workerSms', v, sender), crit, st,
        case when wphone is null then 'no mobile number on worker record' when st = 'skipped' then 'no WhatsApp opt-in' end,
        case when p_dedupe is not null then p_dedupe || '|worker|whatsapp' end, ev->>'workerWa', wlang, v,
        case when coalesce(ev->>'workerSms', '') <> '' then public.notify_sms_text(ev->>'workerSms', v, sender) end)
      on conflict (dedupe_key) do nothing returning id into did;
      if did is not null and st = 'skipped' and wphone is not null then perform public.notify_fallback(did, 'no_whatsapp'); end if;
      n := n + 1;
    end if;
    if coalesce((ev->'worker'->>'sms')::boolean, false) and coalesce(ev->>'workerSms', '') <> '' and public.notify_chan_on(c, 'sms') then
      insert into public.notification_deliveries (event_id, event, recipient, channel, address, title, body, critical, status, last_error, dedupe_key)
      values (ev_id, p_event, 'Worker ' || coalesce(w->>'workerNo', ''), 'sms', wphone, public.notify_render(ev->>'title', v),
        public.notify_sms_text(ev->>'workerSms', v, sender), crit,
        case when wphone is null then 'skipped' else 'queued' end, case when wphone is null then 'no mobile number on worker record' end,
        case when p_dedupe is not null then p_dedupe || '|worker|sms' end)
      on conflict (dedupe_key) do nothing;
      n := n + 1;
    end if;
  end if;
  update public.notification_events set recipients = n where id = ev_id;
  return ev_id;
end $function$;

CREATE OR REPLACE FUNCTION public.notify_digest(p_day date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p record; body text; ev jsonb := public.cfg('notifications')->'events'->'daily_digest'; mine int; exp int; soon int; cons int; outp int; outs text[]; staff boolean;
begin
  if ev is null or not coalesce((ev->>'enabled')::boolean, true) or not (coalesce((ev->'channels'->>'email')::boolean, false) or coalesce((ev->'channels'->>'whatsapp')::boolean, false)) then return; end if;
  for p in select * from public.profiles where status = 'active' and (email is not null or phone is not null) loop
    staff := p.role in ('super_admin','general_manager','hr_admin','hr_manager','viewer');
    outs := p.outlet_ids;
    select count(*) into mine from public.requests q where
      ((p.role = 'hr_manager' and q.status = 'submitted') or (p.role = 'hr_admin' and q.status = 'recommended')
      or (q.status = 'escalated' and p.id = any(public.top_approvers(q.type))) or (q.created_by = p.id and q.status = 'returned')
      or (p.role = 'hr_manager' and q.status = 'approved'))
      and (q.created_by = p.id or public.scope_ok(p.role, p.company_ids, p.outlet_ids, q.outlet_id))
      and public.demo_ok(p.company_ids, p.outlet_ids, q.outlet_id);
    select count(*) filter (where (d->>'expiryDate')::date < p_day), count(*) filter (where (d->>'expiryDate')::date between p_day and p_day + 30)
      into exp, soon
    from public.records w cross join lateral jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) d
    where w.entity = 'workers' and not w.deleted and coalesce(d->>'expiryDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(w.data->>'status', '') not in ('Absconded','Resigned','Terminated','Contract Ended','Repatriated')
      and public.scope_ok(p.role, p.company_ids, p.outlet_ids, w.data->>'outletId') and public.demo_ok(p.company_ids, p.outlet_ids, w.data->>'outletId');
    select count(*) filter (where data->'passportSafe'->>'consent' in ('pending','uploaded')),
           count(*) filter (where data->'passportSafe'->>'custody' = 'released')
      into cons, outp from public.records w
      where entity = 'workers' and not deleted and public.scope_ok(p.role, p.company_ids, p.outlet_ids, w.data->>'outletId') and public.demo_ok(p.company_ids, p.outlet_ids, w.data->>'outletId');
    if mine + exp + soon + cons + outp = 0 then continue; end if;
    body := 'Requests needing your action: ' || mine || E'\n' || 'Documents expired: ' || exp || E'\n' || 'Documents expiring in 30 days: ' || soon
      || E'\n' || 'Passport consents pending: ' || cons || E'\n' || 'Passports out of the safe: ' || outp;
    perform public.notify('daily_digest', null, null, jsonb_build_object('count', mine::text, 'soon', soon::text, 'expired', exp::text, 'date', to_char(p_day, 'DD Mon YYYY'), 'digest', body), 'digest:' || p_day || ':' || p.id, array[p.id]);
  end loop;
end $function$;
