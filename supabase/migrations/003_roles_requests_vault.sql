-- 003: roles (super_admin / hr_admin / hr_manager / outlet_manager / viewer), outlet scoping,
-- requests & approvals, document vault, passport safekeeping hooks, audit log.
-- Additive & non-destructive: no table/column drops, no row deletes. Existing roles are remapped with UPDATE.
begin;

-- ======================= Config (Super Admin only writes) =======================
create table if not exists public.app_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
alter table public.app_config enable row level security;
insert into public.app_config (key, value) values
  ('approval_rules', '{"types":{"annual_leave":{"enabled":true,"level":"hr_admin","limit":null},"medical_leave":{"enabled":true,"level":"hr_manager","limit":null},"emergency_leave":{"enabled":true,"level":"hr_admin","limit":null},"home_leave":{"enabled":true,"level":"hr_admin","limit":null},"checkout_memo":{"enabled":true,"level":"hr_manager","limit":null},"salary_increment":{"enabled":true,"level":"super_admin","limit":null},"salary_advance":{"enabled":true,"level":"hr_admin","limit":500},"loan":{"enabled":true,"level":"super_admin","limit":null},"deduction":{"enabled":true,"level":"hr_admin","limit":200},"ot_claim":{"enabled":true,"level":"hr_admin","limit":300},"penalty":{"enabled":true,"level":"hr_admin","limit":100},"warning_letter":{"enabled":true,"level":"hr_admin","limit":null},"absconding":{"enabled":true,"level":"hr_admin","limit":null},"medical_visit":{"enabled":true,"level":"hr_manager","limit":null},"accident":{"enabled":true,"level":"hr_admin","limit":null},"insurance_claim":{"enabled":true,"level":"hr_admin","limit":null},"accommodation":{"enabled":true,"level":"hr_manager","limit":null},"complaint":{"enabled":true,"level":"hr_manager","limit":null},"uniform":{"enabled":true,"level":"hr_manager","limit":null},"passport":{"enabled":true,"level":"hr_manager","limit":null},"permit_renewal":{"enabled":true,"level":"hr_admin","limit":null},"document_copy":{"enabled":true,"level":"hr_manager","limit":null},"update_details":{"enabled":true,"level":"hr_manager","limit":null},"transfer":{"enabled":true,"level":"hr_admin","limit":null},"resignation":{"enabled":true,"level":"hr_admin","limit":null},"termination":{"enabled":true,"level":"super_admin","limit":null},"other":{"enabled":true,"level":"hr_admin","limit":null}}}'::jsonb),
  ('hr_admin', '{"manageUsers":true,"deleteWorkers":false,"viewSalary":true,"viewAudit":true}'::jsonb),
  ('vault', '{"maxImageKB":1024,"maxPdfKB":5120,"restricted":["Payslip","Bank"],"extraCategories":[]}'::jsonb),
  ('emergency_reasons', '[{"key":"death","label":"Death of immediate family member","relationship":true,"proof":"Death certificate, burial/cremation permit or official letter (photo is fine)","proofDays":14},{"key":"critical_illness","label":"Critical illness / hospitalisation of immediate family member","relationship":true,"proof":"Hospital letter, admission slip or doctor’s note","proofDays":14},{"key":"accident","label":"Serious accident or injury of immediate family member","relationship":true,"proof":"Hospital letter, police report or photo proof","proofDays":14},{"key":"own_medical","label":"Own medical emergency needing treatment in home country","relationship":false,"proof":"Doctor’s note / referral letter","proofDays":7},{"key":"childbirth","label":"Spouse childbirth / pregnancy complication","relationship":false,"proof":"Hospital letter or birth certificate","proofDays":30},{"key":"disaster","label":"Natural disaster or fire affecting family home","relationship":false,"proof":"Local authority letter, news report or photos","proofDays":30},{"key":"legal","label":"Family security emergency / legal matter needing personal presence","relationship":false,"proof":"Court summons, police or official letter","proofDays":14},{"key":"other","label":"Other (explain in detail — HR Admin decides)","relationship":false,"proof":"Any supporting document","proofDays":14,"detailed":true}]'::jsonb)
on conflict (key) do nothing;

create or replace function public.cfg(k text) returns jsonb language sql stable security definer set search_path = public as $$
  select value from public.app_config where key = k
$$;
create or replace function public.hr_flag(flag text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.cfg('hr_admin')->>flag)::boolean,
    case flag when 'manageUsers' then true when 'viewSalary' then true when 'viewAudit' then true else false end)
