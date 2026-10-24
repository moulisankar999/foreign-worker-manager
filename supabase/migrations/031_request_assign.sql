-- 031: Assign / Escalate (CEO + General Manager) and the CEO's five actions on every request.
-- Additive: new nullable columns, new functions, and updated request functions (same signatures).
--   * request_assign(id, user, note): CEO or GM only; moves the request to any level / person, scoped to its outlet/company,
--     never to an outlet manager when confidential. Skipped steps are recorded. Audit-logged. Assignee (+ CEO when the GM assigns) notified.
--   * request_assignees(id): the people a request can be assigned to (for the picker).
--   * request_act / request_manager_act: while a request is assigned to a person, only that person (or the CEO) decides at that step.
--   * ceo_decide: Recall pulls the request to the CEO; Amend keeps the original values in history (and may keep the status);
--     Mark reviewed adds "Reviewed by CEO" to the timeline.
--   * worker_requests(): simple "with" status (e.g. With HR Admin) and the assign/escalate steps, never internal notes or names.

alter table public.requests add column if not exists assigned_to uuid;
alter table public.requests add column if not exists assigned_to_name text;
alter table public.requests add column if not exists assigned_role text;
alter table public.requests add column if not exists assigned_by uuid;
alter table public.requests add column if not exists assigned_by_name text;
alter table public.requests add column if not exists assigned_by_role text;
alter table public.requests add column if not exists assigned_at timestamptz;
create index if not exists requests_assigned_to_idx on public.requests (assigned_to) where assigned_to is not null;

alter table public.request_events add column if not exists to_user uuid;
alter table public.request_events add column if not exists to_name text;
alter table public.request_events add column if not exists to_role text;
alter table public.request_events add column if not exists meta jsonb;

-- chain position of a role / of a request (OM 0 → HRM 1 → HRA 2 → GM 3 → CEO 4)
create or replace function public.chain_level(p_role text) returns int language sql immutable as $$
  select case p_role when 'outlet_manager' then 0 when 'hr_manager' then 1 when 'hr_admin' then 2 when 'general_manager' then 3
    when 'super_admin' then 4 when 'admin' then 4 end
$$;
create or replace function public.request_level(p_status text, p_assigned_role text) returns int language sql immutable as $$
  select case p_status when 'manager_review' then 0 when 'submitted' then 1 when 'recommended' then 2
    when 'escalated' then case when p_assigned_role in ('super_admin','admin') then 4 else 3 end end
$$;

-- who may receive this request (scope + confidentiality)
create or replace function public.request_assign_targets(p_req uuid)
returns table (id uuid, name text, role text, level int)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email), p.role, public.chain_level(p.role)
  from public.requests q, public.profiles p
  where q.id = p_req and p.status = 'active'
    and p.role in ('outlet_manager','hr_manager','hr_admin','general_manager','super_admin','admin')
    and public.scope_ok(p.role, p.company_ids, p.outlet_ids, q.outlet_id)
    and (p.role <> 'outlet_manager' or (q.outlet_id is not null and not coalesce(q.confidential, false)))
    -- confidential: only the CEO, the GM and HR in scope; never an outlet manager (the complaint may be about him)
    and (not coalesce(q.confidential, false) or p.role in ('super_admin','admin','general_manager') or p.id = any(public.confidential_audience(q.outlet_id)))
    and p.id is distinct from q.created_by
$$;
revoke all on function public.request_assign_targets(uuid) from public, anon, authenticated;

create or replace function public.request_assignees(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_ceo() or public.my_role() = 'general_manager') then raise exception 'Only the CEO or the General Manager can assign requests' using errcode = '42501'; end if;
  if not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'role', t.role, 'roleLabel', public.role_label(t.role)) order by t.level, t.name), '[]'::jsonb)
          from public.request_assign_targets(p_id) t);
end $$;
revoke all on function public.request_assignees(uuid) from public, anon;
grant execute on function public.request_assignees(uuid) to authenticated;

