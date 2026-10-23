-- 004: Notifications framework (outbox + deliveries + in-app inbox). Additive only.
-- Events are queued by DB triggers / sweeps; the 'notify-dispatch' Edge Function sends push / email / SMS.
-- Provider keys live ONLY in Supabase function secrets. No provider configured → delivery is marked 'skipped'.
begin;

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists notify_optout text[] not null default '{}';

insert into public.app_config (key, value) values ('notifications', '{"appUrl":"https://moulisankar999.github.io/foreign-worker-manager/","smsSender":"FWM","email":{"fromName":"FW Manager","fromEmail":""},"quietHours":{"enabled":true,"start":"22:00","end":"07:00"},"digest":{"enabled":true,"time":"08:00"},"rateLimitPerHour":{"sms":6,"email":30,"whatsapp":6},"costs":{"sms":0.115,"email":0.002,"whatsapp":0.15},"events":{"request_submitted":{"label":"Request submitted","group":"Requests","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{ref}} {{type}} for {{worker}}","sms":"New {{type}} request {{ref}} for worker {{workerNo}}. Please open FW Manager app."},"request_returned":{"label":"Returned for more info","group":"Requests","critical":false,"enabled":true,"recipients":["requester"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{ref}} returned: more info needed","sms":"Request {{ref}} returned for more info. Please open FW Manager app."},"request_recommended":{"label":"Recommended (waiting HR Admin)","group":"Requests","critical":false,"enabled":true,"recipients":["hr_admin"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{ref}} {{type}} waiting for your approval","sms":"Request {{ref}} ({{type}}) waiting for your approval. Please open FW Manager app."},"request_escalated":{"label":"Escalated to Super Admin","group":"Requests","critical":false,"enabled":true,"recipients":["super_admin"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{ref}} {{type}} escalated to you","sms":"Request {{ref}} ({{type}}) escalated for your approval. Please open FW Manager app."},"request_approved":{"label":"Approved","group":"Requests","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{ref}} {{type}} approved","sms":"Request {{ref}} ({{type}}) approved. Please open FW Manager app."},"request_rejected":{"label":"Rejected","group":"Requests","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{ref}} {{type}} rejected","sms":"Request {{ref}} ({{type}}) rejected. Please open FW Manager app."},"request_completed":{"label":"Applied / closed","group":"Requests","critical":false,"enabled":true,"recipients":["requester"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{ref}} {{type}} completed","sms":"Request {{ref}} ({{type}}) completed. Please open FW Manager app."},"request_cancelled":{"label":"Cancelled by requester","group":"Requests","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true},"worker":{},"title":"{{ref}} {{type}} cancelled","sms":"Request {{ref}} cancelled."},"comment_added":{"label":"Comment on a request","group":"Requests","critical":false,"enabled":true,"recipients":["participants"],"channels":{"in_app":true,"push":true},"worker":{},"title":"New comment on {{ref}}","sms":"New comment on request {{ref}}. Please open FW Manager app."},"approval_overdue":{"label":"Approval waiting > 24 h","group":"Requests","critical":true,"enabled":true,"recipients":["approver"],"channels":{"in_app":true,"push":true,"email":true,"sms":true},"worker":{},"title":"⏰ {{ref}} {{type}} waiting over 24 h","sms":"Request {{ref}} ({{type}}) waiting over 24h for your approval. Please open FW Manager app."},"emergency_submitted":{"label":"Emergency leave submitted","group":"Emergency leave","critical":true,"enabled":true,"recipients":["hr_manager","hr_admin"],"channels":{"in_app":true,"push":true,"email":true,"sms":true},"worker":{},"title":"🚨 Emergency leave {{ref}}: {{worker}}","sms":"URGENT emergency leave {{ref}} for worker {{workerNo}}. Please review in FW Manager app."},"emergency_decided":{"label":"Emergency leave decided","group":"Emergency leave","critical":true,"enabled":true,"recipients":["requester","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"sms":true},"worker":{"sms":true},"title":"Emergency leave {{ref}} {{status}}","sms":"Emergency leave {{ref}} for worker {{workerNo}} {{status}}. Please open FW Manager app.","workerSms":"Your emergency leave is {{status}}. Please contact your manager."},"leave_decided":{"label":"Leave decided (worker SMS)","group":"Leave","critical":false,"enabled":true,"recipients":[],"channels":{},"worker":{"sms":true},"title":"Leave {{ref}} {{status}}","sms":"","workerSms":"Your {{type}} is {{status}}. Please contact your manager for details."},"proof_overdue":{"label":"Emergency proof still pending","group":"Emergency leave","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"Proof pending for {{ref}} ({{worker}})","sms":"Emergency leave {{ref}} proof documents overdue. Please upload in FW Manager app."},"ticket_uploaded":{"label":"Flight ticket uploaded","group":"Tickets","critical":true,"enabled":true,"recipients":["outlet_manager","requester"],"channels":{"in_app":true,"push":true,"email":true,"sms":true},"worker":{"sms":true},"title":"✈️ Ticket booked for {{worker}} — download","sms":"Flight ticket for worker {{workerNo}} booked (request {{ref}}). Download in FW Manager app.","workerSms":"Your flight ticket is ready. Please collect it from your manager."},"passport_consent_pending":{"label":"Passport consent pending signature","group":"Passport","critical":false,"enabled":true,"recipients":["outlet_manager","hr_manager"],"channels":{"in_app":true,"email":true},"worker":{},"title":"{{count}} passport consent form(s) pending signature","sms":"Passport safekeeping consent pending for worker {{workerNo}}. Please open FW Manager app."},"passport_consent_uploaded":{"label":"Signed consent uploaded (verify)","group":"Passport","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"Verify passport consent: {{worker}}","sms":"Signed passport consent for worker {{workerNo}} uploaded. Please verify in FW Manager app."},"passport_consent_signed":{"label":"Consent verified","group":"Passport","critical":false,"enabled":true,"recipients":["outlet_manager"],"channels":{"in_app":true},"worker":{},"title":"Passport consent verified: {{worker}}","sms":"Passport consent for worker {{workerNo}} verified."},"passport_release_ready":{"label":"Passport ready for collection","group":"Passport","critical":true,"enabled":true,"recipients":["requester","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"sms":true},"worker":{"sms":true},"title":"Passport of {{worker}} ready for collection","sms":"Passport of worker {{workerNo}} ready for collection (request {{ref}}).","workerSms":"Your passport is ready for collection from HR."},"passport_overdue":{"label":"Passport out of safe past return date","group":"Passport","critical":false,"enabled":true,"recipients":["hr_manager","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"Passport of {{worker}} not returned ({{days}} days late)","sms":"Passport of worker {{workerNo}} is {{days}} day(s) past expected return. Please open FW Manager app."},"doc_expiring":{"label":"Document expiring","group":"Documents","critical":false,"enabled":true,"recipients":["hr_manager","outlet_manager"],"channels":{"in_app":true,"email":true},"worker":{},"title":"{{doc}} of {{worker}} expires in {{days}} days","sms":"{{doc}} of worker {{workerNo}} expires in {{days}} days. Please open FW Manager app."},"doc_expired":{"label":"Document expired","group":"Documents","critical":true,"enabled":true,"recipients":["hr_manager","hr_admin","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"sms":true},"worker":{},"title":"❗ {{doc}} of {{worker}} EXPIRED","sms":"{{doc}} of worker {{workerNo}} EXPIRED on {{date}}. Please act in FW Manager app."},"remark_added":{"label":"Remark added by outlet manager","group":"Workers","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true},"worker":{},"title":"New remark on {{worker}}","sms":"New remark on worker {{workerNo}}. Please open FW Manager app."},"user_awaiting_approval":{"label":"New user awaiting approval","group":"Users","critical":false,"enabled":true,"recipients":["user_admins"],"channels":{"in_app":true,"push":true,"email":true},"worker":{},"title":"{{title}} is waiting for access","sms":"A new user is waiting for access. Please open FW Manager app."},"daily_digest":{"label":"Daily digest","group":"Digest","critical":false,"enabled":true,"recipients":[],"channels":{"email":true},"worker":{},"title":"{{company}} daily summary","sms":""}}}'::jsonb) on conflict (key) do nothing;

