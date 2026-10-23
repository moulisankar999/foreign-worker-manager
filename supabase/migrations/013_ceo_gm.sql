-- 013 (v1.2.0): "Super Admin" is shown as "CEO" (internal key stays super_admin) + new role General Manager (general_manager),
-- GM powers checklist (CEO-only), GM-final approvals, CEO review / overrule / recall / lock, HR follow-up tasks.
-- Additive & non-destructive: one CHECK constraint widened, new columns / tables / functions / config rows (only if missing),
-- existing functions & policies redefined. No data is deleted; existing users keep their roles.
begin;

-- ---------------------------------------------------------------- role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('super_admin','general_manager','hr_admin','hr_manager','outlet_manager','viewer'));

-- ---------------------------------------------------------------- powers
create or replace function public.gm_power_keys() returns text[] language sql immutable as $$
  select array['users.approve','users.roles','users.manage','users.reset','users.audit',
               'hr.flags','hr.approvers',
               'org.companies','org.outlets','org.logos',
               'workers.edit','workers.delete','workers.salary','workers.vault',
               'requests.final','requests.loans','requests.increments','requests.cancel','requests.rules','requests.emergency',
               'passport.settings','passport.consent',
               'notifications.settings','notifications.test',
               'agencies.edit',
               'data.export','data.import','data.demo',
               'compliance.settings','compliance.rates']
$$;

insert into public.app_config (key, value) values ('gm_powers', '{"powers":{}}'::jsonb) on conflict (key) do nothing;

-- p_uid has power p? CEO always; GM unless the CEO switched it off (all on by default); everybody else never.
create or replace function public.power_of(p_uid uuid, p_power text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case when p.status <> 'active' then false
      when p.role in ('super_admin','admin') then true
      when p.role = 'general_manager' then p_power = any(public.gm_power_keys())
           and coalesce((public.cfg('gm_powers')->'powers'->>p_power)::boolean, true)
      else false end
    from public.profiles p where p.id = p_uid), false)
$$;
create or replace function public.has_power(p_power text) returns boolean
language sql stable security definer set search_path = public as $$ select public.power_of(auth.uid(), p_power) $$;
create or replace function public.is_gm() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.my_role() = 'general_manager', false) $$;
create or replace function public.is_ceo() returns boolean
language sql stable security definer set search_path = public as $$ select coalesce(public.my_role() in ('super_admin','admin'), false) $$;
-- GM only (not CEO) with power p
create or replace function public.gm_can(p_power text) returns boolean
language sql stable security definer set search_path = public as $$ select public.is_gm() and public.has_power(p_power) $$;

-- the caller's own effective powers (for hiding buttons). Never exposes the config itself.
create or replace function public.my_powers() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.my_role() is null then '{}'::jsonb
    else coalesce((select jsonb_object_agg(k, public.has_power(k)) from unnest(public.gm_power_keys()) k), '{}'::jsonb) end
$$;

-- CEO only: read / write the GM powers checklist
create or replace function public.get_gm_powers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_ceo() then raise exception 'Only the CEO can see General Manager powers' using errcode = '42501'; end if;
  return (select coalesce(jsonb_object_agg(k, coalesce((public.cfg('gm_powers')->'powers'->>k)::boolean, true)), '{}'::jsonb) from unnest(public.gm_power_keys()) k);
end $$;

create or replace function public.set_gm_powers(p_powers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; old jsonb := public.get_gm_powers(); nw jsonb := '{}'::jsonb; off text[] := '{}'; onn text[] := '{}';
begin
  if not public.is_ceo() then raise exception 'Only the CEO can change General Manager powers' using errcode = '42501'; end if;
  if p_powers is null or jsonb_typeof(p_powers) <> 'object' then raise exception 'Invalid powers'; end if;
  foreach k in array public.gm_power_keys() loop
    nw := nw || jsonb_build_object(k, coalesce((p_powers->>k)::boolean, (old->>k)::boolean, true));
    if (old->>k)::boolean and not (nw->>k)::boolean then off := off || k; end if;
    if not (old->>k)::boolean and (nw->>k)::boolean then onn := onn || k; end if;
  end loop;
  insert into public.app_config (key, value) values ('gm_powers', jsonb_build_object('powers', nw))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  if cardinality(off) + cardinality(onn) > 0 then
    perform public.audit('update', 'gm_powers', 'gm_powers',
      'General Manager powers changed' || coalesce(': on ' || nullif(array_to_string(onn, ', '), ''), '') || coalesce('; off ' || nullif(array_to_string(off, ', '), ''), ''),
      jsonb_build_object('on', onn, 'off', off));
  end if;
  return nw;
end $$;

-- which power a final (top-level) decision on a request type needs
create or replace function public.request_power(p_type text) returns text language sql immutable as $$
  select case when p_type in ('loan','salary_advance') then 'requests.loans' when p_type = 'salary_increment' then 'requests.increments' else 'requests.final' end
$$;
-- who makes the top-level decision: active GMs with the matching power, else the CEO(s)
create or replace function public.top_approvers(p_type text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array_agg(id) from public.profiles where role = 'general_manager' and status = 'active' and public.power_of(id, public.request_power(p_type))),
    (select array_agg(id) from public.profiles where role in ('super_admin','admin') and status = 'active'), '{}')
$$;
-- routing info for the "Needs my action" list (CEO / GM only)
create or replace function public.approval_route() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.my_role() in ('super_admin','admin','general_manager') then jsonb_build_object(
    'gmFinal', exists (select 1 from public.profiles where role = 'general_manager' and status = 'active' and public.power_of(id, 'requests.final')),
    'gmLoans', exists (select 1 from public.profiles where role = 'general_manager' and status = 'active' and public.power_of(id, 'requests.loans')),
    'gmIncrements', exists (select 1 from public.profiles where role = 'general_manager' and status = 'active' and public.power_of(id, 'requests.increments')))
  else '{}'::jsonb end
