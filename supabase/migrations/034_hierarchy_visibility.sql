-- 034 Hierarchy visibility: nobody sees anyone above their own level (their row, role, name, tasks or activity),
-- except the approval steps of a request they are part of (shown neutrally, no CEO overrule / review / assignment details).
-- Order: CEO (super_admin, legacy admin) > General Manager > HR Admin > HR Manager (legacy manager) > Outlet Manager > Viewer.
-- Additive: new helpers, restrictive policies, masked read views, column grants, neutral wording. No data is changed or deleted.

/* ---------- rank helpers ---------- */
create or replace function public.role_rank(r text) returns int language sql immutable set search_path = public as $$
  select case r when 'super_admin' then 5 when 'admin' then 5 when 'general_manager' then 4 when 'hr_admin' then 3
    when 'hr_manager' then 2 when 'manager' then 2 when 'outlet_manager' then 1 else 0 end
$$;
-- caller's rank; no user session (service role / server jobs) = sees all; signed-in but not active = -1 (own row only)
create or replace function public.my_rank() returns int language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null and coalesce(auth.role(), '') in ('', 'service_role') then 9
              when public.my_role() is null then -1 else public.role_rank(public.my_role()) end
$$;
create or replace function public.user_rank(p_uid uuid) returns int language sql stable security definer set search_path = public as $$
  select public.role_rank(role) from public.profiles where id = p_uid
$$;
-- may the caller see this actor (by user id and/or the role stored with the action)? Self always; superiors never.
create or replace function public.actor_ok(p_uid uuid, p_role text) returns boolean language sql stable set search_path = public as $$
  select (p_uid is not null and p_uid = auth.uid())
      or coalesce(greatest(case when p_role is not null then public.role_rank(p_role) end, public.user_rank(p_uid)), 0) <= public.my_rank()
$$;
-- who reset this user's password (only the name was stored): the latest audit entry tells the actor
create or replace function public.pw_reset_actor_ok(p_target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select public.actor_ok(a.user_id, a.user_role) from public.audit_log a
                   where a.action = 'user.password_reset' and a.entity_id = p_target::text order by a.id desc limit 1), public.my_rank() >= 5)