create or replace function public.request_assign(p_id uuid, p_user uuid, p_note text default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_role text := public.my_role(); v_ceo boolean := public.is_ceo(); v_name text := public.my_name();
  q public.requests; t record; v_from text; v_to text; s int; tg int; i int; v_act text; v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
  v_skipped text[] := '{}'; v_ceos uuid[]; v_days int := coalesce((public.worker_cfg()->>'escalateDays')::int, 3); v_by text;
begin
  if not (v_ceo or v_role = 'general_manager') then raise exception 'Only the CEO or the General Manager can assign or escalate requests' using errcode = '42501'; end if;
  select * into q from public.requests where id = p_id for update;
  if not found or not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  if q.status not in ('manager_review','submitted','returned','recommended','escalated') then
    raise exception 'This request is closed (%). The CEO can Recall it first.', q.status;
  end if;
  if not v_ceo and q.ceo_locked then raise exception 'The CEO has made the final decision on this request — only the CEO can reassign it'; end if;
  if not v_ceo and q.assigned_to is not null and q.assigned_by_role in ('super_admin','admin') and q.assigned_to is distinct from auth.uid() then
    raise exception 'The CEO assigned this request — only the CEO (or the person it is assigned to) can reassign it';
  end if;
  select * into t from public.request_assign_targets(p_id) x where x.id = p_user;
  if not found then
    raise exception 'This person cannot take this request (not active, outside its company/outlet, or it is confidential)';
  end if;
  if q.assigned_to = p_user and public.request_level(q.status, q.assigned_role) = t.level then raise exception 'Already assigned to %', t.name; end if;
  v_from := q.status;
  tg := t.level;
  s := public.request_level(q.status, q.assigned_role);
  v_to := case tg when 0 then 'manager_review' when 1 then 'submitted' when 2 then 'recommended' else 'escalated' end;
  -- "Escalated" = sent above the caller's own level (GM → CEO); everything else the CEO / GM does is "Assigned"
  v_act := case when tg > public.chain_level(v_role) then 'escalate' else 'assign' end;
  v_by := public.role_label(v_role) || ' (' || coalesce(v_name, '') || ')';

  update public.requests set status = v_to, updated_at = now(),
    assigned_to = p_user, assigned_to_name = t.name, assigned_role = t.role,
    assigned_by = auth.uid(), assigned_by_name = v_name, assigned_by_role = v_role, assigned_at = now(),
    -- the CEO hands it on: the assignee must be able to act, so the CEO lock is lifted (kept when the CEO assigns to himself)
    ceo_locked = case when v_ceo and tg < 4 then false else ceo_locked end,
    -- timers restart for the new assignee
    manager_due_at = case when tg = 0 then now() + make_interval(days => v_days) else manager_due_at end,
    manager_overdue = case when tg = 0 then false else manager_overdue end
  where id = p_id returning * into q;

  if s is not null and tg > s then
    for i in s .. tg - 1 loop
      v_skipped := v_skipped || (case i when 0 then 'outlet_manager' when 1 then 'hr_manager' when 2 then 'hr_admin' else 'general_manager' end);
      insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment, to_role)
      values (p_id, auth.uid(), v_name, v_role, 'skipped', v_from, v_to, 'Skipped by ' || public.role_label(v_role),
              case i when 0 then 'outlet_manager' when 1 then 'hr_manager' when 2 then 'hr_admin' else 'general_manager' end);
    end loop;
  end if;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment, to_user, to_name, to_role, meta)
  values (p_id, auth.uid(), v_name, v_role, v_act, v_from, v_to, v_note, p_user, t.name, t.role, jsonb_build_object('skipped', to_jsonb(v_skipped)));

  perform public.audit('request.' || v_act, 'request', p_id::text,
    'R-' || q.ref_no || ' ' || case when v_act = 'escalate' then 'escalated' else 'assigned' end || ' by ' || v_by || ' → ' || public.role_label(t.role) || ': ' || t.name,
    jsonb_build_object('to', p_user, 'toName', t.name, 'toRole', t.role, 'from', v_from, 'status', v_to, 'skipped', to_jsonb(v_skipped), 'note', v_note));

  -- GM assignments go on the CEO's review list (he can reassign or overrule)
  if v_role = 'general_manager' then
    insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at)
    values (p_id, 'gm_assigned', v_name, v_role, now())
    on conflict (request_id) do update set reason = excluded.reason, decided_by_name = excluded.decided_by_name, decided_by_role = excluded.decided_by_role,
      decided_at = excluded.decided_at, reviewed_at = null, reviewed_by = null, reviewed_by_name = null, outcome = null;
  end if;
  begin
    if p_user is distinct from auth.uid() then
      perform public.notify('request_assigned', q.worker_id, q.id,
        jsonb_build_object('by', coalesce(v_name, ''), 'byRole', public.role_label(v_role), 'note', coalesce(v_note, ''),
                           'action', case when v_act = 'escalate' then 'escalated' else 'assigned' end),
        'asg:' || p_id || ':' || p_user || ':' || extract(epoch from now())::bigint, array[p_user]);
    end if;
    if v_role = 'general_manager' then
      select array_agg(id) into v_ceos from public.profiles where role in ('super_admin','admin') and status = 'active' and id is distinct from p_user;
      if v_ceos is not null then
        perform public.notify('gm_assigned', q.worker_id, q.id,
          jsonb_build_object('by', coalesce(v_name, ''), 'toName', t.name, 'toRole', public.role_label(t.role), 'note', coalesce(v_note, ''),
                             'action', case when v_act = 'escalate' then 'escalated' else 'assigned' end),
          'gmasg:' || p_id || ':' || extract(epoch from now())::bigint, v_ceos);
      end if;
    end if;
  exception when others then raise warning 'notify failed: %', sqlerrm;
  end;
  return q;
