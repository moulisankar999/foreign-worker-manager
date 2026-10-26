-- 038 Quota & Recruitment, part 3 (v1.4.0 draft). Additive: new tables / columns / functions / bucket; constraint lists only widen.
--  * CEO defaults: India first, letters valid 12 months, runaway report 14 days, Quota Use Requests raised ONLY by HR Admin / HR Manager
--    (GM and CEO approve; CEO alone is final; GM alone never is; nobody decides their own request).
--  * Only a Check Out Memo exit is "on file" for a possible government application. Deaths and transfers never count.
--  * There is no replacement entitlement: CMOs never add to any balance. In the rare case the government opens a window that asks
--    for CMOs, an application is recorded; only an APPROVED outcome adds quota, entered as a new "additional" approval letter.
--  * Master quota table (company / sector / grand total), anti-misuse alerts, calling-visa copy per recruit, ECR departure gate.
--  * Agent portal: external agency logins (no staff profile at all) that see only recruits of batches assigned to them,
--    upload documents for HR to verify, and download the calling visa copy — every upload / download audited, revoke is instant.

/* ---------------- CEO defaults ---------------- */
alter table public.qr_rules add column if not exists default_country text not null default 'India';
alter table public.qr_rules add column if not exists letter_valid_months int not null default 12;
alter table public.qr_rules add column if not exists stall_days int not null default 14;        -- approved request / pending decision idle -> alert
alter table public.qr_rules add column if not exists expiry_mid_days int not null default 60;   -- warnings at 90 / 60 / 30 days
alter table public.qr_rules add column if not exists window_warn_days int not null default 14;  -- recorded government window closing soon
update public.qr_rules set runaway_report_days = 14 where id = 1 and runaway_report_days <> 14;