$$;
-- may the caller take the top-level decision for this request type?
create or replace function public.can_top_decide(p_type text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_ceo() or public.gm_can(public.request_power(p_type))
$$;

-- app_config writes: key → power (gm_powers itself only through set_gm_powers)
create or replace function public.config_can_write(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select k is distinct from 'gm_powers' and (public.is_ceo() or public.gm_can(case k
    when 'approval_rules' then 'requests.rules' when 'hr_admin' then 'hr.flags' when 'vault' then 'workers.vault'
    when 'emergency_reasons' then 'requests.emergency' when 'wa_templates' then 'notifications.settings' when 'notifications' then 'notifications.settings'
    when 'companies' then 'org.companies' when 'user_approvals' then 'hr.approvers' when 'passport' then 'passport.settings'
    when 'consent_translations' then 'passport.consent' when 'agencies' then 'agencies.edit' when 'compliance' then 'compliance.settings'
    when 'rates' then 'compliance.rates' else 'compliance.settings' end))
$$;

drop policy if exists "config read" on public.app_config;
create policy "config read" on public.app_config for select using (public.is_active_user() and (key <> 'gm_powers' or public.is_ceo()));
drop policy if exists "config write" on public.app_config;
create policy "config write" on public.app_config for insert with check (public.config_can_write(key));
drop policy if exists "config update" on public.app_config;
create policy "config update" on public.app_config for update using (public.config_can_write(key)) with check (public.config_can_write(key));

-- ---------------------------------------------------------------- helpers (GM)
create or replace function public.role_label(r text) returns text language sql immutable as $$
  select case r when 'super_admin' then 'CEO' when 'admin' then 'CEO' when 'general_manager' then 'General Manager' when 'hr_admin' then 'HR Admin'
    when 'hr_manager' then 'HR Manager' when 'outlet_manager' then 'Outlet Manager' when 'viewer' then 'Viewer' else coalesce(r, '') end
$$;
create or replace function public.rank_of(r text) returns integer language sql immutable as $$
  select case r when 'hr_manager' then 1 when 'hr_admin' then 2 when 'general_manager' then 3 when 'super_admin' then 3 else 0 end
$$;
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','general_manager','hr_admin','hr_manager','viewer','admin','manager'), false)
$$;
create or replace function public.is_unscoped() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','admin','general_manager') or (public.is_staff() and cardinality(public.my_companies()) = 0 and cardinality(public.my_outlets()) = 0), false)
$$;
create or replace function public.scope_ok(p_role text, p_companies text[], p_outlets text[], p_outlet text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_role in ('super_admin','admin','general_manager') then true
    when p_role in ('hr_admin','hr_manager','viewer','manager') and coalesce(cardinality(p_companies), 0) = 0 and coalesce(cardinality(p_outlets), 0) = 0 then true
    when p_outlet is null then false
    else p_outlet = any(coalesce(p_outlets, '{}')) or public.outlet_company(p_outlet) = any(coalesce(p_companies, '{}')) end
$$;
create or replace function public.can_see_worker(wid text) returns boolean language sql stable security definer set search_path = public as $$
  select case when wid is null then false
    when public.my_role() in ('super_admin','admin','general_manager') then true
    when public.is_staff() or public.my_role() = 'outlet_manager' then public.in_my_scope(public.worker_outlet(wid))
    else false end
$$;
create or replace function public.can_write() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','hr_admin','hr_manager','admin','manager')
    or public.gm_can('workers.edit') or public.gm_can('org.outlets'), false)
$$;
create or replace function public.can_view_salary() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','hr_manager','admin','manager') or (public.my_role() = 'hr_admin' and public.hr_flag('viewSalary'))
    or public.gm_can('workers.salary'), false)
$$;
create or replace function public.can_view_remittance() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((public.my_role() in ('super_admin','admin','hr_admin','hr_manager','manager') or public.gm_can('workers.salary')) and public.is_active_user(), false)
$$;
create or replace function public.can_delete_workers() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','admin') or (public.my_role() = 'hr_admin' and public.hr_flag('deleteWorkers')) or public.gm_can('workers.delete'), false)
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','admin') or (public.my_role() = 'hr_admin' and public.hr_flag('manageUsers'))
    or public.gm_can('users.roles') or public.gm_can('users.approve'), false)
$$;

create or replace function public.logo_can_write(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if not (public.my_role() in ('super_admin','admin','hr_admin','hr_manager') or public.gm_can('org.logos')) or array_length(parts, 1) <> 3
     or parts[3] !~ '^[0-9]+\.(png|jpg)$' then return false; end if;
  if parts[1] = 'company' then
    return public.company_exists(parts[2]) and (public.is_unscoped() or parts[2] = any(public.my_companies()));
  end if;
  if parts[1] = 'outlet' then
    return exists (select 1 from public.records where entity = 'outlets' and id = parts[2] and not deleted) and public.in_my_scope(parts[2]);
  end if;
  return false;
end $$;

-- ---------------------------------------------------------------- policies
drop policy if exists "events read" on public.notification_events;
create policy "events read" on public.notification_events for select using (public.is_ceo() or public.gm_can('notifications.settings'));
drop policy if exists "deliveries read" on public.notification_deliveries;
create policy "deliveries read" on public.notification_deliveries for select
  using (public.is_ceo() or public.gm_can('notifications.settings') or (user_id = auth.uid() and channel = 'in_app'));
drop policy if exists "wa inbound read" on public.whatsapp_inbound;
create policy "wa inbound read" on public.whatsapp_inbound for select using (public.is_ceo() or public.gm_can('notifications.settings'));
drop policy if exists "audit read" on public.audit_log;
create policy "audit read" on public.audit_log for select
  using (public.is_ceo() or public.gm_can('users.audit') or (public.my_role() = 'hr_admin' and public.hr_flag('viewAudit')));
drop policy if exists "read own or admin reads all" on public.profiles;
create policy "read own or admin reads all" on public.profiles for select using (
  id = auth.uid() or public.is_ceo()
  or (public.is_gm() and (public.has_power('users.approve') or public.has_power('users.roles') or public.has_power('users.manage') or public.has_power('users.reset') or role in ('super_admin','admin','general_manager')))
  or (public.my_role() = 'hr_admin' and ((status = 'pending' and public.hr_may_approve(auth.uid(), requested_company_id, requested_outlet_id))
      or (status <> 'pending' and public.hr_flag('manageUsers') and (role in ('super_admin','admin','general_manager') or public.scope_within_mine(company_ids, outlet_ids))))));

-- ---------------------------------------------------------------- users
create or replace function public.approve_user(p_id uuid, p_role text, p_company_ids text[] default '{}'::text[], p_outlet_ids text[] default '{}'::text[])
returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if not (public.my_role() in ('super_admin','admin','hr_admin') or public.gm_can('users.approve')) then raise exception 'You are not allowed to approve users'; end if;
  if p_role not in ('super_admin','general_manager','hr_admin','hr_manager','outlet_manager','viewer') then raise exception 'Unknown role'; end if;
  if p_role in ('super_admin','general_manager') and not public.is_ceo() then raise exception 'Only the CEO can give the % role', public.role_label(p_role); end if;
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
  if not (public.my_role() in ('super_admin','admin','hr_admin') or public.gm_can('users.approve')) then raise exception 'You are not allowed to reject users'; end if;
  update public.profiles set status = 'inactive', reject_reason = p_reason where id = p_id and status = 'pending' returning * into p;
  if not found then raise exception 'This sign-up is no longer waiting (already handled?)'; end if;
  return p;
end $$;

create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); me uuid := auth.uid(); v_reason text := new.reject_reason;
        v_sys boolean := coalesce(current_setting('fwm.user_admin', true), '') = 'on';