end $$;
revoke all on function public.request_assign(uuid, uuid, text) from public, anon;
grant execute on function public.request_assign(uuid, uuid, text) to authenticated;

-- ---------- request_act: the assignee (or the CEO) decides; assignment clears when the request moves on ----------
create or replace function public.request_act(p_id uuid, p_action text, p_comment text default null, p_patch jsonb default null)
returns public.requests language plpgsql security definer set search_path = public as $function$
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
    -- assigned by the CEO / GM to a person: only that person (or the CEO) decides at this step
    if q.assigned_to is not null and q.assigned_to is distinct from auth.uid() and not v_ceo then
      raise exception 'Assigned to % (%) — only they or the CEO can decide this now', q.assigned_to_name, public.role_label(q.assigned_role);
    end if;
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
    result = case when v_to = 'completed' then p_patch else result end,
    assigned_to = case when v_to <> v_from then null else assigned_to end,
    assigned_to_name = case when v_to <> v_from then null else assigned_to_name end,
    assigned_role = case when v_to <> v_from then null else assigned_role end
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
end $function$;

-- ---------- outlet-manager step: the assigned outlet manager (or the CEO) decides ----------
create or replace function public.request_manager_act(p_id uuid, p_action text, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $function$
declare v_role text := public.my_role(); q public.requests; v_to text; ev text;
begin
  if v_role is null then raise exception 'Account not active'; end if;
  select * into q from public.requests where id = p_id for update;
  if not found or not public.can_see_request(p_id) then raise exception 'Request not found'; end if;
  if q.status <> 'manager_review' then raise exception 'This request is not waiting for the outlet manager'; end if;
  -- the outlet manager in scope; CEO / GM / HR may decide instead (override)
  if v_role not in ('outlet_manager','super_admin','admin','general_manager','hr_admin','hr_manager') then raise exception 'Not allowed'; end if;
  if v_role = 'outlet_manager' and not public.in_my_scope(q.outlet_id) then raise exception 'Not allowed'; end if;
  if q.assigned_to is not null and q.assigned_to is distinct from auth.uid() and not public.is_ceo() then
    raise exception 'Assigned to % (%) — only they or the CEO can decide this now', q.assigned_to_name, public.role_label(q.assigned_role);
  end if;
  if p_action = 'approve' then v_to := 'submitted'; ev := 'mgr_approve';
  elsif p_action = 'reject' then
    if coalesce(trim(p_comment), '') = '' then raise exception 'Please write the reason'; end if;
    v_to := 'rejected'; ev := 'mgr_reject';
  else raise exception 'Unknown action'; end if;
  update public.requests set status = v_to, updated_at = now(), manager_decided_by_name = public.my_name(), manager_decided_at = now(),
    decided_by = case when v_to = 'rejected' then auth.uid() else decided_by end,
    decided_by_name = case when v_to = 'rejected' then public.my_name() else decided_by_name end,
    decided_by_role = case when v_to = 'rejected' then v_role else decided_by_role end,
    decided_at = case when v_to = 'rejected' then now() else decided_at end,
    assigned_to = null, assigned_to_name = null, assigned_role = null
  where id = p_id;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
  values (p_id, auth.uid(), public.my_name(), v_role, ev, 'manager_review', v_to, nullif(trim(coalesce(p_comment, '')), ''));
  if v_to = 'rejected' then
    insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at)
    values (p_id, 'rejected', public.my_name(), v_role, now()) on conflict (request_id) do nothing;
  end if;
  begin
    perform public.notify(case when v_to = 'submitted' then 'request_submitted' else 'request_rejected' end, q.worker_id, p_id,
      jsonb_build_object('comment', coalesce(p_comment, ''), 'by', coalesce(public.my_name(), '')), 'mgr:' || p_id || ':' || extract(epoch from now())::bigint);
  exception when others then raise warning 'notify failed: %', sqlerrm; end;
