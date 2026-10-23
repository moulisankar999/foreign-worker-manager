-- 007: Companies + new-user approvals (Super Admin and, if allowed, HR Admins). Additive only:
-- new columns / functions / policies, config rows inserted if missing, outlets backfilled with companyId 'main' (UPDATE only).
begin;

-- ---------- columns ----------
alter table public.profiles add column if not exists company_ids text[] not null default '{}';
alter table public.profiles add column if not exists requested_company_id text;
alter table public.profiles add column if not exists requested_outlet_id text;
alter table public.profiles add column if not exists approved_by uuid;
alter table public.profiles add column if not exists approved_by_name text;
alter table public.profiles add column if not exists approved_by_role text;
alter table public.profiles add column if not exists approved_at timestamptz;
alter table public.profiles add column if not exists rejected_by uuid;
alter table public.profiles add column if not exists rejected_by_name text;
alter table public.profiles add column if not exists rejected_by_role text;
alter table public.profiles add column if not exists rejected_at timestamptz;
alter table public.profiles add column if not exists reject_reason text;

-- ---------- config ----------
insert into public.app_config (key, value) values ('companies', '{"items":[{"id":"main","name":"Main company"}]}'::jsonb) on conflict (key) do nothing;
insert into public.app_config (key, value) values ('user_approvals', '{"hrAdmins":{}}'::jsonb) on conflict (key) do nothing;
update public.app_config set value = jsonb_set(value, '{events,user_approved_by_hr}',
  '{"label":"New user approved by an HR Admin","group":"Users","critical":false,"enabled":true,"recipients":["super_admin"],"channels":{"in_app":true,"push":true},"worker":{},"title":"{{title}}","sms":""}'::jsonb)
 where key = 'notifications' and value ? 'events' and not (value->'events' ? 'user_approved_by_hr');

-- every outlet belongs to a company (existing outlets → 'main', which the Super Admin can rename / split)
update public.records set data = data || '{"companyId":"main"}'::jsonb
 where entity = 'outlets' and coalesce(data->>'companyId', '') = '';

-- ---------- scope helpers ----------
create or replace function public.company_exists(c text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' = c)
$$;
create or replace function public.outlet_company(o text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(data->>'companyId', '') from public.records where entity = 'outlets' and id = o), 'main')
$$;
create or replace function public.my_companies() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select company_ids from public.profiles where id = auth.uid() and status = 'active'), '{}')
$$;
-- does a user (role + companies + outlets) cover this outlet? Super Admin: everything. HR / viewer with no
-- companies and no outlets: everything (as before). Otherwise: his outlets + every outlet of his companies.
create or replace function public.scope_ok(p_role text, p_companies text[], p_outlets text[], p_outlet text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_role in ('super_admin','admin') then true
    when p_role in ('hr_admin','hr_manager','viewer','manager') and coalesce(cardinality(p_companies), 0) = 0 and coalesce(cardinality(p_outlets), 0) = 0 then true
    when p_outlet is null then false
    else p_outlet = any(coalesce(p_outlets, '{}')) or public.outlet_company(p_outlet) = any(coalesce(p_companies, '{}')) end
$$;
create or replace function public.is_unscoped() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','admin') or (public.is_staff() and cardinality(public.my_companies()) = 0 and cardinality(public.my_outlets()) = 0), false)
$$;
create or replace function public.in_my_scope(p_outlet text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() is not null and public.scope_ok(public.my_role(), public.my_companies(), public.my_outlets(), p_outlet), false)
$$;
-- is a target user's scope (companies + outlets) inside mine? (HR Admin managing users)
create or replace function public.scope_within_mine(p_companies text[], p_outlets text[]) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_unscoped() or (
    coalesce(cardinality(p_companies), 0) + coalesce(cardinality(p_outlets), 0) > 0
    and coalesce(p_companies, '{}') <@ public.my_companies()
    and not exists (select 1 from unnest(coalesce(p_outlets, '{}')) o where not public.in_my_scope(o)))
$$;

create or replace function public.can_see_worker(wid text) returns boolean language sql stable security definer set search_path = public as $$
  select case when wid is null then false
    when public.my_role() in ('super_admin','admin') then true
    when public.is_staff() or public.my_role() = 'outlet_manager' then public.in_my_scope(public.worker_outlet(wid))
    else false end
$$;

-- ---------- approval rules for HR Admins (Super Admin sets them in Settings → Users) ----------
create or replace function public.approval_rule(p_uid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(public.cfg('user_approvals')->'hrAdmins'->(p_uid::text), '{}'::jsonb)
$$;
create or replace function public.signup_company(p_company text, p_outlet text) returns text language sql stable security definer set search_path = public as $$
  select case when p_outlet is not null then public.outlet_company(p_outlet) else p_company end
$$;
-- may this HR Admin (p_uid) handle a sign-up that asked for this company/outlet? Unassigned sign-ups: Super Admin only.
create or replace function public.hr_may_approve(p_uid uuid, p_company text, p_outlet text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'hr_admin' and p.status = 'active' from public.profiles p where p.id = p_uid), false)
    and coalesce((public.approval_rule(p_uid)->>'enabled')::boolean, false)
    and public.signup_company(p_company, p_outlet) is not null
    and (public.approval_rule(p_uid)->'companies' ? '*' or public.approval_rule(p_uid)->'companies' ? public.signup_company(p_company, p_outlet))
$$;
create or replace function public.hr_grantable_roles(p_uid uuid) returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select array_agg(x) from jsonb_array_elements_text(public.approval_rule(p_uid)->'roles') x where x in ('hr_admin','hr_manager','outlet_manager','viewer')),
                  array['outlet_manager','viewer'])