$$;

-- ======================= Roles =======================
alter table public.profiles add column if not exists outlet_ids text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_role_check;

create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;
create or replace function public.my_outlets() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select outlet_ids from public.profiles where id = auth.uid() and status = 'active'), '{}')
$$;
create or replace function public.is_super() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'super_admin', false)
$$;
-- sees every worker (read)
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','hr_admin','hr_manager','viewer','admin','manager'), false)
$$;
-- edits worker master data, outlets, settings
create or replace function public.can_write() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','hr_admin','hr_manager','admin','manager'), false)
$$;
-- manages users (Super Admin; HR Admin if allowed)
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','admin') or (public.my_role() = 'hr_admin' and public.hr_flag('manageUsers')), false)
$$;
create or replace function public.can_view_salary() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','hr_manager','admin','manager') or (public.my_role() = 'hr_admin' and public.hr_flag('viewSalary')), false)
$$;
create or replace function public.can_delete_workers() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','admin') or (public.my_role() = 'hr_admin' and public.hr_flag('deleteWorkers')), false)
$$;
create or replace function public.salary_keys() returns text[] language sql immutable as $$
  select array['initialBasicPay','increments','allowances','bankName','bankAccount','loans','deductions']
$$;

-- ---------- audit log ----------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text,
  user_role text,
  action text not null,
  entity text,
  entity_id text,
  summary text,
  details jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
drop policy if exists "audit read" on public.audit_log;
create policy "audit read" on public.audit_log for select to authenticated
  using (public.is_super() or (public.my_role() = 'hr_admin' and public.hr_flag('viewAudit')));

create or replace function public.audit(p_action text, p_entity text, p_id text, p_summary text, p_details jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare n text; r text;
begin
  select coalesce(nullif(full_name,''), email), role into n, r from public.profiles where id = auth.uid();
  insert into public.audit_log (user_id, user_name, user_role, action, entity, entity_id, summary, details)
  values (auth.uid(), coalesce(n, 'system'), r, p_action, p_entity, p_id, p_summary, p_details);
end $$;
revoke execute on function public.audit(text,text,text,text,jsonb) from public, anon, authenticated;

-- profile guard: who may change whom (+ keep one active Super Admin)
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.my_role();
begin
  new.updated_at := now();
  new.id := old.id; new.email := old.email;
  if auth.uid() is not null then
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

create or replace function public.profiles_audit() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role or new.status is distinct from old.status or new.outlet_ids is distinct from old.outlet_ids then
    perform public.audit('user.update', 'profile', new.id::text,
      coalesce(new.email,'') || ': ' || old.role || '/' || old.status || ' → ' || new.role || '/' || new.status,
      jsonb_build_object('old', jsonb_build_object('role', old.role, 'status', old.status, 'outlets', old.outlet_ids),
                         'new', jsonb_build_object('role', new.role, 'status', new.status, 'outlets', new.outlet_ids)));
  end if;
  return null;
end $$;
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after update on public.profiles for each row execute function public.profiles_audit();

-- remap existing roles (UPDATE only)
update public.profiles set role = case role when 'admin' then 'super_admin' when 'manager' then 'hr_manager' else role end
 where role in ('admin','manager');
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin','hr_admin','hr_manager','outlet_manager','viewer'));

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(424242);
  if not exists (select 1 from public.profiles where role = 'super_admin' and status = 'active') then
    insert into public.profiles (id, email, full_name, role, status)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'super_admin', 'active');
  else
    insert into public.profiles (id, email, full_name, role, status)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'viewer', 'pending');
  end if;
  return new;
end $$;

drop policy if exists "read own or admin reads all" on public.profiles;
create policy "read own or admin reads all" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "admin updates" on public.profiles;
create policy "admin updates" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin deletes" on public.profiles;
create policy "admin deletes" on public.profiles for delete to authenticated
  using (public.is_super() and id <> auth.uid());

-- config policies + audit
drop policy if exists "config read" on public.app_config;
create policy "config read" on public.app_config for select to authenticated using (public.is_active_user());
drop policy if exists "config write" on public.app_config;
create policy "config write" on public.app_config for insert to authenticated with check (public.is_super());
drop policy if exists "config update" on public.app_config;
create policy "config update" on public.app_config for update to authenticated using (public.is_super()) with check (public.is_super());
create or replace function public.app_config_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now(); new.updated_by := auth.uid();
  perform public.audit('config.update', 'config', new.key, 'Changed ' || new.key,
    jsonb_build_object('old', case when tg_op = 'UPDATE' then old.value end, 'new', new.value));
  return new;