begin
  new.updated_at := now();
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  new.requested_company_id := old.requested_company_id; new.requested_outlet_id := old.requested_outlet_id;
  new.approved_by := old.approved_by; new.approved_by_name := old.approved_by_name; new.approved_by_role := old.approved_by_role; new.approved_at := old.approved_at;
  new.rejected_by := old.rejected_by; new.rejected_by_name := old.rejected_by_name; new.rejected_by_role := old.rejected_by_role; new.rejected_at := old.rejected_at;
  new.reject_reason := old.reject_reason;
  if not v_sys then
    new.paused_at := old.paused_at; new.paused_by := old.paused_by; new.paused_by_name := old.paused_by_name; new.pause_reason := old.pause_reason;
    new.resumed_at := old.resumed_at; new.resumed_by := old.resumed_by; new.resumed_by_name := old.resumed_by_name;
    new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by; new.deleted_by_name := old.deleted_by_name;
    new.pw_reset_at := old.pw_reset_at; new.pw_reset_by_name := old.pw_reset_by_name;
    if not (me is not null and old.id = me and new.must_change_password = false) then new.must_change_password := old.must_change_password; end if;
    if old.status = 'deleted' then raise exception 'This user was deleted'; end if;
    if new.status is distinct from old.status and (new.status in ('paused','deleted') or old.status in ('paused','deleted')) then
      raise exception 'Use Pause / Resume / Delete in Settings → Users';
    end if;
  end if;
  new.company_ids := coalesce(new.company_ids, '{}'); new.outlet_ids := coalesce(new.outlet_ids, '{}');
  if new.role in ('super_admin','admin','general_manager') then new.outlet_ids := '{}'; new.company_ids := '{}'; end if;
  if me is not null and not (old.id = me and new.role = old.role and new.status = old.status and new.outlet_ids = old.outlet_ids
       and new.company_ids = old.company_ids and new.full_name is not distinct from old.full_name) then
    if r in ('super_admin','admin') then
      null;
    elsif r = 'general_manager' then
      if old.id = me then
        if new.role <> old.role or new.status <> old.status then raise exception 'Only the CEO can change your role'; end if;
      else
        if old.role in ('super_admin','admin','general_manager') then raise exception 'Only the CEO can change CEO or General Manager accounts'; end if;
        if new.role in ('super_admin','admin','general_manager') then raise exception 'Only the CEO can give the % role', public.role_label(new.role); end if;
        if old.status = 'pending' then
          if not public.has_power('users.approve') then raise exception 'The CEO has not allowed you to approve sign-ups'; end if;
        elsif not public.has_power('users.roles') then raise exception 'The CEO has not allowed you to change users'' roles'; end if;
      end if;
    elsif r = 'hr_admin' and old.status = 'pending' then
      if not public.hr_may_approve(me, old.requested_company_id, old.requested_outlet_id) then
        raise exception 'You are not allowed to approve this sign-up (only the CEO / General Manager can, or it is for a company you do not manage)';
      end if;
      if new.status <> 'inactive' then
        if not (new.role = any(public.hr_grantable_roles(me))) then raise exception 'You are not allowed to give the role %', new.role; end if;
        if new.status = 'active' and not public.hr_scope_ok(me, new.company_ids, new.outlet_ids) then
          raise exception 'Choose the company / outlets for this user (only companies you may manage)';
        end if;
      end if;
    elsif r = 'hr_admin' and public.hr_flag('manageUsers') then
      if old.role in ('super_admin','admin','general_manager') or new.role in ('super_admin','admin','general_manager') then raise exception 'Only the CEO can change CEO or General Manager accounts'; end if;
      if (new.role = 'hr_admin' and old.role <> 'hr_admin') or (old.role = 'hr_admin' and old.id <> me) then raise exception 'Only the CEO or General Manager can add or change HR Admins'; end if;
      if old.id <> me and not (public.scope_within_mine(old.company_ids, old.outlet_ids) and public.scope_within_mine(new.company_ids, new.outlet_ids)) then
        raise exception 'This user is outside the companies / outlets you manage';
      end if;
      if old.id = me and (new.company_ids <> old.company_ids or new.outlet_ids <> old.outlet_ids) then raise exception 'Only the CEO can change your own companies'; end if;
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
      raise exception 'There must be at least one active CEO';
    end if;
  end if;
  return new;
end $$;

create or replace function public.profiles_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_to uuid[]; v_where text;
begin
  if new.status = 'pending' then
    select array_agg(p.id) into v_to from public.profiles p where p.status = 'active'
      and (p.role = 'super_admin' or (p.role = 'general_manager' and public.power_of(p.id, 'users.approve'))
           or (p.role = 'hr_admin' and public.hr_may_approve(p.id, new.requested_company_id, new.requested_outlet_id)));
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

