-- v1.4.2 (t163u / t164u): Approval & Recruitment wording + removable sample data. Additive: no table or column is dropped or renamed.
--  A. Server text: "CMO" → "COM" (Check Out Memo), "Quota & Recruitment" → "Approval & Recruitment"; neutral messages when an
--     approval action is blocked (the checks themselves are unchanged: CEO final, GM alone never enough, nobody decides his own).
--  B. Sample companies (id "sample-…") never notify anyone.
--  C. qr_block_change lets remove_sample_data (and only it) delete rows of sample companies.
--  D. sample_data_preview() / remove_sample_data('REMOVE') for Settings → Remove sample data.
--  E. Storage delete policies limited to the sample folders.

-- A. text patches (safe to re-run: a text already patched is simply not found again)
do $mig$
declare
  f record; src text; dst text;
  pairs text[][] := array[
    ['qr_decide_use', 'Only the person who raised it (or the CEO) cancels it.', 'You cannot cancel this request.'],
    ['qr_decide_use', 'Only the GM or the CEO decides Quota Use Requests.', 'You cannot approve this request.'],
    ['qr_decide_use', 'You raised this request — you cannot approve or decide it yourself.', 'You cannot approve this request.'],
    ['qr_decide_use', 'The GM has already approved — this request now waits for the CEO.', 'Waiting for the next approval step.'],
    ['qr_open_quota', 'You recorded this letter — another GM or the CEO confirms it.', 'Waiting for the next approval step.'],
    ['qr_reg_decide', 'You proposed this change — the CEO approves it.', 'Waiting for the next approval step.'],
    ['qr_reg_decide', 'Only the CEO approves rule changes.', 'You cannot approve this change.'],
    ['qr_request_use', 'Quota Use Requests are raised by HR Admin or HR Manager. The GM and the CEO approve them.', 'Your role cannot raise a Quota Use Request.'],
    ['qr_pipeline_gate', 'Only the CEO marks a stage done without its documents, with a note.', 'This step needs its documents first.'],
    ['qr_stage_override', 'Only the CEO marks a stage done without its documents.', 'You cannot mark this stage done without its documents.'],
    ['qr_claim_status', 'You created this application — another GM or the CEO records the result.', 'You cannot record the result of this application.'],
    ['request_act', 'You cannot approve your own request', 'You cannot approve this request.']
  ];
  i int;
begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and p.proname in ('qr_reverse','qr_void_exit','qr_save_runaway','qr_record_exit','qr_claim_create','qr_followups_core','qr_need','qr_ledger_fill',
                               'qr_decide_use','qr_open_quota','qr_reg_decide','qr_request_use','qr_pipeline_gate','qr_stage_override','qr_claim_status','request_act') loop
    src := pg_get_functiondef(f.oid);
    dst := regexp_replace(src, '\mCMO(s?)\M', 'COM\1', 'g');
    dst := replace(dst, 'Quota & Recruitment', 'Approval & Recruitment');
    for i in 1 .. array_length(pairs, 1) loop
      if pairs[i][1] = (select proname from pg_proc where oid = f.oid) then dst := replace(dst, pairs[i][2], pairs[i][3]); end if;
    end loop;
    if dst <> src then execute dst; end if;
  end loop;
end $mig$;

update public.qr_reg_rules set value = regexp_replace(value::text, '\mCMO(s?)\M', 'COM\1', 'g')::jsonb
 where value::text ~ '\mCMOs?\M';