end $$;
drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch before insert or update on public.app_config for each row execute function public.app_config_touch();

-- ======================= Records: outlet scoping =======================
alter table public.records add column if not exists worker_id text;
create index if not exists records_worker_idx on public.records (worker_id);
alter table public.records drop constraint if exists records_entity_check;
alter table public.records add constraint records_entity_check check (entity in ('workers','outlets','jobs','settings','remarks'));

create or replace function public.worker_outlet(wid text) returns text language sql stable security definer set search_path = public as $$
  select data->>'outletId' from public.records where entity = 'workers' and id = wid
$$;
create or replace function public.can_see_worker(wid text) returns boolean language sql stable security definer set search_path = public as $$
  select case when wid is null then false
    when public.is_staff() then true
    when public.my_role() = 'outlet_manager' then coalesce(public.worker_outlet(wid) = any(public.my_outlets()), false)
    else false end
$$;

create or replace function public.records_lww() returns trigger language plpgsql as $$
declare k text;
begin
  if tg_op = 'UPDATE' and new.client_ts < old.client_ts then
    return null; -- older write loses
  end if;
  new.server_ts := clock_timestamp();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.worker_id := case new.entity when 'workers' then new.id
    when 'remarks' then coalesce(new.data->>'workerId', case when tg_op = 'UPDATE' then old.worker_id end) else null end;
  if tg_op = 'UPDATE' and new.entity = 'workers' and auth.uid() is not null then
    if new.deleted and not old.deleted and not public.can_delete_workers() then
      raise exception 'You are not allowed to delete workers';
    end if;
    -- people who cannot see salary never overwrite it (their copy has no salary fields)
    if not public.can_view_salary() and not new.deleted then
      foreach k in array public.salary_keys() loop
        if old.data ? k then new.data := jsonb_set(new.data, array[k], old.data->k); else new.data := new.data - k; end if;
      end loop;
    end if;
  end if;
  return new;
end $$;

create or replace function public.records_after() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; changed text[] := '{}';
begin
  if new.entity = 'workers' then
    if tg_op = 'UPDATE' then
      if new.deleted and not old.deleted then
        perform public.audit('worker.delete', 'worker', new.id, 'Deleted worker ' || coalesce(old.data->>'workerNo','') || ' ' || coalesce(old.data->>'fullName',''));
      elsif not new.deleted then
        foreach k in array public.salary_keys() loop
          if (old.data->k) is distinct from (new.data->k) then changed := changed || k; end if;
        end loop;
        if array_length(changed, 1) > 0 then
          perform public.audit('worker.salary_change', 'worker', new.id,
            coalesce(new.data->>'workerNo','') || ' ' || coalesce(new.data->>'fullName','') || ': ' || array_to_string(changed, ', '),
            jsonb_build_object('fields', changed, 'old', (select jsonb_object_agg(x, old.data->x) from unnest(changed) x), 'new', (select jsonb_object_agg(x, new.data->x) from unnest(changed) x)));
        end if;
        -- worker moved to another outlet: re-send his remarks so the right outlet managers get them
        if (old.data->>'outletId') is distinct from (new.data->>'outletId') then
          update public.records set client_ts = client_ts where entity = 'remarks' and worker_id = new.id;
        end if;
      end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists records_after on public.records;
create trigger records_after after insert or update on public.records for each row execute function public.records_after();

-- live-update signal for every role (realtime on records itself would leak salary to restricted roles)
create table if not exists public.sync_ticks (id int primary key, ts timestamptz not null default now());
insert into public.sync_ticks (id) values (1) on conflict do nothing;
alter table public.sync_ticks enable row level security;
drop policy if exists "ticks read" on public.sync_ticks;
create policy "ticks read" on public.sync_ticks for select to authenticated using (public.is_active_user());
create or replace function public.bump_sync_tick() returns trigger language plpgsql security definer set search_path = public as $$
begin update public.sync_ticks set ts = clock_timestamp() where id = 1; return null; end $$;
drop trigger if exists records_tick on public.records;
create trigger records_tick after insert or update on public.records for each statement execute function public.bump_sync_tick();