$$;
-- may HR Admin p_uid give this scope? (non-empty, inside the companies he may manage)
create or replace function public.hr_scope_ok(p_uid uuid, p_companies text[], p_outlets text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(cardinality(p_companies), 0) + coalesce(cardinality(p_outlets), 0) > 0
    and (public.approval_rule(p_uid)->'companies' ? '*' or (
      not exists (select 1 from unnest(coalesce(p_companies, '{}')) c where not (public.approval_rule(p_uid)->'companies' ? c))
      and not exists (select 1 from unnest(coalesce(p_outlets, '{}')) o where not (public.approval_rule(p_uid)->'companies' ? public.outlet_company(o)))))
$$;

-- ---------- profiles: read / guard / audit ----------
drop policy if exists "read own or admin reads all" on public.profiles;
create policy "read own or admin reads all" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_super()
    or (public.my_role() = 'hr_admin' and (
         (status = 'pending' and public.hr_may_approve(auth.uid(), requested_company_id, requested_outlet_id))
      or (status <> 'pending' and public.hr_flag('manageUsers') and (role in ('super_admin','admin') or public.scope_within_mine(company_ids, outlet_ids))))));

create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); me uuid := auth.uid(); v_reason text := new.reject_reason;
begin
  new.updated_at := now();
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  -- system-stamped columns are never taken from the client
  new.requested_company_id := old.requested_company_id; new.requested_outlet_id := old.requested_outlet_id;
  new.approved_by := old.approved_by; new.approved_by_name := old.approved_by_name; new.approved_by_role := old.approved_by_role; new.approved_at := old.approved_at;
  new.rejected_by := old.rejected_by; new.rejected_by_name := old.rejected_by_name; new.rejected_by_role := old.rejected_by_role; new.rejected_at := old.rejected_at;
  new.reject_reason := old.reject_reason;
  new.company_ids := coalesce(new.company_ids, '{}'); new.outlet_ids := coalesce(new.outlet_ids, '{}');
  if new.role in ('super_admin','admin') then new.outlet_ids := '{}'; new.company_ids := '{}'; end if;
  if me is not null and not (old.id = me and new.role = old.role and new.status = old.status and new.outlet_ids = old.outlet_ids
       and new.company_ids = old.company_ids and new.full_name is not distinct from old.full_name) then
    if r in ('super_admin','admin') then
      null;
    elsif r = 'hr_admin' and old.status = 'pending' then
      -- a new sign-up: only HR Admins the Super Admin allowed, for the companies he allowed, with the roles he allowed
      if not public.hr_may_approve(me, old.requested_company_id, old.requested_outlet_id) then
        raise exception 'You are not allowed to approve this sign-up (only the Super Admin can, or it is for a company you do not manage)';
      end if;
      if new.status <> 'inactive' then
        if not (new.role = any(public.hr_grantable_roles(me))) then raise exception 'You are not allowed to give the role %', new.role; end if;
        if new.status = 'active' and not public.hr_scope_ok(me, new.company_ids, new.outlet_ids) then
          raise exception 'Choose the company / outlets for this user (only companies you may manage)';
        end if;
      end if;
    elsif r = 'hr_admin' and public.hr_flag('manageUsers') then
      if old.role = 'super_admin' or new.role = 'super_admin' then raise exception 'Only a Super Admin can change Super Admin accounts'; end if;
      if (new.role = 'hr_admin' and old.role <> 'hr_admin') or (old.role = 'hr_admin' and old.id <> me) then raise exception 'Only a Super Admin can add or change HR Admins'; end if;
      if old.id <> me and not (public.scope_within_mine(old.company_ids, old.outlet_ids) and public.scope_within_mine(new.company_ids, new.outlet_ids)) then
        raise exception 'This user is outside the companies / outlets you manage';
      end if;
      if old.id = me and (new.company_ids <> old.company_ids or new.outlet_ids <> old.outlet_ids) then raise exception 'Only a Super Admin can change your own companies'; end if;
    else
      raise exception 'You are not allowed to change users';
    end if;
  end if;
  if old.status = 'pending' and new.status = 'active' then
    new.approved_by := me; new.approved_at := now();
    new.approved_by_name := case when me is null then 'System' else public.my_name() end;
    new.approved_by_role := coalesce(r, 'system');
  elsif old.status = 'pending' and new.status = 'inactive' then
    new.rejected_by := me; new.rejected_at := now();
    new.rejected_by_name := case when me is null then 'System' else public.my_name() end;
    new.rejected_by_role := coalesce(r, 'system'); new.reject_reason := nullif(left(coalesce(v_reason, ''), 500), '');
  end if;
  if old.role in ('super_admin','admin') and old.status = 'active' and (new.role not in ('super_admin','admin') or new.status <> 'active') then
    if not exists (select 1 from public.profiles where role in ('super_admin','admin') and status = 'active' and id <> old.id) then
      raise exception 'There must be at least one active Super Admin';
    end if;
  end if;
  return new;
