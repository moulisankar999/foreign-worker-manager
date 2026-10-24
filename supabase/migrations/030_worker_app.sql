-- 030_worker_app.sql — "FW Worker" self-service app (additive; safe to re-run)
--
-- * Workers sign in with passport number + 6-digit PIN through the `worker-auth` edge function only.
--   Each worker gets ONE Supabase Auth user (synthetic e-mail, app_metadata.fwm_worker = true) and NO profile row,
--   so every existing staff policy (is_active_user / my_role) denies them by default.
-- * The Auth password is HMAC(pepper, user_id:pin) — the pepper lives only in the edge function secrets, so the PIN
--   cannot be tried directly against GoTrue (lockout cannot be bypassed). The PIN itself is never stored.
-- * Workers read/write ONLY through the security-definer RPCs below, all scoped to my_worker_id(), which also checks
--   that the caller's JWT session still exists (revoke = immediate, even for unexpired JWTs).
-- * Worker requests start at the outlet manager ('manager_review'); auto-escalate to HR after N days (default 3).
--   Complaints "about my manager" are confidential: they skip the outlet manager and are hidden from outlet managers.

-- ---------------------------------------------------------------- requests: source / confidential / manager stage
alter table public.requests add column if not exists source text not null default 'manager';
alter table public.requests add column if not exists confidential boolean not null default false;
alter table public.requests add column if not exists manager_due_at timestamptz;
alter table public.requests add column if not exists manager_overdue boolean not null default false;
alter table public.requests add column if not exists manager_decided_by_name text;
alter table public.requests add column if not exists manager_decided_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'requests_source_check' and conrelid = 'public.requests'::regclass) then
    alter table public.requests add constraint requests_source_check check (source in ('manager','worker'));
  end if;
end $$;
alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check check (status = any (array[
  'manager_review','submitted','returned','recommended','escalated','approved','rejected','completed','cancelled']));
create index if not exists requests_manager_due_idx on public.requests (manager_due_at) where status = 'manager_review';
create index if not exists requests_worker_src_idx on public.requests (worker_id) where source = 'worker';

-- ---------------------------------------------------------------- config
insert into public.app_config (key, value)
values ('worker_app', '{"escalateDays":3,"lockAfter":5,"lockMinutes":15,"hardLockAfter":3,"ipMaxFails":20,"ipWindowMinutes":15,"maxOpenRequests":10,"maxPerDay":5}'::jsonb)
on conflict (key) do nothing;

do $$
declare c jsonb; ev jsonb := '{
  "worker_request_submitted": {"label":"Worker raised a request (to outlet manager)","group":"Worker app","recipients":["outlet_manager"],
     "channels":{"in_app":true,"push":true},"title":"👷 {{ref}} {{type}} from {{worker}} — please approve or reject","sms":"{{ref}} {{type}} from {{worker}} waiting for you"},
  "worker_request_overdue": {"label":"Outlet manager did not act — escalated to HR","group":"Worker app","recipients":["hr_manager","hr_admin"],
     "channels":{"in_app":true,"push":true,"email":true},"title":"⏰ {{ref}} {{type}} ({{worker}}): outlet manager did not act in {{days}} days — now with HR","sms":"{{ref}} overdue at outlet, now with HR"},
  "worker_complaint_confidential": {"label":"Confidential worker complaint (about manager)","group":"Worker app","recipients":[],
     "channels":{"in_app":true,"push":true,"email":true},"critical":true,"title":"🔒 Confidential complaint {{ref}} from {{worker}}","sms":"Confidential complaint {{ref}}"}
}'::jsonb; k text;
begin
  select value into c from public.app_config where key = 'notifications';
  if c is null then return; end if;
  for k in select jsonb_object_keys(ev) loop
    if not (coalesce(c->'events', '{}'::jsonb) ? k) then
      c := jsonb_set(c, array['events', k], ev->k, true);
    end if;
  end loop;
  update public.app_config set value = c where key = 'notifications';
end $$;

-- ---------------------------------------------------------------- worker access (one row per worker with a login)
create table if not exists public.worker_access (
  worker_id text primary key,
  user_id uuid not null unique,
  passport_norm text not null,
  status text not null default 'active' check (status in ('active','revoked')),
  failed_count int not null default 0,
  lock_count int not null default 0,
  locked_until timestamptz,
  hard_locked boolean not null default false,
  pin_set_at timestamptz,
  pin_set_by uuid,
  pin_set_by_name text,
  pin_changed_by_worker_at timestamptz,
  last_login_at timestamptz,
  last_failed_at timestamptz,
  revoked_at timestamptz,
  revoked_by_name text,
  created_at timestamptz not null default now(),
  created_by_name text,
  updated_at timestamptz not null default now()
);
create index if not exists worker_access_passport_idx on public.worker_access (passport_norm);
alter table public.worker_access enable row level security;
revoke insert, update, delete, truncate on public.worker_access from anon, authenticated;

create table if not exists public.worker_login_attempts (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  ip_hash text,
  passport_hash text,
  worker_id text,
  ok boolean not null,
  reason text
);
create index if not exists worker_login_attempts_ip_idx on public.worker_login_attempts (ip_hash, at);
create index if not exists worker_login_attempts_pp_idx on public.worker_login_attempts (passport_hash, at);
alter table public.worker_login_attempts enable row level security;
revoke all on public.worker_login_attempts from anon, authenticated;