create table if not exists public.notification_events (
  id bigint generated always as identity primary key,
  event text not null,
  worker_id text,
  request_id uuid,
  entity text,
  entity_id text,
  vars jsonb not null default '{}'::jsonb,
  actor uuid,
  dedupe_key text unique,
  recipients int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists notification_events_at on public.notification_events (created_at desc);
alter table public.notification_events enable row level security;

create table if not exists public.notification_deliveries (
  id bigint generated always as identity primary key,
  event_id bigint references public.notification_events(id) on delete cascade,
  event text not null,
  user_id uuid,
  recipient text,
  channel text not null check (channel in ('in_app','push','email','sms','whatsapp')),
  address text,
  title text,
  body text,
  link text,
  critical boolean not null default false,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider text,
  provider_id text,
  cost numeric(10,4),
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index if not exists notification_deliveries_queue on public.notification_deliveries (status, next_attempt_at) where status in ('queued','sending');
create index if not exists notification_deliveries_user on public.notification_deliveries (user_id, channel, created_at desc);
alter table public.notification_deliveries enable row level security;

drop policy if exists "events read" on public.notification_events;
create policy "events read" on public.notification_events for select to authenticated using (public.is_super());
drop policy if exists "deliveries read" on public.notification_deliveries;
create policy "deliveries read" on public.notification_deliveries for select to authenticated
  using (public.is_super() or (user_id = auth.uid() and channel = 'in_app'));

-- ---------- helpers ----------
create or replace function public.e164_my(p text) returns text language sql immutable as $$
  select case when d is null or d = '' then null
    when d like '60%' then '+' || d
    when d like '0%' then '+6' || d
    when length(d) between 9 and 10 then '+60' || d
    else '+' || d end
  from (select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') as d) x
$$;

create or replace function public.notify_render(tpl text, vars jsonb) returns text language plpgsql immutable as $$
declare k text; v text; out text := coalesce(tpl, '');
begin
  for k, v in select key, value from jsonb_each_text(coalesce(vars, '{}'::jsonb)) loop
    out := replace(out, '{{' || k || '}}', coalesce(v, ''));
  end loop;
  return trim(regexp_replace(out, '\{\{\s*\w+\s*\}\}', '', 'g'));
end $$;

-- Malaysian carrier rules: RM0 prefix, no URLs, no phone numbers
create or replace function public.notify_sms_text(tpl text, vars jsonb, sender text) returns text language sql immutable as $$
  select left('RM0 ' || coalesce(nullif(trim(sender), ''), 'FWM') || ': ' ||
    trim(regexp_replace(regexp_replace(public.notify_render(tpl, vars - 'link' - 'worker' - 'outlet' - 'by' - 'comment' - 'title'),
      '(https?://\S+|www\.\S+)', '', 'gi'), '\+?\d[\d\s-]{7,}\d', '', 'g')), 306)
$$;

create or replace function public.request_type_label(t text) returns text language sql immutable as $$
  select initcap(replace(coalesce(t, ''), '_', ' '))
$$;

/** Queue one event: resolve recipients (role + outlet), render templates, insert one delivery per recipient x channel. */
create or replace function public.notify(p_event text, p_worker text, p_request uuid, p_vars jsonb default '{}'::jsonb, p_dedupe text default null, p_users uuid[] default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  c jsonb := public.cfg('notifications'); ev jsonb; v jsonb; ev_id bigint; w jsonb; q public.requests; outlet text;
  rec record; ch text; addr text; st text; err text; crit boolean; n int := 0; tokens text[]; app text; link text;
  sender text; wphone text;
begin
  ev := c->'events'->p_event;
  if ev is null or coalesce((ev->>'enabled')::boolean, true) = false then return null; end if;
  crit := coalesce((ev->>'critical')::boolean, false);
  if p_worker is not null then select data into w from public.records where entity = 'workers' and id = p_worker; end if;
  if p_request is not null then select * into q from public.requests where id = p_request; end if;
  outlet := coalesce(q.outlet_id, w->>'outletId');
  app := coalesce(nullif(c->>'appUrl', ''), 'https://moulisankar999.github.io/foreign-worker-manager/');
  link := app || case when p_request is not null then '#/requests/' || p_request
                      when p_worker is not null then '#/workers/' || p_worker else '#/' end;
  sender := coalesce(nullif(c->>'smsSender', ''), 'FWM');
  v := jsonb_build_object(
    'worker', coalesce(w->>'fullName', ''), 'workerNo', coalesce(w->>'workerNo', ''),
    'outlet', coalesce((select data->>'name' from public.records where entity = 'outlets' and id = outlet), ''),
    'company', coalesce((select data->>'companyName' from public.records where entity = 'settings' and id = 'app'), 'FW Manager'),
    'link', link, 'date', to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    || case when q.id is not null then jsonb_build_object('ref', 'R-' || q.ref_no, 'type', public.request_type_label(q.type), 'status', q.status, 'title', q.title) else '{}'::jsonb end
    || coalesce(p_vars, '{}'::jsonb);
  begin
    insert into public.notification_events (event, worker_id, request_id, vars, actor, dedupe_key)
    values (p_event, p_worker, p_request, v, auth.uid(), p_dedupe) returning id into ev_id;
  exception when unique_violation then return null; -- already queued (dedupe)
  end;

  select array(select jsonb_array_elements_text(coalesce(ev->'recipients', '[]'::jsonb))) into tokens;
  for rec in
    select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name, p.email, p.phone, p.notify_optout
    from public.profiles p
    where p.status = 'active' and (p.id is distinct from auth.uid() or p_users is not null)
      and (case when p_users is not null then p.id = any(p_users) else (
           (p.role = any(tokens) and p.role <> 'outlet_manager')
        or ('outlet_manager' = any(tokens) and p.role = 'outlet_manager' and outlet is not null and outlet = any(p.outlet_ids))
        or ('requester' = any(tokens) and q.created_by = p.id)
        or ('participants' = any(tokens) and q.id is not null and (q.created_by = p.id or p.role = 'hr_manager'
              or exists (select 1 from public.request_events e where e.request_id = q.id and e.by = p.id)))
        or ('user_admins' = any(tokens) and (p.role = 'super_admin' or (p.role = 'hr_admin' and public.hr_flag('manageUsers'))))
        or ('approver' = any(tokens) and q.id is not null and p.role = case q.status when 'submitted' then 'hr_manager' when 'recommended' then 'hr_admin' when 'escalated' then 'super_admin' end)
      ) end)
      -- outlet managers only hear about workers in their outlets
      and (p.role <> 'outlet_manager' or outlet is null or outlet = any(p.outlet_ids) or q.created_by = p.id)
  loop
    foreach ch in array array['in_app','push','email','sms','whatsapp'] loop
      if not coalesce((ev->'channels'->>ch)::boolean, false) then continue; end if;
      st := 'queued'; err := null; addr := null;
      if not crit and (p_event || ':' || ch = any(rec.notify_optout) or '*:' || ch = any(rec.notify_optout) or p_event || ':*' = any(rec.notify_optout)) then
        continue; -- personal opt-out (non-critical only)
      end if;
      if ch = 'email' then addr := rec.email; elsif ch in ('sms','whatsapp') then addr := public.e164_my(rec.phone); end if;
      if ch in ('email','sms','whatsapp') and addr is null then st := 'skipped'; err := 'no ' || case when ch = 'email' then 'email' else 'mobile number' end || ' on profile'; end if;
      if ch = 'in_app' then st := 'sent'; end if;
      insert into public.notification_deliveries (event_id, event, user_id, recipient, channel, address, title, body, link, critical, status, last_error, sent_at, dedupe_key)
      values (ev_id, p_event, rec.id, rec.name, ch, addr,
        public.notify_render(ev->>'title', v),
        case when ch in ('sms','whatsapp') then public.notify_sms_text(ev->>'sms', v, sender)
             when ch = 'email' then coalesce(nullif(public.notify_render(ev->>'email', v), ''), public.notify_render(ev->>'title', v))
             else public.notify_render(coalesce(nullif(ev->>'body', ''), ev->>'title'), v) end,
        link, crit, st, err, case when st = 'sent' then now() end,
        case when p_dedupe is not null then p_dedupe || '|' || rec.id || '|' || ch end)
      on conflict (dedupe_key) do nothing;
      n := n + 1;
    end loop;
  end loop;

  -- the worker himself (his own phone in the worker record) — SMS only, short and non-sensitive
  if p_worker is not null and coalesce((ev->'worker'->>'sms')::boolean, false) and coalesce(ev->>'workerSms', '') <> '' then
    wphone := public.e164_my(w->>'phoneMY');
    insert into public.notification_deliveries (event_id, event, recipient, channel, address, title, body, critical, status, last_error, dedupe_key)
    values (ev_id, p_event, 'Worker ' || coalesce(w->>'workerNo', ''), 'sms', wphone, public.notify_render(ev->>'title', v),
      public.notify_sms_text(ev->>'workerSms', v, sender), crit,
      case when wphone is null then 'skipped' else 'queued' end, case when wphone is null then 'no mobile number on worker record' end,
      case when p_dedupe is not null then p_dedupe || '|worker|sms' end)
    on conflict (dedupe_key) do nothing;
    n := n + 1;
  end if;
  update public.notification_events set recipients = n where id = ev_id;
  return ev_id;
end $$;
revoke execute on function public.notify(text, text, uuid, jsonb, text, uuid[]) from public, anon, authenticated;

-- wake the dispatcher right away (async HTTP via pg_net; the cron sweep is the safety net)
create or replace function public.notify_kick() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      execute $q$ select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_functions_url') || '/notify-dispatch',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_cron_secret')),
        body := '{"source":"trigger"}'::jsonb, timeout_milliseconds := 30000)
        where exists (select 1 from vault.decrypted_secrets where name = 'fwm_functions_url') $q$;
    exception when others then null; -- never block the workflow
    end;
  end if;
  return null;
end $$;
drop trigger if exists notification_kick on public.notification_deliveries;
create trigger notification_kick after insert on public.notification_deliveries
  referencing new table as newrows for each statement
  execute function public.notify_kick();
-- only kick when something actually needs sending
create or replace function public.notify_kick_needed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from newrows where status = 'queued') then perform public.notify_kick_call(); end if;
  return null;
end $$;
create or replace function public.notify_kick_call() returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_net') and exists (select 1 from vault.decrypted_secrets where name = 'fwm_functions_url') then
    begin
      execute $q$ select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_functions_url') || '/notify-dispatch',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_cron_secret')),
        body := '{"source":"trigger"}'::jsonb, timeout_milliseconds := 30000) $q$;
    exception when others then null;
    end;
  end if;