end $$;

create or replace function public.role_label(r text) returns text language sql immutable as $$
  select case r when 'super_admin' then 'Super Admin' when 'hr_admin' then 'HR Admin' when 'hr_manager' then 'HR Manager'
    when 'outlet_manager' then 'Outlet Manager' when 'viewer' then 'Viewer' else coalesce(r, '') end
$$;

create or replace function public.profiles_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text := coalesce(nullif(new.full_name, ''), new.email, ''); v_sup uuid[];
begin
  if new.role is distinct from old.role or new.status is distinct from old.status or new.outlet_ids is distinct from old.outlet_ids
     or new.company_ids is distinct from old.company_ids then
    perform public.audit(
      case when old.status = 'pending' and new.status = 'active' then 'user.approve'
           when old.status = 'pending' and new.status = 'inactive' then 'user.reject' else 'user.update' end,
      'profile', new.id::text,
      case when old.status = 'pending' and new.status = 'active' then coalesce(new.email,'') || ' approved as ' || public.role_label(new.role) || ' by ' || coalesce(new.approved_by_name, '') || ' (' || public.role_label(new.approved_by_role) || ')'
           when old.status = 'pending' and new.status = 'inactive' then coalesce(new.email,'') || ' rejected by ' || coalesce(new.rejected_by_name, '') || ' (' || public.role_label(new.rejected_by_role) || ')' || coalesce(': ' || new.reject_reason, '')
           else coalesce(new.email,'') || ': ' || old.role || '/' || old.status || ' → ' || new.role || '/' || new.status end,
      jsonb_build_object('old', jsonb_build_object('role', old.role, 'status', old.status, 'outlets', old.outlet_ids, 'companies', old.company_ids),
                         'new', jsonb_build_object('role', new.role, 'status', new.status, 'outlets', new.outlet_ids, 'companies', new.company_ids),
                         'requested', jsonb_build_object('company', old.requested_company_id, 'outlet', old.requested_outlet_id)));
  end if;
  if old.status = 'pending' and new.status <> 'pending' then
    -- the sign-up is handled: clear the "waiting" item from everyone's inbox
    update public.notification_deliveries set read_at = coalesce(read_at, now())
     where event = 'user_awaiting_approval' and channel = 'in_app' and dedupe_key like 'newuser:' || new.id || '|%';
    if new.status = 'active' and coalesce(new.approved_by_role, '') = 'hr_admin' then
      select array_agg(id) into v_sup from public.profiles where role = 'super_admin' and status = 'active';
      if v_sup is not null then
        begin
          perform public.notify('user_approved_by_hr', null, null,
            jsonb_build_object('title', 'User ' || v_name || ' approved by HR Admin ' || coalesce(new.approved_by_name, '') || ' as ' || public.role_label(new.role)),
            'userapproved:' || new.id, v_sup);
        exception when others then raise warning 'notify failed: %', sqlerrm;
        end;
      end if;
    end if;
  end if;
  return null;