$$;
-- a request raised higher up is only seen by people who are part of it (current step, assigned, or acted on it)
create or replace function public.req_hier_ok(p_id uuid, p_created_by uuid, p_created_role text, p_assigned_to uuid, p_status text, p_assigned_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_rank() >= 5 or p_created_by is null or p_created_by = auth.uid() or p_assigned_to = auth.uid()
      or coalesce(greatest(case when p_created_role is not null then public.role_rank(p_created_role) end, public.user_rank(p_created_by)), 0) <= public.my_rank()
      or public.request_level(p_status, p_assigned_role) = public.chain_level(public.my_role())
      or exists (select 1 from public.request_events e where e.request_id = p_id and (e.by = auth.uid() or e.to_user = auth.uid()))
$$;
create or replace function public.req_visible(p_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.requests q where q.id = p_id
    and public.req_hier_ok(q.id, q.created_by, q.created_by_role, q.assigned_to, q.status, q.assigned_role))
$$;
grant execute on function public.role_rank(text), public.my_rank(), public.user_rank(uuid), public.actor_ok(uuid, text),
  public.pw_reset_actor_ok(uuid), public.req_hier_ok(uuid, uuid, text, uuid, text, text), public.req_visible(uuid) to authenticated;

/* ---------- rows: restrictive policies (ANDed with the existing ones) ----------
   The caller's rank / id / CEO flag are wrapped in (select …) so Postgres works them out once per query, not per row. */
drop policy if exists "hierarchy: no superiors" on public.profiles;
create policy "hierarchy: no superiors" on public.profiles as restrictive for select to authenticated
  using (id = (select auth.uid()) or public.role_rank(role) <= (select public.my_rank()));

drop policy if exists "hierarchy: no superiors" on public.requests;
create policy "hierarchy: no superiors" on public.requests as restrictive for select to authenticated
  using ((select public.my_rank()) >= 5 or public.req_hier_ok(id, created_by, created_by_role, assigned_to, status, assigned_role));

drop policy if exists "hierarchy: no superiors" on public.request_events;
create policy "hierarchy: no superiors" on public.request_events as restrictive for select to authenticated
  using ((select public.is_ceo()) or (action not like 'ceo\_%' and public.req_visible(request_id)));

drop policy if exists "hierarchy: no superiors" on public.audit_log;
create policy "hierarchy: no superiors" on public.audit_log as restrictive for select to authenticated
  using ((select public.is_ceo()) or (
        (user_id = (select auth.uid()) or coalesce(greatest(public.role_rank(user_role), public.user_rank(user_id)), 0) <= (select public.my_rank()))
    and action not like 'request.ceo\_%'
    and not (entity in ('profile','profiles')
             and coalesce(public.user_rank(case when entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then entity_id::uuid end), 0) > (select public.my_rank()))
    and public.role_rank(details->>'toRole') <= (select public.my_rank())
    and public.role_rank(details->>'role') <= (select public.my_rank())));

drop policy if exists "hierarchy: no superiors" on public.notification_deliveries;
create policy "hierarchy: no superiors" on public.notification_deliveries as restrictive for select to authenticated
  using ((select public.is_ceo()) or user_id is null or user_id = (select auth.uid()) or coalesce(public.user_rank(user_id), 0) <= (select public.my_rank()));

drop policy if exists "hierarchy: no superiors" on public.notification_events;
create policy "hierarchy: no superiors" on public.notification_events as restrictive for select to authenticated
  using ((select public.is_ceo()) or ((actor is null or actor = (select auth.uid()) or coalesce(public.user_rank(actor), 0) <= (select public.my_rank()))
    and event not in ('ceo_review','gm_assigned','user_approved_by_hr','ceo_overruled')));

/* ---------- names: masked read views + column grants ----------
   The tables keep every column (the server functions use them); signed-in users may no longer read the columns that
   name who did what. The app reads the *_v views instead: same rows as the table policies, but a superior's
   name / role / id is blank. The CEO sees everything. */
create or replace view public.profiles_v with (security_barrier = true) as
select p.id, p.email, p.full_name, p.role, p.status, p.created_at, p.updated_at, p.outlet_ids, p.phone, p.notify_optout, p.wa_optin, p.wa_optin_at,
  p.company_ids, p.requested_company_id, p.requested_outlet_id,
  case when a.ap then p.approved_by end as approved_by, case when a.ap then p.approved_by_name end as approved_by_name,
  case when a.ap then p.approved_by_role end as approved_by_role, p.approved_at,
  case when a.rj then p.rejected_by end as rejected_by, case when a.rj then p.rejected_by_name end as rejected_by_name,
  case when a.rj then p.rejected_by_role end as rejected_by_role, p.rejected_at, p.reject_reason,
  p.paused_at, case when a.pa then p.paused_by end as paused_by, case when a.pa then p.paused_by_name end as paused_by_name, p.pause_reason,
  p.resumed_at, case when a.re then p.resumed_by end as resumed_by, case when a.re then p.resumed_by_name end as resumed_by_name,
  p.deleted_at, case when a.de then p.deleted_by end as deleted_by, case when a.de then p.deleted_by_name end as deleted_by_name,
  p.must_change_password, p.pw_reset_at, case when p.pw_reset_by_name is not null and public.pw_reset_actor_ok(p.id) then p.pw_reset_by_name end as pw_reset_by_name,
  case when a.ad then p.added_by end as added_by, case when a.ad then p.added_by_name end as added_by_name,
  case when a.ad then p.added_by_role end as added_by_role, p.added_at
from public.profiles p
cross join lateral (select public.actor_ok(p.approved_by, p.approved_by_role) ap, public.actor_ok(p.rejected_by, p.rejected_by_role) rj,
  public.actor_ok(p.paused_by, null) pa, public.actor_ok(p.resumed_by, null) re, public.actor_ok(p.deleted_by, null) de,
  public.actor_ok(p.added_by, p.added_by_role) ad) a
where (p.id = auth.uid() or public.role_rank(p.role) <= public.my_rank())
  and ((p.id = auth.uid()) or public.is_ceo()
   or (public.is_gm() and (public.has_power('users.approve') or public.has_power('users.roles') or public.has_power('users.manage') or public.has_power('users.reset')
       or p.role in ('super_admin','admin','general_manager')))
   or (public.my_role() = 'hr_admin' and ((p.status = 'pending' and public.hr_may_approve(auth.uid(), p.requested_company_id, p.requested_outlet_id))
       or (p.status <> 'pending' and public.hr_flag('manageUsers') and (p.role in ('super_admin','admin','general_manager') or public.scope_within_mine(p.company_ids, p.outlet_ids))))));

create or replace function public.mask_request(q public.requests) returns public.requests language plpgsql stable set search_path = public as $$
begin
  if public.my_rank() >= 5 then return q; end if;
  if not public.actor_ok(q.created_by, q.created_by_role) then q.created_by_name := null; q.created_by_role := null; end if;
  if not public.actor_ok(q.decided_by, q.decided_by_role) then q.decided_by := null; q.decided_by_name := null; q.decided_by_role := null; end if;
  if not public.actor_ok(q.applied_by, null) then q.applied_by := null; q.applied_by_name := null; end if;
  if public.my_rank() < 1 then q.manager_decided_by_name := null; end if;
  -- assigned_to stays (an id only): the app needs it to know the step is with someone else
  if not public.actor_ok(q.assigned_to, q.assigned_role) then q.assigned_to_name := null; q.assigned_role := null; end if;
  if not public.actor_ok(q.assigned_by, q.assigned_by_role) then q.assigned_by := null; q.assigned_by_name := null; q.assigned_by_role := null; end if;
  q.ceo_updated_at := null;
  return q;
end $$;

create or replace view public.requests_v with (security_barrier = true) as
select m.*,
  -- held: assigned at a higher level to someone else — only they (or a higher level) can move it on
  (q.assigned_to is not null and q.assigned_to is distinct from auth.uid() and public.role_rank(q.assigned_by_role) > public.my_rank()) as assign_held
from public.requests q
cross join lateral (select (public.mask_request(q)).*) m
where public.is_active_user() and public.req_conf_ok(q.confidential, q.created_by)
  and (q.created_by = auth.uid() or public.can_see_worker(q.worker_id) or (q.outlet_id is not null and public.in_my_scope(q.outlet_id)))
  and public.req_hier_ok(q.id, q.created_by, q.created_by_role, q.assigned_to, q.status, q.assigned_role);

create or replace view public.request_events_v with (security_barrier = true) as
select e.id, e.request_id, e.at,
  case when a.b then e.by end as by, case when a.b then e.by_name end as by_name, case when a.b then e.by_role end as by_role,
  e.action, e.from_status, e.to_status,
  -- a hand-over note written higher up (assign / escalate / skip) stays with them, even when the hand-over names you;
  -- decisions and notes on the steps themselves are shown
  case when a.b or e.action not in ('assign','escalate','skipped') then e.comment end as comment,
  case when a.t then e.to_user end as to_user, case when a.t then e.to_name end as to_name, case when a.t then e.to_role end as to_role,
  case when a.b then e.meta end as meta
from public.request_events e
cross join lateral (select public.actor_ok(e.by, e.by_role) b, public.actor_ok(e.to_user, e.to_role) t) a
where public.can_see_request(e.request_id) and (e.action not like 'ceo\_%' or public.is_ceo()) and public.req_visible(e.request_id);

create or replace function public.mask_hr_task(t public.hr_tasks) returns public.hr_tasks language plpgsql stable set search_path = public as $$
begin
  if public.my_rank() >= 5 then return t; end if;
  -- a removed account has no rank any more: its stored name could be a superior's, so it is not shown
  if not public.actor_ok(t.created_by, null) or (t.created_by is not null and public.user_rank(t.created_by) is null and t.created_by <> auth.uid())
    then t.created_by := null; t.created_by_name := null; end if;
  if not public.actor_ok(t.done_by, null) or (t.done_by is not null and public.user_rank(t.done_by) is null and t.done_by <> auth.uid())
    then t.done_by := null; t.done_by_name := null; end if;
  t.title := replace(t.title, 'Adjust to the CEO''s changes: ', 'Adjust to the final decision: ');
  t.details := regexp_replace(t.details, ' — CEO: .*$', '');
  return t;
end $$;
create or replace view public.hr_tasks_v with (security_barrier = true) as
select m.* from public.hr_tasks t cross join lateral (select (public.mask_hr_task(t)).*) m
where public.my_role() in ('super_admin','admin','general_manager','hr_admin','hr_manager') and (t.worker_id is null or public.can_see_worker(t.worker_id));

grant execute on function public.mask_request(public.requests), public.mask_hr_task(public.hr_tasks) to authenticated;
revoke all on public.profiles_v, public.requests_v, public.request_events_v, public.hr_tasks_v from anon, public;
grant select on public.profiles_v, public.requests_v, public.request_events_v, public.hr_tasks_v to authenticated;

-- Backward compatible with v1.3.8 clients: the base tables keep their full column grants (old apps select '*').
-- Superior ROWS are hidden by the restrictive policies above; v1.3.9+ reads the masked *_v views for names.
-- The column lock that also hides superior NAMES on the base tables is held back in
-- supabase/pending/hierarchy_column_lock.sql — apply it only once no v1.3.8-or-older client is in use.
grant select on public.profiles, public.requests, public.request_events, public.hr_tasks to authenticated;

/* ---------- server functions: neutral wording, masked results ---------- */
do $$
declare src text; n int;
begin
  -- request_act
  src := pg_get_functiondef('public.request_act(uuid,text,text,jsonb)'::regprocedure);
  src := replace(src, $q$raise exception 'The CEO has made the final decision on this request — it is locked';$q$,
                      $q$raise exception 'A final decision has been made on this request — it is locked';$q$);
  src := replace(src, $q$raise exception 'Assigned to % (%) — only they or the CEO can decide this now', q.assigned_to_name, public.role_label(q.assigned_role);$q$,
                      $q$if public.actor_ok(q.assigned_to, q.assigned_role) then raise exception 'Assigned to % (%) — only they can decide this now', q.assigned_to_name, public.role_label(q.assigned_role);
      else raise exception 'This step is with the next approver — you cannot decide it now'; end if;$q$);
  src := replace(src, E'  return q;\nend', E'  return public.mask_request(q);\nend');
  if src like '%CEO has made the final%' or src like '%or the CEO can decide%' or src not like '%return public.mask_request(q);%' then raise exception 'request_act(): pattern not found'; end if;
  execute src;

  -- request_manager_act
  src := pg_get_functiondef('public.request_manager_act(uuid,text,text)'::regprocedure);
  src := replace(src, $q$raise exception 'Assigned to % (%) — only they or the CEO can decide this now', q.assigned_to_name, public.role_label(q.assigned_role);$q$,
                      $q$if public.actor_ok(q.assigned_to, q.assigned_role) then raise exception 'Assigned to % (%) — only they can decide this now', q.assigned_to_name, public.role_label(q.assigned_role);
      else raise exception 'This step is with the next approver — you cannot decide it now'; end if;$q$);
  if src like '%or the CEO can decide%' then raise exception 'request_manager_act(): pattern not found'; end if;
  execute src;

  -- request_note
  src := pg_get_functiondef('public.request_note(uuid,jsonb,text)'::regprocedure);
  src := replace(src, $q$raise exception 'The CEO has made the final decision on this request — it is locked';$q$,
                      $q$raise exception 'A final decision has been made on this request — it is locked';$q$);
  src := replace(src, E'  return q;\nend', E'  return public.mask_request(q);\nend');
  if src like '%CEO has made the final%' or src not like '%return public.mask_request(q);%' then raise exception 'request_note(): pattern not found'; end if;
  execute src;

  -- request_assign (CEO / GM only)
  src := pg_get_functiondef('public.request_assign(uuid,uuid,text)'::regprocedure);
  src := replace(src, $q$raise exception 'The CEO has made the final decision on this request — only the CEO can reassign it';$q$,
                      $q$raise exception 'A final decision has been made on this request — it cannot be reassigned';$q$);
  src := replace(src, $q$raise exception 'The CEO assigned this request — only the CEO (or the person it is assigned to) can reassign it';$q$,
                      $q$raise exception 'This request is held at a higher level — only the person it is assigned to can move it on';$q$);
  src := replace(src, $q$raise exception 'Already assigned to %', t.name;$q$,
                      $q$raise exception 'Already assigned to %', case when public.role_rank(t.role) > public.my_rank() then 'the next approval step' else t.name end;$q$);
  src := replace(src, E'  return q;\nend', E'  return public.mask_request(q);\nend');
  if src like '%The CEO assigned this%' or src like '%only the CEO can reassign%' or src not like '%return public.mask_request(q);%' then raise exception 'request_assign(): pattern not found'; end if;
  execute src;

  -- hr_task_done
  src := pg_get_functiondef('public.hr_task_done(uuid,text)'::regprocedure);
  src := replace(src, E'  return t;\nend', E'  return public.mask_hr_task(t);\nend');
  if src not like '%return public.mask_hr_task(t);%' then raise exception 'hr_task_done(): pattern not found'; end if;
  execute src;

  -- notify(): a superior's name / role / CEO note never reaches a lower level
  src := pg_get_functiondef('public.notify(text,text,uuid,jsonb,text,uuid[])'::regprocedure);
  if src not like '%vr jsonb; v_ar int%' then  -- re-running 034 leaves an already-patched notify() alone
  src := replace(src, $q$  rec record; ch text;$q$, $q$  vr jsonb; v_ar int := coalesce(public.user_rank(auth.uid()), 0); rec record; ch text;$q$);
  src := replace(src, $q$select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name,$q$, $q$select distinct p.id, p.role, coalesce(nullif(p.full_name, ''), p.email) as name,$q$);
  n := position(E'  loop\n    foreach ch in array' in src);
  if n = 0 or src not like '%vr jsonb; v_ar int%' or src not like '%p.id, p.role, coalesce%' then raise exception 'notify(): pattern not found'; end if;
  declare head text := left(src, n - 1); body text := substr(src, n); m int := position('-- the worker' in lower(body));
  begin
    if m = 0 then m := position($q$'Worker ' ||$q$ in body); end if;
    if m = 0 then raise exception 'notify(): worker section not found'; end if;
    src := head || replace(replace(replace(left(body, m - 1),
        E'  loop\n    foreach ch in array', E'  loop\n    vr := v;\n    if v_ar > public.role_rank(rec.role) then\n      vr := v || jsonb_build_object(''by'', '''', ''byRole'', ''Management'') || case when p_event = ''ceo_overruled'' then jsonb_build_object(''comment'', '''') else ''{}''::jsonb end;\n    end if;\n    foreach ch in array'),
        ', v)', ', vr)'), 'then v end', 'then vr end') || substr(body, m);
  end;
  if src not like '%vr := v;%' or src not like '%notify_render(ev->>''title'', vr)%' then raise exception 'notify(): render pattern not found'; end if;
  execute src;
  end if;
end $$;

-- assign / escalate picker: people above the caller show as one neutral "Next approval step" (escalating stays allowed)
create or replace function public.request_assignees(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rank int := public.my_rank();
begin
  if not (public.is_ceo() or public.my_role() = 'general_manager') then raise exception 'Only the CEO or the General Manager can assign requests' using errcode = '42501'; end if;
  if not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  return (
    with t as (select x.*, public.role_rank(x.role) > v_rank as up from public.request_assign_targets(p_id) x),
    u as (select * from t where not up
          union all
          select * from (select * from t where up order by level, name limit 1) a)
    select coalesce(jsonb_agg(case when u.up then jsonb_build_object('id', u.id, 'name', 'Next approval step', 'role', 'next_step', 'roleLabel', 'Next approval step')
                                   else jsonb_build_object('id', u.id, 'name', u.name, 'role', u.role, 'roleLabel', public.role_label(u.role)) end
                              order by u.level, u.name), '[]'::jsonb) from u);
end $$;

/* ---------- notification wording: no "the CEO" in what lower levels receive (only if still the shipped default) ---------- */
update public.app_config set value = jsonb_set(value, '{events,ceo_overruled}', (value->'events'->'ceo_overruled')
    || case when value->'events'->'ceo_overruled'->>'title' = '{{ref}} {{type}} updated by the CEO — now {{status}}' then jsonb_build_object('title', '{{ref}} {{type}} — final decision: {{status}}') else '{}'::jsonb end
    || case when value->'events'->'ceo_overruled'->>'body' = '{{worker}}: the CEO made the final decision. {{comment}}' then jsonb_build_object('body', '{{worker}}: a final decision has been made — the request is locked.') else '{}'::jsonb end
    || case when value->'events'->'ceo_overruled'->>'email' = '{{ref}} {{type}} for {{worker}} was updated by the CEO and is now {{status}}. {{comment}} {{link}}' then jsonb_build_object('email', '{{ref}} {{type}} for {{worker}}: a final decision has been made and it is now {{status}}. {{link}}') else '{}'::jsonb end)
where key = 'notifications' and value->'events' ? 'ceo_overruled';
update public.app_config set value = jsonb_set(value, '{events,hr_task_created}', (value->'events'->'hr_task_created')
    || case when value->'events'->'hr_task_created'->>'body' = '{{count}} follow-up task(s) after the CEO''s decision. Open Requests → Follow-ups.' then jsonb_build_object('body', '{{count}} follow-up task(s) after the final decision. Open Requests → Follow-ups.') else '{}'::jsonb end)
where key = 'notifications' and value->'events' ? 'hr_task_created';
