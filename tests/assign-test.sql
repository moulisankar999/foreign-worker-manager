-- v1.3.3 assign / escalate / CEO actions: server tests on TEST. Everything runs in ONE transaction that is
-- always rolled back (the block ends by raising the results), so nothing persists.
do $t$
declare
  res jsonb := '[]'::jsonb; ok boolean; m text; x jsonb; n int;
  W text := 'wu-w-mvlwluod'; O text := 'wu-o-mvlwluod';
  ceo uuid := gen_random_uuid(); gm uuid := gen_random_uuid(); hra uuid := gen_random_uuid(); hra2 uuid := gen_random_uuid();
  hrm uuid := gen_random_uuid(); om uuid := gen_random_uuid(); om2 uuid := gen_random_uuid();
  wuser uuid; sid uuid := gen_random_uuid(); r1 uuid; r2 uuid; r3 uuid; q public.requests;
  u uuid; nm text; rl text;
begin
  -- test people (rolled back at the end)
  foreach u in array array[ceo, gm, hra, hra2, hrm, om, om2] loop
    insert into auth.users (id, email, aud, role, instance_id) values (u, 'fwm-asg-' || left(u::text, 8) || '@example.test', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  end loop;
  insert into public.profiles (id, email, role, status, outlet_ids, company_ids) select u2, 'x', 'viewer', 'active', '{}', '{}' from unnest(array[ceo, gm, hra, hra2, hrm, om, om2]) u2 on conflict (id) do nothing;
  update public.profiles set status = 'active', company_ids = '{}', outlet_ids = '{}', role = 'super_admin', full_name = 'T CEO' where id = ceo;
  update public.profiles set status = 'active', company_ids = '{}', outlet_ids = '{}', role = 'general_manager', full_name = 'T GM' where id = gm;
  update public.profiles set status = 'active', company_ids = '{}', outlet_ids = '{}', role = 'hr_admin', full_name = 'T HRA' where id = hra;
  update public.profiles set status = 'active', company_ids = '{}', outlet_ids = '{}', role = 'hr_admin', full_name = 'T HRA2' where id = hra2;
  update public.profiles set status = 'active', company_ids = '{}', outlet_ids = '{}', role = 'hr_manager', full_name = 'T HRM' where id = hrm;
  update public.profiles set status = 'active', company_ids = '{}', outlet_ids = array[O], role = 'outlet_manager', full_name = 'T OM' where id = om;
  update public.profiles set status = 'active', company_ids = '{}', outlet_ids = array['no-such-outlet'], role = 'outlet_manager', full_name = 'T OM other' where id = om2;
  -- the worker's app session
  select user_id into wuser from public.worker_access where worker_id = W;
  update public.worker_access set status = 'active' where worker_id = W;
  insert into auth.sessions (id, user_id) values (sid, wuser);

  -- worker raises an annual leave (→ outlet manager) and a confidential complaint about his manager
  perform set_config('request.jwt.claims', json_build_object('sub', wuser, 'role', 'authenticated', 'session_id', sid)::text, true);
  select (public.worker_request_create('leave', jsonb_build_object('kind', 'annual', 'from', (current_date + 20)::text, 'to', (current_date + 22)::text, 'reason', 'assign test'))->>'id')::uuid into r1;
  select (public.worker_request_create('complaint', jsonb_build_object('aboutManager', true, 'reason', 'assign test complaint', 'topic', 'Other'))->>'id')::uuid into r2;
  select status into m from public.requests where id = r1;
  res := res || jsonb_build_object('t', 'setup: worker leave starts with the outlet manager', 'ok', m = 'manager_review', 'v', m);

  -- 1. CEO skips straight to the GM
  perform set_config('request.jwt.claims', json_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  q := public.request_assign(r1, gm, 'GM please decide');
  select count(*) into n from public.request_events where request_id = r1 and action = 'skipped';
  res := res || jsonb_build_object('t', '1 CEO skips to GM: status escalated, assigned to GM, 3 steps marked skipped (OM, HRM, HRA)', 'ok', q.status = 'escalated' and q.assigned_to = gm and q.assigned_role = 'general_manager' and n = 3, 'v', q.status || '/' || n);
  select jsonb_agg(to_role || ':' || comment) into x from public.request_events where request_id = r1 and action = 'skipped';
  res := res || jsonb_build_object('t', '1b skipped steps say "Skipped by CEO"', 'ok', x::text like '%outlet_manager:Skipped by CEO%' and x::text like '%hr_admin:Skipped by CEO%', 'v', x);
  select count(*) into n from public.request_events where request_id = r1 and action = 'assign' and to_user = gm and by_name = 'T CEO' and comment = 'GM please decide';
  res := res || jsonb_build_object('t', '1c timeline: assigned by CEO (T CEO) → GM T GM + note', 'ok', n = 1, 'v', n);
  select count(*) into n from public.notification_deliveries d join public.notification_events e on e.id = d.event_id where e.request_id = r1 and d.event = 'request_assigned' and d.user_id = gm and d.channel in ('in_app','push');
  res := res || jsonb_build_object('t', '1d GM notified (in-app + push)', 'ok', n = 2, 'v', n);
  select count(*) into n from public.audit_log where entity = 'request' and entity_id = r1::text and action = 'request.assign';
  res := res || jsonb_build_object('t', '1e audit log entry', 'ok', n = 1, 'v', n);

  -- 2. GM assigns to an HR Admin → CEO notified + on the CEO review list
  perform set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true);
  begin q := public.request_assign(r1, hra, 'HRA to check balance'); ok := true; m := q.status; exception when others then ok := false; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '2 GM can reassign what the CEO assigned to him', 'ok', ok and m = 'recommended', 'v', m);
  select count(*) into n from public.notification_deliveries d join public.notification_events e on e.id = d.event_id where e.request_id = r1 and d.event = 'gm_assigned' and d.user_id = ceo;
  res := res || jsonb_build_object('t', '2b CEO notified when the GM assigns', 'ok', n >= 1, 'v', n);
  select count(*) into n from public.ceo_reviews where request_id = r1 and reason = 'gm_assigned' and reviewed_at is null;
  res := res || jsonb_build_object('t', '2c on the CEO needs-review list', 'ok', n = 1, 'v', n);

  -- 3. another HR Admin cannot decide while it is assigned to someone else; the assignee can
  perform set_config('request.jwt.claims', json_build_object('sub', hra2, 'role', 'authenticated')::text, true);
  begin perform public.request_act(r1, 'forward', null, null); ok := false; m := 'allowed'; exception when others then ok := sqlerrm like 'Assigned to T HRA%'; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '3 a different HR Admin is blocked (assigned to T HRA)', 'ok', ok, 'v', m);

  -- 4. worker app shows the simple status "With HR Admin", no notes / names
  perform set_config('request.jwt.claims', json_build_object('sub', wuser, 'role', 'authenticated', 'session_id', sid)::text, true);
  select e into x from jsonb_array_elements(public.worker_requests()) e where e->>'id' = r1::text;
  res := res || jsonb_build_object('t', '4 worker sees "with: hr_admin"', 'ok', x->>'with' = 'hr_admin', 'v', x->>'with');
  res := res || jsonb_build_object('t', '4b worker timeline has the assign step with role only, no note, no names, no skipped rows',
    'ok', (select count(*) from jsonb_array_elements(x->'events') e where e->>'action' in ('assign','escalate') and e->>'comment' is null) = 2
      and x::text not like '%T GM%' and x::text not like '%HRA to check%' and x::text not like '%skipped%', 'v', x->'events');

  -- 5. GM escalates to the CEO; GM can no longer decide it
  perform set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true);
  q := public.request_assign(r1, ceo, 'Needs CEO');
  res := res || jsonb_build_object('t', '5 GM escalates to CEO: escalated, assigned CEO, action escalate', 'ok', q.status = 'escalated' and q.assigned_to = ceo
    and exists (select 1 from public.request_events where request_id = r1 and action = 'escalate' and to_user = ceo and by_role = 'general_manager'), 'v', q.status || '/' || q.assigned_role);
  begin perform public.request_act(r1, 'approve', null, null); ok := false; m := 'allowed'; exception when others then ok := true; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '5b GM cannot approve after escalating to the CEO', 'ok', ok, 'v', m);
  perform set_config('request.jwt.claims', json_build_object('sub', wuser, 'role', 'authenticated', 'session_id', sid)::text, true);
  select e into x from jsonb_array_elements(public.worker_requests()) e where e->>'id' = r1::text;
  res := res || jsonb_build_object('t', '5c worker sees "with: ceo"', 'ok', x->>'with' = 'ceo', 'v', x->>'with');

  -- 6. OM / HR cannot reassign
  foreach u in array array[om, hrm, hra] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    begin perform public.request_assign(r1, hrm, null); ok := false; m := 'allowed'; exception when others then ok := sqlerrm like 'Only the CEO or the General Manager%'; m := sqlerrm; end;
    select role into rl from public.profiles where id = u;
    res := res || jsonb_build_object('t', '6 ' || rl || ' cannot reassign', 'ok', ok, 'v', m);
    begin perform public.request_assignees(r1); ok := false; exception when others then ok := true; end;
    res := res || jsonb_build_object('t', '6b ' || rl || ' cannot list assignees', 'ok', ok);
  end loop;

  -- 7. CEO assigns to HRM; the GM cannot take over the CEO's assignment; CEO can reassign what the GM assigned
  perform set_config('request.jwt.claims', json_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  q := public.request_assign(r1, hrm, null);
  res := res || jsonb_build_object('t', '7 CEO assigns down to HR Manager: submitted', 'ok', q.status = 'submitted' and q.assigned_to = hrm and
     exists (select 1 from public.request_events where request_id = r1 and action = 'assign' and to_user = hrm), 'v', q.status);
  perform set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true);
  begin perform public.request_assign(r1, hra, null); ok := false; m := 'allowed'; exception when others then ok := sqlerrm like 'The CEO assigned this request%'; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '7b GM cannot override the CEO''s assignment', 'ok', ok, 'v', m);
  -- the HRM assignee forwards: the assignment ends, the request moves on normally
  perform set_config('request.jwt.claims', json_build_object('sub', hrm, 'role', 'authenticated')::text, true);
  q := public.request_act(r1, 'forward', 'ok', null);
  res := res || jsonb_build_object('t', '7c the assignee acts; assignment clears', 'ok', q.status = 'recommended' and q.assigned_to is null, 'v', q.status);
  perform set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true);
  begin perform public.request_assign(r1, hra2, null); ok := true; m := 'ok'; exception when others then ok := false; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '7d after the CEO''s assignee acted, the GM may assign again', 'ok', ok, 'v', m);

  -- 8. timers restart: CEO sends it back to the outlet manager → new 3-day deadline
  perform set_config('request.jwt.claims', json_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  q := public.request_assign(r1, om, 'OM please confirm roster');
  res := res || jsonb_build_object('t', '8 assign to OM: manager_review, new deadline in ~3 days', 'ok', q.status = 'manager_review' and q.manager_due_at > now() + interval '71 hours', 'v', q.manager_due_at);
  begin perform public.request_assign(r1, om2, null); ok := false; m := 'allowed'; exception when others then ok := true; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '8b outlet manager of another outlet is out of scope', 'ok', ok, 'v', m);
  perform set_config('request.jwt.claims', json_build_object('sub', om, 'role', 'authenticated')::text, true);
  perform public.request_manager_act(r1, 'approve', null);
  select * into q from public.requests where id = r1;
  res := res || jsonb_build_object('t', '8c the OM assignee approves → HR; assignment clears', 'ok', q.status = 'submitted' and q.assigned_to is null, 'v', q.status);

  -- 9. confidential complaint about the manager: never to an outlet manager
  perform set_config('request.jwt.claims', json_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  x := public.request_assignees(r2);
  res := res || jsonb_build_object('t', '9 confidential: no outlet manager in the picker', 'ok', x::text not like '%outlet_manager%' and x::text like '%T HRA%', 'v', jsonb_array_length(x));
  begin perform public.request_assign(r2, om, null); ok := false; m := 'allowed'; exception when others then ok := true; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '9b confidential: assigning to the outlet manager is refused', 'ok', ok, 'v', m);
  q := public.request_assign(r2, gm, 'GM to handle');
  res := res || jsonb_build_object('t', '9c confidential: CEO can assign to the GM', 'ok', q.assigned_to = gm, 'v', q.status);
  select count(*) into n from public.notification_deliveries d join public.notification_events e on e.id = d.event_id where e.request_id = r2 and d.user_id = om;
  res := res || jsonb_build_object('t', '9d confidential: the outlet manager got no notification', 'ok', n = 0, 'v', n);

  -- 10. the CEO's actions: amend (keeps the original), mark reviewed, recall, overrule
  perform set_config('request.jwt.claims', json_build_object('sub', ceo, 'role', 'authenticated')::text, true);
  begin perform public.ceo_decide(r1, 'amend', null, jsonb_build_object('data', jsonb_build_object('reason', 'changed'), 'keepStatus', true)); ok := false; exception when others then ok := sqlerrm like 'Write a change note%'; end;
  res := res || jsonb_build_object('t', '10 amend needs a change note', 'ok', ok);
  q := public.ceo_decide(r1, 'amend', 'Fix reason', jsonb_build_object('data', jsonb_build_object('reason', 'changed by CEO'), 'keepStatus', true));
  select meta into x from public.request_events where request_id = r1 and action = 'ceo_overrule' order by id desc limit 1;
  res := res || jsonb_build_object('t', '10b amend (keep moving): status unchanged, original kept in history', 'ok', q.status = 'submitted' and q.data->>'reason' = 'changed by CEO'
     and x->'before'->'data'->>'reason' = 'assign test' and not q.ceo_locked, 'v', x);
  perform public.ceo_decide(r1, 'reviewed', 'Seen', null);
  res := res || jsonb_build_object('t', '10c mark reviewed: "Reviewed by CEO" in the timeline, outcome unchanged',
     'ok', exists (select 1 from public.request_events where request_id = r1 and action = 'ceo_reviewed') and (select status from public.requests where id = r1) = 'submitted'
       and exists (select 1 from public.ceo_reviews where request_id = r1 and reviewed_at is not null));
  q := public.ceo_decide(r1, 'recall', 'Taking this', null);
  res := res || jsonb_build_object('t', '10d recall: back to the CEO (assigned to CEO)', 'ok', q.status = 'escalated' and q.assigned_to = ceo and q.assigned_role = 'super_admin', 'v', q.status);
  q := public.ceo_decide(r1, 'reject', 'No', null);
  res := res || jsonb_build_object('t', '10e overrule (reject): final + locked, assignment ends', 'ok', q.status = 'rejected' and q.ceo_locked and q.assigned_to is null, 'v', q.status);
  perform set_config('request.jwt.claims', json_build_object('sub', gm, 'role', 'authenticated')::text, true);
  begin perform public.ceo_decide(r1, 'approve', 'x', null); ok := false; exception when others then ok := true; end;
  res := res || jsonb_build_object('t', '10f GM cannot use CEO-only actions', 'ok', ok);
  begin perform public.request_assign(r1, hra, null); ok := false; m := 'allowed'; exception when others then ok := true; m := sqlerrm; end;
  res := res || jsonb_build_object('t', '10g closed / CEO-locked: GM cannot assign', 'ok', ok, 'v', m);
  select count(*) into n from public.audit_log where entity = 'request' and entity_id = r1::text and action in ('request.assign','request.escalate','request.ceo_amend','request.ceo_reviewed','request.ceo_recall','request.ceo_reject');
  res := res || jsonb_build_object('t', '10h every step audit-logged', 'ok', n >= 9, 'v', n);

  raise exception 'RESULTS:%', res;
end $t$;