end $$;

-- new sign-ups may name a company / outlet (validated; anything unknown → unassigned)
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_out text := nullif(new.raw_user_meta_data->>'outlet_id', ''); v_com text := nullif(new.raw_user_meta_data->>'company_id', '');
begin
  perform pg_advisory_xact_lock(424242);
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
end $$;

-- "waiting for access": Super Admins always; HR Admins only for companies they may approve
create or replace function public.profiles_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare v_to uuid[]; v_where text;
begin
  if new.status = 'pending' then
    select array_agg(p.id) into v_to from public.profiles p where p.status = 'active'
      and (p.role = 'super_admin' or (p.role = 'hr_admin' and public.hr_may_approve(p.id, new.requested_company_id, new.requested_outlet_id)));
    v_where := coalesce((select data->>'name' from public.records where entity = 'outlets' and id = new.requested_outlet_id),
                        (select e->>'name' from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' = new.requested_company_id limit 1));
    if v_to is not null then
      perform public.notify('user_awaiting_approval', null, null,
        jsonb_build_object('title', coalesce(nullif(new.full_name, ''), new.email) || coalesce(' (' || v_where || ')', '')), 'newuser:' || new.id, v_to);
    end if;
  end if;
  return null;
exception when others then raise warning 'notify failed: %', sqlerrm; return null;
end $$;

-- ---------- approval RPCs (the guard above enforces the same rules on any direct update) ----------
create or replace function public.approve_user(p_id uuid, p_role text, p_company_ids text[] default '{}', p_outlet_ids text[] default '{}')
returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if public.my_role() not in ('super_admin','hr_admin') then raise exception 'You are not allowed to approve users'; end if;
  if p_role not in ('super_admin','hr_admin','hr_manager','outlet_manager','viewer') then raise exception 'Unknown role'; end if;
  if exists (select 1 from unnest(coalesce(p_company_ids, '{}')) c where not public.company_exists(c)) then raise exception 'Unknown company'; end if;
  if exists (select 1 from unnest(coalesce(p_outlet_ids, '{}')) o where not exists (select 1 from public.records where entity = 'outlets' and id = o and not deleted)) then raise exception 'Unknown outlet'; end if;
  update public.profiles set role = p_role, status = 'active', company_ids = coalesce(p_company_ids, '{}'), outlet_ids = coalesce(p_outlet_ids, '{}')
   where id = p_id and status = 'pending' returning * into p;
  if not found then raise exception 'This sign-up is no longer waiting (already handled?)'; end if;
  return p;
end $$;
create or replace function public.reject_user(p_id uuid, p_reason text default null)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if public.my_role() not in ('super_admin','hr_admin') then raise exception 'You are not allowed to reject users'; end if;
  update public.profiles set status = 'inactive', reject_reason = p_reason where id = p_id and status = 'pending' returning * into p;
  if not found then raise exception 'This sign-up is no longer waiting (already handled?)'; end if;
  return p;
end $$;

-- public sign-up form: company + outlet NAMES only (nothing else)
create or replace function public.signup_options() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', e->>'id', 'name', e->>'name') order by e->>'name')
                           from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e), '[]'::jsonb),
    'outlets', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', data->>'name', 'companyId', coalesce(nullif(data->>'companyId', ''), 'main')) order by data->>'name')
                         from public.records where entity = 'outlets' and not deleted), '[]'::jsonb))