create or replace function public.worker_cfg() returns jsonb language sql stable security definer set search_path = public as $$
  select '{"escalateDays":3,"lockAfter":5,"lockMinutes":15,"hardLockAfter":3,"ipMaxFails":20,"ipWindowMinutes":15,"maxOpenRequests":10,"maxPerDay":5}'::jsonb
         || coalesce((select value from public.app_config where key = 'worker_app'), '{}'::jsonb)
$$;

create or replace function public.passport_norm(p text) returns text language sql immutable as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '')
$$;

-- the worker's current passport number (latest expiry), normalised
create or replace function public.worker_passport_norm(p_worker text) returns text language sql stable security definer set search_path = public as $$
  select public.passport_norm(d->>'number')
  from public.records r, jsonb_array_elements(coalesce(r.data->'documents', '[]'::jsonb)) d
  where r.entity = 'workers' and r.id = p_worker and not r.deleted and d->>'type' = 'Passport' and coalesce(d->>'number', '') <> ''
  order by coalesce(d->>'expiryDate', '') desc limit 1
$$;

-- may the signed-in staff member manage this worker's app login? CEO / GM / HR Admin / HR Manager (in scope). Never OM / viewer.
create or replace function public.worker_access_can(p_actor uuid, p_worker text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
    where p.id = p_actor and p.status = 'active'
      and p.role in ('super_admin','admin','general_manager','hr_admin','hr_manager')
      and public.scope_ok(p.role, p.company_ids, p.outlet_ids, public.worker_outlet(p_worker)))
  and exists (select 1 from public.records r where r.entity = 'workers' and r.id = p_worker and not r.deleted)
$$;

create or replace function public.worker_access_mine(p_worker text) returns boolean language sql stable security definer set search_path = public as $$
  select public.worker_access_can(auth.uid(), p_worker)
$$;
drop policy if exists "worker access read" on public.worker_access;
create policy "worker access read" on public.worker_access for select to authenticated
  using (public.worker_access_mine(worker_id));