-- B. sample companies never notify (qr_notify and the overdue sweep)
do $mig$
declare src text; dst text;
begin
  src := pg_get_functiondef('public.qr_notify(text,text[],text,text,text,text,boolean)'::regprocedure);
  if position('sample-%' in src) = 0 then
    dst := replace(src, E'begin\n  for u in select', E'begin\n  if coalesce(p_company, '''') like ''sample-%'' then return; end if; -- v1.4.2 sample data: no notifications\n  for u in select');
    if dst = src then raise exception '044: qr_notify text not found'; end if;
    execute dst;
  end if;
  src := pg_get_functiondef('public.qr_followups_sweep()'::regprocedure);
  if position('sample-%' in src) = 0 then
    dst := replace(src, 'x where x.days_late > 0 loop', 'x where x.days_late > 0 and coalesce(x.company_id, '''') not like ''sample-%'' loop');
    if dst = src then raise exception '044: qr_followups_sweep text not found'; end if;
    execute dst;
  end if;
end $mig$;

-- C. permanent tables: still never changed or deleted, except sample rows inside remove_sample_data
create or replace function public.qr_block_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('fwm.sample_cleanup', true) = 'on' and coalesce(old.company_id, '') like 'sample-%' then return old; end if;
  raise exception '% is permanent: rows are never changed or deleted (post a reversal instead).', tg_table_name using errcode = '42501';
end $$;

-- D. preview + removal
create or replace function public.sample_users() returns setof uuid language sql stable security definer set search_path = public, auth as $$
  select u.id from auth.users u where coalesce(u.raw_app_meta_data->>'fwm_sample', '') = 'true'
$$;
revoke all on function public.sample_users() from public, anon, authenticated;