$$;

-- ---------- data scoping by company ----------
create or replace function public.logo_path_ok(p_path text, p_kind text, p_id text) returns boolean language sql immutable as $$
  select array_length(string_to_array(p_path, '/'), 1) = 3 and split_part(p_path, '/', 1) = p_kind
     and split_part(p_path, '/', 2) = p_id and split_part(p_path, '/', 3) ~ '^[0-9]+\.(png|jpg)$'
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
  if new.entity = 'outlets' then
    if coalesce(new.data->>'companyId', '') = '' then
      new.data := new.data || jsonb_build_object('companyId', case when tg_op = 'UPDATE' then coalesce(nullif(old.data->>'companyId', ''), 'main')
                                                                  when cardinality(public.my_companies()) > 0 then (public.my_companies())[1] else 'main' end);
    end if;
    if auth.uid() is not null and not public.is_super() then
      if tg_op = 'UPDATE' and (new.data->>'companyId') is distinct from coalesce(nullif(old.data->>'companyId', ''), 'main') then
        raise exception 'Only the Super Admin can move an outlet to another company';
      end if;
      if not public.is_unscoped() and not ((new.data->>'companyId') = any(public.my_companies()) or new.id = any(public.my_outlets())) then
        raise exception 'This outlet is not in your companies';
      end if;
    end if;
  end if;
  if new.entity = 'outlets' and coalesce(new.data->>'logo', '') <> '' and not public.logo_path_ok(new.data->>'logo', 'outlet', new.id) then
    raise exception 'Invalid outlet logo';
  end if;
  if new.entity = 'outlets' and auth.uid() is not null and tg_op = 'UPDATE' and (new.data->>'logo') is distinct from (old.data->>'logo')
     and public.my_role() not in ('super_admin','admin','hr_admin','hr_manager') then
    raise exception 'Only Super Admin, HR Admin or HR Manager can change logos';
  end if;
  if new.entity = 'workers' and auth.uid() is not null and not public.is_unscoped() then
    if (tg_op = 'UPDATE' and not public.in_my_scope(old.data->>'outletId')) or not public.in_my_scope(new.data->>'outletId') then
      raise exception 'This worker is not in your companies / outlets';
    end if;
  end if;
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

drop policy if exists "active users read" on public.records;
create policy "active users read" on public.records for select to authenticated
  using (public.is_active_user() and (entity in ('outlets','jobs','settings')
    or (entity = 'workers' and public.can_view_salary() and public.can_see_worker(id))
    or (entity = 'remarks' and public.can_see_worker(worker_id))));

create or replace function public.pull_records(p_since timestamptz, p_limit int default 500)
returns table (entity text, id text, data jsonb, deleted boolean, client_ts timestamptz, server_ts timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_role() as role, public.can_view_salary() as sal, public.is_unscoped() as allw,
                     public.my_outlets() as outs, public.my_companies() as comps)
  select r.entity, r.id,
    case when not v.vis then '{}'::jsonb
         when r.entity = 'workers' and not me.sal then r.data - public.salary_keys()
         else r.data end,
    r.deleted or not v.vis, r.client_ts, r.server_ts
  from public.records r cross join me
  cross join lateral (select case
      when r.entity in ('workers','remarks') then me.allw or coalesce(public.scope_ok(me.role, me.comps, me.outs, public.worker_outlet(r.worker_id)), false)
      else true end as vis) v
  where me.role is not null and r.server_ts > p_since
  order by r.server_ts
  limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;

create or replace function public.can_see_request(rid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests q where q.id = rid and (
    q.created_by = auth.uid() or public.can_see_worker(q.worker_id) or (q.outlet_id is not null and public.in_my_scope(q.outlet_id) and public.my_role() is not null)))
$$;
drop policy if exists "requests read" on public.requests;
create policy "requests read" on public.requests for select to authenticated
  using (public.is_active_user() and (created_by = auth.uid() or public.can_see_worker(worker_id) or (outlet_id is not null and public.in_my_scope(outlet_id))));