-- staff view for the "App access" panel (no secrets in the table anyway; this adds the computed state)
create or replace function public.worker_access_status(p_worker text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a public.worker_access; st text;
begin
  if not public.worker_access_can(auth.uid(), p_worker) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into a from public.worker_access where worker_id = p_worker;
  st := case when a.worker_id is null then 'never_set' when a.status = 'revoked' then 'revoked'
             when a.hard_locked or a.locked_until > now() then 'locked' else 'active' end;
  return jsonb_build_object('status', st, 'hasPassport', public.worker_passport_norm(p_worker) is not null,
    'lastLoginAt', a.last_login_at, 'pinSetAt', a.pin_set_at, 'pinSetByName', a.pin_set_by_name, 'workerChangedPinAt', a.pin_changed_by_worker_at,
    'lockedUntil', case when a.locked_until > now() then a.locked_until end, 'hardLocked', coalesce(a.hard_locked, false),
    'failedCount', coalesce(a.failed_count, 0), 'revokedAt', a.revoked_at, 'revokedByName', a.revoked_by_name);
end $$;

-- ---------------------------------------------------------------- service-only helpers used by the edge functions
-- check + context for an admin action (service role only; the edge function passes the verified caller id)
create or replace function public.worker_access_check(p_actor uuid, p_worker text) returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.profiles; a public.worker_access; w jsonb; pp text; dup text;
begin
  if not public.worker_access_can(p_actor, p_worker) then return jsonb_build_object('error', 'Only the CEO, General Manager, HR Admin or HR Manager can manage worker app access'); end if;
  select * into p from public.profiles where id = p_actor;
  select data into w from public.records where entity = 'workers' and id = p_worker;
  select * into a from public.worker_access where worker_id = p_worker;
  pp := public.worker_passport_norm(p_worker);
  select x.worker_id into dup from public.worker_access x where x.passport_norm = pp and x.worker_id <> p_worker and x.status = 'active' limit 1;
  return jsonb_build_object('actorName', coalesce(nullif(p.full_name, ''), p.email), 'actorRole', p.role,
    'workerName', w->>'fullName', 'workerNo', w->>'workerNo', 'passport', pp, 'duplicatePassport', dup is not null,
    'userId', a.user_id, 'status', a.status);
end $$;

create or replace function public.worker_kill_sessions(p_user uuid, p_keep uuid default null) returns int language plpgsql security definer set search_path = public, auth as $$
declare n int;
begin
  delete from auth.refresh_tokens where user_id = p_user::text and (p_keep is null or session_id is distinct from p_keep);
  delete from auth.sessions where user_id = p_user and (p_keep is null or id <> p_keep);
  get diagnostics n = row_count;
  return n;
end $$;

-- apply an admin action after the edge function did the Auth part; audit-logged with the real actor
create or replace function public.worker_access_apply(p_actor uuid, p_worker text, p_action text, p_user uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.profiles; a public.worker_access; pp text; wname text; n int := 0;
begin
  if not public.worker_access_can(p_actor, p_worker) then raise exception 'Not allowed'; end if;
  select * into p from public.profiles where id = p_actor;
  select data->>'fullName' into wname from public.records where entity = 'workers' and id = p_worker;
  pp := public.worker_passport_norm(p_worker);
  select * into a from public.worker_access where worker_id = p_worker for update;
  if p_action = 'generate' then
    if a.worker_id is not null then raise exception 'PIN already set — use Reset PIN'; end if;
    if pp is null then raise exception 'Add the passport number first'; end if;
    if p_user is null or not exists (select 1 from auth.users u where u.id = p_user and u.raw_app_meta_data->>'fwm_worker' = 'true') then
      raise exception 'Not a worker login';
    end if;
    delete from public.profiles where id = p_user;  -- a worker login must never carry a staff profile
    insert into public.worker_access (worker_id, user_id, passport_norm, pin_set_at, pin_set_by, pin_set_by_name, created_by_name)
    values (p_worker, p_user, pp, now(), p_actor, coalesce(nullif(p.full_name, ''), p.email), coalesce(nullif(p.full_name, ''), p.email));
  elsif a.worker_id is null then
    raise exception 'No app login for this worker yet';
  elsif p_action = 'reset' then
    if a.status = 'revoked' then raise exception 'Access is revoked — restore it first'; end if;
    update public.worker_access set passport_norm = coalesce(pp, passport_norm), failed_count = 0, lock_count = 0, locked_until = null, hard_locked = false,
      pin_set_at = now(), pin_set_by = p_actor, pin_set_by_name = coalesce(nullif(p.full_name, ''), p.email), pin_changed_by_worker_at = null, updated_at = now()
    where worker_id = p_worker;
    n := public.worker_kill_sessions(a.user_id);
  elsif p_action = 'revoke' then
    update public.worker_access set status = 'revoked', revoked_at = now(), revoked_by_name = coalesce(nullif(p.full_name, ''), p.email), updated_at = now()
    where worker_id = p_worker;
    n := public.worker_kill_sessions(a.user_id);
  elsif p_action = 'restore' then
    update public.worker_access set status = 'active', revoked_at = null, revoked_by_name = null, failed_count = 0, locked_until = null, hard_locked = false,
      lock_count = 0, passport_norm = coalesce(pp, passport_norm), updated_at = now()
    where worker_id = p_worker;
  elsif p_action = 'unlock' then
    update public.worker_access set failed_count = 0, lock_count = 0, locked_until = null, hard_locked = false, updated_at = now() where worker_id = p_worker;
  else
    raise exception 'Unknown action';
  end if;
  insert into public.audit_log (user_id, user_name, user_role, action, entity, entity_id, summary, details)
  values (p_actor, coalesce(nullif(p.full_name, ''), p.email), p.role, 'worker_app_' || p_action, 'workers', p_worker,
    case p_action when 'generate' then 'Generated worker app PIN for ' when 'reset' then 'Reset worker app PIN for '
      when 'revoke' then 'Revoked worker app access for ' when 'restore' then 'Restored worker app access for ' else 'Unlocked worker app login for ' end || coalesce(wname, p_worker),
    jsonb_build_object('sessionsEnded', n));
  return jsonb_build_object('ok', true, 'sessionsEnded', n);
end $$;

-- login step 1 (service only): rate limits + lockout; counts the attempt as failed up-front (pessimistic, race-safe)
create or replace function public.worker_login_begin(p_passport text, p_ip_hash text, p_passport_hash text) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare c jsonb := public.worker_cfg(); a public.worker_access; pp text := public.passport_norm(p_passport); n int; em text; win interval;
begin
  win := make_interval(mins => (c->>'ipWindowMinutes')::int);
  select count(*) into n from public.worker_login_attempts where ip_hash = p_ip_hash and not ok and at > now() - win;
  if n >= (c->>'ipMaxFails')::int then
    insert into public.worker_login_attempts (ip_hash, passport_hash, ok, reason) values (p_ip_hash, p_passport_hash, false, 'ip_blocked');
    return jsonb_build_object('ok', false);
  end if;
  -- unknown passports are also limited per passport (so nobody learns which passports exist from timing of lockouts)
  select count(*) into n from public.worker_login_attempts where passport_hash = p_passport_hash and not ok and at > now() - win;
  if pp is null then
    insert into public.worker_login_attempts (ip_hash, passport_hash, ok, reason) values (p_ip_hash, p_passport_hash, false, 'bad_format');
    return jsonb_build_object('ok', false);
  end if;
  -- match the stored passport, or the worker's CURRENT passport (renewed passport keeps working)
  select x.* into a from public.worker_access x where x.passport_norm = pp
  union all
  select x.* from public.worker_access x where x.passport_norm <> pp and public.worker_passport_norm(x.worker_id) = pp
  limit 1;
  if a.worker_id is null then
    insert into public.worker_login_attempts (ip_hash, passport_hash, ok, reason) values (p_ip_hash, p_passport_hash, false, 'unknown');
    return jsonb_build_object('ok', false);
  end if;
  select * into a from public.worker_access where worker_id = a.worker_id for update;
  if a.status <> 'active' or a.hard_locked or a.locked_until > now() or a.failed_count >= (c->>'lockAfter')::int
     or not exists (select 1 from public.records r where r.entity = 'workers' and r.id = a.worker_id and not r.deleted) then
    insert into public.worker_login_attempts (ip_hash, passport_hash, worker_id, ok, reason)
    values (p_ip_hash, p_passport_hash, a.worker_id, false, case when a.status <> 'active' then 'revoked' else 'locked' end);
    return jsonb_build_object('ok', false);
  end if;
  update public.worker_access set failed_count = failed_count + 1, last_failed_at = now(),
    passport_norm = pp, updated_at = now() where worker_id = a.worker_id;
  select email into em from auth.users where id = a.user_id;
  return jsonb_build_object('ok', true, 'userId', a.user_id, 'email', em, 'workerId', a.worker_id);
end $$;

-- login step 2 (service only): success resets counters; failure may lock (15 min × 2^n, hard lock after N lockouts)
create or replace function public.worker_login_finish(p_worker text, p_ok boolean, p_ip_hash text, p_passport_hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := public.worker_cfg(); a public.worker_access;
begin
  select * into a from public.worker_access where worker_id = p_worker for update;
  if a.worker_id is null then return jsonb_build_object('ok', false); end if;
  insert into public.worker_login_attempts (ip_hash, passport_hash, worker_id, ok, reason) values (p_ip_hash, p_passport_hash, p_worker, p_ok, case when p_ok then 'ok' else 'bad_pin' end);
  if p_ok then
    update public.worker_access set failed_count = 0, lock_count = 0, locked_until = null, last_login_at = now(), updated_at = now() where worker_id = p_worker;
    return jsonb_build_object('ok', true);
  end if;
  if a.failed_count >= (c->>'lockAfter')::int and (a.locked_until is null or a.locked_until <= now()) then
    update public.worker_access set lock_count = lock_count + 1, failed_count = 0,
      locked_until = now() + make_interval(mins => (c->>'lockMinutes')::int * (2 ^ least(lock_count, 6))::int),
      hard_locked = (lock_count + 1) >= (c->>'hardLockAfter')::int, updated_at = now()
    where worker_id = p_worker;
    insert into public.audit_log (user_id, user_name, user_role, action, entity, entity_id, summary)
    values (null, 'system', null, 'worker_app_locked', 'workers', p_worker, 'Worker app login locked after repeated wrong PINs');
  end if;
  return jsonb_build_object('ok', false);
end $$;


-- GoTrue itself refused (rate limit / outage): undo the pessimistic count so the worker is not punished (service only)
create or replace function public.worker_login_abort(p_worker text) returns void language sql security definer set search_path = public as $$
  update public.worker_access set failed_count = greatest(failed_count - 1, 0), updated_at = now() where worker_id = p_worker
$$;

-- PIN check for "change my PIN" without creating a session (service only); counts toward the lockout
create or replace function public.worker_pin_verify(p_user uuid, p_secret text) returns boolean language plpgsql security definer set search_path = public, auth, extensions as $$
declare a public.worker_access; c jsonb := public.worker_cfg(); ok boolean;
begin
  select * into a from public.worker_access where user_id = p_user for update;
  if a.worker_id is null or a.status <> 'active' or a.hard_locked or a.locked_until > now() then return false; end if;
  select u.encrypted_password = extensions.crypt(p_secret, u.encrypted_password) into ok from auth.users u where u.id = p_user;
  if coalesce(ok, false) then
    update public.worker_access set failed_count = 0, updated_at = now() where worker_id = a.worker_id;
    return true;
  end if;
  update public.worker_access set failed_count = failed_count + 1, last_failed_at = now(), updated_at = now() where worker_id = a.worker_id;
  if a.failed_count + 1 >= (c->>'lockAfter')::int then
    update public.worker_access set lock_count = lock_count + 1, failed_count = 0,
      locked_until = now() + make_interval(mins => (c->>'lockMinutes')::int * (2 ^ least(lock_count, 6))::int),
      hard_locked = (lock_count + 1) >= (c->>'hardLockAfter')::int where worker_id = a.worker_id;
  end if;
  return false;
end $$;

create or replace function public.worker_pin_changed(p_user uuid, p_keep_session uuid) returns void language plpgsql security definer set search_path = public as $$
declare wid text;
begin
  update public.worker_access set pin_changed_by_worker_at = now(), updated_at = now() where user_id = p_user returning worker_id into wid;
  perform public.worker_kill_sessions(p_user, p_keep_session);
  insert into public.audit_log (user_id, user_name, user_role, action, entity, entity_id, summary)
  values (p_user, coalesce((select data->>'fullName' from public.records where entity = 'workers' and id = wid), 'worker'), 'worker', 'worker_app_pin_changed', 'workers', wid, 'Worker changed own app PIN');
end $$;

-- ---------------------------------------------------------------- worker identity
create or replace function public.my_worker_id() returns text language sql stable security definer set search_path = public, auth as $$
  select a.worker_id from public.worker_access a
  where a.user_id = auth.uid() and a.status = 'active'
    and exists (select 1 from auth.sessions s where s.id = nullif(auth.jwt()->>'session_id', '')::uuid and s.user_id = auth.uid())
    and exists (select 1 from public.records r where r.entity = 'workers' and r.id = a.worker_id and not r.deleted)
$$;

create or replace function public.worker_require() returns text language plpgsql stable security definer set search_path = public as $$
declare w text := public.my_worker_id();
begin
  if w is null then raise exception 'Session ended — please sign in again' using errcode = '42501'; end if;
  return w;
end $$;

-- new auth users that are worker logins get no staff profile
create or replace function public.handle_new_user()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v_out text := nullif(new.raw_user_meta_data->>'outlet_id', ''); v_com text := nullif(new.raw_user_meta_data->>'company_id', '');
        t public.user_create_tickets; b public.profiles;
begin
  -- FW Worker logins (app_metadata can only be set with the service role): no profile → no staff access at all
  -- (GoTrue may write app_metadata after the insert, so the edge function also sets the user_metadata marker;
  --  a self-signup that fakes the marker just gets no profile = no access at all)
  if coalesce(new.raw_app_meta_data->>'fwm_worker', '') = 'true' or coalesce(new.raw_user_meta_data->>'fwm_worker', '') = 'true' then return new; end if;
  perform pg_advisory_xact_lock(424242);
  if nullif(new.raw_user_meta_data->>'fwm_ticket', '') is not null then
    delete from public.user_create_tickets
     where nonce = new.raw_user_meta_data->>'fwm_ticket' and lower(email) = lower(new.email) and created_at > now() - interval '10 minutes'
    returning * into t;
  end if;
  if t.nonce is not null then
    select * into b from public.profiles where id = t.actor and status = 'active';
    if b.id is null or not (t.role = any(public.creatable_roles(t.actor))) then raise exception 'Not allowed to add this user'; end if;
    insert into public.profiles (id, email, full_name, role, status, company_ids, outlet_ids, phone, must_change_password,
                                 approved_by, approved_by_name, approved_by_role, approved_at, added_by, added_by_name, added_by_role, added_at)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), t.role, 'active',
            case when t.role = 'general_manager' then '{}' else t.company_ids end,
            case when t.role = 'general_manager' then '{}' else t.outlet_ids end,
            t.phone, true,
            b.id, coalesce(nullif(b.full_name, ''), b.email), b.role, now(), b.id, coalesce(nullif(b.full_name, ''), b.email), b.role, now());
    return new;
  end if;
  if v_out is not null and not exists (select 1 from public.records where entity = 'outlets' and id = v_out and not deleted) then v_out := null; end if;
  if v_out is not null then v_com := public.outlet_company(v_out); end if;
  if v_com is not null and not public.company_exists(v_com) then v_com := null; end if;
  if not exists (select 1 from public.profiles where role = 'super_admin' and status = 'active') then
    insert into public.profiles (id, email, full_name, role, status)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'super_admin', 'active');
  else
    insert into public.profiles (id, email, full_name, role, status, requested_company_id, requested_outlet_id)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'viewer', 'pending', v_com, v_out);
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------- confidential requests: hidden from outlet managers
create or replace function public.req_conf_ok(p_conf boolean, p_created_by uuid) returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce(p_conf, false) or p_created_by = auth.uid()
      or coalesce(public.my_role() in ('super_admin','admin','general_manager','hr_admin','hr_manager'), false)