create or replace function public.profiles_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text := coalesce(nullif(new.full_name, ''), new.email, ''); v_sup uuid[];
begin
  if new.role is distinct from old.role or new.status is distinct from old.status or new.outlet_ids is distinct from old.outlet_ids
     or new.company_ids is distinct from old.company_ids then
    perform public.audit(
      case when old.status = 'pending' and new.status = 'active' then 'user.approve'
           when old.status = 'pending' and new.status = 'inactive' then 'user.reject'
           when new.status = 'paused' and old.status <> 'paused' then 'user.pause'
           when old.status in ('paused','inactive') and new.status = 'active' and new.resumed_at is distinct from old.resumed_at then 'user.resume'
           when new.status = 'deleted' and old.status <> 'deleted' then 'user.delete'
           else 'user.update' end,
      'profile', new.id::text,
      case when old.status = 'pending' and new.status = 'active' then coalesce(new.email,'') || ' approved as ' || public.role_label(new.role) || ' by ' || coalesce(new.approved_by_name, '') || ' (' || public.role_label(new.approved_by_role) || ')'
           when old.status = 'pending' and new.status = 'inactive' then coalesce(new.email,'') || ' rejected by ' || coalesce(new.rejected_by_name, '') || ' (' || public.role_label(new.rejected_by_role) || ')' || coalesce(': ' || new.reject_reason, '')
           when new.status = 'paused' and old.status <> 'paused' then coalesce(new.email,'') || ' paused by ' || coalesce(new.paused_by_name, '') || coalesce(': ' || new.pause_reason, '')
           when old.status in ('paused','inactive') and new.status = 'active' and new.resumed_at is distinct from old.resumed_at then coalesce(new.email,'') || ' resumed by ' || coalesce(new.resumed_by_name, '')
           when new.status = 'deleted' and old.status <> 'deleted' then v_name || ' (' || coalesce(new.email,'') || ', ' || public.role_label(old.role) || ') deleted by ' || coalesce(new.deleted_by_name, '') || ' — login removed, history kept'
           else coalesce(new.email,'') || ': ' || public.role_label(old.role) || '/' || old.status || ' → ' || public.role_label(new.role) || '/' || new.status end,
      jsonb_build_object('old', jsonb_build_object('role', old.role, 'status', old.status, 'outlets', old.outlet_ids, 'companies', old.company_ids),
                         'new', jsonb_build_object('role', new.role, 'status', new.status, 'outlets', new.outlet_ids, 'companies', new.company_ids),
                         'requested', jsonb_build_object('company', old.requested_company_id, 'outlet', old.requested_outlet_id)));
  end if;
  if old.status = 'pending' and new.status <> 'pending' then
    update public.notification_deliveries set read_at = coalesce(read_at, now())
     where event = 'user_awaiting_approval' and channel = 'in_app' and dedupe_key like 'newuser:' || new.id || '|%';
    if new.status = 'active' and coalesce(new.approved_by_role, '') in ('hr_admin','general_manager') then
      select array_agg(id) into v_sup from public.profiles where role = 'super_admin' and status = 'active';
      if v_sup is not null then
        begin
          perform public.notify('user_approved_by_hr', null, null,
            jsonb_build_object('title', 'User ' || v_name || ' approved by ' || public.role_label(new.approved_by_role) || ' ' || coalesce(new.approved_by_name, '') || ' as ' || public.role_label(new.role)),
            'userapproved:' || new.id, v_sup);
        exception when others then raise warning 'notify failed: %', sqlerrm;
        end;
      end if;
    end if;
  end if;
  return null;
end $$;