-- direct table access: only roles that may see everything (incl. salary); everyone else uses the RPCs below
drop policy if exists "active users read" on public.records;
create policy "active users read" on public.records for select to authenticated
  using (public.is_active_user() and (entity in ('outlets','jobs','settings')
    or (entity = 'workers' and public.can_view_salary())
    or (entity = 'remarks' and public.can_see_worker(worker_id))));
drop policy if exists "writers insert" on public.records;
create policy "writers insert" on public.records for insert to authenticated
  with check (public.can_write() and public.can_view_salary() and entity <> 'remarks');
drop policy if exists "writers update" on public.records;
create policy "writers update" on public.records for update to authenticated
  using (public.can_write() and public.can_view_salary() and entity <> 'remarks')
  with check (public.can_write() and public.can_view_salary() and entity <> 'remarks');
drop policy if exists "admin hard delete" on public.records;
create policy "admin hard delete" on public.records for delete to authenticated using (public.is_super());

create or replace function public.pull_records(p_since timestamptz, p_limit int default 500)
returns table (entity text, id text, data jsonb, deleted boolean, client_ts timestamptz, server_ts timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_role() as role, public.can_view_salary() as sal, public.is_staff() as staff, public.my_outlets() as outs)
  select r.entity, r.id,
    case when not v.vis then '{}'::jsonb
         when r.entity = 'workers' and not me.sal then r.data - public.salary_keys()
         else r.data end,
    r.deleted or not v.vis, r.client_ts, r.server_ts
  from public.records r cross join me
  cross join lateral (select case
      when r.entity in ('workers','remarks') then me.staff or (me.role = 'outlet_manager' and coalesce(public.worker_outlet(r.worker_id) = any(me.outs), false))
      else true end as vis) v
  where me.role is not null and r.server_ts > p_since
  order by r.server_ts
  limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;

create or replace function public.record_keys() returns table (entity text, id text)
language sql stable security definer set search_path = public as $$
  select r.entity, r.id from public.records r where public.can_write()
$$;

create or replace function public.push_records(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_role text := public.my_role(); rejected jsonb := '[]'::jsonb; ok int := 0;
  v_entity text; v_id text; v_wid text; v_old public.records%rowtype; v_found boolean;
begin
  if v_role is null then raise exception 'Account not active'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_entity := r->>'entity'; v_id := r->>'id';
    begin
      select * into v_old from public.records x where x.entity = v_entity and x.id = v_id;
      v_found := found;
      if v_entity in ('workers','outlets','jobs','settings') then
        if not public.can_write() then raise exception 'View-only access: your role cannot change this'; end if;
      elsif v_entity = 'remarks' then
        if v_role not in ('super_admin','hr_admin','hr_manager','outlet_manager') then raise exception 'View-only access'; end if;
        v_wid := coalesce(r->'data'->>'workerId', case when v_found then v_old.worker_id end);
        if not public.can_see_worker(v_wid) then raise exception 'This worker is not in your outlets'; end if;
        if v_found and not public.can_write() and coalesce(v_old.data->>'byId', '') <> auth.uid()::text then
          raise exception 'You can only change your own remarks';
        end if;
        if not v_found then r := jsonb_set(r, '{data,byId}', to_jsonb(auth.uid()::text)); end if;
      else
        raise exception 'Unknown record type';
      end if;
      insert into public.records (entity, id, data, deleted, client_ts)
      values (v_entity, v_id, coalesce(r->'data', '{}'::jsonb), coalesce((r->>'deleted')::boolean, false), coalesce((r->>'client_ts')::timestamptz, now()))
      on conflict (entity, id) do update set data = excluded.data, deleted = excluded.deleted, client_ts = excluded.client_ts;
      ok := ok + 1;
    exception when others then
      rejected := rejected || jsonb_build_object('entity', v_entity, 'id', v_id, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', ok, 'rejected', rejected);
end $$;

-- backfill worker_id (additive UPDATE; data untouched)
update public.records set worker_id = id where entity = 'workers' and worker_id is null;

-- ======================= Requests & approvals =======================
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity,
  type text not null,
  worker_id text not null,
  outlet_id text,
  title text not null default '',
  data jsonb not null default '{}'::jsonb,
  amount numeric(12,2),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status text not null default 'submitted' check (status in ('submitted','returned','recommended','escalated','approved','rejected','completed','cancelled')),
  required_level text not null default 'hr_admin' check (required_level in ('hr_manager','hr_admin','super_admin')),
  created_by uuid not null default auth.uid(),
  created_by_name text,
  created_by_role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_by uuid, decided_by_name text, decided_at timestamptz,
  applied_by uuid, applied_by_name text, applied_at timestamptz,
  result jsonb
);
create index if not exists requests_worker_idx on public.requests (worker_id);
create index if not exists requests_status_idx on public.requests (status);
alter table public.requests enable row level security;

create table if not exists public.request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.requests(id) on delete cascade,
  at timestamptz not null default now(),
  by uuid default auth.uid(),
  by_name text,
  by_role text,
  action text not null,
  from_status text,
  to_status text,
  comment text
);
create index if not exists request_events_req_idx on public.request_events (request_id);
alter table public.request_events enable row level security;