end $function$;

-- ---------- CEO: overrule / amend / recall / mark reviewed (assign is request_assign) ----------
create or replace function public.ceo_decide(p_id uuid, p_decision text, p_reason text default null, p_patch jsonb default null)
returns public.requests language plpgsql security definer set search_path = public as $function$
declare q public.requests; v_from text; v_to text; fx jsonb := '[]'::jsonb; e jsonb; n_tasks int := 0; v_name text := public.my_name();
  v_before jsonb; v_keep boolean := coalesce((p_patch->>'keepStatus')::boolean, false); v_reason text := nullif(trim(coalesce(p_reason, '')), '');
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
    insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
    values (p_id, auth.uid(), v_name, 'super_admin', 'ceo_reviewed', v_from, v_from, v_reason);
    perform public.audit('request.ceo_reviewed', 'request', p_id::text, 'R-' || q.ref_no || ' reviewed by CEO — decision kept', jsonb_build_object('note', v_reason));
    return q;
  end if;
  if p_decision = 'amend' and v_reason is null then raise exception 'Write a change note'; end if;
  if p_decision = 'amend' and v_keep and q.status not in ('manager_review','submitted','returned','recommended','escalated','approved') then
    raise exception 'This request is closed — choose Amend, then approve';
  end if;
  v_to := case p_decision when 'approve' then 'approved' when 'amend' then case when v_keep then q.status else 'approved' end
                          when 'reject' then 'rejected' when 'cancel' then 'cancelled' when 'recall' then 'escalated' end;
  if p_decision in ('approve','amend') and q.status = 'completed' and p_decision = 'approve' then raise exception 'This request is already approved and applied'; end if;
  if p_decision = 'approve' and q.status = 'approved' then raise exception 'This request is already approved'; end if;
  if p_decision in ('reject','cancel') and q.status = v_to then raise exception 'This request is already %', v_to; end if;
  -- downstream effects → HR follow-up tasks (money is never reversed automatically)
  if p_decision in ('reject','cancel','amend') then fx := public.request_effects(p_id); end if;
  if p_decision = 'amend' then
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception 'Nothing to change'; end if;
    -- the original values stay in history (timeline + audit)
    v_before := jsonb_strip_nulls(jsonb_build_object(
      'title', case when nullif(p_patch->>'title', '') is not null then to_jsonb(q.title) end,
      'amount', case when p_patch ? 'amount' then coalesce(to_jsonb(q.amount), 'null'::jsonb) end,
      'data', (select jsonb_object_agg(k, coalesce(q.data->k, 'null'::jsonb)) from jsonb_object_keys(coalesce(p_patch->'data', '{}'::jsonb)) k)));
    update public.requests set data = data || coalesce(p_patch->'data', '{}'::jsonb),
      amount = case when p_patch ? 'amount' then nullif(p_patch->>'amount','')::numeric else amount end,
      title = coalesce(nullif(p_patch->>'title', ''), title) where id = p_id returning * into q;
  end if;
  if p_decision = 'amend' and v_keep then
    update public.requests set updated_at = now(), ceo_updated_at = now() where id = p_id returning * into q;
  else
    update public.requests set status = v_to, updated_at = now(), ceo_locked = true, ceo_updated_at = now(),
      decided_by = case when v_to in ('approved','rejected') then auth.uid() else decided_by end,
      decided_by_name = case when v_to in ('approved','rejected') then v_name else decided_by_name end,
      decided_by_role = case when v_to in ('approved','rejected') then 'super_admin' else decided_by_role end,
      decided_at = case when v_to in ('approved','rejected') then now() else decided_at end,
      -- Recall: pulled back to the CEO from wherever it is. Other decisions end any assignment.
      assigned_to = case when p_decision = 'recall' then auth.uid() end,
      assigned_to_name = case when p_decision = 'recall' then v_name end,
      assigned_role = case when p_decision = 'recall' then 'super_admin' end,
      assigned_by = case when p_decision = 'recall' then auth.uid() else assigned_by end,
      assigned_by_name = case when p_decision = 'recall' then v_name else assigned_by_name end,
      assigned_by_role = case when p_decision = 'recall' then 'super_admin' else assigned_by_role end,
      assigned_at = case when p_decision = 'recall' then now() else assigned_at end
    where id = p_id returning * into q;
  end if;
  insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment, to_user, to_name, to_role, meta)
  values (p_id, auth.uid(), v_name, 'super_admin', case when p_decision = 'recall' then 'ceo_recall' else 'ceo_overrule' end, v_from, v_to,
    v_reason, case when p_decision = 'recall' then auth.uid() end, case when p_decision = 'recall' then v_name end, case when p_decision = 'recall' then 'super_admin' end,
    case when p_decision = 'amend' then jsonb_build_object('kind', 'amend', 'before', v_before, 'after', p_patch - 'keepStatus', 'keptStatus', v_keep) end);
  for e in select * from jsonb_array_elements(fx) loop
    if p_decision = 'amend' and e->>'kind' = 'ticket' then continue; end if;
    insert into public.hr_tasks (request_id, worker_id, kind, title, details, created_by, created_by_name)
    values (p_id, q.worker_id, e->>'kind', case when p_decision = 'amend' then 'Adjust to the CEO''s changes: ' || (e->>'task') else e->>'task' end,
            (e->>'effect') || coalesce(' — CEO: ' || v_reason, ''), auth.uid(), v_name);
    n_tasks := n_tasks + 1;
  end loop;
  insert into public.ceo_reviews (request_id, reason, decided_by_name, decided_by_role, decided_at, reviewed_at, reviewed_by, reviewed_by_name, outcome)
  values (p_id, 'recalled', q.decided_by_name, q.decided_by_role, now(), now(), auth.uid(), v_name, p_decision)
  on conflict (request_id) do update set reviewed_at = now(), reviewed_by = auth.uid(), reviewed_by_name = v_name, outcome = p_decision;
  perform public.audit('request.ceo_' || p_decision, 'request', p_id::text,
    'R-' || q.ref_no || ' ' || case when p_decision = 'amend' then 'amended' when p_decision = 'recall' then 'recalled' else 'overruled' end || ' by CEO ' || v_name || ': ' || v_from || ' → ' || v_to || coalesce(' — ' || v_reason, ''),
    jsonb_build_object('reason', p_reason, 'patch', p_patch, 'before', v_before, 'effects', fx, 'tasks', n_tasks));
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
end $function$;

