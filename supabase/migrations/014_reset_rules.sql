-- v1.2.0 (part 2): the CEO can reset ANY user's password (incl. General Managers); a GM only with the
-- 'users.reset' power and never for the CEO or another GM; nobody resets a CEO except that CEO.
-- + DIRECT USER CREATION ("Add user"): who may create which role (server-side), active at once, "Added by <role> <name>".
-- + the hierarchy rule for editing: nobody gives the CEO role from the app or edits another CEO.
-- Additive: new columns / functions; function bodies replaced.
begin;
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
    if tr = 'super_admin' then
      return case when p_actor = p_target then null else 'Only that CEO can reset their own password' end;
    end if;
    if tr = 'general_manager' and ar <> 'super_admin' and p_actor <> p_target then
      return 'Only the CEO can reset a General Manager''s password';
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
revoke all on function public.user_admin_check(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.user_admin_check(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- GM power: create users
create or replace function public.gm_power_keys() returns text[] language sql immutable as $$
  select array['users.approve','users.create','users.roles','users.manage','users.reset','users.audit',
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

-- ---------------------------------------------------------------- who added this user
alter table public.profiles add column if not exists added_by uuid;
alter table public.profiles add column if not exists added_by_name text;
alter table public.profiles add column if not exists added_by_role text;
alter table public.profiles add column if not exists added_at timestamptz;

-- roles a person may create (strictly below their own)
create or replace function public.creatable_roles(p_actor uuid) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare a public.profiles; ar text;
begin
  if auth.uid() is not null and auth.uid() <> p_actor then return '{}'; end if; -- only your own list from the app
  select * into a from public.profiles where id = p_actor and status = 'active';
  if a.id is null then return '{}'; end if;
  ar := case a.role when 'admin' then 'super_admin' when 'manager' then 'hr_manager' else a.role end;
  return case ar
    when 'super_admin' then array['general_manager','hr_admin','hr_manager','outlet_manager','viewer']
    when 'general_manager' then case when public.power_of(p_actor, 'users.create') then array['hr_admin','hr_manager','outlet_manager','viewer'] else '{}'::text[] end
    when 'hr_admin' then array['hr_manager','outlet_manager','viewer']
    when 'hr_manager' then array['outlet_manager']
    else '{}'::text[] end;
end $$;

-- may p_actor create this user? returns {error?, duplicate?, editable?}. Called by the user-admin Edge Function.
create or replace function public.user_create_check(p_actor uuid, p_email text, p_role text, p_companies text[], p_outlets text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.profiles; ar text; d public.profiles; o text; c text; allowed text[];
begin
  select * into a from public.profiles where id = p_actor;
  if a.id is null or a.status <> 'active' then return jsonb_build_object('error', 'Your account is not active'); end if;
  ar := case a.role when 'admin' then 'super_admin' when 'manager' then 'hr_manager' else a.role end;
  perform public.ua_as(p_actor);
  allowed := public.creatable_roles(p_actor);
  if cardinality(allowed) = 0 then
    return jsonb_build_object('error', case when ar = 'general_manager' then 'The CEO has not allowed you to add users' else 'You are not allowed to add users' end);
  end if;
  if p_role in ('super_admin','admin') then return jsonb_build_object('error', 'Nobody can add a CEO from the app'); end if;
  if not (p_role = any(allowed)) then
    return jsonb_build_object('error', 'You can only add roles below your own (' || array_to_string(array(select public.role_label(x) from unnest(allowed) x), ', ') || ')');
  end if;
  p_companies := coalesce(p_companies, '{}'); p_outlets := coalesce(p_outlets, '{}');
  foreach o in array p_outlets loop
    if not exists (select 1 from public.records where entity = 'outlets' and id = o and not deleted) then return jsonb_build_object('error', 'Unknown outlet ' || o); end if;
  end loop;
  foreach c in array p_companies loop
    if not public.company_exists(c) then return jsonb_build_object('error', 'Unknown company ' || c); end if;
  end loop;
  if p_role = 'outlet_manager' and cardinality(p_outlets) = 0 then return jsonb_build_object('error', 'Choose at least one outlet for an Outlet Manager'); end if;
  if ar = 'hr_manager' then
    if cardinality(p_companies) > 0 then return jsonb_build_object('error', 'An HR Manager can only give outlets, not whole companies'); end if;
    foreach o in array p_outlets loop
      if not public.in_my_scope(o) then return jsonb_build_object('error', 'You can only add Outlet Managers for outlets in your companies'); end if;
    end loop;
  elsif ar = 'hr_admin' then
    if not public.scope_within_mine(p_companies, p_outlets) then return jsonb_build_object('error', 'Choose only companies / outlets you manage'); end if;
  end if;
  select * into d from public.profiles where lower(email) = lower(trim(p_email)) limit 1;
  if d.id is not null or exists (select 1 from auth.users where lower(email) = lower(trim(p_email))) then
    return jsonb_build_object('error', 'A user with this email already exists' || coalesce(' (' || nullif(d.full_name, '') || ', ' || public.role_label(d.role) || ', ' || d.status || ')', ''),
      'duplicate', d.id, 'editable', d.id is not null and d.status <> 'deleted' and public.rank_of(d.role) < public.rank_of(ar)
        and d.role not in ('super_admin','admin','general_manager') and (ar in ('super_admin','general_manager') or public.scope_within_mine(d.company_ids, d.outlet_ids)));
  end if;
  return '{}'::jsonb;
end $$;

-- one-time tickets for "Add user": the user-admin Edge Function (service role) writes a ticket after
-- user_create_check, then creates the auth user with the ticket's random nonce; the sign-up trigger turns the
-- ticket into an ACTIVE profile (no approval queue). A self sign-up can never guess a nonce, so it stays pending.
create table if not exists public.user_create_tickets (
  nonce text primary key, email text not null, actor uuid not null, role text not null,
  company_ids text[] not null default '{}', outlet_ids text[] not null default '{}', phone text, created_at timestamptz not null default now());
alter table public.user_create_tickets enable row level security; -- no policies: service role only
revoke all on public.user_create_tickets from anon, authenticated;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare v_out text := nullif(new.raw_user_meta_data->>'outlet_id', ''); v_com text := nullif(new.raw_user_meta_data->>'company_id', '');
        t public.user_create_tickets; b public.profiles;
begin
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
end $$;

-- audit line for a user added directly (password never passed or logged)
create or replace function public.user_create_audit(p_actor uuid, p_target uuid, p_channels text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.profiles;
begin
  select * into t from public.profiles where id = p_target;
  if t.id is null or t.added_by is distinct from p_actor then raise exception 'Not found'; end if;
  perform public.ua_as(p_actor);
  perform public.audit('user.create', 'profiles', t.id::text,
    'Added by ' || public.role_label(t.added_by_role) || ' ' || t.added_by_name || ': ' || coalesce(nullif(t.full_name, ''), t.email) || ' as ' || public.role_label(t.role),
    jsonb_build_object('email', t.email, 'role', t.role, 'companies', t.company_ids, 'outlets', t.outlet_ids, 'loginDetails', coalesce(p_channels, '{}')));
  return jsonb_build_object('name', coalesce(nullif(t.full_name, ''), t.email), 'role', t.role);
end $$;

revoke all on function public.creatable_roles(uuid) from public, anon;
grant execute on function public.creatable_roles(uuid) to authenticated, service_role;
revoke all on function public.user_create_check(uuid, text, text, text[], text[]) from public, anon, authenticated;
grant execute on function public.user_create_check(uuid, text, text, text[], text[]) to service_role;
revoke all on function public.user_create_audit(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.user_create_audit(uuid, uuid, text[]) to service_role;

-- editing: the CEO role is never handed out from the app, and a CEO's account is changed only by that CEO
do $do$
declare src text; n text;
begin
  select pg_get_functiondef('public.profiles_guard()'::regprocedure) into src;
  if position('Nobody can give the CEO role' in src) > 0 then -- re-run: make sure the system path is exempt
    n := replace(src, $a$      if old.id <> me and old.role in ('super_admin','admin') and (new.role$a$, $a$      if not v_sys and old.id <> me and old.role in ('super_admin','admin') and (new.role$a$);
  else
    n := replace(src, $a$    if r in ('super_admin','admin') then
      null;
    elsif r = 'general_manager' then$a$, $a$    if r in ('super_admin','admin') then
      if not v_sys and old.id <> me and old.role in ('super_admin','admin') and (new.role <> old.role or new.status <> old.status) then raise exception 'Only that CEO can change their own account'; end if;
      if old.id <> me and new.role in ('super_admin','admin') and old.role not in ('super_admin','admin') then raise exception 'Nobody can give the CEO role from the app'; end if;
    elsif r = 'general_manager' then$a$);
    if n = src then raise exception 'profiles_guard patch point not found'; end if;
  end if;
  if n <> src then execute n; end if;
end $do$;
commit;