$$;

create or replace function public.can_see_request(rid uuid)
 returns boolean language sql stable security definer set search_path to 'public' as $function$
  select exists (select 1 from public.requests q where q.id = rid and public.req_conf_ok(q.confidential, q.created_by) and (
    q.created_by = auth.uid() or public.can_see_worker(q.worker_id) or (q.outlet_id is not null and public.in_my_scope(q.outlet_id) and public.my_role() is not null)))
$function$;

drop policy if exists "requests read" on public.requests;
create policy "requests read" on public.requests for select using (
  public.is_active_user() and public.req_conf_ok(confidential, created_by)
  and ((created_by = auth.uid()) or public.can_see_worker(worker_id) or ((outlet_id is not null) and public.in_my_scope(outlet_id))));

-- people who hear about a confidential complaint: CEO + HR in scope (never the outlet manager)
create or replace function public.confidential_audience(p_outlet text) returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}') from public.profiles p
  where p.status = 'active' and p.role in ('super_admin','hr_admin','hr_manager')
    and (p.role = 'super_admin' or public.scope_ok(p.role, p.company_ids, p.outlet_ids, p_outlet))
$$;

create or replace function public.request_events_notify()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare q public.requests; e text; k text := 'rev:' || new.id; aud uuid[];
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
  if q.confidential then
    -- confidential complaint: only CEO + HR in scope, whatever the event config says
    aud := array(select x from unnest(public.confidential_audience(q.outlet_id)) x where x is distinct from auth.uid());
    if cardinality(aud) > 0 then
      perform public.notify(e, q.worker_id, q.id, jsonb_build_object('comment', coalesce(new.comment, ''), 'by', coalesce(new.by_name, '')), k, aud);
    end if;
    return null;
  end if;
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
end $function$;

