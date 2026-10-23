-- 011 (v1.1.3): "Remove sample (DEMO) data" for the Super Admin.
-- Additive: two new functions only. Nothing runs at migration time.
-- When the Super Admin presses the button the function SOFT-deletes (deleted = true, synced to every device) only:
--   * workers whose name starts with 'DEMO ' (and their remarks and vault documents),
--   * outlets whose name starts with 'DEMO ' that no real (non-DEMO) worker still uses,
-- cancels open requests of DEMO workers (no notifications are sent), skips queued notifications for DEMO workers,
-- and moves users off DEMO outlets (to the outlet the Super Admin picked, or unassigned). Real records are never touched.
begin;

create or replace function public.demo_scope()
returns table (kind text, id text, name text) language sql stable security definer set search_path = public as $$
  select 'worker', r.id, r.data->>'fullName' from public.records r
   where r.entity = 'workers' and not r.deleted and coalesce(r.data->>'fullName','') like 'DEMO %'
  union all
  select 'outlet', o.id, o.data->>'name' from public.records o
   where o.entity = 'outlets' and not o.deleted and coalesce(o.data->>'name','') like 'DEMO %'
     and not exists (select 1 from public.records w where w.entity = 'workers' and not w.deleted
                      and w.data->>'outletId' = o.id and coalesce(w.data->>'fullName','') not like 'DEMO %')
$$;
revoke execute on function public.demo_scope() from public, anon, authenticated;

create or replace function public.demo_data_preview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare dw text[]; dout text[]; res jsonb;
begin
  if not public.is_active_user() or coalesce(public.my_role(), '') not in ('super_admin','admin') then
    raise exception 'Only a Super Admin can remove sample data' using errcode = '42501';
  end if;
  select coalesce(array_agg(id), '{}') into dw from public.demo_scope() where kind = 'worker';
  select coalesce(array_agg(id), '{}') into dout from public.demo_scope() where kind = 'outlet';
  select jsonb_build_object(
    'workers', cardinality(dw),
    'outlets', cardinality(dout),
    'outletsKept', (select coalesce(jsonb_agg(o.data->>'name' order by o.data->>'name'), '[]'::jsonb) from public.records o
                     where o.entity = 'outlets' and not o.deleted and coalesce(o.data->>'name','') like 'DEMO %' and not (o.id = any(dout))),
    'remarks', (select count(*) from public.records where entity = 'remarks' and not deleted and worker_id = any(dw)),
    'documents', (select count(*) from public.documents where not deleted and worker_id = any(dw)),
    'requests', (select count(*) from public.requests where worker_id = any(dw)),
    'requestsOpen', (select count(*) from public.requests where worker_id = any(dw) and status not in ('approved','rejected','completed','cancelled')),
    'notifications', (select count(*) from public.notification_deliveries d join public.notification_events e on e.id = d.event_id
                       where e.worker_id = any(dw) and d.status = 'queued'),
    'jobs', 0,
    'realWorkers', (select count(*) from public.records where entity = 'workers' and not deleted and coalesce(data->>'fullName','') not like 'DEMO %'),
    'realOutlets', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', data->>'name') order by data->>'name'), '[]'::jsonb) from public.records
                     where entity = 'outlets' and not deleted and coalesce(data->>'name','') not like 'DEMO %'),
    'users', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.full_name,''), p.email), 'email', p.email, 'role', p.role, 'status', p.status,
                       'demoOutlets', (select jsonb_agg(o.data->>'name') from public.records o where o.entity = 'outlets' and o.id = any(p.outlet_ids) and o.id = any(dout)),
                       'otherOutlets', cardinality(array(select x from unnest(p.outlet_ids) x where not (x = any(dout))))) order by p.full_name), '[]'::jsonb)
               from public.profiles p where p.status <> 'deleted' and p.outlet_ids && dout)
  ) into res;
  return res;
end $$;
revoke execute on function public.demo_data_preview() from public, anon;
grant execute on function public.demo_data_preview() to authenticated;