end $$;
drop trigger if exists notification_kick on public.notification_deliveries;
create trigger notification_kick after insert on public.notification_deliveries
  referencing new table as newrows for each statement execute function public.notify_kick_needed();
drop function if exists public.notify_kick();

-- ---------- workflow hooks ----------
create or replace function public.request_events_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare q public.requests; e text; k text := 'rev:' || new.id;
begin
  select * into q from public.requests where id = new.request_id;
  e := case new.action
    when 'submit' then case when q.type = 'emergency_leave' then 'emergency_submitted' else 'request_submitted' end
    when 'resubmit' then 'request_submitted'
    when 'return' then 'request_returned'
    when 'reject' then 'request_rejected'
    when 'apply' then 'request_completed'
    when 'cancel' then 'request_cancelled'
    when 'comment' then 'comment_added'
    when 'forward' then case new.to_status when 'recommended' then 'request_recommended' when 'escalated' then 'request_escalated' end
    when 'approve' then case new.to_status when 'approved' then 'request_approved' when 'recommended' then 'request_recommended' when 'escalated' then 'request_escalated' end
  end;
  if e is null then return null; end if;
  if q.type = 'emergency_leave' and e in ('request_approved','request_rejected') then
    perform public.notify('emergency_decided', q.worker_id, q.id, jsonb_build_object('comment', coalesce(new.comment, '')), k || ':em');
  end if;
  if q.type in ('annual_leave','home_leave','medical_leave') and e in ('request_approved','request_rejected') then
    perform public.notify('leave_decided', q.worker_id, q.id, '{}'::jsonb, k || ':leave');
  end if;
  if q.type = 'passport' and e = 'request_approved' then
    perform public.notify('passport_release_ready', q.worker_id, q.id, '{}'::jsonb, k || ':pp');
  end if;
  perform public.notify(e, q.worker_id, q.id, jsonb_build_object('comment', coalesce(new.comment, ''), 'by', coalesce(new.by_name, '')), k);
  return null;