-- ---------------------------------------------------------------- worker RPCs (read)
create or replace function public.worker_me() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wid text := public.worker_require(); w jsonb; s jsonb; docs jsonb; basic numeric; loans numeric; outlet jsonb; comp text; lead int; pp text;
begin
  select data into w from public.records where entity = 'workers' and id = wid;
  select data into s from public.records where entity = 'settings' and id = 'app';
  select data into outlet from public.records where entity = 'outlets' and id = w->>'outletId';
  select e->>'name' into comp from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' = public.outlet_company(w->>'outletId') limit 1;
  select coalesce(max(x::int), 90) into lead from jsonb_array_elements_text(coalesce(s->'leadTimes', '[90]'::jsonb)) x;
  -- latest document of each tracked type
  select coalesce(jsonb_agg(jsonb_build_object('type', t.type, 'expiryDate', d.exp,
           'number', case when t.type = 'Passport' and d.num is not null then repeat('•', greatest(length(d.num) - 4, 0)) || right(d.num, 4) end)
         order by t.ord), '[]'::jsonb) into docs
  from (values (1, 'Passport'), (2, 'Work Permit / PLKS (VP(TE))'), (3, 'Visa / VDR'), (4, 'FOMEMA Medical'), (5, 'Insurance (SPIKPA / Hospitalisation)')) t(ord, type)
  left join lateral (
    select nullif(x->>'expiryDate', '') as exp, nullif(x->>'number', '') as num
    from jsonb_array_elements(coalesce(w->'documents', '[]'::jsonb)) x where x->>'type' = t.type
    order by coalesce(x->>'expiryDate', '') desc limit 1) d on true
  where d.exp is not null or t.type in ('Passport','Work Permit / PLKS (VP(TE))','FOMEMA Medical','Insurance (SPIKPA / Hospitalisation)');
  select coalesce((select (i->>'newPay')::numeric from jsonb_array_elements(coalesce(w->'increments', '[]'::jsonb)) i
                   where coalesce(i->>'date', '') <= to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') order by i->>'date' desc limit 1),
                  nullif(w->>'initialBasicPay', '')::numeric) into basic;
  select coalesce(sum(greatest(coalesce((l->>'amount')::numeric, 0)
           - coalesce((select sum(coalesce((d->>'amount')::numeric, 0)) from jsonb_array_elements(coalesce(w->'deductions', '[]'::jsonb)) d where d->>'loanId' = l->>'id'), 0), 0)), 0)
    into loans from jsonb_array_elements(coalesce(w->'loans', '[]'::jsonb)) l;
  return jsonb_build_object(
    'id', wid, 'name', w->>'fullName', 'workerNo', w->>'workerNo', 'job', w->>'jobCategory', 'nationality', w->>'nationality',
    'joinDate', w->>'joinDate', 'status', w->>'status', 'language', w->>'primaryLanguage',
    'outlet', outlet->>'name', 'company', comp, 'leadDays', lead, 'docs', docs,
    'basicPay', basic, 'loanBalance', loans,
    'renewals', (select coalesce(jsonb_agg(jsonb_build_object('type', q.type, 'status', q.status, 'title', q.title)), '[]'::jsonb)
                 from public.requests q where q.worker_id = wid and q.type in ('permit_renewal','fomema','passport_renewal','visa_renewal')
                   and q.status not in ('completed','cancelled','rejected')));
end $$;

-- request types a worker may SEE about himself (raised by him, or by managers for the safe types)
create or replace function public.worker_visible_type(p_type text) returns boolean language sql immutable as $$
  select p_type in ('annual_leave','medical_leave','home_leave','emergency_leave','salary_advance','loan','salary_increment','resignation',
                    'permit_renewal','passport','complaint','fomema','document_copy')
$$;

create or replace function public.worker_requests() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wid text := public.worker_require();
begin
  return (select coalesce(jsonb_agg(r order by r->>'createdAt' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', q.id, 'ref', 'R-' || q.ref_no, 'type', q.type, 'status', q.status, 'source', q.source,
      'createdAt', q.created_at, 'updatedAt', q.updated_at, 'amount', q.amount, 'overdue', q.manager_overdue, 'mine', q.created_by = auth.uid(),
      'from', q.data->>'from', 'to', q.data->>'to', 'lastDay', q.data->>'lastDay', 'confidential', q.confidential,
      'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'to', e.to_status, 'role', e.by_role,
                   'comment', case when e.action in ('reject','return','mgr_reject','worker_submit','worker_resubmit') then left(e.comment, 400) end) order by e.at), '[]'::jsonb)
                 from public.request_events e where e.request_id = q.id
                   and e.action in ('submit','worker_submit','mgr_approve','mgr_reject','auto_escalate','approve','forward','return','reject','apply','cancel','resubmit','worker_resubmit','worker_cancel'))) as r
    from public.requests q
    where q.worker_id = wid and (q.created_by = auth.uid() or (q.source = 'manager' and public.worker_visible_type(q.type)))
    order by q.created_at desc limit 60) s);