create or replace function public.qr_set_rules(p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.qr_rank() < 4 and not (public.is_gm() and public.gm_can('settings')) then raise exception 'Only the CEO sets the quota rules.' using errcode = '42501'; end if;
  update public.qr_rules set
    cmo_missing_days = coalesce((p->>'cmo_missing_days')::int, cmo_missing_days), runaway_report_days = coalesce((p->>'runaway_report_days')::int, runaway_report_days),
    expiry_amber_days = coalesce((p->>'expiry_amber_days')::int, expiry_amber_days), expiry_mid_days = coalesce((p->>'expiry_mid_days')::int, expiry_mid_days),
    expiry_red_days = coalesce((p->>'expiry_red_days')::int, expiry_red_days),
    util_amber_pct = coalesce((p->>'util_amber_pct')::int, util_amber_pct), payment_check_rm = coalesce((p->>'payment_check_rm')::numeric, payment_check_rm),
    default_country = coalesce(nullif(p->>'default_country', ''), default_country), letter_valid_months = coalesce((p->>'letter_valid_months')::int, letter_valid_months),
    stall_days = coalesce((p->>'stall_days')::int, stall_days), window_warn_days = coalesce((p->>'window_warn_days')::int, window_warn_days),
    templates = coalesce(p->'templates', templates), updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public.audit('qr_rules', 'quota', '1', 'Quota rules updated', p);
end $$;

-- a letter recorded without an expiry date gets approval date + 12 months (rule letter_valid_months)
create or replace function public.qr_quota_default_expiry() returns trigger language plpgsql as $$
begin
  if new.expiry_date is null and new.approval_date is not null then
    new.expiry_date := (new.approval_date + make_interval(months => coalesce((select letter_valid_months from public.qr_rules where id = 1), 12)))::date;
  end if;
  return new;
end $$;
drop trigger if exists qr_quota_default_expiry on public.qr_quotas;
create trigger qr_quota_default_expiry before insert on public.qr_quotas for each row execute function public.qr_quota_default_expiry();

-- additional quota from a government window is its own letter kind
alter table public.qr_quotas drop constraint if exists qr_quotas_kind_check;
alter table public.qr_quotas add constraint qr_quotas_kind_check check (kind in ('new','replacement','transfer','additional'));

-- Quota Use Requests: raised by HR Admin / HR Manager only (rank 1-2). GM and CEO approve.
do $$ declare src text := pg_get_functiondef('public.qr_request_use(jsonb)'::regprocedure); n text; begin
  n := replace(src, 'if public.qr_rank() >= 4 then raise exception ''Quota Use Requests are raised by HR or the GM and approved by the CEO.''',
                    'if public.qr_rank() >= 3 then raise exception ''Quota Use Requests are raised by HR Admin or HR Manager. The GM and the CEO approve them.''');
  if n = src and position('qr_rank() >= 3' in src) = 0 then raise exception '038: qr_request_use body not as expected'; end if;
  execute n;
end $$;

-- only a CMO exit is "on file"; deaths and transfers are recorded and never count
do $$ declare src text := pg_get_functiondef('public.qr_record_exit(jsonb)'::regprocedure); n text; begin
  n := replace(src, 'case when k = ''cmo'' or (k = ''death'' and coalesce((p->>''eligible'')::boolean, false)) then ''eligible'' else ''not_eligible'' end',
                    'case when k = ''cmo'' then ''eligible'' else ''not_eligible'' end');
  n := replace(n, 'when k = ''death'' and coalesce((p->>''eligible'')::boolean, false) then ''exit_other_elig'' ', '');
  n := replace(n, '''Exited via CMO — eligible for replacement: ''', '''Exited via CMO (copy on file): ''');
  if position('exit_other_elig' in n) > 0 then raise exception '038: qr_record_exit body not as expected'; end if;
  execute n;
end $$;

/* ---------------- rare: government quota windows (CMO-supported applications) ---------------- */
create table if not exists public.qr_windows (
  id uuid primary key default gen_random_uuid(),
  title text not null, circular_ref text, open_date date, close_date date, rules text, file_id uuid references public.qr_files(id),
  status text not null default 'recorded' check (status in ('recorded','closed')),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now()
);
alter table public.qr_windows enable row level security;
drop policy if exists "qr read" on public.qr_windows;
create policy "qr read" on public.qr_windows for select to authenticated using (public.qr_rank() > 0);
revoke insert, update, delete, truncate on public.qr_windows from anon, authenticated;

alter table public.qr_claims add column if not exists window_id uuid references public.qr_windows(id);
alter table public.qr_claims add column if not exists outcome_note text;
alter table public.qr_claims drop constraint if exists qr_claims_status_check;
alter table public.qr_claims add constraint qr_claims_status_check check (status in ('draft','submitted','approved','partly_approved','rejected','no_outcome'));

-- government circulars are not company files: kept under the folder _gov, readable by every quota role
drop policy if exists "qr gov read" on public.qr_files;
create policy "qr gov read" on public.qr_files for select to authenticated using (company_id = '_gov' and public.qr_rank() > 0);
drop policy if exists "qr gov docs read" on storage.objects;
create policy "qr gov docs read" on storage.objects for select to authenticated using (bucket_id = 'quota-docs' and (storage.foldername(name))[1] = '_gov' and public.qr_rank() > 0);
drop policy if exists "qr gov docs add" on storage.objects;
create policy "qr gov docs add" on storage.objects for insert to authenticated with check (bucket_id = 'quota-docs' and (storage.foldername(name))[1] = '_gov' and public.qr_rank() >= 2);

create or replace function public.qr_add_gov_file(p_path text, p_name text, p_mime text, p_size bigint, p_sha256 text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if public.qr_rank() < 2 then raise exception 'HR Admin, GM or CEO records government circulars.' using errcode = '42501'; end if;
  if split_part(p_path, '/', 1) <> '_gov' then raise exception 'Circular path must start with _gov/.'; end if;
  insert into public.qr_files (company_id, kind, path, name, mime, size, sha256, uploaded_by_name) values ('_gov', 'circular', p_path, p_name, p_mime, p_size, lower(p_sha256), public.my_name()) returning id into nid;
  perform public.audit('qr_file', 'quota_file', nid::text, 'Uploaded government circular: ' || coalesce(p_name, p_path), jsonb_build_object('sha256', p_sha256, 'size', p_size));
  return nid;
end $$;

create or replace function public.qr_save_window(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if public.qr_rank() < 2 then raise exception 'HR Admin, GM or CEO records government quota windows.' using errcode = '42501'; end if;
  if coalesce(trim(p->>'title'), '') = '' then raise exception 'Give the window a title.'; end if;
  if (p->>'open_date')::date > (p->>'close_date')::date then raise exception 'The close date is before the open date.'; end if;
  if p->>'id' is null then
    insert into public.qr_windows (title, circular_ref, open_date, close_date, rules, file_id, created_by_name)
    values (p->>'title', p->>'circular_ref', (p->>'open_date')::date, (p->>'close_date')::date, p->>'rules', (p->>'file_id')::uuid, public.my_name()) returning id into nid;
    perform public.audit('qr_window_add', 'quota_window', nid::text, 'Government quota window recorded: ' || (p->>'title'), p);
    return nid;
  end if;
  update public.qr_windows set title = coalesce(p->>'title', title), circular_ref = coalesce(p->>'circular_ref', circular_ref), open_date = coalesce((p->>'open_date')::date, open_date),
    close_date = coalesce((p->>'close_date')::date, close_date), rules = coalesce(p->>'rules', rules), file_id = coalesce((p->>'file_id')::uuid, file_id), status = coalesce(p->>'status', status)
  where id = (p->>'id')::uuid returning id into nid;
  perform public.audit('qr_window_edit', 'quota_window', nid::text, 'Government quota window updated', p);
  return nid;
end $$;

-- an application under a window: select CMOs on file (each CMO can sit in one live application only)
create or replace function public.qr_claim_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; c text := p->>'company_id'; x public.qr_exits; e uuid; n int := 0; w uuid := (p->>'window_id')::uuid;
begin
  perform public.qr_need(c, 2);
  if w is not null and not exists (select 1 from public.qr_windows where id = w) then raise exception 'Choose a recorded government window.'; end if;
  insert into public.qr_claims (company_id, title, announcement, notes, window_id, created_by_name)
  values (c, coalesce(nullif(p->>'title', ''), (select title from public.qr_windows where id = w), 'Additional quota application'), p->>'announcement', p->>'notes', w, public.my_name()) returning id into nid;
  for e in select v::uuid from jsonb_array_elements_text(coalesce(p->'exit_ids', '[]'::jsonb)) v loop
    select * into x from public.qr_exits where id = e for update;
    if x.id is null or x.company_id <> c then raise exception 'CMO % is not in this company.', e; end if;
    if x.status <> 'eligible' then raise exception 'CMO % (%) is already % — it cannot be used twice.', coalesce(x.cmo_ref, ''), x.worker_name, x.status using errcode = '23505'; end if;
    insert into public.qr_claim_items (claim_id, exit_id) values (nid, x.id);
    update public.qr_exits set status = 'claimed', claim_id = nid where id = x.id;
    if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_submit', 1, x.cmo_ref, 'Supporting an additional quota application', p_exit => x.id, p_claim => nid); end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Select at least one CMO on file.'; end if;
  perform public.qr_event(c, 'Additional quota application created (' || n || ' CMOs)', p->>'title', p_claim => nid);
  perform public.audit('qr_claim_add', 'quota_claim', nid::text, 'Additional quota application with ' || n || ' CMO(s)', p);
  return nid;
end $$;

-- status: submitted | approved / partly_approved (GM / CEO, with the new letter's numbers) | rejected | no_outcome
-- Only an approved outcome adds quota: a new 'additional' letter with the numbers the government granted (never derived from CMO counts).
create or replace function public.qr_claim_status(p_id uuid, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare cl public.qr_claims; st text := p->>'status'; x record; nq uuid; ok_ids uuid[]; nok int := 0; bd jsonb := coalesce(p->'breakdown', '{}'::jsonb); tot int := 0;
begin
  select * into cl from public.qr_claims where id = p_id for update;
  if cl.id is null then raise exception 'Application not found.'; end if;
  perform public.qr_need(cl.company_id, 2);
  if st = 'submitted' then
    if cl.status <> 'draft' then raise exception 'Only a draft is submitted.'; end if;
    update public.qr_claims set status = 'submitted', submitted_at = coalesce((p->>'submitted_at')::date, current_date), gov_ref = coalesce(p->>'gov_ref', gov_ref),
      pack_file = coalesce((p->>'pack_file')::uuid, pack_file) where id = cl.id;
  elsif st in ('approved','partly_approved') then
    perform public.qr_need(cl.company_id, 3);
    if cl.status not in ('draft','submitted') then raise exception 'This application is already %.', cl.status; end if;
    if cl.created_by = auth.uid() then raise exception 'You created this application — another GM or the CEO records the result.' using errcode = '42501'; end if;
    if coalesce(trim(p->>'gov_ref'), '') = '' then raise exception 'Enter the reference of the government approval letter.'; end if;
    select coalesce(sum(value::int), 0) into tot from jsonb_each_text(bd) where value ~ '^\d+$';
    if tot <= 0 then raise exception 'Enter the quota the government granted (per country) from the approval letter.'; end if;
    ok_ids := coalesce((select array_agg(v::uuid) from jsonb_array_elements_text(p->'approved_exit_ids') v),
                       (select array_agg(exit_id) from public.qr_claim_items where claim_id = cl.id and not released));
    for x in select e.* from public.qr_claim_items i join public.qr_exits e on e.id = i.exit_id where i.claim_id = cl.id and not i.released loop
      if x.id = any(ok_ids) then
        if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_approved', 1, p->>'gov_ref', 'Used in an approved application', p_exit => x.id, p_claim => cl.id); end if;
        update public.qr_exits set status = 'replaced' where id = x.id;
        update public.qr_claim_items set approved = true where claim_id = cl.id and exit_id = x.id;
        nok := nok + 1;
      else
        if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_release', 1, p->>'gov_ref', 'Not used in the outcome — back on file', p_exit => x.id, p_claim => cl.id); end if;
        update public.qr_exits set status = 'eligible', claim_id = null where id = x.id;
        update public.qr_claim_items set released = true, approved = false where claim_id = cl.id and exit_id = x.id;
      end if;
    end loop;
    insert into public.qr_quotas (company_id, ref_no, kind, approval_date, expiry_date, breakdown, sector, notes, status, claim_id, created_by_name, opened_by, opened_by_name, opened_at, letter_file)
    values (cl.company_id, p->>'gov_ref', 'additional', coalesce((p->>'decided_on')::date, current_date), (p->>'expiry_date')::date, bd, p->>'sector',
      'Additional quota from application A-' || cl.ref_no, 'active', cl.id, public.my_name(), auth.uid(), public.my_name(), now(), (p->>'letter_file')::uuid)
    returning id into nq;
    for x in select key k, value::int v from jsonb_each_text(bd) where value ~ '^\d+$' and value::int > 0 loop
      perform public.qr_post(nq, x.k, 'approved', x.v, p->>'gov_ref', 'Additional quota (application A-' || cl.ref_no || ')', p_claim => cl.id);
    end loop;
    update public.qr_claims set status = st, gov_ref = p->>'gov_ref', decided_on = coalesce((p->>'decided_on')::date, current_date), approved_count = tot, new_quota_id = nq,
      outcome_note = p->>'note', decided_by = auth.uid(), decided_by_name = public.my_name() where id = cl.id;
  elsif st in ('rejected','no_outcome') then
    perform public.qr_need(cl.company_id, 3);
    if cl.status not in ('draft','submitted') then raise exception 'This application is already %.', cl.status; end if;
    for x in select e.* from public.qr_claim_items i join public.qr_exits e on e.id = i.exit_id where i.claim_id = cl.id and not i.released loop
      if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_release', 1, null, case when st = 'rejected' then 'Application rejected' else 'No outcome' end || ' — back on file', p_exit => x.id, p_claim => cl.id); end if;
      update public.qr_exits set status = 'eligible', claim_id = null where id = x.id;
      update public.qr_claim_items set released = true, approved = false where claim_id = cl.id and exit_id = x.id;
    end loop;
    update public.qr_claims set status = st, decided_on = current_date, decided_by = auth.uid(), decided_by_name = public.my_name(), outcome_note = p->>'note' where id = cl.id;
  else raise exception 'Unknown status %', st;
  end if;
  perform public.qr_event(cl.company_id, 'Application ' || replace(st, '_', ' '), coalesce(p->>'gov_ref', p->>'note'), p_claim => cl.id);
  perform public.audit('qr_claim_' || st, 'quota_claim', cl.id::text, 'Additional quota application A-' || cl.ref_no || ' ' || replace(st, '_', ' '), p);
  return cl.id;
end $$;

/* ---------------- master quota table: letter -> company -> sector -> grand total ---------------- */
create or replace function public.qr_master(p_company text default null) returns table (
  level text, company_id text, sector text, quota_id uuid, ref_no text, expiry_date date, days_left int, letters int,
  approved int, reserved int, used int, available int, lapsed int, expiring_unused int, runaways int, active_workers int
) language sql stable security definer set search_path = public as $$
  with t as (select * from public.qr_tally(p_company)),
  per as (
    select t.company_id, coalesce(nullif(q.sector, ''), 'Unspecified') sector, t.quota_id, t.ref_no, t.expiry_date,
      (t.expiry_date - current_date) dl,
      sum(t.approved)::int appr, sum(t.reserved)::int resv, sum(t.used)::int used, sum(t.available)::int avail, sum(t.lapsed)::int lps,
      sum(t.runaways)::int run, sum(t.active_workers)::int act
    from t join public.qr_quotas q on q.id = t.quota_id group by 1, 2, 3, 4, 5),
  r as (select (select expiry_amber_days from public.qr_rules where id = 1) amber)
  select case when grouping(per.company_id) = 0 and grouping(per.quota_id) = 0 then 'letter' when grouping(per.company_id) = 0 then 'company'
              when grouping(per.sector) = 0 then 'sector' else 'total' end,
    per.company_id, case when grouping(per.sector) = 0 then per.sector else string_agg(distinct per.sector, ', ') end,
    per.quota_id, per.ref_no, per.expiry_date,
    min(per.dl) filter (where per.avail > 0)::int, count(*)::int,
    coalesce(sum(per.appr), 0)::int, coalesce(sum(per.resv), 0)::int, coalesce(sum(per.used), 0)::int, coalesce(sum(per.avail), 0)::int, coalesce(sum(per.lps), 0)::int,
    coalesce(sum(per.avail) filter (where per.dl is not null and per.dl <= (select amber from r)), 0)::int,
    coalesce(sum(per.run), 0)::int, coalesce(sum(per.act), 0)::int
  from per
  group by grouping sets ((per.company_id, per.sector, per.quota_id, per.ref_no, per.expiry_date), (per.company_id), (per.sector), ())
$$;
revoke execute on function public.qr_master(text) from public, anon;
grant execute on function public.qr_master(text) to authenticated;

/* ---------------- anti-misuse alerts (server side, same scope as the tally) ---------------- */
create or replace function public.qr_alerts() returns table (level text, kind text, company_id text, ref_id text, text text, link text)
language sql stable security definer set search_path = public as $$
  with ru as (select * from public.qr_rules where id = 1),
  t as (select * from public.qr_tally(null)),
  lt as (select t.quota_id, t.ref_no, t.company_id, t.expiry_date, (t.expiry_date - current_date) dl, sum(t.available)::int avail from t group by 1, 2, 3, 4)
  -- 1. slot used without a fully approved Quota Use Request (should be impossible: the gate refuses it; flags any data that slipped past)
  select 'red', 'unapproved_use', l.company_id, l.id::text,
    'Ledger #' || l.id || ': ' || l.qty || ' slot(s) used on ' || q.ref_no || ' without a CEO-approved Quota Use Request', 'quota?tab=letters&q=' || q.id
  from public.qr_ledger l join public.qr_quotas q on q.id = l.quota_id left join public.qr_use_requests u on u.id = l.use_request_id
  where l.kind = 'use' and (u.id is null or u.status <> 'approved') and public.qr_scope(l.company_id)
    and not exists (select 1 from public.qr_ledger r where r.reverses = l.id)
  union all
  -- 2. more workers on a letter than slots recorded as used (workers linked to the letter outside a Quota Use Request)
  select 'red', 'unrecorded_use', t.company_id, t.quota_id::text,
    t.ref_no || ' ' || t.country || ': ' || (-t.mismatch) || ' worker(s) on this letter without a used slot — check that each came through an approved Quota Use Request', 'quota?tab=recon'
  from t where t.mismatch < 0
  union all
  select 'amber', 'unbacked_use', t.company_id, t.quota_id::text,
    t.ref_no || ' ' || t.country || ': ' || t.mismatch || ' used slot(s) with no worker or recruit behind them — link the workers or reverse the entry', 'quota?tab=recon'
  from t where t.mismatch > 0
  union all
  -- 3. unused balance close to the letter's expiry (90 / 60 / 30 days) or already expired
  select case when lt.dl <= ru.expiry_red_days then 'red' else 'amber' end, 'expiry', lt.company_id, lt.quota_id::text,
    lt.ref_no || ': ' || lt.avail || ' slot(s) unused — ' || case when lt.dl < 0 then 'letter EXPIRED ' || (-lt.dl) || ' days ago'
      else 'expires in ' || lt.dl || ' days (' || case when lt.dl <= ru.expiry_red_days then ru.expiry_red_days when lt.dl <= ru.expiry_mid_days then ru.expiry_mid_days else ru.expiry_amber_days end || '-day warning)' end,
    'quota?tab=letters&q=' || lt.quota_id
  from lt, ru where lt.avail > 0 and lt.dl is not null and lt.dl <= ru.expiry_amber_days
  union all
  -- 4. approved request not moving: slots still reserved and no calling visa applied for N days
  select 'amber', 'stalled', u.company_id, u.id::text,
    'Q-' || u.ref_no || ': approved ' || (current_date - greatest(u.ceo_at, coalesce((select max(l.at) from public.qr_ledger l where l.use_request_id = u.id and l.kind = 'use'), u.ceo_at))::date)
      || ' days ago, ' || (select coalesce(sum(d_resv), 0) from public.qr_ledger l where l.use_request_id = u.id) || ' slot(s) still not used — apply the calling visa or release them',
    'quota?tab=approvals&r=' || u.id
  from public.qr_use_requests u, ru
  where u.status = 'approved' and public.qr_scope(u.company_id)
    and (select coalesce(sum(d_resv), 0) from public.qr_ledger l where l.use_request_id = u.id) > 0
    and greatest(u.ceo_at, coalesce((select max(l.at) from public.qr_ledger l where l.use_request_id = u.id and l.kind = 'use'), u.ceo_at)) < now() - make_interval(days => ru.stall_days)
  union all
  -- 5. request waiting for a decision too long
  select 'amber', 'waiting', u.company_id, u.id::text,
    'Q-' || u.ref_no || ': waiting ' || (current_date - u.requested_at::date) || ' days for ' || case when u.status = 'gm_approved' then 'the CEO' else 'GM / CEO' end || ' approval',
    'quota?tab=approvals&r=' || u.id
  from public.qr_use_requests u, ru
  where u.status in ('pending','gm_approved') and public.qr_scope(u.company_id) and u.requested_at < now() - make_interval(days => ru.stall_days)
  union all
  -- 6. only when a government window has been recorded and is open: its close date is near
  select case when w.close_date - current_date <= 3 then 'red' else 'amber' end, 'window', null::text, w.id::text,
    'Government quota window "' || w.title || '" closes in ' || (w.close_date - current_date) || ' days (' || to_char(w.close_date, 'DD Mon YYYY') || ')',
    'quota?tab=exits&sub=windows'
  from public.qr_windows w, ru
  where public.qr_rank() > 0 and w.status = 'recorded' and w.close_date is not null and current_date between coalesce(w.open_date, current_date) and w.close_date
    and w.close_date - current_date <= ru.window_warn_days
$$;
revoke execute on function public.qr_alerts() from public, anon;
grant execute on function public.qr_alerts() to authenticated;

/* ---------------- slot tracking: calling visa copy, stamping, ECR departure gate ---------------- */
alter table public.qr_recruits add column if not exists vdr_file uuid references public.qr_files(id);
alter table public.qr_recruits add column if not exists stamped_on date;

-- India ECR passports cannot depart without emigration clearance (POE); the passport type must be known first. ECNR skips it.
create or replace function public.qr_departure_gate() returns trigger language plpgsql as $$
declare newly boolean;
begin
  newly := (new.flight_at is not null and (tg_op = 'INSERT' or old.flight_at is null))
        or (coalesce((new.steps->'ticket'->>'done')::boolean, false) and (tg_op = 'INSERT' or not coalesce((old.steps->'ticket'->>'done')::boolean, false)));
  if newly and new.country = 'India' then
    if new.ecr is null then raise exception 'Set the passport type (ECR or ECNR) before booking the flight.' using errcode = 'P0001'; end if;
    if new.ecr = 'ECR' and not coalesce((new.steps->'emig_clear'->>'done')::boolean, false) then
      raise exception 'ECR passport: emigration clearance (POE, eMigrate) must be granted before the flight.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists qr_departure_gate on public.qr_recruits;
create trigger qr_departure_gate before insert or update on public.qr_recruits for each row execute function public.qr_departure_gate();

-- HR uploads the approved calling visa copy (file kind 'vdr'); the assigned agent can then download it from the portal
create or replace function public.qr_set_vdr_copy(p_recruit uuid, p_file uuid, p_approved date default null) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; f public.qr_files; ag boolean;
begin
  select * into r from public.qr_recruits where id = p_recruit for update;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  select * into f from public.qr_files where id = p_file;
  if f.id is null or f.company_id <> r.company_id then raise exception 'The calling visa copy must be a file of the same company.'; end if;
  if r.vdr_applied is null then raise exception 'Apply the calling visa (VDR) first — the copy is uploaded after approval.'; end if;
  ag := exists (select 1 from public.qr_agent_batches b join public.qr_agents a on a.id = b.agent_id where b.batch_id = r.batch_id and a.active);
  update public.qr_recruits set vdr_file = f.id, vdr_approved = coalesce(p_approved, vdr_approved, current_date),
    steps = steps || jsonb_build_object('vdr_ok', jsonb_build_object('done', true, 'date', coalesce(p_approved, vdr_approved, current_date), 'by_name', public.my_name(), 'at', now()))
      || case when ag then jsonb_build_object('vdr_sent', jsonb_build_object('done', true, 'date', current_date, 'note', 'Available in the agent portal', 'by_name', public.my_name(), 'at', now())) else '{}'::jsonb end,
    stage = case when stage in ('sourcing','interview','offer','passport','medical','vdr') then 'clearance' else stage end, updated_at = now()
  where id = r.id;
  perform public.qr_event(r.company_id, 'Calling visa copy uploaded' || case when ag then ' — shared with the agent' else '' end, f.name, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_vdr_copy', 'quota_recruit', r.id::text, 'Calling visa copy uploaded for ' || r.full_name, jsonb_build_object('file', f.id));
end $$;

/* ---------------- agents (external) ---------------- */
create table if not exists public.qr_agents (
  id uuid primary key default gen_random_uuid(),
  agency text not null, country text not null default 'India', licence text, contact_name text, phone text, email text,
  user_id uuid unique,                       -- auth user of the agent login (NO staff profile: staff data is invisible to it)
  active boolean not null default true, revoked_at timestamptz, revoked_by_name text, revoke_reason text,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.qr_agent_batches (
  agent_id uuid not null references public.qr_agents(id), batch_id uuid not null references public.qr_batches(id), company_id text not null,
  assigned_by_name text, assigned_at timestamptz not null default now(),
  primary key (agent_id, batch_id)
);
create table if not exists public.qr_agent_docs (
  id uuid primary key default gen_random_uuid(),
  company_id text not null, batch_id uuid not null references public.qr_batches(id), recruit_id uuid not null references public.qr_recruits(id), agent_id uuid not null references public.qr_agents(id),
  kind text not null check (kind in ('passport','photo','medical','police','other')),
  path text not null unique, name text, mime text, size bigint, sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), note text,
  status text not null default 'submitted' check (status in ('submitted','accepted','rejected')),
  submitted_at timestamptz not null default now(), reviewed_by uuid, reviewed_by_name text, reviewed_at timestamptz, review_note text
);
create index if not exists qr_agent_docs_r on public.qr_agent_docs (recruit_id);
create table if not exists public.qr_agent_grants (   -- short-lived download grant: written only after the download is audited
  id bigserial primary key, user_id uuid not null, path text not null, expires_at timestamptz not null
);
create index if not exists qr_agent_grants_u on public.qr_agent_grants (user_id, path);

alter table public.qr_agents enable row level security;
alter table public.qr_agent_batches enable row level security;
alter table public.qr_agent_docs enable row level security;
alter table public.qr_agent_grants enable row level security;
drop policy if exists "qr read" on public.qr_agents;
create policy "qr read" on public.qr_agents for select to authenticated using (public.qr_rank() > 0);
drop policy if exists "qr read" on public.qr_agent_batches;
create policy "qr read" on public.qr_agent_batches for select to authenticated using (public.qr_scope(company_id));
drop policy if exists "qr read" on public.qr_agent_docs;
create policy "qr read" on public.qr_agent_docs for select to authenticated using (public.qr_scope(company_id));
revoke insert, update, delete, truncate on public.qr_agents, public.qr_agent_batches, public.qr_agent_docs from anon, authenticated;
revoke all on public.qr_agent_grants from anon, authenticated;
revoke all on sequence public.qr_agent_grants_id_seq from anon, authenticated;

-- the signed-in agent (null when not an agent, revoked, or a staff user)
create or replace function public.qr_agent_me() returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.qr_agents a where a.user_id = auth.uid() and a.active and auth.uid() is not null
    and not exists (select 1 from public.profiles p where p.id = auth.uid())
$$;
create or replace function public.qr_agent_has_recruit(p_recruit uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.qr_recruits r join public.qr_agent_batches b on b.batch_id = r.batch_id
    where r.id = p_recruit and b.agent_id = public.qr_agent_me() and r.status = 'active')
$$;
create or replace function public.qr_agent_path_ok(p_name text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.qr_recruits r join public.qr_agent_batches b on b.batch_id = r.batch_id
    where b.agent_id = public.qr_agent_me() and r.status = 'active'
      and r.company_id = (storage.foldername(p_name))[1] and r.batch_id::text = (storage.foldername(p_name))[2] and r.id::text = (storage.foldername(p_name))[3])
$$;
create or replace function public.qr_agent_audit(p_action text, p_id text, p_summary text, p_details jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (user_id, user_name, user_role, action, entity, entity_id, summary, details)
  values (auth.uid(), coalesce((select agency from public.qr_agents where user_id = auth.uid()), 'agent') || ' (agent)', 'agent', p_action, 'quota_agent', p_id, p_summary, p_details);
end $$;
revoke execute on function public.qr_agent_audit(text,text,text,jsonb) from public, anon, authenticated;

-- private bucket for agent uploads: <company>/<batch>/<recruit>/<uuid>-<name>. Agents add only; HR in scope reads. Nobody updates or deletes.
insert into storage.buckets (id, name, public) values ('quota-agent', 'quota-agent', false) on conflict (id) do update set public = false;
drop policy if exists "qr agent add" on storage.objects;
create policy "qr agent add" on storage.objects for insert to authenticated with check (bucket_id = 'quota-agent' and public.qr_agent_path_ok(name));
drop policy if exists "qr agent hr read" on storage.objects;
create policy "qr agent hr read" on storage.objects for select to authenticated using (bucket_id = 'quota-agent' and public.qr_scope((storage.foldername(name))[1]));
-- an agent reads a calling visa copy only through a fresh, audited grant for that exact file
drop policy if exists "qr agent vdr read" on storage.objects;
create policy "qr agent vdr read" on storage.objects for select to authenticated using (bucket_id = 'quota-docs' and public.qr_agent_me() is not null
  and exists (select 1 from public.qr_agent_grants g where g.user_id = auth.uid() and g.path = name and g.expires_at > now()));

-- HR: agent records
create or replace function public.qr_agent_save(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if public.qr_rank() < 2 then raise exception 'HR Admin, GM or CEO manages agents.' using errcode = '42501'; end if;
  if coalesce(trim(p->>'agency'), '') = '' then raise exception 'Enter the agency name.'; end if;
  if p->>'id' is null then
    insert into public.qr_agents (agency, country, licence, contact_name, phone, email, created_by_name)
    values (trim(p->>'agency'), coalesce(nullif(p->>'country', ''), 'India'), p->>'licence', p->>'contact_name', p->>'phone', lower(nullif(trim(p->>'email'), '')), public.my_name()) returning id into nid;
    perform public.audit('qr_agent_add', 'quota_agent', nid::text, 'Agent ' || (p->>'agency') || ' added', p);
    return nid;
  end if;
  update public.qr_agents set agency = coalesce(nullif(trim(p->>'agency'), ''), agency), country = coalesce(nullif(p->>'country', ''), country), licence = coalesce(p->>'licence', licence),
    contact_name = coalesce(p->>'contact_name', contact_name), phone = coalesce(p->>'phone', phone), email = case when user_id is null then coalesce(lower(nullif(trim(p->>'email'), '')), email) else email end,
    updated_at = now() where id = (p->>'id')::uuid returning id into nid;
  perform public.audit('qr_agent_edit', 'quota_agent', nid::text, 'Agent details updated', p);
  return nid;
end $$;
create or replace function public.qr_agent_assign(p_agent uuid, p_batch uuid, p_on boolean default true) returns void language plpgsql security definer set search_path = public as $$
declare b public.qr_batches; a public.qr_agents;
begin
  select * into b from public.qr_batches where id = p_batch; select * into a from public.qr_agents where id = p_agent;
  if b.id is null or a.id is null then raise exception 'Agent or batch not found.'; end if;
  perform public.qr_need(b.company_id, 2);
  if p_on then
    insert into public.qr_agent_batches (agent_id, batch_id, company_id, assigned_by_name) values (a.id, b.id, b.company_id, public.my_name()) on conflict do nothing;
    update public.qr_batches set agent_name = coalesce(agent_name, a.agency), agent_licence = coalesce(agent_licence, a.licence) where id = b.id;
  else
    delete from public.qr_agent_batches where agent_id = a.id and batch_id = b.id;
  end if;
  perform public.qr_event(b.company_id, case when p_on then 'Agent assigned: ' else 'Agent removed: ' end || a.agency, null, p_batch => b.id);
  perform public.audit(case when p_on then 'qr_agent_assign' else 'qr_agent_unassign' end, 'quota_agent', a.id::text, a.agency || case when p_on then ' assigned to batch ' else ' removed from batch ' end || b.title, null);
end $$;
-- revoke: access ends at once (every agent check reads active) and the agent's sessions are signed out
create or replace function public.qr_agent_revoke(p_agent uuid, p_reason text) returns void language plpgsql security definer set search_path = public, auth as $$
declare a public.qr_agents;
begin
  if public.qr_rank() < 2 then raise exception 'HR Admin, GM or CEO manages agents.' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  update public.qr_agents set active = false, revoked_at = now(), revoked_by_name = public.my_name(), revoke_reason = p_reason, updated_at = now() where id = p_agent returning * into a;
  if a.id is null then raise exception 'Agent not found.'; end if;
  if a.user_id is not null then
    delete from auth.refresh_tokens where user_id = a.user_id::text;
    delete from auth.sessions where user_id = a.user_id;
    delete from public.qr_agent_grants where user_id = a.user_id;
  end if;
  perform public.audit('qr_agent_revoke', 'quota_agent', a.id::text, 'Agent ' || a.agency || ' access revoked: ' || p_reason, null);
end $$;
create or replace function public.qr_agent_restore(p_agent uuid) returns void language plpgsql security definer set search_path = public as $$
declare a public.qr_agents;
begin
  if public.qr_rank() < 2 then raise exception 'HR Admin, GM or CEO manages agents.' using errcode = '42501'; end if;
  update public.qr_agents set active = true, revoked_at = null, revoke_reason = null, updated_at = now() where id = p_agent returning * into a;
  perform public.audit('qr_agent_restore', 'quota_agent', a.id::text, 'Agent ' || a.agency || ' access restored', null);
end $$;
-- service role only (edge function agent-admin): may this actor create / reset a login for this agent?
create or replace function public.qr_agent_login_check(p_actor uuid, p_agent uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r text; a public.qr_agents;
begin
  select role into r from public.profiles where id = p_actor and status = 'active';
  if coalesce(r, '') not in ('super_admin','admin','general_manager','hr_admin') then return jsonb_build_object('error', 'HR Admin, GM or CEO creates agent logins.'); end if;
  select * into a from public.qr_agents where id = p_agent;
  if a.id is null then return jsonb_build_object('error', 'Agent not found.'); end if;
  if not a.active then return jsonb_build_object('error', 'This agent is revoked — restore it first.'); end if;
  return jsonb_build_object('ok', true, 'agency', a.agency, 'email', a.email, 'user_id', a.user_id, 'contact', a.contact_name);
end $$;
create or replace function public.qr_agent_login_set(p_actor uuid, p_agent uuid, p_user uuid, p_action text) returns void language plpgsql security definer set search_path = public as $$
declare n text; rl text; a public.qr_agents;
begin
  select coalesce(nullif(full_name, ''), email), role into n, rl from public.profiles where id = p_actor;
  if p_user is not null then update public.qr_agents set user_id = p_user, updated_at = now() where id = p_agent; end if;
  select * into a from public.qr_agents where id = p_agent;
  insert into public.audit_log (user_id, user_name, user_role, action, entity, entity_id, summary, details)
  values (p_actor, n, rl, 'qr_agent_' || p_action, 'quota_agent', p_agent::text, 'Agent login ' || replace(p_action, '_', ' ') || ' for ' || a.agency, null);
end $$;
revoke execute on function public.qr_agent_login_check(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.qr_agent_login_set(uuid,uuid,uuid,text) from public, anon, authenticated;

-- HR verifies an agent upload: accept, or reject with a note (the agent sees the note and uploads again)
create or replace function public.qr_agent_review(p_doc uuid, p_accept boolean, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare d public.qr_agent_docs; rn text;
begin
  select * into d from public.qr_agent_docs where id = p_doc for update;
  if d.id is null then raise exception 'Document not found.'; end if;
  perform public.qr_need(d.company_id, 1);
  if d.status <> 'submitted' then raise exception 'Already %.', d.status; end if;
  if not p_accept and coalesce(trim(p_note), '') = '' then raise exception 'Tell the agent what to fix.'; end if;
  update public.qr_agent_docs set status = case when p_accept then 'accepted' else 'rejected' end, reviewed_by = auth.uid(), reviewed_by_name = public.my_name(), reviewed_at = now(), review_note = p_note where id = d.id;
  select full_name into rn from public.qr_recruits where id = d.recruit_id;
  perform public.qr_event(d.company_id, 'Agent ' || d.kind || ' ' || case when p_accept then 'accepted' else 'rejected' end, p_note, p_recruit => d.recruit_id, p_batch => d.batch_id);
  perform public.audit(case when p_accept then 'qr_agent_doc_accept' else 'qr_agent_doc_reject' end, 'quota_agent_doc', d.id::text,
    'Agent ' || d.kind || ' for ' || coalesce(rn, '') || case when p_accept then ' accepted' else ' rejected: ' || p_note end, null);
end $$;

-- AGENT side ------------------------------------------------------------
create or replace function public.agent_me() returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.qr_agent_me() is null then
      (select case when a.id is null then null else jsonb_build_object('revoked', true, 'agency', a.agency) end from public.qr_agents a where a.user_id = auth.uid() and auth.uid() is not null)
    else (select jsonb_build_object('id', a.id, 'agency', a.agency, 'country', a.country, 'licence', a.licence, 'contact', a.contact_name,
      'batches', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'country', b.country, 'company_id', b.company_id,
          'company', coalesce((select i->>'name' from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) i where i->>'id' = b.company_id), b.company_id),
          'expected_arrival', b.expected_arrival) order by b.created_at desc)
        from public.qr_agent_batches ab join public.qr_batches b on b.id = ab.batch_id where ab.agent_id = a.id), '[]'::jsonb))
      from public.qr_agents a where a.id = public.qr_agent_me()) end
$$;
-- only what an agent needs: name, passport, passport type, stage, own uploads + HR's verdict, whether a calling visa copy is ready. No costs, no staff names.
create or replace function public.agent_recruits() returns table (
  id uuid, batch_id uuid, batch_title text, company_id text, company text, full_name text, passport_no text, passport_expiry date, ecr text, country text,
  stage text, steps_done text[], vdr_ready boolean, vdr_name text, docs jsonb
) language sql stable security definer set search_path = public as $$
  select r.id, r.batch_id, b.title, r.company_id,
    coalesce((select i->>'name' from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) i where i->>'id' = r.company_id), r.company_id),
    r.full_name, r.passport_no, r.passport_expiry, r.ecr, r.country, r.stage,
    coalesce((select array_agg(k) from jsonb_each(r.steps) s(k, v) where coalesce((v->>'done')::boolean, false)), '{}'),
    r.vdr_file is not null, (select f.name from public.qr_files f where f.id = r.vdr_file),
    coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name, 'status', d.status, 'note', d.review_note, 'at', d.submitted_at) order by d.submitted_at desc)
      from public.qr_agent_docs d where d.recruit_id = r.id and d.agent_id = public.qr_agent_me()), '[]'::jsonb)
  from public.qr_recruits r join public.qr_batches b on b.id = r.batch_id
  join public.qr_agent_batches ab on ab.batch_id = r.batch_id and ab.agent_id = public.qr_agent_me()
  where r.status = 'active'
  order by b.title, r.full_name
$$;
create or replace function public.agent_add_doc(p_recruit uuid, p_kind text, p_path text, p_name text, p_mime text, p_size bigint, p_sha256 text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; me uuid := public.qr_agent_me(); nid uuid; ag text;
begin
  if me is null then raise exception 'Your agent access is not active.' using errcode = '42501'; end if;
  if not public.qr_agent_has_recruit(p_recruit) then raise exception 'This recruit is not in a batch assigned to you.' using errcode = '42501'; end if;
  select * into r from public.qr_recruits where id = p_recruit;
  if p_path not like r.company_id || '/' || r.batch_id || '/' || r.id || '/%' then raise exception 'Wrong upload path.' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'quota-agent' and o.name = p_path) then raise exception 'Upload the file first.'; end if;
  insert into public.qr_agent_docs (company_id, batch_id, recruit_id, agent_id, kind, path, name, mime, size, sha256, note)
  values (r.company_id, r.batch_id, r.id, me, p_kind, p_path, left(p_name, 120), p_mime, p_size, lower(p_sha256), left(p_note, 500)) returning id into nid;
  select agency into ag from public.qr_agents where id = me;
  insert into public.qr_events (company_id, recruit_id, batch_id, action, note, by_name, by_role) values (r.company_id, r.id, r.batch_id, 'Agent uploaded ' || p_kind, p_name, ag, 'Agent');
  perform public.qr_agent_audit('qr_agent_upload', nid::text, 'Uploaded ' || p_kind || ' for ' || r.full_name, jsonb_build_object('recruit', r.id, 'sha256', p_sha256, 'size', p_size));
  perform public.qr_notify(r.company_id, array['hr_admin','hr_manager','manager'], 'Agent upload to verify: ' || r.full_name, ag || ' uploaded the ' || p_kind || '.', 'quota?tab=agents&sub=verify', 'agd|' || nid);
  return nid;
end $$;
-- audited download of the calling visa copy: returns the path; a 2-minute grant lets the agent's own client fetch that one file
create or replace function public.agent_vdr_grant(p_recruit uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; f public.qr_files;
begin
  if public.qr_agent_me() is null then raise exception 'Your agent access is not active.' using errcode = '42501'; end if;
  if not public.qr_agent_has_recruit(p_recruit) then raise exception 'This recruit is not in a batch assigned to you.' using errcode = '42501'; end if;
  select * into r from public.qr_recruits where id = p_recruit;
  select * into f from public.qr_files where id = r.vdr_file;
  if f.id is null then raise exception 'HR has not uploaded the calling visa copy yet.'; end if;
  delete from public.qr_agent_grants where expires_at < now();
  insert into public.qr_agent_grants (user_id, path, expires_at) values (auth.uid(), f.path, now() + interval '2 minutes');
  perform public.qr_agent_audit('qr_agent_download', r.id::text, 'Downloaded calling visa copy for ' || r.full_name, jsonb_build_object('file', f.id));
  return jsonb_build_object('path', f.path, 'name', f.name);
end $$;

-- agent logins never get a staff profile (same rule as FW Worker logins)
do $$ declare src text := pg_get_functiondef('public.handle_new_user()'::regprocedure); n text; begin
  if position('fwm_agent' in src) = 0 then
    n := replace(src, 'if coalesce(new.raw_app_meta_data->>''fwm_worker'', '''') = ''true''',
      'if coalesce(new.raw_app_meta_data->>''fwm_agent'', '''') = ''true'' or coalesce(new.raw_user_meta_data->>''fwm_agent'', '''') = ''true'' then return new; end if;' || chr(10) ||
      '  if coalesce(new.raw_app_meta_data->>''fwm_worker'', '''') = ''true''');
    if n = src then raise exception '038: handle_new_user body not as expected'; end if;
    execute n;
  end if;
end $$;

/* ---------------- grants ---------------- */
do $$ declare f text; begin
  foreach f in array array['qr_set_rules(jsonb)','qr_add_gov_file(text,text,text,bigint,text)','qr_save_window(jsonb)','qr_claim_create(jsonb)','qr_claim_status(uuid,jsonb)',
    'qr_set_vdr_copy(uuid,uuid,date)','qr_agent_save(jsonb)','qr_agent_assign(uuid,uuid,boolean)','qr_agent_revoke(uuid,text)','qr_agent_restore(uuid)','qr_agent_review(uuid,boolean,text)',
    'agent_me()','agent_recruits()','agent_add_doc(uuid,text,text,text,text,bigint,text,text)','agent_vdr_grant(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

/* ---------------- System Map ---------------- */
insert into public.system_map (key, sort, title, content) values ('quota', 35, 'Quota & Recruitment module', jsonb_build_object('blocks', jsonb_build_array(
  jsonb_build_object('t', 'text', 'text', 'Admin-only module (CEO, GM, HR Admin, HR Manager) for quota letters, their use and the road from calling visa to arrival, plus exits (CMO register, runaway cases). External agents get a separate, very small portal. Outlet Managers, Viewers and workers have no access — enforced by the database, not only the menu.'),
  jsonb_build_object('t', 'kv', 'rows', jsonb_build_array(
    jsonb_build_array('Tables', 'qr_quotas, qr_ledger (append-only), qr_use_requests, qr_batches, qr_recruits, qr_events, qr_payments, qr_exits (CMO register), qr_runaways, qr_windows, qr_claims (applications), qr_files, qr_rules, qr_agents, qr_agent_batches, qr_agent_docs'),
    jsonb_build_array('Master table', 'qr_master(): per letter, company subtotal, sector total and grand total of approved / reserved / used / balance / expiring unused / runaways. Same scope as the user.'),
    jsonb_build_array('Anti-misuse', 'qr_alerts(): use without an approved request, workers on a letter without a used slot, unused balance at 90 / 60 / 30 days to expiry, approved requests idle, decisions waiting, a recorded government window closing.'),
    jsonb_build_array('Quota Use Request', 'Raised by HR Admin or HR Manager only. GM then CEO approve; the CEO alone is final (GM step skipped); the GM alone never is. Nobody decides their own request.'),
    jsonb_build_array('Calling visa gate', 'qr_recruit_gate and qr_ledger_check refuse a VDR or a ''use'' entry unless the request is CEO-approved. qr_departure_gate: India ECR passports need emigration clearance (POE) before the flight; ECNR skips it.'),
    jsonb_build_array('CMOs', 'Every Check Out Memo is recorded against the company''s letter with its permanent copy. A CMO adds nothing to any balance. Deaths and transfers are recorded but never count.'),
    jsonb_build_array('Government windows (rare)', 'Only when the government announces a window asking for CMOs: record it, build an application from CMOs on file, record the outcome. Only an approved outcome adds quota, as a new ''additional'' letter. Rejected / no outcome: CMOs go back on file.'),
    jsonb_build_array('Agents', 'Agent logins have no staff profile. They see only recruits of batches assigned to them (name, passport, stage), upload documents into bucket quota-agent (HR accepts / rejects) and download the calling visa copy through an audited 2-minute grant. Revoke ends access at once and signs them out.'),
    jsonb_build_array('Migration', '036_quota_recruitment.sql, 037_quota_link_recruit.sql, 038_quota_master_agents.sql (additive only)'))),
  jsonb_build_object('t', 'steps', 'items', jsonb_build_array(
    'Record the approval letter (scan + numbers; valid 12 months by default) → GM / CEO opens it after checking the original.',
    'HR raises a Quota Use Request → GM approves → CEO approves (or CEO directly).',
    'Per recruit: VDR applied (uses 1 slot) → copy uploaded → agent gets it → India ECR: eMigrate, RA demand, PBBY, emigration clearance → visa stamped → flight → arrival → convert to worker.',
    'On exit: record the CMO with its scan. Runaways get a runaway case (police + eRUNAWAY report within 14 days).'))
))) on conflict (key) do update set title = excluded.title, content = excluded.content, sort = excluded.sort, updated_at = now();

-- wording: a CMO in an application is "used in an application", not a replacement claim
do $$ declare src text := pg_get_functiondef('public.qr_void_exit(uuid,text)'::regprocedure); begin
  execute replace(src, 'This CMO is in a replacement claim — it cannot be voided.', 'This CMO is part of an additional quota application — it cannot be voided.');
end $$;