create or replace function public.can_see_request(rid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests q where q.id = rid and (
    public.is_staff() or q.created_by = auth.uid()
    or (public.my_role() = 'outlet_manager' and (public.can_see_worker(q.worker_id) or q.outlet_id = any(public.my_outlets())))))
$$;
drop policy if exists "requests read" on public.requests;
create policy "requests read" on public.requests for select to authenticated
  using (public.is_active_user() and (public.is_staff() or created_by = auth.uid()
    or (public.my_role() = 'outlet_manager' and (public.can_see_worker(worker_id) or outlet_id = any(public.my_outlets())))));
drop policy if exists "events read" on public.request_events;
create policy "events read" on public.request_events for select to authenticated using (public.can_see_request(request_id));
-- no insert/update/delete policies: all changes go through the functions below

create or replace function public.rank_of(r text) returns int language sql immutable as $$
  select case r when 'hr_manager' then 1 when 'hr_admin' then 2 when 'super_admin' then 3 else 0 end
$$;
create or replace function public.request_required_level(p_type text, p_amount numeric) returns text
language plpgsql stable security definer set search_path = public as $$
declare t jsonb := public.cfg('approval_rules')->'types'->p_type; lvl text; lim numeric;
begin
  lvl := coalesce(t->>'level', 'hr_admin');
  if lvl not in ('hr_manager','hr_admin','super_admin') then lvl := 'hr_admin'; end if;
  lim := nullif(t->>'limit', '')::numeric;
  if lvl = 'hr_admin' and lim is not null and p_amount is not null and p_amount > lim then lvl := 'super_admin'; end if;
  -- company rule: loans and salary increments always need the Super Admin
  if p_type in ('loan', 'salary_increment') then lvl := 'super_admin'; end if;
  return lvl;
end $$;

create or replace function public.my_name() returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()
$$;

create or replace function public.request_create(p_type text, p_worker_id text, p_title text, p_data jsonb, p_amount numeric, p_priority text default 'normal')
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); q public.requests; t jsonb; er jsonb;
begin
  if v_role not in ('super_admin','hr_admin','hr_manager','outlet_manager') then raise exception 'Your role cannot create requests'; end if;
  if not public.can_see_worker(p_worker_id) then raise exception 'This worker is not in your outlets'; end if;
  if (select deleted from public.records where entity = 'workers' and id = p_worker_id) then raise exception 'Worker not found'; end if;
  t := public.cfg('approval_rules')->'types'->p_type;
  if t is not null and coalesce((t->>'enabled')::boolean, true) = false then raise exception 'This request type is switched off'; end if;
  if p_type = 'emergency_leave' and coalesce(p_data->>'reasonKey', '') = '' then raise exception 'Emergency leave needs a qualifying emergency reason'; end if;
  if p_type = 'emergency_leave' then
    select e into er from jsonb_array_elements(coalesce(public.cfg('emergency_reasons'), '[]'::jsonb)) e where e->>'key' = p_data->>'reasonKey';
    if er is null then raise exception 'Unknown emergency reason'; end if;
    if coalesce((er->>'relationship')::boolean, false) and coalesce(p_data->>'relationship', '') = '' then raise exception 'Choose the family member (relationship)'; end if;
    if coalesce((er->>'detailed')::boolean, false) and length(coalesce(p_data->>'reasonDetail', '')) < 40 then raise exception 'Explain the emergency in detail (at least 40 characters)'; end if;
  end if;
  insert into public.requests (type, worker_id, outlet_id, title, data, amount, priority, required_level, created_by, created_by_name, created_by_role)
  values (p_type, p_worker_id, public.worker_outlet(p_worker_id), coalesce(p_title, ''), coalesce(p_data, '{}'::jsonb), p_amount,
          case when p_priority in ('low','normal','high','urgent') then p_priority else 'normal' end,
          case when er is not null and coalesce((er->>'detailed')::boolean, false) and public.request_required_level(p_type, p_amount) = 'hr_manager'
               then 'hr_admin' else public.request_required_level(p_type, p_amount) end, auth.uid(), public.my_name(), v_role)
  returning * into q;
  insert into public.request_events (request_id, by_name, by_role, action, to_status, comment)
  values (q.id, public.my_name(), v_role, 'submit', 'submitted', null);
  return q;