end $$;

-- ---------------------------------------------------------------- worker RPCs (write)
create or replace function public.worker_request_create(p_type text, p_data jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare wid text := public.worker_require(); c jsonb := public.worker_cfg(); w jsonb; d jsonb := '{}'::jsonb; t text; amt numeric;
        reason text := left(trim(coalesce(p_data->>'reason', '')), 500); conf boolean := false; st text := 'manager_review';
        q public.requests; outlet text; has_om boolean; n int; title text; today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
        f date; tt date; nm text;
begin
  select data into w from public.records where entity = 'workers' and id = wid;
  outlet := w->>'outletId'; nm := w->>'fullName';
  select count(*) into n from public.requests where worker_id = wid and source = 'worker' and status in ('manager_review','submitted','returned','recommended','escalated','approved');
  if n >= (c->>'maxOpenRequests')::int then raise exception 'Too many open requests — wait for the answers first'; end if;
  select count(*) into n from public.requests where worker_id = wid and source = 'worker' and created_at > now() - interval '1 day';
  if n >= (c->>'maxPerDay')::int then raise exception 'Daily limit reached — try again tomorrow'; end if;

  if p_type = 'leave' then
    t := case p_data->>'kind' when 'medical' then 'medical_leave' when 'home' then 'home_leave' else 'annual_leave' end;
    begin f := (p_data->>'from')::date; tt := (p_data->>'to')::date; exception when others then raise exception 'Choose the dates'; end;
    if f is null or tt is null or tt < f or tt > f + 120 or f < today - 30 or f > today + 365 then raise exception 'Choose valid dates'; end if;
    d := jsonb_build_object('from', f, 'to', tt, 'reason', coalesce(nullif(reason, ''), '—'));
  elsif p_type in ('salary_advance','loan') then
    t := p_type;
    begin amt := round((p_data->>'amount')::numeric, 2); exception when others then raise exception 'Enter the amount'; end;
    if amt is null or amt <= 0 or amt > 20000 then raise exception 'Enter a valid amount'; end if;
    d := jsonb_build_object('amount', amt, 'reason', coalesce(nullif(reason, ''), '—'));
    if p_type = 'loan' then d := d || jsonb_build_object('months', least(greatest(coalesce(nullif(p_data->>'months', '')::int, 6), 1), 36)); end if;
  elsif p_type = 'salary_increment' then
    t := p_type;
    if reason = '' then raise exception 'Write the reason'; end if;
    d := jsonb_build_object('reason', reason);
  elsif p_type = 'resignation' then
    t := p_type;
    begin f := (p_data->>'lastDay')::date; exception when others then raise exception 'Choose your last day'; end;
    if f is null or f < today or f > today + 365 then raise exception 'Choose a valid last day'; end if;
    d := jsonb_build_object('exitType', 'Resigned', 'lastDay', f, 'reason', coalesce(nullif(reason, ''), '—'));
  elsif p_type = 'renewal' then
    t := 'permit_renewal';
    if coalesce(p_data->>'doc', '') not in ('Passport','Work permit (PLKS)','Visa','FOMEMA','Insurance') then raise exception 'Choose the document'; end if;
    d := jsonb_build_object('doc', p_data->>'doc', 'reason', coalesce(nullif(reason, ''), 'Please renew my ' || (p_data->>'doc')));
  elsif p_type = 'passport' then
    t := 'passport';
    begin f := coalesce((p_data->>'date')::date, today); exception when others then f := today; end;
    if f < today or f > today + 180 then raise exception 'Choose a valid date'; end if;
    -- the passport belongs to the worker (Passports Act): goes straight to HR, the outlet manager cannot block it
    d := jsonb_build_object('action', 'Release passport to worker', 'date', f, 'reason', coalesce(nullif(reason, ''), '—'));
    st := 'submitted';
  elsif p_type = 'complaint' then
    t := 'complaint';
    if reason = '' then raise exception 'Write what happened'; end if;
    conf := coalesce((p_data->>'aboutManager')::boolean, false);
    d := jsonb_build_object('against', case when conf then 'My outlet manager' else coalesce(nullif(left(p_data->>'topic', 40), ''), 'Other') end, 'reason', reason,
                            'topic', coalesce(nullif(left(p_data->>'topic', 40), ''), 'Other'));
    if conf then st := 'submitted'; end if;
  else
    raise exception 'This request type is not available';
  end if;

  -- no active outlet manager for this outlet → straight to HR
  select exists (select 1 from public.profiles p where p.status = 'active' and p.role = 'outlet_manager' and outlet is not null
                 and public.scope_ok(p.role, p.company_ids, p.outlet_ids, outlet)) into has_om;
  if st = 'manager_review' and not has_om then st := 'submitted'; d := d || '{"noOutletManager":true}'::jsonb; end if;
  amt := coalesce(amt, nullif(d->>'amount', '')::numeric);
  title := public.request_type_label(t) || ' — ' || coalesce(nm, '');
  insert into public.requests (type, worker_id, outlet_id, title, data, amount, priority, status, required_level, created_by, created_by_name, created_by_role,
                               source, confidential, manager_due_at)
  values (t, wid, outlet, title, d || jsonb_build_object('raisedBy', 'worker'), amt, case when conf then 'high' else 'normal' end, st,
          public.request_required_level(t, amt), auth.uid(), coalesce(nm, 'Worker'), 'worker', 'worker', conf,
          case when st = 'manager_review' then now() + make_interval(days => (c->>'escalateDays')::int) end)
  returning * into q;
  insert into public.request_events (request_id, by, by_name, by_role, action, to_status, comment)
  values (q.id, auth.uid(), coalesce(nm, 'Worker'), 'worker', 'worker_submit', st, nullif(reason, ''));
  begin
    if conf then
      perform public.notify('worker_complaint_confidential', wid, q.id, '{}'::jsonb, 'wsub:' || q.id, public.confidential_audience(outlet));
    elsif st = 'manager_review' then
      perform public.notify('worker_request_submitted', wid, q.id, '{}'::jsonb, 'wsub:' || q.id);
    else
      perform public.notify('request_submitted', wid, q.id, '{}'::jsonb, 'wsub:' || q.id);
    end if;
  exception when others then raise warning 'notify failed: %', sqlerrm;
  end;
  return jsonb_build_object('id', q.id, 'ref', 'R-' || q.ref_no, 'status', q.status);
end $$;

create or replace function public.worker_request_cancel(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare wid text := public.worker_require(); q public.requests;
begin
  select * into q from public.requests where id = p_id for update;
  if q.id is null or q.worker_id <> wid or q.created_by <> auth.uid() then raise exception 'Request not found'; end if;
  if q.status not in ('manager_review','submitted','returned') then raise exception 'This request can no longer be cancelled'; end if;
  update public.requests set status = 'cancelled', updated_at = now() where id = p_id;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status)
  values (p_id, auth.uid(), q.created_by_name, 'worker', 'worker_cancel', q.status, 'cancelled');
end $$;

-- HR returned it for more info → the worker answers and it goes back to HR
create or replace function public.worker_request_resubmit(p_id uuid, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare wid text := public.worker_require(); q public.requests;
begin
  select * into q from public.requests where id = p_id for update;
  if q.id is null or q.worker_id <> wid or q.created_by <> auth.uid() then raise exception 'Request not found'; end if;
  if q.status <> 'returned' then raise exception 'This request is not waiting for you'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write your answer'; end if;
  update public.requests set status = 'submitted', updated_at = now() where id = p_id;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
  values (p_id, auth.uid(), q.created_by_name, 'worker', 'worker_resubmit', 'returned', 'submitted', left(trim(p_note), 500));
  begin perform public.notify('request_submitted', wid, p_id, '{}'::jsonb, 'wres:' || p_id || ':' || extract(epoch from now())::bigint);
  exception when others then null; end;
end $$;

-- ---------------------------------------------------------------- outlet manager stage
create or replace function public.request_manager_act(p_id uuid, p_action text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); q public.requests; v_to text; ev text;
begin
  if v_role is null then raise exception 'Account not active'; end if;
  select * into q from public.requests where id = p_id for update;
  if not found or not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  if q.status <> 'manager_review' then raise exception 'This request is not waiting for the outlet manager'; end if;
  -- the outlet manager in scope; CEO / GM / HR may decide instead (override)
  if v_role not in ('outlet_manager','super_admin','admin','general_manager','hr_admin','hr_manager') then raise exception 'Not allowed'; end if;
  if v_role = 'outlet_manager' and not public.in_my_scope(q.outlet_id) then raise exception 'Not allowed'; end if;
  if p_action = 'approve' then v_to := 'submitted'; ev := 'mgr_approve';
  elsif p_action = 'reject' then
    if coalesce(trim(p_comment), '') = '' then raise exception 'Please write the reason'; end if;
    v_to := 'rejected'; ev := 'mgr_reject';
  else raise exception 'Unknown action'; end if;
  update public.requests set status = v_to, updated_at = now(), manager_decided_by_name = public.my_name(), manager_decided_at = now(),
    decided_by = case when v_to = 'rejected' then auth.uid() else decided_by end,
    decided_by_name = case when v_to = 'rejected' then public.my_name() else decided_by_name end,
    decided_by_role = case when v_to = 'rejected' then v_role else decided_by_role end,
    decided_at = case when v_to = 'rejected' then now() else decided_at end
  where id = p_id;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
  values (p_id, auth.uid(), public.my_name(), v_role, ev, 'manager_review', v_to, nullif(trim(coalesce(p_comment, '')), ''));
  if v_to = 'rejected' then
    insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at)
    values (p_id, 'rejected', public.my_name(), v_role, now()) on conflict (request_id) do nothing;
  end if;
  begin
    perform public.notify(case when v_to = 'submitted' then 'request_submitted' else 'request_rejected' end, q.worker_id, p_id,
      jsonb_build_object('comment', coalesce(p_comment, ''), 'by', coalesce(public.my_name(), '')), 'mgr:' || p_id);
  exception when others then raise warning 'notify failed: %', sqlerrm; end;
end $$;

-- hourly: outlet manager did not act in time → HR, flagged
create or replace function public.worker_requests_escalate() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; days int := (public.worker_cfg()->>'escalateDays')::int;
begin
  for r in select id, worker_id from public.requests where status = 'manager_review' and manager_due_at <= now() for update skip locked loop
    update public.requests set status = 'submitted', manager_overdue = true, updated_at = now() where id = r.id;
    insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
    values (r.id, null, 'system', 'system', 'auto_escalate', 'manager_review', 'submitted', 'Outlet manager did not act within ' || days || ' days');
    begin perform public.notify('worker_request_overdue', r.worker_id, r.id, jsonb_build_object('days', days), 'wesc:' || r.id);
    exception when others then raise warning 'notify failed: %', sqlerrm; end;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fwm-worker-escalate';
    perform cron.schedule('fwm-worker-escalate', '7 * * * *', 'select public.worker_requests_escalate()');
  end if;
end $$;

-- old login attempts are not kept forever
create or replace function public.worker_login_attempts_prune() returns void language sql security definer set search_path = public as $$
  delete from public.worker_login_attempts where at < now() - interval '30 days'
$$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fwm-worker-attempts-prune';
    perform cron.schedule('fwm-worker-attempts-prune', '17 3 * * *', 'select public.worker_login_attempts_prune()');
  end if;
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.worker_access_check(uuid, text), public.worker_access_apply(uuid, text, text, uuid), public.worker_kill_sessions(uuid, uuid),
  public.worker_login_begin(text, text, text), public.worker_login_finish(text, boolean, text, text), public.worker_login_abort(text), public.worker_pin_verify(uuid, text),
  public.worker_pin_changed(uuid, uuid), public.worker_requests_escalate(), public.worker_login_attempts_prune(), public.worker_access_can(uuid, text),
  public.confidential_audience(text), public.worker_passport_norm(text), public.worker_cfg()
  from public, anon, authenticated;
grant execute on function public.worker_access_check(uuid, text), public.worker_access_apply(uuid, text, text, uuid), public.worker_kill_sessions(uuid, uuid),
  public.worker_login_begin(text, text, text), public.worker_login_finish(text, boolean, text, text), public.worker_login_abort(text), public.worker_pin_verify(uuid, text),
  public.worker_pin_changed(uuid, uuid), public.worker_requests_escalate()
  to service_role;
revoke execute on function public.my_worker_id(), public.worker_require(), public.worker_me(), public.worker_requests(),
  public.worker_request_create(text, jsonb), public.worker_request_cancel(uuid), public.worker_request_resubmit(uuid, text),
  public.request_manager_act(uuid, text, text), public.worker_access_status(text), public.req_conf_ok(boolean, uuid), public.worker_access_mine(text) from public, anon;
grant execute on function public.my_worker_id(), public.worker_require(), public.worker_me(), public.worker_requests(),
  public.worker_request_create(text, jsonb), public.worker_request_cancel(uuid), public.worker_request_resubmit(uuid, text),
  public.request_manager_act(uuid, text, text), public.worker_access_status(text), public.req_conf_ok(boolean, uuid), public.worker_access_mine(text) to authenticated;