create or replace function public.user_admin_check(p_actor uuid, p_target uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare a public.profiles; t public.profiles; ar text; tr text;
begin
  select * into a from public.profiles where id = p_actor;
  select * into t from public.profiles where id = p_target;
  if a.id is null or a.status <> 'active' then return 'Your account is not active'; end if;
  ar := case a.role when 'admin' then 'super_admin' else a.role end;
  if ar not in ('super_admin','general_manager','hr_admin') then return 'You are not allowed to manage users'; end if;
  if t.id is null then return 'User not found'; end if;
  if t.status = 'deleted' then return 'This user was already deleted'; end if;
  tr := case t.role when 'admin' then 'super_admin' else t.role end;
  perform public.ua_as(p_actor);
  if p_action in ('reject_pending','delete_pending') then
    if not (t.status = 'pending' or (t.status = 'inactive' and t.approved_at is null)) then return 'This sign-up is no longer waiting (already handled?)'; end if;
    if ar = 'super_admin' then return null; end if;
    if ar = 'general_manager' then return case when public.power_of(p_actor, 'users.approve') then null else 'The CEO has not allowed you to approve or reject sign-ups' end; end if;
    if public.hr_may_approve(p_actor, t.requested_company_id, t.requested_outlet_id) then return null; end if;
    return 'Only the CEO / General Manager (or an HR Admin allowed to approve this company) can do this';
  end if;
  if t.status = 'pending' then return 'Approve or reject this sign-up first'; end if;
  if p_action = 'reset_password' then
    if tr in ('super_admin','general_manager') then
      return case when p_actor = p_target then null else 'Only that ' || public.role_label(tr) || ' can reset their own password' end;
    end if;
    if ar = 'super_admin' or p_actor = p_target then return null; end if;
    if ar = 'general_manager' then return case when public.power_of(p_actor, 'users.reset') then null else 'The CEO has not allowed you to reset passwords' end; end if;
    if not public.hr_flag('resetPasswords') then return 'The CEO has not allowed HR Admins to reset passwords (Settings → HR Admin permissions)'; end if;
    if tr = 'hr_admin' then return 'Only the CEO or General Manager can reset an HR Admin''s password'; end if;
    if not public.scope_within_mine(t.company_ids, t.outlet_ids) then return 'This user is outside the companies / outlets you manage'; end if;
    return null;
  end if;
  if p_action in ('pause','resume','delete') then
    if p_actor = p_target then return 'You cannot ' || p_action || ' your own account'; end if;
    if p_action = 'pause' and t.status <> 'active' then return 'Only active users can be paused'; end if;
    if p_action = 'resume' and t.status not in ('paused','inactive') then return 'This user is not paused'; end if;
    if p_action in ('pause','delete') and tr = 'super_admin'
       and not exists (select 1 from public.profiles where role in ('super_admin','admin') and status = 'active' and id <> t.id) then
      return 'You cannot ' || p_action || ' the last CEO';
    end if;
    if ar = 'super_admin' then return null; end if;
    if tr in ('super_admin','general_manager') then return 'Only the CEO can ' || p_action || ' a ' || public.role_label(tr); end if;
    if ar = 'general_manager' then return case when public.power_of(p_actor, 'users.manage') then null else 'The CEO has not allowed you to pause or delete users' end; end if;
    if not public.hr_flag('manageUsers') then return 'The CEO has not allowed HR Admins to manage users'; end if;
    if tr = 'hr_admin' then return 'Only the CEO or General Manager can ' || p_action || ' an HR Admin'; end if;
    if not public.scope_within_mine(t.company_ids, t.outlet_ids) then return 'This user is outside the companies / outlets you manage'; end if;
    return null;
  end if;
  return 'Unknown action';
end $$;

-- ---------------------------------------------------------------- records
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
        if v_role = 'general_manager' and v_entity = 'outlets' and not public.has_power('org.outlets') then raise exception 'The CEO has not allowed you to change outlets'; end if;
        if v_role = 'general_manager' and v_entity <> 'outlets' and not public.has_power('workers.edit') then raise exception 'The CEO has not allowed you to change workers'; end if;
      elsif v_entity = 'remarks' then
        if v_role not in ('super_admin','general_manager','hr_admin','hr_manager','outlet_manager') then raise exception 'View-only access'; end if;
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

create or replace function public.records_lww() returns trigger language plpgsql as $$
declare k text;
begin
  if tg_op = 'UPDATE' and new.client_ts < old.client_ts then
    return null;
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
    if auth.uid() is not null and not public.is_super() and not public.gm_can('org.companies') then
      if tg_op = 'UPDATE' and (new.data->>'companyId') is distinct from coalesce(nullif(old.data->>'companyId', ''), 'main') then
        raise exception 'Only the CEO can move an outlet to another company';
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
     and not (public.my_role() in ('super_admin','admin','hr_admin','hr_manager') or public.gm_can('org.logos')) then
    raise exception 'Only the CEO, General Manager, HR Admin or HR Manager can change logos';
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
    if not public.can_view_salary() and not new.deleted then
      foreach k in array public.salary_keys() loop
        if old.data ? k then new.data := jsonb_set(new.data, array[k], old.data->k); else new.data := new.data - k; end if;
      end loop;
    end if;
  end if;
  return new;
end $$;

create or replace function public.passport_forms_issued(p_worker_ids text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if public.my_role() not in ('super_admin','general_manager','hr_admin','hr_manager','outlet_manager') then raise exception 'Not allowed'; end if;
  update public.records set client_ts = greatest(client_ts, now()),
    data = jsonb_set(data, '{passportSafe}', coalesce(data->'passportSafe', '{}'::jsonb)
      || jsonb_build_object('consent', 'pending', 'issuedAt', now(), 'issuedBy', public.my_name()))
  where entity = 'workers' and id = any(p_worker_ids) and not deleted and public.can_see_worker(id)
    and coalesce(data->'passportSafe'->>'consent', 'not_issued') in ('not_issued', 'withdrawn');
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.documents_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.category = 'Flight ticket' and coalesce((select role from public.profiles where id = new.uploaded_by), '') in ('super_admin','admin','general_manager','hr_admin','hr_manager') then
    perform public.notify('ticket_uploaded', new.worker_id, new.request_id, jsonb_build_object('doc', new.category), 'doc:' || new.id);
  elsif new.category = 'Passport safekeeping consent' then
    perform public.notify('passport_consent_uploaded', new.worker_id, null, '{}'::jsonb, 'doc:' || new.id);
  end if;
  return null;
exception when others then raise warning 'notify failed: %', sqlerrm; return null;
end $$;

-- ---------------------------------------------------------------- simple power gates
do $$
declare f text; src text;
begin
  -- set_agencies / set_consent_translation / demo functions: swap the role list for a power check (body otherwise unchanged)
  for f, src in select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname in ('set_agencies','set_consent_translation','demo_data_preview','remove_demo_data') loop
    src := replace(src, $q$coalesce(public.my_role(), '') not in ('super_admin','admin','hr_admin')$q$,
      $q$not (coalesce(public.my_role(), '') in ('super_admin','admin','hr_admin') or public.gm_can($q$ || quote_literal(case f when 'set_agencies' then 'agencies.edit' else 'passport.consent' end) || $q$))$q$);
    src := replace(src, $q$coalesce(public.my_role(), '') not in ('super_admin','admin')$q$, $q$not (public.is_ceo() or public.gm_can('data.demo'))$q$);
    src := replace(src, 'Only a Super Admin can remove sample data', 'Only the CEO (or a General Manager allowed to) can remove sample data');
    execute src;
  end loop;
  for f, src in select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname in ('notify_retry','notify_test','notify_summary') loop
    src := replace(src, 'if not public.is_super() then raise exception ''Super Admin only''',
                        'if not (public.is_ceo() or public.gm_can(''notifications.test'')) then raise exception ''CEO only''');
    src := replace(src, 'where public.is_super() and', 'where (public.is_ceo() or public.gm_can(''notifications.settings'')) and');
    execute src;
  end loop;
end $$;

-- ---------------------------------------------------------------- requests: lock, review, follow-up tasks
alter table public.requests add column if not exists decided_by_role text;
alter table public.requests add column if not exists ceo_locked boolean not null default false;
alter table public.requests add column if not exists ceo_updated_at timestamptz;

-- CEO-only review queue (the GM never sees this table)
create table if not exists public.ceo_reviews (
  request_id uuid primary key references public.requests(id) on delete cascade,
  reason text not null,                      -- gm_approved | gm_rejected | rejected
  decided_by_name text, decided_by_role text, decided_at timestamptz not null default now(),
  reviewed_at timestamptz, reviewed_by uuid, reviewed_by_name text, outcome text
);
alter table public.ceo_reviews enable row level security;
drop policy if exists "ceo reads reviews" on public.ceo_reviews;
create policy "ceo reads reviews" on public.ceo_reviews for select using (public.is_ceo());
revoke insert, update, delete on public.ceo_reviews from anon, authenticated;

create table if not exists public.hr_tasks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests(id) on delete cascade, worker_id text,
  kind text not null default 'other', title text not null, details text,
  status text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now(), created_by uuid, created_by_name text,
  done_at timestamptz, done_by uuid, done_by_name text, done_note text
);
alter table public.hr_tasks enable row level security;
drop policy if exists "hr reads tasks" on public.hr_tasks;
create policy "hr reads tasks" on public.hr_tasks for select using (
  public.my_role() in ('super_admin','admin','general_manager','hr_admin','hr_manager') and (worker_id is null or public.can_see_worker(worker_id)));
revoke insert, update, delete on public.hr_tasks from anon, authenticated;

-- history: CEO-only lines are hidden from the General Manager (they see a neutral "Updated by CEO")
drop policy if exists "events read" on public.request_events;
create policy "events read" on public.request_events for select
  using (public.can_see_request(request_id) and (action not in ('ceo_overrule','ceo_recall','ceo_reviewed') or not public.is_gm()));

-- backfill: old rejections are listed on the CEO review page as already seen (no badge)
insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at, reviewed_at, reviewed_by_name, outcome)
select q.id, 'rejected', q.decided_by_name, null, coalesce(q.decided_at, q.updated_at), now(), 'before v1.2.0', 'kept'
from public.requests q where q.status = 'rejected' on conflict do nothing;

create or replace function public.request_create(p_type text, p_worker_id text, p_title text, p_data jsonb, p_amount numeric, p_priority text default 'normal')
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_role text := public.my_role(); q public.requests; t jsonb; er jsonb;
begin
  if v_role not in ('super_admin','general_manager','hr_admin','hr_manager','outlet_manager') then raise exception 'Your role cannot create requests'; end if;
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