-- ---------- notifications follow the same company scope ----------
create or replace function public.notify(p_event text, p_worker text, p_request uuid, p_vars jsonb default '{}'::jsonb, p_dedupe text default null, p_users uuid[] default null)
returns bigint language plpgsql security definer set search_path = public as $$
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
        or ('user_admins' = any(tokens) and (p.role = 'super_admin' or (p.role = 'hr_admin' and public.hr_flag('manageUsers'))))
        or ('approver' = any(tokens) and q.id is not null and p.role = case q.status when 'submitted' then 'hr_manager' when 'recommended' then 'hr_admin' when 'escalated' then 'super_admin' end)
      ) end)
      -- company / outlet scope: people only hear about workers they can see
      and (p_users is not null or outlet is null or q.created_by = p.id or public.scope_ok(p.role, p.company_ids, p.outlet_ids, outlet))
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
  if p_worker is not null then
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
end $$;
revoke execute on function public.notify(text, text, uuid, jsonb, text, uuid[]) from public, anon, authenticated;

create or replace function public.notify_digest(p_day date) returns void language plpgsql security definer set search_path = public as $$
declare p record; body text; ev jsonb := public.cfg('notifications')->'events'->'daily_digest'; mine int; exp int; soon int; cons int; outp int; outs text[]; staff boolean;
begin
  if ev is null or not coalesce((ev->>'enabled')::boolean, true) or not (coalesce((ev->'channels'->>'email')::boolean, false) or coalesce((ev->'channels'->>'whatsapp')::boolean, false)) then return; end if;
  for p in select * from public.profiles where status = 'active' and (email is not null or phone is not null) loop
    staff := p.role in ('super_admin','hr_admin','hr_manager','viewer');
    outs := p.outlet_ids;
    select count(*) into mine from public.requests q where
      ((p.role = 'hr_manager' and q.status = 'submitted') or (p.role = 'hr_admin' and q.status = 'recommended')
      or (p.role = 'super_admin' and q.status = 'escalated') or (q.created_by = p.id and q.status = 'returned')
      or (p.role = 'hr_manager' and q.status = 'approved'))
      and (q.created_by = p.id or public.scope_ok(p.role, p.company_ids, p.outlet_ids, q.outlet_id));
    select count(*) filter (where (d->>'expiryDate')::date < p_day), count(*) filter (where (d->>'expiryDate')::date between p_day and p_day + 30)
      into exp, soon
    from public.records w cross join lateral jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) d
    where w.entity = 'workers' and not w.deleted and coalesce(d->>'expiryDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(w.data->>'status', '') not in ('Absconded','Resigned','Terminated','Contract Ended','Repatriated')
      and public.scope_ok(p.role, p.company_ids, p.outlet_ids, w.data->>'outletId');
    select count(*) filter (where data->'passportSafe'->>'consent' in ('pending','uploaded')),
           count(*) filter (where data->'passportSafe'->>'custody' = 'released')
      into cons, outp from public.records w
      where entity = 'workers' and not deleted and public.scope_ok(p.role, p.company_ids, p.outlet_ids, w.data->>'outletId');
    if mine + exp + soon + cons + outp = 0 then continue; end if;
    body := 'Requests needing your action: ' || mine || E'\n' || 'Documents expired: ' || exp || E'\n' || 'Documents expiring in 30 days: ' || soon
      || E'\n' || 'Passport consents pending: ' || cons || E'\n' || 'Passports out of the safe: ' || outp;
    perform public.notify('daily_digest', null, null, jsonb_build_object('count', mine::text, 'soon', soon::text, 'expired', exp::text, 'date', to_char(p_day, 'DD Mon YYYY'), 'digest', body), 'digest:' || p_day || ':' || p.id, array[p.id]);
  end loop;
end $$;
revoke execute on function public.notify_digest(date) from public, anon, authenticated;

revoke execute on function public.approve_user(uuid, text, text[], text[]), public.reject_user(uuid, text) from public, anon;
grant execute on function public.approve_user(uuid, text, text[], text[]), public.reject_user(uuid, text) to authenticated;
revoke execute on function public.signup_options() from public;
grant execute on function public.signup_options() to anon, authenticated;
revoke execute on function public.approval_rule(uuid), public.hr_may_approve(uuid, text, text), public.hr_grantable_roles(uuid), public.hr_scope_ok(uuid, text[], text[]),
  public.scope_ok(text, text[], text[], text) from public, anon;
grant execute on function public.approval_rule(uuid), public.hr_may_approve(uuid, text, text), public.hr_grantable_roles(uuid), public.hr_scope_ok(uuid, text[], text[]),
  public.scope_ok(text, text[], text[], text) to authenticated;
revoke execute on function public.company_exists(text), public.outlet_company(text), public.my_companies(), public.is_unscoped(), public.in_my_scope(text),
  public.scope_within_mine(text[], text[]), public.signup_company(text, text) from public, anon;
grant execute on function public.company_exists(text), public.outlet_company(text), public.my_companies(), public.is_unscoped(), public.in_my_scope(text),
  public.scope_within_mine(text[], text[]), public.signup_company(text, text) to authenticated;

-- ---------- logos (companies + outlets): private bucket, visible only to signed-in users of that company / outlet ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 262144, array['image/png','image/jpeg'])
on conflict (id) do nothing;