exception when others then
  raise warning 'notify failed: %', sqlerrm; return null; -- notifications never break the workflow
end $$;
drop trigger if exists request_events_notify on public.request_events;
create trigger request_events_notify after insert on public.request_events for each row execute function public.request_events_notify();

create or replace function public.documents_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- HR booked the ticket (routine home leave) → tell the outlet manager / worker it is ready to download.
  -- Emergency tickets are booked by the OM/worker and arrive with the request, so no extra message.
  if new.category = 'Flight ticket' and coalesce((select role from public.profiles where id = new.uploaded_by), '') in ('super_admin','admin','hr_admin','hr_manager') then
    perform public.notify('ticket_uploaded', new.worker_id, new.request_id, jsonb_build_object('doc', new.category), 'doc:' || new.id);
  elsif new.category = 'Passport safekeeping consent' then
    perform public.notify('passport_consent_uploaded', new.worker_id, null, '{}'::jsonb, 'doc:' || new.id);
  end if;
  return null;
exception when others then raise warning 'notify failed: %', sqlerrm; return null;
end $$;
drop trigger if exists documents_notify on public.documents;
create trigger documents_notify after insert on public.documents for each row execute function public.documents_notify();

create or replace function public.records_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entity = 'remarks' and tg_op = 'INSERT' and not new.deleted then
    perform public.notify('remark_added', new.worker_id, null, '{}'::jsonb, 'remark:' || new.id);
  elsif new.entity = 'workers' and tg_op = 'UPDATE'
     and (new.data->'passportSafe'->>'consent') = 'signed' and (old.data->'passportSafe'->>'consent') is distinct from 'signed' then
    perform public.notify('passport_consent_signed', new.id, null, '{}'::jsonb, 'consent-signed:' || new.id || ':' || coalesce(new.data->'passportSafe'->>'verifiedAt', ''));
  end if;
  return null;