create or replace function public.sample_data_preview() returns jsonb
language plpgsql stable security definer set search_path = public, storage as $$
declare res jsonb := '{}'::jsonb; t text; n bigint;
begin
  if not public.is_active_user() or not (public.is_ceo() or public.gm_can('data.demo')) then
    raise exception 'You can''t remove sample data.' using errcode = '42501';
  end if;
  foreach t in array array['qr_quotas','qr_ledger','qr_use_requests','qr_batches','qr_recruits','qr_payments','qr_exits','qr_runaways','qr_claims',
                           'qr_replacements','qr_events','qr_files','qr_agent_batches','qr_agent_docs'] loop
    execute format('select count(*) from public.%I where company_id like ''sample-%%''', t) into n;
    res := res || jsonb_build_object(t, n);
  end loop;
  return res || jsonb_build_object(
    'claim_items', (select count(*) from public.qr_claim_items i join public.qr_claims c on c.id = i.claim_id where c.company_id like 'sample-%'),
    'workers', (select count(*) from public.records where entity = 'workers' and not deleted and coalesce(data->>'companyId', '') like 'sample-%'),
    'outlets', (select count(*) from public.records where entity = 'outlets' and not deleted and coalesce(data->>'companyId', '') like 'sample-%'),
    'companies', (select coalesce(jsonb_agg(e->>'name' order by e->>'name'), '[]'::jsonb) from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' like 'sample-%'),
    'hostels', (select count(*) from jsonb_array_elements(coalesce(public.cfg('hostels')->'items', '[]'::jsonb)) e where e->>'id' like 'sample-%'),
    'users', (select count(*) from public.profiles where id in (select public.sample_users()) and status <> 'deleted'),
    'files', (select count(*) from storage.objects where (bucket_id = 'quota-docs' and name like 'sample-%') or (bucket_id = 'attachments' and name like 'workers/sample-%')),
    'total', (select count(*) from public.qr_quotas where company_id like 'sample-%')
           + (select count(*) from public.records where entity in ('workers','outlets') and not deleted and coalesce(data->>'companyId', '') like 'sample-%')
           + (select count(*) from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' like 'sample-%')
           + (select count(*) from storage.objects where (bucket_id = 'quota-docs' and name like 'sample-%') or (bucket_id = 'attachments' and name like 'workers/sample-%')));
end $$;
revoke all on function public.sample_data_preview() from public, anon;
grant execute on function public.sample_data_preview() to authenticated;

create or replace function public.remove_sample_data(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare res jsonb := '{}'::jsonb; t text; n bigint; paths jsonb; att jsonb;
        v_uid uuid := auth.uid(); v_name text := public.my_name(); v_claims text := current_setting('request.jwt.claims', true);
begin
  if not public.is_active_user() or not (public.is_ceo() or public.gm_can('data.demo')) then
    raise exception 'You can''t remove sample data.' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'REMOVE' then raise exception 'Type REMOVE to confirm.'; end if;
  perform pg_advisory_xact_lock(hashtext('fwm.remove_sample_data'));
  perform set_config('fwm.sample_cleanup', 'on', true);
  select coalesce(jsonb_agg(name order by name), '[]'::jsonb) into paths from storage.objects where bucket_id = 'quota-docs' and name like 'sample-%';
  select coalesce(jsonb_agg(name order by name), '[]'::jsonb) into att from storage.objects where bucket_id = 'attachments' and name like 'workers/sample-%';
  delete from public.qr_claim_items i using public.qr_claims c where c.id = i.claim_id and c.company_id like 'sample-%';
  get diagnostics n = row_count; res := res || jsonb_build_object('qr_claim_items', n);
  delete from public.qr_task_meta where ref in (select id::text from public.qr_recruits where company_id like 'sample-%'
                                               union all select id::text from public.qr_use_requests where company_id like 'sample-%'
                                               union all select id::text from public.qr_quotas where company_id like 'sample-%'
                                               union all select id::text from public.qr_exits where company_id like 'sample-%'
                                               union all select id::text from public.qr_runaways where company_id like 'sample-%');
  foreach t in array array['qr_agent_docs','qr_agent_batches','qr_replacements','qr_payments','qr_ledger','qr_events','qr_exits','qr_runaways','qr_claims',
                           'qr_recruits','qr_use_requests','qr_batches','qr_quotas','qr_files'] loop
    execute format('delete from public.%I where company_id like ''sample-%%''', t);
    get diagnostics n = row_count; res := res || jsonb_build_object(t, n);
  end loop;
  perform set_config('fwm.sample_cleanup', 'off', true);
  update public.records set deleted = true, client_ts = greatest(client_ts, now()) + interval '1 millisecond'
   where entity in ('workers','outlets') and not deleted and coalesce(data->>'companyId', '') like 'sample-%';
  get diagnostics n = row_count; res := res || jsonb_build_object('records', n);
  update public.app_config set value = jsonb_set(value, '{items}', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(value->'items') e where coalesce(e->>'id', '') not like 'sample-%'))
   where key in ('companies','hostels') and exists (select 1 from jsonb_array_elements(coalesce(value->'items', '[]'::jsonb)) e where e->>'id' like 'sample-%');
  -- the sample logins are system rows: delete them as the system (the caller's role rules for editing users do not apply),
  -- but record who removed them; then restore the caller's identity for the audit line
  perform set_config('fwm.user_admin', 'on', true);
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set status = 'deleted', deleted_at = now(), deleted_by = v_uid, deleted_by_name = v_name
   where id in (select public.sample_users()) and status <> 'deleted';
  get diagnostics n = row_count; res := res || jsonb_build_object('users', n);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('fwm.user_admin', 'off', true);
  perform public.audit('sample.remove', 'sample_data', 'approval-recruitment', 'Removed the Approval & Recruitment sample data', res);
  return res || jsonb_build_object('paths', paths, 'attachments', att);
end $$;
revoke all on function public.remove_sample_data(text) from public, anon;
grant execute on function public.remove_sample_data(text) to authenticated;

-- E. the app removes the sample files through the Storage API after remove_sample_data
drop policy if exists "qr sample docs remove" on storage.objects;
create policy "qr sample docs remove" on storage.objects for delete to authenticated
  using (bucket_id = 'quota-docs' and (storage.foldername(name))[1] like 'sample-%' and public.is_active_user() and (public.is_ceo() or public.gm_can('data.demo')));
drop policy if exists "fwm sample attachments remove" on storage.objects;
create policy "fwm sample attachments remove" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and name like 'workers/sample-%' and public.is_active_user() and (public.is_ceo() or public.gm_can('data.demo')));