-- object names: company/<companyId>/<version>.png|jpg  or  outlet/<outletId>/<version>.png|jpg
create or replace function public.logo_can_read(p_name text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if not public.is_active_user() or array_length(parts, 1) <> 3 then return false; end if;
  if public.is_unscoped() then return true; end if;
  if parts[1] = 'outlet' then return public.in_my_scope(parts[2]); end if;
  if parts[1] = 'company' then
    return parts[2] = any(public.my_companies())
      or exists (select 1 from unnest(public.my_outlets()) o where public.outlet_company(o) = parts[2]);
  end if;
  return false;
end $$;
create or replace function public.logo_can_write(p_name text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if public.my_role() not in ('super_admin','admin','hr_admin','hr_manager') or array_length(parts, 1) <> 3
     or parts[3] !~ '^[0-9]+\.(png|jpg)$' then return false; end if;
  if parts[1] = 'company' then
    return public.company_exists(parts[2]) and (public.is_unscoped() or parts[2] = any(public.my_companies()));
  end if;
  if parts[1] = 'outlet' then
    return exists (select 1 from public.records where entity = 'outlets' and id = parts[2] and not deleted) and public.in_my_scope(parts[2]);
  end if;
  return false;
end $$;
drop policy if exists "fwm read logos" on storage.objects;
create policy "fwm read logos" on storage.objects for select to authenticated using (bucket_id = 'logos' and public.logo_can_read(name));
drop policy if exists "fwm write logos" on storage.objects;
create policy "fwm write logos" on storage.objects for insert to authenticated with check (bucket_id = 'logos' and public.logo_can_write(name));
drop policy if exists "fwm update logos" on storage.objects;
create policy "fwm update logos" on storage.objects for update to authenticated using (bucket_id = 'logos' and public.logo_can_write(name)) with check (bucket_id = 'logos' and public.logo_can_write(name));
drop policy if exists "fwm delete logos" on storage.objects;
create policy "fwm delete logos" on storage.objects for delete to authenticated using (bucket_id = 'logos' and public.logo_can_write(name));

-- company logo lives in app_config 'companies' (Super Admin list); HR Admin / HR Manager may set it for their companies
create or replace function public.set_company_logo(p_company text, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if p_path is not null and (not public.logo_path_ok(p_path, 'company', p_company)
       or not public.logo_can_write(p_path)) then raise exception 'Not allowed'; end if;
  if p_path is null and not public.logo_can_write('company/' || p_company || '/0.png') then raise exception 'Not allowed'; end if;
  update public.app_config set value = jsonb_set(value, '{items}', (
      select coalesce(jsonb_agg(case when e->>'id' = p_company then (case when p_path is null then e - 'logo' else e || jsonb_build_object('logo', p_path) end) else e end), '[]'::jsonb)
      from jsonb_array_elements(value->'items') e)), updated_at = now()
   where key = 'companies' returning value into v;
  perform public.audit('company.logo', 'company', p_company, case when p_path is null then 'Logo removed' else 'Logo updated' end, jsonb_build_object('path', p_path));
  return v;
end $$;
revoke execute on function public.set_company_logo(text, text), public.logo_can_read(text), public.logo_can_write(text) from public, anon;
grant execute on function public.set_company_logo(text, text), public.logo_can_read(text), public.logo_can_write(text) to authenticated;

-- live updates of the user list / own profile (realtime respects the read policy above)
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

commit;