exception when others then raise warning 'notify failed: %', sqlerrm; return null;
end $$;
drop trigger if exists records_notify on public.records;
create trigger records_notify after insert or update on public.records for each row execute function public.records_notify();

create or replace function public.profiles_notify() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    perform public.notify('user_awaiting_approval', null, null, jsonb_build_object('title', coalesce(nullif(new.full_name, ''), new.email)), 'newuser:' || new.id);
  end if;
  return null;
exception when others then raise warning 'notify failed: %', sqlerrm; return null;
end $$;
drop trigger if exists profiles_notify on public.profiles;
create trigger profiles_notify after insert on public.profiles for each row execute function public.profiles_notify();

-- ---------- time-based sweep (pg_cron every 5 min; idempotent through dedupe keys) ----------
create or replace function public.notify_sweep() returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  wk text := to_char(today, 'IYYY-IW');
  lead int[]; r record; n int := 0; c jsonb := public.cfg('notifications'); dt text; t time;
begin
  select coalesce(array(select jsonb_array_elements_text(data->'leadTimes')::int), array[90,60,30,7])
    into lead from public.records where entity = 'settings' and id = 'app';
  lead := coalesce(lead, array[90,60,30,7]);
  -- worker documents (passport, permit, FOMEMA, insurance …) of active workers
  for r in
    select w.id, d->>'type' as doc, (d->>'expiryDate')::date as exp, d->>'id' as did
    from public.records w cross join lateral jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) d
    where w.entity = 'workers' and not w.deleted
      and coalesce(w.data->>'status', '') not in ('Absconded','Resigned','Terminated','Contract Ended','Repatriated')
      and coalesce(d->>'expiryDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
  loop
    if r.exp < today then
      if public.notify('doc_expired', r.id, null, jsonb_build_object('doc', r.doc, 'date', r.exp::text), 'expired:' || r.id || ':' || r.did || ':' || wk) is not null then n := n + 1; end if;
    elsif (r.exp - today) = any(lead) then
      if public.notify('doc_expiring', r.id, null, jsonb_build_object('doc', r.doc, 'date', r.exp::text, 'days', (r.exp - today)::text), 'expiring:' || r.id || ':' || r.did || ':' || (r.exp - today)) is not null then n := n + 1; end if;
    end if;
  end loop;
  -- vault documents with expiry
  for r in select id, worker_id, category, expiry_date from public.documents where is_current and not deleted and expiry_date is not null loop
    if r.expiry_date < today then
      perform public.notify('doc_expired', r.worker_id, null, jsonb_build_object('doc', r.category, 'date', r.expiry_date::text), 'vexpired:' || r.id || ':' || wk);
    elsif (r.expiry_date - today) = any(lead) then
      perform public.notify('doc_expiring', r.worker_id, null, jsonb_build_object('doc', r.category, 'date', r.expiry_date::text, 'days', (r.expiry_date - today)::text), 'vexpiring:' || r.id || ':' || (r.expiry_date - today));
    end if;
  end loop;
  -- approvals waiting > 24 h (one reminder per stage per day)
  for r in select id, worker_id, status from public.requests where status in ('submitted','recommended','escalated') and updated_at < now() - interval '24 hours' loop
    if public.notify('approval_overdue', r.worker_id, r.id, '{}'::jsonb, 'overdue:' || r.id || ':' || r.status || ':' || today) is not null then n := n + 1; end if;
  end loop;
  -- emergency leave proof still missing after the grace period (weekly reminder)
  for r in
    select q.id, q.worker_id from public.requests q
    left join lateral (select e from jsonb_array_elements(coalesce(public.cfg('emergency_reasons'), '[]'::jsonb)) e where e->>'key' = q.data->>'reasonKey' limit 1) er on true
    where q.type = 'emergency_leave' and q.status in ('approved','completed')
      and coalesce(q.data->>'from', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and (q.data->>'from')::date + coalesce((er.e->>'proofDays')::int, 14) < today
      and not exists (select 1 from public.documents d where d.request_id = q.id and d.category = 'Emergency leave proof' and not d.deleted)
  loop
    perform public.notify('proof_overdue', r.worker_id, r.id, '{}'::jsonb, 'proof:' || r.id || ':' || wk);
  end loop;
  -- passport out of the safe past expected return (daily)
  for r in
    select id, (data->'passportSafe'->>'expectedReturn')::date as er from public.records
    where entity = 'workers' and not deleted and data->'passportSafe'->>'custody' = 'released'
      and coalesce(data->'passportSafe'->>'expectedReturn', '') ~ '^\d{4}-\d{2}-\d{2}$' and (data->'passportSafe'->>'expectedReturn')::date < today
  loop
    perform public.notify('passport_overdue', r.id, null, jsonb_build_object('days', (today - r.er)::text), 'ppoverdue:' || r.id || ':' || today);
  end loop;
  -- consent forms issued > 3 days ago and still unsigned (weekly)
  for r in
    select id from public.records where entity = 'workers' and not deleted and data->'passportSafe'->>'consent' = 'pending'
      and coalesce(data->'passportSafe'->>'issuedAt', '') <> '' and (data->'passportSafe'->>'issuedAt')::timestamptz < now() - interval '3 days'
  loop
    perform public.notify('passport_consent_pending', r.id, null, '{"count":"1"}'::jsonb, 'consent:' || r.id || ':' || wk);
  end loop;
  -- daily email digest at the configured Malaysia time
  t := coalesce(nullif(c->'digest'->>'time', ''), '08:00')::time;
  if coalesce((c->'digest'->>'enabled')::boolean, true) and (now() at time zone 'Asia/Kuala_Lumpur')::time >= t then
    perform public.notify_digest(today);
  end if;
  return jsonb_build_object('queued', n);
end $$;
revoke execute on function public.notify_sweep() from public, anon, authenticated;

create or replace function public.notify_digest(p_day date) returns void language plpgsql security definer set search_path = public as $$
declare p record; body text; ev jsonb := public.cfg('notifications')->'events'->'daily_digest'; mine int; exp int; soon int; cons int; outp int; outs text[]; staff boolean;
begin
  if ev is null or not coalesce((ev->>'enabled')::boolean, true) or not coalesce((ev->'channels'->>'email')::boolean, false) then return; end if;
  for p in select * from public.profiles where status = 'active' and email is not null and not ('daily_digest:email' = any(notify_optout)) loop
    staff := p.role in ('super_admin','hr_admin','hr_manager','viewer');
    outs := p.outlet_ids;
    select count(*) into mine from public.requests q where
      (p.role = 'hr_manager' and q.status = 'submitted') or (p.role = 'hr_admin' and q.status = 'recommended')
      or (p.role = 'super_admin' and q.status = 'escalated') or (q.created_by = p.id and q.status = 'returned')
      or (p.role = 'hr_manager' and q.status = 'approved');
    select count(*) filter (where (d->>'expiryDate')::date < p_day), count(*) filter (where (d->>'expiryDate')::date between p_day and p_day + 30)
      into exp, soon
    from public.records w cross join lateral jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) d
    where w.entity = 'workers' and not w.deleted and coalesce(d->>'expiryDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(w.data->>'status', '') not in ('Absconded','Resigned','Terminated','Contract Ended','Repatriated')
      and (staff or (w.data->>'outletId') = any(outs));
    select count(*) filter (where data->'passportSafe'->>'consent' in ('pending','uploaded')),
           count(*) filter (where data->'passportSafe'->>'custody' = 'released')
      into cons, outp from public.records w
      where entity = 'workers' and not deleted and (staff or (w.data->>'outletId') = any(outs));
    if mine + exp + soon + cons + outp = 0 then continue; end if;
    body := 'Requests needing your action: ' || mine || E'\n' || 'Documents expired: ' || exp || E'\n' || 'Documents expiring in 30 days: ' || soon
      || E'\n' || 'Passport consents pending: ' || cons || E'\n' || 'Passports out of the safe: ' || outp;
    perform public.notify('daily_digest', null, null, jsonb_build_object('count', mine::text, 'digest', body), 'digest:' || p_day || ':' || p.id, array[p.id]);
  end loop;
end $$;
revoke execute on function public.notify_digest(date) from public, anon, authenticated;

-- ---------- in-app inbox for the signed-in user ----------
create or replace function public.notify_mark_read(p_ids bigint[] default null) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notification_deliveries set read_at = now()
  where user_id = auth.uid() and channel = 'in_app' and read_at is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count; return n;
end $$;
create or replace function public.update_my_contact(p_phone text, p_optout text[]) returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_phone), '') <> '' and coalesce(public.e164_my(p_phone), '') !~ '^\+\d{9,15}$' then raise exception 'Enter a valid mobile number, e.g. +60123456789'; end if;
  update public.profiles set phone = nullif(public.e164_my(p_phone), ''), notify_optout = coalesce(p_optout, '{}') where id = auth.uid();