end $$;

create or replace function public.request_act(p_id uuid, p_action text, p_comment text default null, p_patch jsonb default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role(); v_rank int := public.rank_of(public.my_role());
  q public.requests; v_to text; v_from text; v_stage int; v_need int; v_mine boolean;
begin
  if v_role is null then raise exception 'Account not active'; end if;
  select * into q from public.requests where id = p_id for update;
  if not found or not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  v_mine := q.created_by = auth.uid(); v_from := q.status;
  v_stage := case q.status when 'submitted' then 1 when 'recommended' then 2 when 'escalated' then 3 else null end;
  v_need := public.rank_of(q.required_level);
  v_to := q.status;

  if p_action = 'comment' then
    if coalesce(trim(p_comment), '') = '' then raise exception 'Write a comment'; end if;
  elsif p_action = 'cancel' then
    if q.status not in ('submitted','returned','recommended','escalated') then raise exception 'This request can no longer be cancelled'; end if;
    if not (v_mine or v_role = 'super_admin') then raise exception 'Only the requester can cancel'; end if;
    v_to := 'cancelled';
  elsif p_action = 'resubmit' then
    if q.status <> 'returned' or not v_mine then raise exception 'Only the requester can resubmit a returned request'; end if;
    if p_patch is not null then
      update public.requests set data = coalesce(p_patch->'data', data), amount = case when p_patch ? 'amount' then nullif(p_patch->>'amount','')::numeric else amount end,
        title = coalesce(p_patch->>'title', title) where id = p_id returning * into q;
      update public.requests set required_level = public.request_required_level(q.type, q.amount) where id = p_id returning * into q;
      v_need := public.rank_of(q.required_level);
    end if;
    v_to := 'submitted';
  elsif p_action in ('approve','forward','return','reject') then
    if v_stage is null then raise exception 'This request is not waiting for a decision'; end if;
    -- chain: HR manager reviews (submitted) → HR admin (recommended) → Super Admin (escalated); Super Admin may act at any stage
    if v_role <> 'super_admin' and v_rank <> v_stage then
      raise exception '%', case when v_rank < v_stage then 'Waiting for a higher level' else 'Waiting for HR manager review first' end;
    end if;
    if p_action in ('return','reject') and coalesce(trim(p_comment), '') = '' then raise exception 'Please write the reason'; end if;
    if p_action = 'return' then v_to := 'returned';
    elsif p_action = 'reject' then v_to := 'rejected';
    else
      if v_mine and v_role <> 'super_admin' then raise exception 'You cannot approve your own request'; end if;
      if p_action = 'approve' and v_rank >= v_need then
        if q.type = 'emergency_leave' and not exists (select 1 from public.documents d where d.request_id = q.id and d.category = 'Flight ticket' and not d.deleted) then
          raise exception 'Emergency leave needs the flight ticket attached before approval';
        end if;
        v_to := 'approved';
      elsif v_rank < v_need then
        v_to := case when v_rank = 1 then 'recommended' else 'escalated' end;
      else
        raise exception 'Use Approve';
      end if;
    end if;
  elsif p_action = 'apply' then
    if q.status <> 'approved' then raise exception 'Only approved requests can be applied'; end if;
    if not public.can_write() or v_rank < 1 then raise exception 'Only HR can apply requests'; end if;
    v_to := 'completed';
  else
    raise exception 'Unknown action %', p_action;
  end if;

  update public.requests set status = v_to, updated_at = now(),
    decided_by = case when v_to in ('approved','rejected') then auth.uid() else decided_by end,
    decided_by_name = case when v_to in ('approved','rejected') then public.my_name() else decided_by_name end,
    decided_at = case when v_to in ('approved','rejected') then now() else decided_at end,
    applied_by = case when v_to = 'completed' then auth.uid() else applied_by end,
    applied_by_name = case when v_to = 'completed' then public.my_name() else applied_by_name end,
    applied_at = case when v_to = 'completed' then now() else applied_at end,
    result = case when v_to = 'completed' then p_patch else result end
  where id = p_id returning * into q;
  insert into public.request_events (request_id, by_name, by_role, action, from_status, to_status, comment)
  values (p_id, public.my_name(), v_role, p_action, case when p_action = 'comment' then null else v_from end, case when p_action = 'comment' then null else v_to end, nullif(trim(coalesce(p_comment, '')), ''));
  if p_action not in ('comment') then
    perform public.audit('request.' || p_action, 'request', p_id::text,
      'REQ-' || q.ref_no || ' ' || q.type || ' → ' || v_to || coalesce(' (RM ' || q.amount || ')', ''), jsonb_build_object('comment', p_comment));
  end if;
  return q;
end $$;

-- data patch by the requester or HR while the request is open (e.g. add proof details); keeps a timeline entry
create or replace function public.request_note(p_id uuid, p_data jsonb, p_comment text) returns public.requests
language plpgsql security definer set search_path = public as $$
declare q public.requests;
begin
  select * into q from public.requests where id = p_id;
  if not found or not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  if not (q.created_by = auth.uid() or public.can_write()) then raise exception 'Not allowed'; end if;
  update public.requests set data = data || coalesce(p_data, '{}'::jsonb), updated_at = now() where id = p_id returning * into q;
  insert into public.request_events (request_id, by_name, by_role, action, comment) values (p_id, public.my_name(), public.my_role(), 'update', p_comment);
  return q;
end $$;

-- ======================= Document vault =======================
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  category text not null,
  title text not null default '',
  doc_no text,
  file_path text not null,
  file_name text,
  mime text,
  size_bytes integer,
  pages integer,
  issue_date date,
  expiry_date date,
  version integer not null default 1,
  group_id uuid,
  is_current boolean not null default true,
  request_id uuid references public.requests(id) on delete set null,
  ref text,
  source text not null default 'upload',
  notes text,
  uploaded_by uuid not null default auth.uid(),
  uploaded_by_name text,
  uploaded_at timestamptz not null default now(),
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists documents_worker_idx on public.documents (worker_id);
create index if not exists documents_group_idx on public.documents (group_id);
create index if not exists documents_request_idx on public.documents (request_id);
alter table public.documents enable row level security;

create or replace function public.is_restricted_category(c text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(c in (select jsonb_array_elements_text(public.cfg('vault')->'restricted')), false)
$$;
create or replace function public.can_see_document(p_worker text, p_category text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and public.can_see_worker(p_worker)
    and not (public.my_role() in ('outlet_manager','viewer') and public.is_restricted_category(p_category))
$$;
drop policy if exists "documents read" on public.documents;
create policy "documents read" on public.documents for select to authenticated using (public.can_see_document(worker_id, category));
drop policy if exists "documents insert" on public.documents;
create policy "documents insert" on public.documents for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_see_worker(worker_id)
    and (public.can_write() or (public.my_role() = 'outlet_manager' and not public.is_restricted_category(category))));
drop policy if exists "documents update" on public.documents;
create policy "documents update" on public.documents for update to authenticated using (public.can_write()) with check (public.can_write());

create or replace function public.documents_before() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.group_id := coalesce(new.group_id, new.id);
    new.uploaded_by_name := coalesce(public.my_name(), new.uploaded_by_name);
    if exists (select 1 from public.documents d where d.group_id = new.group_id and d.id <> new.id) then
      if not exists (select 1 from public.documents d where d.group_id = new.group_id and public.can_see_worker(d.worker_id) and d.worker_id = new.worker_id) then
        raise exception 'Cannot add a version to this document';
      end if;
      new.version := (select max(version) + 1 from public.documents d where d.group_id = new.group_id);
    else
      new.version := 1;
    end if;
    new.is_current := true;
  else
    new.updated_at := now();
    new.id := old.id; new.file_path := old.file_path; new.uploaded_by := old.uploaded_by; new.group_id := old.group_id;
  end if;
  return new;
end $$;
drop trigger if exists documents_before on public.documents;
create trigger documents_before before insert or update on public.documents for each row execute function public.documents_before();

create or replace function public.documents_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.documents set is_current = false where group_id = new.group_id and id <> new.id and is_current;
    perform public.audit(case when new.version > 1 then 'document.new_version' else 'document.upload' end, 'document', new.id::text,
      new.category || ': ' || coalesce(nullif(new.title, ''), new.file_name, '') || ' (worker ' || new.worker_id || ', v' || new.version || ')');
    -- passport safekeeping consent uploaded → worker shows "signed copy uploaded (HR to verify)"
    if new.category = 'Passport safekeeping consent' then
      update public.records set client_ts = greatest(client_ts, now()),
        data = jsonb_set(data, '{passportSafe}', coalesce(data->'passportSafe', '{}'::jsonb)
          || jsonb_build_object('consent', 'uploaded', 'consentDocId', new.id::text, 'uploadedAt', now(), 'uploadedBy', new.uploaded_by_name))
      where entity = 'workers' and id = new.worker_id and not deleted;
    end if;
  elsif new.deleted and not old.deleted then
    perform public.audit('document.delete', 'document', new.id::text, new.category || ': ' || coalesce(nullif(new.title, ''), new.file_name, ''));
  end if;
  return null;
end $$;
drop trigger if exists documents_after on public.documents;
create trigger documents_after after insert or update on public.documents for each row execute function public.documents_after();

-- ======================= Passport safekeeping =======================
-- outlet manager / HR prints the consent form → status "pending signature"
create or replace function public.passport_forms_issued(p_worker_ids text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.my_role() not in ('super_admin','hr_admin','hr_manager','outlet_manager') then raise exception 'Not allowed'; end if;
  update public.records set client_ts = greatest(client_ts, now()),
    data = jsonb_set(data, '{passportSafe}', coalesce(data->'passportSafe', '{}'::jsonb)
      || jsonb_build_object('consent', 'pending', 'issuedAt', now(), 'issuedBy', public.my_name()))
  where entity = 'workers' and id = any(p_worker_ids) and not deleted and public.can_see_worker(id)
    and coalesce(data->'passportSafe'->>'consent', 'not_issued') in ('not_issued', 'withdrawn');
  get diagnostics n = row_count;
  return n;
end $$;

-- ======================= Storage (private bucket) =======================
create or replace function public.storage_can_read(p_name text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if not public.is_active_user() then return false; end if;
  if parts[1] = 'workers' then return public.can_see_worker(parts[2]); end if;
  if parts[1] = 'vault' then
    return exists (select 1 from public.documents d where d.file_path = p_name and public.can_see_document(d.worker_id, d.category));
  end if;
  return public.is_staff();
end $$;
create or replace function public.storage_can_upload(p_name text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if parts[1] = 'workers' then return public.can_write(); end if;
  if parts[1] = 'vault' then
    return public.can_see_worker(parts[2]) and (public.can_write() or public.my_role() = 'outlet_manager');
  end if;
  return false;
end $$;
drop policy if exists "fwm read attachments" on storage.objects;
create policy "fwm read attachments" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.storage_can_read(name));
drop policy if exists "fwm write attachments" on storage.objects;
create policy "fwm write attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.storage_can_upload(name));
drop policy if exists "fwm update attachments" on storage.objects;
create policy "fwm update attachments" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and public.can_write() and name like 'workers/%');
drop policy if exists "fwm delete attachments" on storage.objects;
create policy "fwm delete attachments" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.is_super());

-- ======================= Realtime & grants =======================
do $$
declare t text;
begin
  foreach t in array array['sync_ticks','requests','request_events','documents','app_config'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.records, public.profiles, public.push_subscriptions to authenticated;
grant select, insert, update on public.app_config, public.documents to authenticated;
grant select on public.requests, public.request_events, public.audit_log, public.sync_ticks to authenticated;
revoke all on public.app_config, public.documents, public.requests, public.request_events, public.audit_log, public.sync_ticks from anon;
revoke execute on function public.push_records(jsonb), public.pull_records(timestamptz, int), public.record_keys(),
  public.request_create(text, text, text, jsonb, numeric, text), public.request_act(uuid, text, text, jsonb),
  public.request_note(uuid, jsonb, text), public.passport_forms_issued(text[]) from anon, public;
grant execute on function public.push_records(jsonb), public.pull_records(timestamptz, int), public.record_keys(),
  public.request_create(text, text, text, jsonb, numeric, text), public.request_act(uuid, text, text, jsonb),
  public.request_note(uuid, jsonb, text), public.passport_forms_issued(text[]) to authenticated;

commit;
