-- 010: user account management — pause / resume, delete (keeps history), admin password reset.
-- Strictly additive: widens the status check, adds nullable columns + functions, re-creates two trigger functions.
-- No rows are deleted or rewritten by this migration.

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active','pending','inactive','paused','deleted'));

alter table public.profiles add column if not exists paused_at timestamptz;
alter table public.profiles add column if not exists paused_by uuid;
alter table public.profiles add column if not exists paused_by_name text;
alter table public.profiles add column if not exists pause_reason text;
alter table public.profiles add column if not exists resumed_at timestamptz;
alter table public.profiles add column if not exists resumed_by uuid;
alter table public.profiles add column if not exists resumed_by_name text;
alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.profiles add column if not exists deleted_by uuid;
alter table public.profiles add column if not exists deleted_by_name text;
alter table public.profiles add column if not exists must_change_password boolean not null default false;
alter table public.profiles add column if not exists pw_reset_at timestamptz;
alter table public.profiles add column if not exists pw_reset_by_name text;

-- run the rest of a (service-role) transaction "as" a user so auth.uid(), my_role(), audit() … see him
create or replace function public.ua_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims', case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $$;
revoke execute on function public.ua_as(uuid) from public, anon, authenticated;

-- ---------- guard: same as 007 + the new system-stamped columns + pause/delete only through user-admin ----------
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare r text := public.my_role(); me uuid := auth.uid(); v_reason text := new.reject_reason;
        v_sys boolean := coalesce(current_setting('fwm.user_admin', true), '') = 'on';
begin
  new.updated_at := now();
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  -- system-stamped columns are never taken from the client
  new.requested_company_id := old.requested_company_id; new.requested_outlet_id := old.requested_outlet_id;
  new.approved_by := old.approved_by; new.approved_by_name := old.approved_by_name; new.approved_by_role := old.approved_by_role; new.approved_at := old.approved_at;
  new.rejected_by := old.rejected_by; new.rejected_by_name := old.rejected_by_name; new.rejected_by_role := old.rejected_by_role; new.rejected_at := old.rejected_at;
  new.reject_reason := old.reject_reason;
  if not v_sys then
    new.paused_at := old.paused_at; new.paused_by := old.paused_by; new.paused_by_name := old.paused_by_name; new.pause_reason := old.pause_reason;
    new.resumed_at := old.resumed_at; new.resumed_by := old.resumed_by; new.resumed_by_name := old.resumed_by_name;
    new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by; new.deleted_by_name := old.deleted_by_name;
    new.pw_reset_at := old.pw_reset_at; new.pw_reset_by_name := old.pw_reset_by_name;
    -- the user himself may only clear the "must change password" flag (after changing it)
    if not (me is not null and old.id = me and new.must_change_password = false) then new.must_change_password := old.must_change_password; end if;
    if old.status = 'deleted' then raise exception 'This user was deleted'; end if;
    if new.status is distinct from old.status and (new.status in ('paused','deleted') or old.status in ('paused','deleted')) then
      raise exception 'Use Pause / Resume / Delete in Settings → Users';
    end if;
  end if;
  new.company_ids := coalesce(new.company_ids, '{}'); new.outlet_ids := coalesce(new.outlet_ids, '{}');
  if new.role in ('super_admin','admin') then new.outlet_ids := '{}'; new.company_ids := '{}'; end if;
  if me is not null and not (old.id = me and new.role = old.role and new.status = old.status and new.outlet_ids = old.outlet_ids
       and new.company_ids = old.company_ids and new.full_name is not distinct from old.full_name) then
    if r in ('super_admin','admin') then
      null;
    elsif r = 'hr_admin' and old.status = 'pending' then
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

-- ---------- audit: name pause / resume / delete properly ----------
create or replace function public.profiles_audit() returns trigger language plpgsql security definer set search_path = public as $$
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
           else coalesce(new.email,'') || ': ' || old.role || '/' || old.status || ' → ' || new.role || '/' || new.status end,
      jsonb_build_object('old', jsonb_build_object('role', old.role, 'status', old.status, 'outlets', old.outlet_ids, 'companies', old.company_ids),
                         'new', jsonb_build_object('role', new.role, 'status', new.status, 'outlets', new.outlet_ids, 'companies', new.company_ids),
                         'requested', jsonb_build_object('company', old.requested_company_id, 'outlet', old.requested_outlet_id)));
  end if;
  if old.status = 'pending' and new.status <> 'pending' then
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