end $$;
-- monthly summary for Super Admin (delivery log)
create or replace function public.notify_summary(p_months int default 3) returns table (month text, channel text, status text, n bigint, cost numeric)
language sql stable security definer set search_path = public as $$
  select to_char(date_trunc('month', created_at at time zone 'Asia/Kuala_Lumpur'), 'YYYY-MM'), channel, status, count(*), coalesce(sum(cost), 0)
  from public.notification_deliveries
  where public.is_super() and created_at > now() - make_interval(months => greatest(p_months, 1))
  group by 1, 2, 3 order by 1 desc, 2, 3
$$;
-- Super Admin: retry a failed/skipped delivery
create or replace function public.notify_retry(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super() then raise exception 'Super Admin only'; end if;
  update public.notification_deliveries set status = 'queued', next_attempt_at = now(), attempts = 0, last_error = null where id = p_id and status in ('failed','skipped');
  perform public.notify_kick_call();
end $$;

-- the profile guard must allow a user to change his own phone/opt-out (only through update_my_contact, which runs as definer)
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.my_role();
begin
  new.updated_at := now();
  new.id := old.id; new.email := old.email;
  if auth.uid() is not null and not (old.id = auth.uid() and new.role = old.role and new.status = old.status and new.outlet_ids = old.outlet_ids
       and new.full_name is not distinct from old.full_name) then
    if r in ('super_admin','admin') then
      null;
    elsif r = 'hr_admin' and public.hr_flag('manageUsers') then
      if old.role = 'super_admin' or new.role = 'super_admin' then raise exception 'Only a Super Admin can change Super Admin accounts'; end if;
      if (new.role = 'hr_admin' and old.role <> 'hr_admin') or (old.role = 'hr_admin' and old.id <> auth.uid()) then raise exception 'Only a Super Admin can add or change HR Admins'; end if;
    else
      raise exception 'You are not allowed to change users';
    end if;
  end if;
  if old.role in ('super_admin','admin') and old.status = 'active' and (new.role not in ('super_admin','admin') or new.status <> 'active') then
    if not exists (select 1 from public.profiles where role in ('super_admin','admin') and status = 'active' and id <> old.id) then
      raise exception 'There must be at least one active Super Admin';
    end if;
  end if;
  if new.role <> 'outlet_manager' then new.outlet_ids := '{}'; end if;
  return new;
end $$;

-- ---------- dispatcher support (service role only) ----------
create or replace function public.notify_claim(p_limit int default 50) returns setof public.notification_deliveries
language plpgsql security definer set search_path = public as $$
begin
  -- rows stuck in 'sending' (crashed run) go back to the queue
  update public.notification_deliveries set status = 'queued' where status = 'sending' and next_attempt_at < now() - interval '10 minutes';
  return query
  update public.notification_deliveries d set status = 'sending', attempts = d.attempts + 1, next_attempt_at = now()
  where d.id in (select id from public.notification_deliveries where status = 'queued' and next_attempt_at <= now()
                 order by critical desc, id limit p_limit for update skip locked)
  returning d.*;
end $$;
revoke execute on function public.notify_claim(int) from public, anon, authenticated;
-- Super Admin: queue a test message to himself on one channel ("Send test" in Settings → Notifications)
create or replace function public.notify_test(p_channel text) returns bigint language plpgsql security definer set search_path = public as $$
declare me public.profiles; addr text; v_id bigint; c jsonb := public.cfg('notifications');
begin
  if not public.is_super() then raise exception 'Super Admin only'; end if;
  if p_channel not in ('push','email','sms','whatsapp') then raise exception 'Unknown channel'; end if;
  select * into me from public.profiles p where p.id = auth.uid();
  addr := case p_channel when 'email' then me.email when 'push' then null else public.e164_my(me.phone) end;
  insert into public.notification_deliveries (event, user_id, recipient, channel, address, title, body, link, critical, status, last_error)
  values ('test', me.id, coalesce(nullif(me.full_name, ''), me.email), p_channel, addr, 'FW Manager test message',
    case when p_channel in ('sms','whatsapp') then 'RM0 ' || coalesce(nullif(c->>'smsSender', ''), 'FWM') || ': Test message. Notifications are working.'
         else 'Test message from FW Manager. Notifications are working.' end,
    coalesce(nullif(c->>'appUrl', ''), '') || '#/settings', true,
    case when p_channel in ('email','sms','whatsapp') and addr is null then 'skipped' else 'queued' end,
    case when p_channel in ('email','sms','whatsapp') and addr is null then 'no ' || case when p_channel = 'email' then 'email' else 'mobile number' end || ' on your profile' end)
  returning notification_deliveries.id into v_id;
  return v_id;
end $$;
revoke execute on function public.notify_test(text) from public, anon;
grant execute on function public.notify_test(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_deliveries') then
    alter publication supabase_realtime add table public.notification_deliveries;
  end if;
end $$;
grant select on public.notification_events, public.notification_deliveries to authenticated;
revoke all on public.notification_events, public.notification_deliveries from anon;
revoke execute on function public.notify_mark_read(bigint[]), public.update_my_contact(text, text[]), public.notify_summary(int), public.notify_retry(bigint) from public, anon;
grant execute on function public.notify_mark_read(bigint[]), public.update_my_contact(text, text[]), public.notify_summary(int), public.notify_retry(bigint) to authenticated;

commit;