-- ---------- worker app: simple "with" status; assign / escalate steps without notes or names ----------
create or replace function public.worker_requests()
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare wid text := public.worker_require();
begin
  return (select coalesce(jsonb_agg(r order by r->>'createdAt' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', q.id, 'ref', 'R-' || q.ref_no, 'type', q.type, 'status', q.status, 'source', q.source,
      'createdAt', q.created_at, 'updatedAt', q.updated_at, 'amount', q.amount, 'overdue', q.manager_overdue, 'mine', q.created_by = auth.uid(),
      'from', q.data->>'from', 'to', q.data->>'to', 'lastDay', q.data->>'lastDay', 'confidential', q.confidential,
      'with', case
        when q.status = 'manager_review' then 'manager'
        when q.status = 'submitted' then 'hr_manager'
        when q.status = 'recommended' then 'hr_admin'
        when q.status = 'escalated' then case when q.assigned_role in ('super_admin','admin') then 'ceo'
                                              when q.assigned_role = 'general_manager' then 'gm'
                                              when exists (select 1 from public.profiles g where g.role = 'general_manager' and g.status = 'active'
                                                           and public.power_of(g.id, public.request_power(q.type))) then 'gm'
                                              else 'ceo' end
        end,
      'events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'to', e.to_status,
                   'role', case when e.action in ('assign','escalate') then e.to_role else e.by_role end,
                   'comment', case when e.action in ('reject','return','mgr_reject','worker_submit','worker_resubmit') then left(e.comment, 400) end) order by e.at), '[]'::jsonb)
                 from public.request_events e where e.request_id = q.id
                   and e.action in ('submit','worker_submit','mgr_approve','mgr_reject','auto_escalate','approve','forward','return','reject','apply','cancel','resubmit','worker_resubmit','worker_cancel','assign','escalate'))) as r
    from public.requests q
    where q.worker_id = wid and (q.created_by = auth.uid() or (q.source = 'manager' and public.worker_visible_type(q.type)))
    order by q.created_at desc limit 60) s);