-- ---------- who may do what (null = allowed, else the reason) ----------
create or replace function public.user_admin_check(p_actor uuid, p_target uuid, p_action text) returns text
language plpgsql security definer set search_path = public as $$
declare a public.profiles; t public.profiles; ar text; tr text;
begin
  select * into a from public.profiles where id = p_actor;
  select * into t from public.profiles where id = p_target;
  if a.id is null or a.status <> 'active' then return 'Your account is not active'; end if;
  ar := case a.role when 'admin' then 'super_admin' else a.role end;
  if ar not in ('super_admin','hr_admin') then return 'You are not allowed to manage users'; end if;
  if t.id is null then return 'User not found'; end if;
  if t.status = 'deleted' then return 'This user was already deleted'; end if;
  tr := case t.role when 'admin' then 'super_admin' else t.role end;
  perform public.ua_as(p_actor);
  if p_action in ('reject_pending','delete_pending') then
    if not (t.status = 'pending' or (t.status = 'inactive' and t.approved_at is null)) then return 'This sign-up is no longer waiting (already handled?)'; end if;
    if ar = 'super_admin' then return null; end if;
    if public.hr_may_approve(p_actor, t.requested_company_id, t.requested_outlet_id) then return null; end if;
    return 'Only the Super Admin (or an HR Admin allowed to approve this company) can do this';
  end if;
  if t.status = 'pending' then return 'Approve or reject this sign-up first'; end if;
  if p_action = 'reset_password' then
    if tr = 'super_admin' then
      return case when p_actor = p_target then null else 'Only that Super Admin can reset their own password' end;
    end if;
    if ar = 'super_admin' or p_actor = p_target then return null; end if;
    if not public.hr_flag('resetPasswords') then return 'The Super Admin has not allowed HR Admins to reset passwords (Settings → HR Admin permissions)'; end if;
    if tr = 'hr_admin' then return 'Only a Super Admin can reset an HR Admin''s password'; end if;
    if not public.scope_within_mine(t.company_ids, t.outlet_ids) then return 'This user is outside the companies / outlets you manage'; end if;
    return null;
  end if;
  if p_action in ('pause','resume','delete') then
    if p_actor = p_target then return 'You cannot ' || p_action || ' your own account'; end if;
    if p_action = 'pause' and t.status <> 'active' then return 'Only active users can be paused'; end if;
    if p_action = 'resume' and t.status not in ('paused','inactive') then return 'This user is not paused'; end if;
    if p_action in ('pause','delete') and tr = 'super_admin'
       and not exists (select 1 from public.profiles where role in ('super_admin','admin') and status = 'active' and id <> t.id) then
      return 'You cannot ' || p_action || ' the last Super Admin';
    end if;
    if ar = 'super_admin' then return null; end if;
    if not public.hr_flag('manageUsers') then return 'The Super Admin has not allowed HR Admins to manage users'; end if;
    if tr in ('super_admin','hr_admin') then return 'Only a Super Admin can ' || p_action || ' a ' || public.role_label(tr); end if;
    if not public.scope_within_mine(t.company_ids, t.outlet_ids) then return 'This user is outside the companies / outlets you manage'; end if;
    return null;
  end if;
  return 'Unknown action';
end $$;

-- ---------- apply (called only by the user-admin Edge Function, after the auth-side change) ----------
create or replace function public.user_admin_apply(p_actor uuid, p_target uuid, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text; a public.profiles; t public.profiles; an text; tn text; dn text; n int := 0;
begin
  v := public.user_admin_check(p_actor, p_target, p_action);
  if v is not null then raise exception '%', v using errcode = '42501'; end if;
  select * into a from public.profiles where id = p_actor;
  select * into t from public.profiles where id = p_target;
  an := coalesce(nullif(a.full_name, ''), a.email); tn := coalesce(nullif(t.full_name, ''), t.email, 'user');
  perform set_config('fwm.user_admin', 'on', true);
  perform public.ua_as(p_actor);
  if p_action = 'pause' then
    update public.profiles set status = 'paused', paused_at = now(), paused_by = p_actor, paused_by_name = an, pause_reason = nullif(left(coalesce(p_note, ''), 300), '') where id = p_target;
    delete from auth.sessions where user_id = p_target;
  elsif p_action = 'resume' then
    update public.profiles set status = 'active', resumed_at = now(), resumed_by = p_actor, resumed_by_name = an where id = p_target;
  elsif p_action = 'delete' then
    update public.profiles set status = 'deleted', deleted_at = now(), deleted_by = p_actor, deleted_by_name = an,
      must_change_password = false, wa_optin = false where id = p_target;
    delete from auth.sessions where user_id = p_target;
    delete from public.push_subscriptions where user_id = p_target;
    -- history stays; only the display name changes
    dn := 'deleted user ' || tn;
    perform public.ua_as(null);
    update public.requests set created_by_name = dn where created_by = p_target; get diagnostics n = row_count;
    update public.requests set decided_by_name = dn where decided_by = p_target;
    update public.requests set applied_by_name = dn where applied_by = p_target;
    update public.request_events set by_name = dn where by = p_target;
    update public.documents set uploaded_by_name = dn where uploaded_by = p_target;
    update public.records set data = jsonb_set(data, '{by}', to_jsonb(dn)) where entity = 'remarks' and data->>'byId' = p_target::text;
    perform public.ua_as(p_actor);
  elsif p_action = 'reset_password' then
    update public.profiles set must_change_password = true, pw_reset_at = now(), pw_reset_by_name = an where id = p_target;
    perform public.audit('user.password_reset', 'profile', p_target::text, coalesce(t.email, '') || ': temporary password set by ' || an || coalesce(' (' || p_note || ')', ''), null);
  elsif p_action in ('reject_pending','delete_pending') then
    if t.status = 'pending' then
      update public.profiles set status = 'inactive', reject_reason = coalesce(nullif(p_note, ''), case when p_action = 'delete_pending' then 'Sign-up deleted' end) where id = p_target;
    end if;
    perform public.audit(case when p_action = 'reject_pending' then 'user.reject_delete' else 'user.delete_pending' end, 'profile', p_target::text,
      coalesce(t.email, '') || ' sign-up ' || case when p_action = 'reject_pending' then 'rejected' else 'deleted' end || ' and its login removed by ' || an, null);
  end if;
  perform set_config('fwm.user_admin', '', true);
  return jsonb_build_object('ok', true, 'email', t.email, 'name', tn, 'role', t.role);
end $$;

revoke execute on function public.user_admin_check(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.user_admin_apply(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.user_admin_check(uuid, uuid, text) to service_role;
grant execute on function public.user_admin_apply(uuid, uuid, text, text) to service_role;
grant execute on function public.ua_as(uuid) to service_role;

-- ---------- the signed-in person finished choosing his own password (clears "must change password") ----------
create or replace function public.password_changed() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in again'; end if;
  update public.profiles set must_change_password = false where id = auth.uid() and must_change_password;
end $$;
revoke execute on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;