-- note: required_level 'super_admin' now means "top level": final decision by the General Manager (CEO if no GM / power off)
create or replace function public.request_act(p_id uuid, p_action text, p_comment text default null, p_patch jsonb default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role(); v_rank int; v_top boolean; v_ceo boolean := public.is_ceo();
  q public.requests; v_to text; v_from text; v_stage int; v_need int; v_mine boolean; v_ceos uuid[];
begin
  if v_role is null then raise exception 'Account not active'; end if;
  select * into q from public.requests where id = p_id for update;
  if not found or not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  v_top := public.can_top_decide(q.type);
  v_rank := case when v_top then 3 when v_role = 'general_manager' then 0 else public.rank_of(v_role) end;
  v_mine := q.created_by = auth.uid(); v_from := q.status;
  if q.ceo_locked and not v_ceo and p_action not in ('comment','apply') then
    raise exception 'The CEO has made the final decision on this request — it is locked';
  end if;
  v_stage := case q.status when 'submitted' then 1 when 'recommended' then 2 when 'escalated' then 3 else null end;
  v_need := public.rank_of(q.required_level);
  v_to := q.status;

  if p_action = 'comment' then
    if coalesce(trim(p_comment), '') = '' then raise exception 'Write a comment'; end if;
  elsif p_action = 'cancel' then
    if q.status not in ('submitted','returned','recommended','escalated') then raise exception 'This request can no longer be cancelled'; end if;
    if not (v_mine or v_ceo or public.gm_can('requests.cancel')) then raise exception 'Only the requester can cancel'; end if;
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
    -- chain: HR Manager (submitted) → HR Admin (recommended) → General Manager final (escalated; CEO if no GM). GM/CEO may act at any stage.
    if v_role = 'general_manager' and not v_top then raise exception 'The CEO has not allowed you to decide this type of request'; end if;
    if not v_top and v_rank <> v_stage then
      raise exception '%', case when v_rank < v_stage then 'Waiting for a higher level' else 'Waiting for HR manager review first' end;
    end if;
    if p_action in ('return','reject') and coalesce(trim(p_comment), '') = '' then raise exception 'Please write the reason'; end if;
    if p_action = 'return' then v_to := 'returned';
    elsif p_action = 'reject' then v_to := 'rejected';
    else
      if v_mine and not v_ceo then raise exception 'You cannot approve your own request'; end if;
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
    if not public.can_write() or public.rank_of(v_role) < 1 then raise exception 'Only HR can apply requests'; end if;
    v_to := 'completed';
  else
    raise exception 'Unknown action %', p_action;
  end if;

  update public.requests set status = v_to, updated_at = now(),
    decided_by = case when v_to in ('approved','rejected') then auth.uid() else decided_by end,
    decided_by_name = case when v_to in ('approved','rejected') then public.my_name() else decided_by_name end,
    decided_by_role = case when v_to in ('approved','rejected') then v_role else decided_by_role end,
    decided_at = case when v_to in ('approved','rejected') then now() else decided_at end,
    applied_by = case when v_to = 'completed' then auth.uid() else applied_by end,
    applied_by_name = case when v_to = 'completed' then public.my_name() else applied_by_name end,
    applied_at = case when v_to = 'completed' then now() else applied_at end,
    result = case when v_to = 'completed' then p_patch else result end
  where id = p_id returning * into q;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
  values (p_id, auth.uid(), public.my_name(), v_role, p_action, case when p_action = 'comment' then null else v_from end, case when p_action = 'comment' then null else v_to end, nullif(trim(coalesce(p_comment, '')), ''));
  if p_action not in ('comment') then
    perform public.audit('request.' || p_action, 'request', p_id::text,
      'REQ-' || q.ref_no || ' ' || q.type || ' → ' || v_to || coalesce(' (RM ' || q.amount || ')', '') || ' by ' || public.role_label(v_role), jsonb_build_object('comment', p_comment));
  end if;
  -- CEO review queue: every GM decision and every rejection at any level (not the CEO's own)
  if not v_ceo and ((v_role = 'general_manager' and v_to in ('approved','rejected')) or v_to = 'rejected') then
    insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at)
    values (p_id, case when v_role = 'general_manager' then 'gm_' || v_to else 'rejected' end, public.my_name(), v_role, now())
    on conflict (request_id) do update set reason = excluded.reason, decided_by_name = excluded.decided_by_name, decided_by_role = excluded.decided_by_role,
      decided_at = excluded.decided_at, reviewed_at = null, reviewed_by = null, reviewed_by_name = null, outcome = null;
    select array_agg(id) into v_ceos from public.profiles where role in ('super_admin','admin') and status = 'active';
    if v_ceos is not null then
      begin
        perform public.notify('ceo_review', q.worker_id, q.id,
          jsonb_build_object('decision', case when v_to = 'approved' then 'approved' else 'rejected' end, 'by', public.my_name(), 'byRole', public.role_label(v_role),
                             'comment', coalesce(p_comment, '')), 'ceorev:' || p_id || ':' || extract(epoch from now())::bigint, v_ceos);
      exception when others then raise warning 'notify failed: %', sqlerrm;
      end;
    end if;
  end if;
  return q;
end $$;

-- follow-up data on a request (proof / ticket flags). On a CEO-locked request only these follow-up keys may change.
create or replace function public.request_note(p_id uuid, p_data jsonb, p_comment text) returns public.requests
language plpgsql security definer set search_path = public as $$
declare q public.requests;
begin
  select * into q from public.requests where id = p_id;
  if not found or not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  if not (q.created_by = auth.uid() or public.can_write()) then raise exception 'Not allowed'; end if;
  if q.ceo_locked and not public.is_ceo() and exists (select 1 from jsonb_object_keys(coalesce(p_data, '{}'::jsonb)) k
       where k not in ('proofReceived','proofWaived','ticketBooked','ticketDocId')) then
    raise exception 'The CEO has made the final decision on this request — it is locked';
  end if;
  update public.requests set data = data || coalesce(p_data, '{}'::jsonb), updated_at = now() where id = p_id returning * into q;
  insert into public.request_events (request_id, by, by_name, by_role, action, comment) values (p_id, auth.uid(), public.my_name(), public.my_role(), 'update', p_comment);
  return q;
end $$;

-- what already happened because of this request (shown as a warning before the CEO overrules)
create or replace function public.request_effects(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q public.requests; res jsonb := '[]'::jsonb;
begin
  if not public.is_ceo() then raise exception 'CEO only' using errcode = '42501'; end if;
  select * into q from public.requests where id = p_id;
  if not found then raise exception 'Request not found'; end if;
  if exists (select 1 from public.documents d where d.request_id = q.id and d.category = 'Flight ticket' and not d.deleted) or coalesce((q.data->>'ticketBooked')::boolean, false) then
    res := res || jsonb_build_array(jsonb_build_object('kind', 'ticket', 'effect', 'A flight ticket was booked', 'task', 'Cancel ticket (or change the date) for R-' || q.ref_no));
  end if;
  if q.status = 'completed' and q.type in ('salary_advance','loan') then
    res := res || jsonb_build_array(jsonb_build_object('kind', 'money', 'effect', case when q.type = 'loan' then 'The loan was paid out' else 'The advance was paid' end || coalesce(' (RM ' || q.amount || ')', ''),
      'task', 'Recover ' || case when q.type = 'loan' then 'loan' else 'advance' end || coalesce(' RM ' || q.amount, '') || ' for R-' || q.ref_no));
  end if;
  if q.status = 'completed' and q.type = 'salary_increment' then
    res := res || jsonb_build_array(jsonb_build_object('kind', 'salary', 'effect', 'The salary increment was applied to the worker record',
      'task', 'Revert salary from ' || coalesce(nullif(q.data->>'date', ''), to_char(q.applied_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'), 'the effective date') || ' for R-' || q.ref_no));
  end if;
  if q.status = 'completed' and q.type not in ('salary_advance','loan','salary_increment') then
    res := res || jsonb_build_array(jsonb_build_object('kind', 'record', 'effect', 'HR already applied this request to the worker record',
      'task', 'Undo what was applied for R-' || q.ref_no || ' (' || public.request_type_label(q.type) || ')'));
  end if;
  return res;
end $$;

-- the CEO's final word: approve / approve with changes / reject / cancel / recall / mark reviewed
create or replace function public.ceo_decide(p_id uuid, p_decision text, p_reason text default null, p_patch jsonb default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare q public.requests; v_from text; v_to text; fx jsonb := '[]'::jsonb; e jsonb; n_tasks int := 0; v_name text := public.my_name();
begin
  if not public.is_ceo() then raise exception 'Only the CEO can do this' using errcode = '42501'; end if;
  if p_decision not in ('approve','amend','reject','cancel','recall','reviewed') then raise exception 'Unknown decision'; end if;
  select * into q from public.requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  v_from := q.status;
  if p_decision = 'reviewed' then
    insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at) values (p_id, 'manual', q.decided_by_name, q.decided_by_role, coalesce(q.decided_at, now()))
    on conflict (request_id) do nothing;
    update public.ceo_reviews set reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_name = v_name, outcome = coalesce(outcome, 'kept') where request_id = p_id;
    perform public.audit('request.ceo_reviewed', 'request', p_id::text, 'R-' || q.ref_no || ' reviewed by CEO — decision kept', null);
    return q;
  end if;
  v_to := case p_decision when 'approve' then 'approved' when 'amend' then 'approved' when 'reject' then 'rejected' when 'cancel' then 'cancelled' when 'recall' then 'escalated' end;
  if p_decision in ('approve','amend') and q.status = 'completed' and p_decision = 'approve' then raise exception 'This request is already approved and applied'; end if;
  if p_decision = 'approve' and q.status = 'approved' then raise exception 'This request is already approved'; end if;
  if p_decision in ('reject','cancel') and q.status = v_to then raise exception 'This request is already %', v_to; end if;
  -- downstream effects → HR follow-up tasks (money is never reversed automatically)
  if p_decision in ('reject','cancel','amend') then fx := public.request_effects(p_id); end if;
  if p_decision = 'amend' then
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Nothing to change'; end if;
    update public.requests set data = data || coalesce(p_patch->'data', '{}'::jsonb),
      amount = case when p_patch ? 'amount' then nullif(p_patch->>'amount','')::numeric else amount end,
      title = coalesce(nullif(p_patch->>'title', ''), title) where id = p_id returning * into q;
  end if;
  update public.requests set status = v_to, updated_at = now(), ceo_locked = true, ceo_updated_at = now(),
    decided_by = case when v_to in ('approved','rejected') then auth.uid() else decided_by end,
    decided_by_name = case when v_to in ('approved','rejected') then v_name else decided_by_name end,
    decided_by_role = case when v_to in ('approved','rejected') then 'super_admin' else decided_by_role end,
    decided_at = case when v_to in ('approved','rejected') then now() else decided_at end
  where id = p_id returning * into q;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
  values (p_id, auth.uid(), v_name, 'super_admin', case when p_decision = 'recall' then 'ceo_recall' else 'ceo_overrule' end, v_from, v_to,
    nullif(trim(coalesce(p_reason, '')), ''));
  for e in select * from jsonb_array_elements(fx) loop
    if p_decision = 'amend' and e->>'kind' = 'ticket' then continue; end if;
    insert into public.hr_tasks (request_id, worker_id, kind, title, details, created_by, created_by_name)
    values (p_id, q.worker_id, e->>'kind', case when p_decision = 'amend' then 'Adjust to the CEO''s changes: ' || (e->>'task') else e->>'task' end,
            (e->>'effect') || coalesce(' — CEO: ' || nullif(trim(coalesce(p_reason, '')), ''), ''), auth.uid(), v_name);
    n_tasks := n_tasks + 1;
  end loop;
  insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at, reviewed_at, reviewed_by, reviewed_by_name, outcome)
  values (p_id, 'recalled', q.decided_by_name, q.decided_by_role, now(), now(), auth.uid(), v_name, p_decision)
  on conflict (request_id) do update set reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_name = v_name, outcome = p_decision;
  perform public.audit('request.ceo_' || p_decision, 'request', p_id::text,
    'R-' || q.ref_no || ' overruled by CEO ' || v_name || ': ' || v_from || ' → ' || v_to || coalesce(' — ' || nullif(trim(coalesce(p_reason, '')), ''), ''),
    jsonb_build_object('reason', p_reason, 'patch', p_patch, 'effects', fx, 'tasks', n_tasks));
  begin
    if p_decision <> 'recall' then
      perform public.notify('ceo_overruled', q.worker_id, q.id, jsonb_build_object('comment', coalesce(p_reason, '')), 'ceo:' || p_id || ':' || extract(epoch from now())::bigint);
    end if;
    if n_tasks > 0 then
      perform public.notify('hr_task_created', q.worker_id, q.id, jsonb_build_object('count', n_tasks::text), 'hrtask:' || p_id || ':' || extract(epoch from now())::bigint);
    end if;
  exception when others then raise warning 'notify failed: %', sqlerrm;
  end;
  return q;
end $$;

create or replace function public.hr_task_done(p_id uuid, p_note text default null) returns public.hr_tasks
language plpgsql security definer set search_path = public as $$
declare t public.hr_tasks;
begin
  if public.my_role() not in ('super_admin','admin','general_manager','hr_admin','hr_manager') then raise exception 'Not allowed'; end if;
  select * into t from public.hr_tasks where id = p_id;
  if not found or (t.worker_id is not null and not public.can_see_worker(t.worker_id)) then raise exception 'Task not found'; end if;
  update public.hr_tasks set status = 'done', done_at = now(), done_by = auth.uid(), done_by_name = public.my_name(), done_note = nullif(left(coalesce(p_note, ''), 500), '')
  where id = p_id and status = 'open' returning * into t;
  if not found then raise exception 'This task is already done'; end if;
  perform public.audit('hr_task.done', 'request', coalesce(t.request_id::text, t.id::text), 'Follow-up done: ' || t.title, jsonb_build_object('note', p_note));
  return t;
end $$;

-- ---------------------------------------------------------------- notifications
do $$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'notify';
  src := replace(src, $q$or ('user_admins' = any(tokens) and (p.role = 'super_admin' or (p.role = 'hr_admin' and public.hr_flag('manageUsers'))))$q$,
    $q$or ('user_admins' = any(tokens) and (p.role = 'super_admin' or (p.role = 'general_manager' and public.power_of(p.id, 'users.manage')) or (p.role = 'hr_admin' and public.hr_flag('manageUsers'))))$q$);
  src := replace(src, $q$or ('approver' = any(tokens) and q.id is not null and p.role = case q.status when 'submitted' then 'hr_manager' when 'recommended' then 'hr_admin' when 'escalated' then 'super_admin' end)$q$,
    $q$or ('approver' = any(tokens) and q.id is not null and (case when q.status = 'escalated' then p.id = any(public.top_approvers(q.type)) else p.role = case q.status when 'submitted' then 'hr_manager' when 'recommended' then 'hr_admin' end end))$q$);
  if src not like '%top_approvers%' or src not like '%general_manager%' then raise exception 'notify(): pattern not found'; end if;
  execute src;

  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'notify_digest';
  src := replace(src, $q$staff := p.role in ('super_admin','hr_admin','hr_manager','viewer');$q$, $q$staff := p.role in ('super_admin','general_manager','hr_admin','hr_manager','viewer');$q$);
  src := replace(src, $q$or (p.role = 'super_admin' and q.status = 'escalated')$q$, $q$or (q.status = 'escalated' and p.id = any(public.top_approvers(q.type)))$q$);
  if src not like '%top_approvers%' then raise exception 'notify_digest(): pattern not found'; end if;
  execute src;
end $$;

-- new events (only if missing) + escalations now go to the General Manager (or CEO): recipient token "approver"
update public.app_config set value = jsonb_set(value, '{events}', coalesce(value->'events', '{}'::jsonb)
  || case when value->'events' ? 'ceo_review' then '{}'::jsonb else jsonb_build_object('ceo_review', jsonb_build_object(
       'enabled', true, 'critical', false, 'recipients', '["super_admin"]'::jsonb,
       'channels', jsonb_build_object('in_app', true, 'push', true, 'email', false, 'sms', false, 'whatsapp', false),
       'title', '{{byRole}} {{by}} {{decision}} {{ref}} {{type}} — {{worker}}', 'body', '{{comment}} Tap to review or overrule.',
       'email', '{{byRole}} {{by}} {{decision}} {{ref}} {{type}} for {{worker}} ({{outlet}}). {{comment}} Review: {{link}}', 'sms', '')) end
  || case when value->'events' ? 'ceo_overruled' then '{}'::jsonb else jsonb_build_object('ceo_overruled', jsonb_build_object(
       'enabled', true, 'critical', false, 'recipients', '["participants","hr_admin"]'::jsonb,
       'channels', jsonb_build_object('in_app', true, 'push', true, 'email', false, 'sms', false, 'whatsapp', false),
       'title', '{{ref}} {{type}} updated by the CEO — now {{status}}', 'body', '{{worker}}: the CEO made the final decision. {{comment}}',
       'email', '{{ref}} {{type}} for {{worker}} was updated by the CEO and is now {{status}}. {{comment}} {{link}}', 'sms', '')) end
  || case when value->'events' ? 'hr_task_created' then '{}'::jsonb else jsonb_build_object('hr_task_created', jsonb_build_object(
       'enabled', true, 'critical', false, 'recipients', '["hr_manager","hr_admin"]'::jsonb,
       'channels', jsonb_build_object('in_app', true, 'push', true, 'email', false, 'sms', false, 'whatsapp', false),
       'title', 'HR follow-up needed: {{ref}} {{type}} — {{worker}}', 'body', '{{count}} follow-up task(s) after the CEO''s decision. Open Requests → Follow-ups.',
       'email', 'HR follow-up needed for {{ref}} {{type}} ({{worker}}): {{count}} task(s). {{link}}', 'sms', '')) end)
where key = 'notifications';
update public.app_config set value = jsonb_set(jsonb_set(value, '{events,request_escalated,recipients}', '["approver"]'::jsonb),
    '{events,request_escalated,title}', to_jsonb(replace(coalesce(value->'events'->'request_escalated'->>'title', 'Escalated: {{ref}} {{type}}'), 'Super Admin', 'General Manager')))
where key = 'notifications' and value->'events'->'request_escalated'->'recipients' = '["super_admin"]'::jsonb;
-- "Super Admin" wording in stored notification texts → "CEO" (internal recipient keys unchanged)
update public.app_config set value = replace(value::text, 'Super Admin', 'CEO')::jsonb where key = 'notifications' and value::text like '%Super Admin%';

-- ---------------------------------------------------------------- grants
do $$
declare f text;
begin
  foreach f in array array['power_of(uuid,text)','has_power(text)','is_gm()','is_ceo()','gm_can(text)','my_powers()','get_gm_powers()','set_gm_powers(jsonb)',
    'top_approvers(text)','approval_route()','can_top_decide(text)','config_can_write(text)','request_effects(uuid)','ceo_decide(uuid,text,text,jsonb)','hr_task_done(uuid,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated, service_role';
  end loop;
end $$;
-- power_of(other user) and top_approvers are internal: not callable from the app
revoke execute on function public.power_of(uuid,text) from authenticated;
revoke execute on function public.top_approvers(text) from authenticated;
grant select on public.ceo_reviews, public.hr_tasks to authenticated;

commit;