end $function$;

-- auto-escalation (outlet manager did not act): the assignment ends with it
create or replace function public.worker_requests_escalate()
returns integer language plpgsql security definer set search_path = public as $function$
declare r record; n int := 0; days int := (public.worker_cfg()->>'escalateDays')::int;
begin
  for r in select id, worker_id, assigned_at from public.requests where status = 'manager_review' and manager_due_at <= now() for update skip locked loop
    update public.requests set status = 'submitted', manager_overdue = true, updated_at = now(),
      assigned_to = null, assigned_to_name = null, assigned_role = null where id = r.id;
    insert into public.request_events (request_id, by, by_name, by_role, action, from_status, to_status, comment)
    values (r.id, null, 'system', 'system', 'auto_escalate', 'manager_review', 'submitted', 'Outlet manager did not act within ' || days || ' days');
    begin perform public.notify('worker_request_overdue', r.worker_id, r.id, jsonb_build_object('days', days),
                                'wesc:' || r.id || coalesce(':' || extract(epoch from r.assigned_at)::bigint, ''));
    exception when others then raise warning 'notify failed: %', sqlerrm; end;
    n := n + 1;
  end loop;
  return n;
end $function$;

-- notifications: "approver" (reminders, escalations) = the assignee while a request is assigned
do $$
declare src text := pg_get_functiondef('public.notify(text,text,uuid,jsonb,text,uuid[])'::regprocedure);
begin
  if src like '%q.assigned_to is not null and public.request_level%' then return; end if;
  src := replace(src,
    $q$('approver' = any(tokens) and q.id is not null and (case when q.status = 'escalated'$q$,
    $q$('approver' = any(tokens) and q.id is not null and (case when q.assigned_to is not null and public.request_level(q.status, q.assigned_role) = public.chain_level(q.assigned_role) then p.id = q.assigned_to when q.status = 'escalated'$q$);
  if src not like '%q.assigned_to is not null and public.request_level%' then raise exception 'notify(): approver pattern not found'; end if;
  execute src;
end $$;

-- new notification events (only if missing)
update public.app_config set value = jsonb_set(value, '{events}', coalesce(value->'events', '{}'::jsonb)
  || case when value->'events' ? 'request_assigned' then '{}'::jsonb else jsonb_build_object('request_assigned', jsonb_build_object(
       'label', 'Request assigned to you (CEO / GM)', 'group', 'Requests',
       'enabled', true, 'critical', false, 'worker', '{}'::jsonb, 'recipients', '[]'::jsonb,
       'channels', jsonb_build_object('in_app', true, 'push', true, 'email', false, 'sms', false, 'whatsapp', false),
       'title', '{{ref}} {{type}} {{action}} to you by {{byRole}} {{by}}', 'body', '{{worker}}. {{note}}',
       'email', '{{ref}} {{type}} for {{worker}} ({{outlet}}) was {{action}} to you by {{byRole}} {{by}}. {{note}} {{link}}', 'sms', '')) end
  || case when value->'events' ? 'gm_assigned' then '{}'::jsonb else jsonb_build_object('gm_assigned', jsonb_build_object(
       'label', 'General Manager assigned a request (CEO)', 'group', 'Requests',
       'enabled', true, 'critical', false, 'worker', '{}'::jsonb, 'recipients', '["super_admin"]'::jsonb,
       'channels', jsonb_build_object('in_app', true, 'push', true, 'email', false, 'sms', false, 'whatsapp', false),
       'title', 'GM {{by}} {{action}} {{ref}} {{type}} to {{toRole}} {{toName}}', 'body', '{{worker}}. {{note}} Tap to review or reassign.',
       'email', 'General Manager {{by}} {{action}} {{ref}} {{type}} for {{worker}} to {{toRole}} {{toName}}. {{note}} {{link}}', 'sms', '')) end)
where key = 'notifications';