-- p_reassign: {"<user id>": "<real outlet id>" | null}; p_confirm must be 'REMOVE'
create or replace function public.remove_demo_data(p_reassign jsonb, p_confirm text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare dw text[]; dout text[]; real_out text[]; me text; n_w int; n_o int; n_r int; n_d int; n_q int; n_n int; n_u int := 0;
  p record; target text; newo text[];
begin
  if not public.is_active_user() or coalesce(public.my_role(), '') not in ('super_admin','admin') then
    raise exception 'Only a Super Admin can remove sample data' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'REMOVE' then raise exception 'Type REMOVE to confirm'; end if;
  if p_reassign is not null and jsonb_typeof(p_reassign) <> 'object' then raise exception 'Invalid reassignment'; end if;
  perform pg_advisory_xact_lock(777001);
  select coalesce(array_agg(id), '{}') into dw from public.demo_scope() where kind = 'worker';
  select coalesce(array_agg(id), '{}') into dout from public.demo_scope() where kind = 'outlet';
  select coalesce(array_agg(id), '{}') into real_out from public.records where entity = 'outlets' and not deleted and coalesce(data->>'name','') not like 'DEMO %';
  select coalesce(nullif(full_name,''), email) into me from public.profiles where id = auth.uid();

  -- users on DEMO outlets: move to the chosen real outlet (or leave unassigned)
  for p in select id, outlet_ids, full_name, email from public.profiles where outlet_ids && dout loop
    target := nullif(coalesce(p_reassign->>(p.id::text), ''), '');
    if target is not null and not (target = any(real_out)) then raise exception 'Pick a real outlet for %', coalesce(nullif(p.full_name,''), p.email); end if;
    newo := array(select x from unnest(p.outlet_ids) x where not (x = any(dout)));
    if target is not null and not (target = any(newo)) then newo := newo || target; end if;
    update public.profiles set outlet_ids = newo where id = p.id;
    n_u := n_u + 1;
  end loop;

  -- requests of DEMO workers: cancel the open ones (event action 'cleanup' sends no notification)
  with c as (
    update public.requests set status = 'cancelled', updated_at = now(),
      result = coalesce(result, '{}'::jsonb) || jsonb_build_object('cleanup', 'Sample (DEMO) data removed')
    where worker_id = any(dw) and status not in ('approved','rejected','completed','cancelled') returning id, status)
  select count(*) into n_q from c;
  insert into public.request_events (request_id, by_name, by_role, action, from_status, to_status, comment)
  select id, me, 'super_admin', 'cleanup', null, 'cancelled', 'Sample (DEMO) data removed'
  from public.requests where worker_id = any(dw) and (result->>'cleanup') is not null
    and not exists (select 1 from public.request_events e where e.request_id = requests.id and e.action = 'cleanup');

  update public.notification_deliveries d set status = 'skipped'
  from public.notification_events e where e.id = d.event_id and e.worker_id = any(dw) and d.status = 'queued';
  get diagnostics n_n = row_count;

  update public.documents set deleted = true where worker_id = any(dw) and not deleted;
  get diagnostics n_d = row_count;
  update public.records set deleted = true, client_ts = greatest(now(), client_ts + interval '1 millisecond')
   where entity = 'remarks' and worker_id = any(dw) and not deleted;
  get diagnostics n_r = row_count;
  update public.records set deleted = true, client_ts = greatest(now(), client_ts + interval '1 millisecond')
   where entity = 'workers' and id = any(dw) and not deleted;
  get diagnostics n_w = row_count;
  update public.records set deleted = true, client_ts = greatest(now(), client_ts + interval '1 millisecond')
   where entity = 'outlets' and id = any(dout) and not deleted;
  get diagnostics n_o = row_count;

  perform public.audit('demo.remove', 'system', 'demo-data',
    format('Sample (DEMO) data removed: %s workers, %s outlets, %s remarks, %s documents, %s requests cancelled, %s users moved', n_w, n_o, n_r, n_d, n_q, n_u),
    jsonb_build_object('workers', n_w, 'outlets', n_o, 'remarks', n_r, 'documents', n_d, 'requestsCancelled', n_q, 'notificationsSkipped', n_n, 'usersMoved', n_u, 'reassign', coalesce(p_reassign, '{}'::jsonb)));
  return jsonb_build_object('workers', n_w, 'outlets', n_o, 'remarks', n_r, 'documents', n_d, 'requestsCancelled', n_q, 'notificationsSkipped', n_n, 'usersMoved', n_u);
end $$;
revoke execute on function public.remove_demo_data(jsonb, text) from public, anon;
grant execute on function public.remove_demo_data(jsonb, text) to authenticated;

commit;
