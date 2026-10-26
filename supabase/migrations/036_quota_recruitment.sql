-- 036 Quota & Recruitment (v1.4.0 draft) — admin-only module: quota letters, append-only quota ledger,
-- Quota Use Requests (GM + CEO approval before any calling visa), recruitment pipeline, costs, CMO register,
-- runaway cases and replacement-quota claims. Additive only: new tables / functions / bucket; nothing existing changes.
-- Visibility: CEO, GM, HR Admin, HR Manager (company scope). Outlet Manager, Viewer and workers see nothing.
-- Writes: only through the security-definer functions below (every one audited). Ledger, files, CMOs: never updated or deleted.

/* ---------------- helpers ---------------- */
create or replace function public.qr_rank() returns int language sql stable security definer set search_path = public as $$
  select case when not public.is_active_user() then 0 else case public.my_role()
    when 'super_admin' then 4 when 'admin' then 4 when 'general_manager' then 3 when 'hr_admin' then 2
    when 'hr_manager' then 1 when 'manager' then 1 else 0 end end
$$;
create or replace function public.qr_scope(p_company text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.qr_rank() > 0 and p_company is not null and (public.is_unscoped() or p_company = any(public.my_companies())
    or exists (select 1 from unnest(public.my_outlets()) o where public.outlet_company(o) = p_company)), false)
$$;
create or replace function public.qr_need(p_company text, p_rank int default 1) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public.qr_rank() < p_rank then raise exception 'Your role cannot do this in Quota & Recruitment.' using errcode = '42501'; end if;
  if p_company is not null and not public.qr_scope(p_company) then raise exception 'This company is outside your scope.' using errcode = '42501'; end if;
end $$;
create or replace function public.qr_role_label() returns text language sql stable security definer set search_path = public as $$
  select case public.my_role() when 'super_admin' then 'CEO' when 'admin' then 'CEO' when 'general_manager' then 'General Manager'
    when 'hr_admin' then 'HR Admin' when 'hr_manager' then 'HR Manager' when 'manager' then 'HR Manager' else public.my_role() end
$$;
create or replace function public.qr_block_change() returns trigger language plpgsql as $$
begin raise exception '% is permanent: rows are never changed or deleted (post a reversal instead).', tg_table_name using errcode = '42501'; end $$;

/* ---------------- rules (single row) ---------------- */
create table if not exists public.qr_rules (
  id int primary key default 1 check (id = 1),
  cmo_missing_days int not null default 14,      -- departed with no CMO copy after N days -> alert
  runaway_report_days int not null default 14,   -- internal deadline to file the Immigration report (FWCMS eRUNAWAY)
  expiry_amber_days int not null default 90,
  expiry_red_days int not null default 30,
  util_amber_pct int not null default 80,
  payment_check_rm numeric not null default 5000, -- payments at or above this need a second person to verify
  templates jsonb not null default '{}'::jsonb,   -- per-country checklist overrides
  updated_at timestamptz not null default now(), updated_by uuid
);
insert into public.qr_rules (id) values (1) on conflict do nothing;

/* ---------------- files (letters, receipts, CMOs, police reports...) ---------------- */
create table if not exists public.qr_files (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  kind text not null,          -- letter | receipt | cmo | police | immigration | death | transfer | claim | other
  path text not null unique,   -- object path in bucket quota-docs: <company>/<kind>/<uuid>-<name>
  name text, mime text, size bigint,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid default auth.uid(), uploaded_by_name text, uploaded_at timestamptz not null default now()
);

/* ---------------- quota approval letters ---------------- */
create table if not exists public.qr_quotas (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  ref_no text not null,                  -- KDN / KESUMA approval reference (SKB)
  kind text not null default 'new' check (kind in ('new','replacement','transfer')),
  approval_date date not null,
  expiry_date date,                      -- SKB use-by date (12-18 months; extensions recorded below)
  sector text, subsector text, job_title text,
  breakdown jsonb not null default '{}'::jsonb,   -- {"India": 30, "Nepal": 20}
  conditions text, levy_note text, notes text,
  section60k_ref text, section60k_expiry date,
  letter_file uuid references public.qr_files(id),
  status text not null default 'pending' check (status in ('pending','active','rejected','closed')),
  extensions jsonb not null default '[]'::jsonb,  -- [{from,to,ref,at,by}]
  claim_id uuid,                                  -- set when created from a replacement claim
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(),
  opened_by uuid, opened_by_name text, opened_at timestamptz,
  unique (company_id, ref_no)
);

/* ---------------- ledger (append only) ---------------- */
create table if not exists public.qr_ledger (
  id bigserial primary key,
  at timestamptz not null default now(),
  company_id text not null,
  quota_id uuid not null references public.qr_quotas(id),
  country text not null,
  kind text not null check (kind in ('approved','reserve','release','use','use_existing','return','expire','transfer_out','transfer_in',
    'adjust_up','adjust_down','exit_cmo','exit_other','exit_other_elig','exit_void','runaway','runaway_void','claim_submit','claim_release','claim_approved','reversal')),
  qty int not null check (qty > 0),
  d_avail int not null default 0, d_resv int not null default 0, d_used int not null default 0,
  d_elig int not null default 0, d_claim int not null default 0, d_repl int not null default 0,
  d_lapsed int not null default 0, d_cmo int not null default 0, d_other int not null default 0, d_run int not null default 0,
  use_request_id uuid, recruit_id uuid, exit_id uuid, runaway_id uuid, claim_id uuid, reverses bigint references public.qr_ledger(id),
  ref text, note text,
  by_id uuid default auth.uid(), by_name text, by_role text
);
create index if not exists qr_ledger_q on public.qr_ledger (quota_id, country);
create index if not exists qr_ledger_ur on public.qr_ledger (use_request_id);

-- bucket deltas per kind (bank-style: every movement is a debit from one bucket and a credit to another)
create or replace function public.qr_ledger_fill() returns trigger language plpgsql as $$
declare q int := new.qty; r public.qr_ledger;
begin
  new.d_avail := 0; new.d_resv := 0; new.d_used := 0; new.d_elig := 0; new.d_claim := 0; new.d_repl := 0; new.d_lapsed := 0; new.d_cmo := 0; new.d_other := 0; new.d_run := 0;
  case new.kind
    when 'approved' then new.d_avail := q;
    when 'reserve' then new.d_avail := -q; new.d_resv := q;
    when 'release' then new.d_resv := -q; new.d_avail := q;
    when 'use' then new.d_resv := -q; new.d_used := q;
    when 'use_existing' then new.d_avail := -q; new.d_used := q;   -- workers already in Malaysia under this letter (import)
    when 'return' then new.d_used := -q; new.d_avail := q;
    when 'expire' then new.d_avail := -q; new.d_lapsed := q;
    when 'transfer_out' then new.d_avail := -q;
    when 'transfer_in' then new.d_avail := q;
    when 'adjust_up' then new.d_avail := q;
    when 'adjust_down' then new.d_avail := -q;
    when 'exit_cmo' then new.d_cmo := q; new.d_elig := q;          -- left Malaysia with a Check Out Memo: replacement-eligible
    when 'exit_other' then new.d_other := q;                        -- death / transfer: recorded, not replaceable
    when 'exit_other_elig' then new.d_other := q; new.d_elig := q;  -- death accepted for replacement (death certificate on file)
    when 'exit_void' then null;                                     -- filled from the voided entry below
    when 'runaway' then new.d_run := q;                              -- absconded: no CMO, not replaceable
    when 'runaway_void' then new.d_run := -q;
    when 'claim_submit' then new.d_elig := -q; new.d_claim := q;
    when 'claim_release' then new.d_claim := -q; new.d_elig := q;
    when 'claim_approved' then new.d_claim := -q; new.d_repl := q;
    when 'reversal' then null;
  end case;
  if new.kind in ('reversal','exit_void') then
    select * into r from public.qr_ledger where id = new.reverses;
    if r.id is null then raise exception 'reversal needs the entry it reverses'; end if;
    if exists (select 1 from public.qr_ledger where reverses = r.id) then raise exception 'entry % is already reversed', r.id; end if;
    new.quota_id := r.quota_id; new.country := r.country; new.company_id := r.company_id; new.qty := r.qty;
    new.d_avail := -r.d_avail; new.d_resv := -r.d_resv; new.d_used := -r.d_used; new.d_elig := -r.d_elig; new.d_claim := -r.d_claim;
    new.d_repl := -r.d_repl; new.d_lapsed := -r.d_lapsed; new.d_cmo := -r.d_cmo; new.d_other := -r.d_other; new.d_run := -r.d_run;
  end if;
  return new;
end $$;
drop trigger if exists qr_ledger_fill on public.qr_ledger;
create trigger qr_ledger_fill before insert on public.qr_ledger for each row execute function public.qr_ledger_fill();

-- no bucket may go below zero; a 'use' needs a fully approved Quota Use Request with reserved slots left (the VDR gate)
create or replace function public.qr_ledger_check() returns trigger language plpgsql as $$
declare b record; ur record; left_ int;
begin
  select sum(d_avail) a, sum(d_resv) r, sum(d_used) u, sum(d_elig) e, sum(d_claim) c, sum(d_run) rn into b
    from public.qr_ledger where quota_id = new.quota_id and country = new.country;
  if b.a < 0 then raise exception 'Not enough quota balance for % on this letter (short by %).', new.country, -b.a using errcode = 'P0001'; end if;
  if b.r < 0 or b.u < 0 or b.e < 0 or b.c < 0 or b.rn < 0 then raise exception 'This movement would make a quota bucket negative.' using errcode = 'P0001'; end if;
  if new.kind = 'use' then
    select * into ur from public.qr_use_requests where id = new.use_request_id;
    if ur.id is null or ur.status <> 'approved' then
      raise exception 'Calling visa blocked: the Quota Use Request is not approved by the CEO yet.' using errcode = '42501';
    end if;
    select coalesce(sum(d_resv), 0) into left_ from public.qr_ledger where use_request_id = ur.id;
    if left_ < 0 then raise exception 'All slots of this Quota Use Request are already used.' using errcode = 'P0001'; end if;
  end if;
  return null;
end $$;
drop trigger if exists qr_ledger_check on public.qr_ledger;

/* ---------------- Quota Use Requests (GM + CEO approval before any calling visa) ---------------- */
create table if not exists public.qr_use_requests (
  id uuid primary key default gen_random_uuid(),
  ref_no bigserial,
  company_id text not null,
  quota_id uuid not null references public.qr_quotas(id),
  country text not null,
  slots int not null check (slots > 0),
  batch_id uuid,
  recruit_ids uuid[] not null default '{}',
  purpose text not null,
  est_cost_rm numeric,
  files uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','gm_approved','approved','returned','rejected','cancelled')),
  requested_by uuid not null default auth.uid(), requested_by_name text, requested_by_role text, requested_at timestamptz not null default now(),
  gm_by uuid, gm_by_name text, gm_at timestamptz, gm_note text,
  ceo_by uuid, ceo_by_name text, ceo_at timestamptz, ceo_note text, gm_skipped boolean not null default false,
  closed_by uuid, closed_by_name text, closed_role text, closed_at timestamptz, close_note text,
  timeline jsonb not null default '[]'::jsonb   -- [{at, by, role, action, note}]
);
create trigger qr_ledger_check after insert on public.qr_ledger for each row execute function public.qr_ledger_check();
drop trigger if exists qr_ledger_nochange on public.qr_ledger;
create trigger qr_ledger_nochange before update or delete on public.qr_ledger for each row execute function public.qr_block_change();
drop trigger if exists qr_files_nochange on public.qr_files;
create trigger qr_files_nochange before update or delete on public.qr_files for each row execute function public.qr_block_change();

/* ---------------- recruitment ---------------- */
create table if not exists public.qr_batches (
  id uuid primary key default gen_random_uuid(),
  company_id text not null, quota_id uuid references public.qr_quotas(id), country text not null,
  title text not null, agent_name text, agent_licence text, ra_name text, target_count int not null default 1,
  outlet_id text, hostel_id text, expected_arrival date,
  budget jsonb not null default '{}'::jsonb, budget_total numeric not null default 0,
  status text not null default 'open' check (status in ('open','closed')),
  notes text, created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.qr_recruits (
  id uuid primary key default gen_random_uuid(),
  company_id text not null, batch_id uuid references public.qr_batches(id), use_request_id uuid references public.qr_use_requests(id),
  country text not null, full_name text not null, passport_no text, passport_expiry date, ecr text check (ecr in ('ECR','ECNR')),
  dob date, gender text, job text, phone text,
  stage text not null default 'sourcing',
  steps jsonb not null default '{}'::jsonb,      -- {key: {done, date, ref, note, by, by_name, at}}
  vdr_no text, vdr_applied date, vdr_approved date, vdr_expiry date,
  flight_no text, flight_at timestamptz, airport text, pickup_by text, transport text,
  arrived_at timestamptz, hostel_id text, outlet_id text, owner_id uuid,
  status text not null default 'active' check (status in ('active','dropped','converted')),
  drop_reason text, worker_id text,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists qr_recruits_b on public.qr_recruits (batch_id);
create table if not exists public.qr_events (
  id bigserial primary key, at timestamptz not null default now(), company_id text not null,
  recruit_id uuid, batch_id uuid, use_request_id uuid, exit_id uuid, runaway_id uuid, claim_id uuid,
  action text not null, note text, by_id uuid default auth.uid(), by_name text, by_role text
);
create index if not exists qr_events_r on public.qr_events (recruit_id);
drop trigger if exists qr_events_nochange on public.qr_events;
create trigger qr_events_nochange before update or delete on public.qr_events for each row execute function public.qr_block_change();

/* ---------------- payments ---------------- */
create table if not exists public.qr_payments (
  id uuid primary key default gen_random_uuid(),
  company_id text not null, quota_id uuid references public.qr_quotas(id), batch_id uuid references public.qr_batches(id), recruit_id uuid references public.qr_recruits(id),
  country text, category text not null, amount_rm numeric not null check (amount_rm > 0),
  paid_on date not null, payee text, method text, ref text, note text, receipt_file uuid references public.qr_files(id),
  status text not null default 'recorded' check (status in ('recorded','pending_check','verified','void')),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(),
  checked_by uuid, checked_by_name text, checked_at timestamptz,
  void_by uuid, void_by_name text, void_at timestamptz, void_reason text
);

/* ---------------- exits: CMO register (+ death / transfer) ---------------- */
create table if not exists public.qr_exits (
  id uuid primary key default gen_random_uuid(),
  company_id text not null, quota_id uuid references public.qr_quotas(id), country text,
  worker_id text, worker_no text, worker_name text not null, passport_no text, permit_no text,
  kind text not null default 'cmo' check (kind in ('cmo','death','transfer')),
  cmo_ref text, cmo_date date, exit_reason text, departure_date date, flight_no text,
  file_id uuid references public.qr_files(id),
  status text not null default 'eligible' check (status in ('eligible','claimed','replaced','not_eligible','void')),
  claim_id uuid, void_reason text,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now()
);
create unique index if not exists qr_exits_ref on public.qr_exits (company_id, cmo_ref) where cmo_ref is not null and status <> 'void';
create unique index if not exists qr_exits_worker on public.qr_exits (worker_id) where worker_id is not null and status <> 'void';

/* ---------------- runaway (absconded) cases ---------------- */
create table if not exists public.qr_runaways (
  id uuid primary key default gen_random_uuid(),
  company_id text not null, quota_id uuid references public.qr_quotas(id), country text,
  worker_id text, worker_no text, worker_name text not null, passport_no text, permit_no text,
  last_seen date not null, flagged_at timestamptz not null default now(),
  reported_by_name text, reported_at timestamptz,
  police_report_no text, police_report_date date, police_file uuid references public.qr_files(id),
  imm_ref text, imm_date date, imm_file uuid references public.qr_files(id),
  permit_cancel text not null default 'pending' check (permit_cancel in ('pending','applied','cancelled')),
  bond_rm numeric, bond_status text not null default 'to_be_forfeited' check (bond_status in ('to_be_forfeited','forfeited','sita_paid','released')),
  sita_rm numeric, levy_note text, wages_owed_rm numeric, money_owed_note text,
  followups jsonb not null default '[]'::jsonb,
  outcome text not null default 'open' check (outcome in ('open','found','returned','closed')),
  outcome_date date, outcome_note text,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists qr_runaways_worker on public.qr_runaways (worker_id) where worker_id is not null and outcome = 'open';

/* ---------------- replacement claims ---------------- */
create table if not exists public.qr_claims (
  id uuid primary key default gen_random_uuid(),
  ref_no bigserial,
  company_id text not null, title text not null, announcement text, notes text,
  status text not null default 'draft' check (status in ('draft','submitted','approved','partly_approved','rejected')),
  submitted_at date, gov_ref text, decided_on date, approved_count int, new_quota_id uuid references public.qr_quotas(id),
  pack_file uuid references public.qr_files(id),
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(),
  decided_by uuid, decided_by_name text
);
create table if not exists public.qr_claim_items (
  claim_id uuid not null references public.qr_claims(id), exit_id uuid not null references public.qr_exits(id),
  released boolean not null default false, approved boolean,
  primary key (claim_id, exit_id)
);
-- one CMO can sit in only one live claim — the database refuses a second one (double-claim guard)
create unique index if not exists qr_claim_items_once on public.qr_claim_items (exit_id) where not released;

/* ---------------- RLS: read only, admin roles in company scope ---------------- */
do $$ declare t text; begin
  foreach t in array array['qr_files','qr_quotas','qr_ledger','qr_use_requests','qr_batches','qr_recruits','qr_events','qr_payments','qr_exits','qr_runaways','qr_claims'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "qr read" on public.%I', t);
    execute format('create policy "qr read" on public.%I for select to authenticated using (public.qr_scope(company_id))', t);
    execute format('revoke insert, update, delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;
alter table public.qr_claim_items enable row level security;
drop policy if exists "qr read" on public.qr_claim_items;
create policy "qr read" on public.qr_claim_items for select to authenticated using (exists (select 1 from public.qr_claims c where c.id = claim_id and public.qr_scope(c.company_id)));
revoke insert, update, delete, truncate on public.qr_claim_items from anon, authenticated;
alter table public.qr_rules enable row level security;
drop policy if exists "qr read" on public.qr_rules;
create policy "qr read" on public.qr_rules for select to authenticated using (public.qr_rank() > 0);
revoke insert, update, delete, truncate on public.qr_rules from anon, authenticated;
revoke all on sequence public.qr_ledger_id_seq, public.qr_events_id_seq from anon, authenticated;

/* ---------------- private bucket: permanent copies ---------------- */
insert into storage.buckets (id, name, public) values ('quota-docs', 'quota-docs', false) on conflict (id) do update set public = false;
drop policy if exists "qr docs read" on storage.objects;
create policy "qr docs read" on storage.objects for select to authenticated using (bucket_id = 'quota-docs' and public.qr_scope((storage.foldername(name))[1]));
drop policy if exists "qr docs add" on storage.objects;
create policy "qr docs add" on storage.objects for insert to authenticated with check (bucket_id = 'quota-docs' and public.qr_scope((storage.foldername(name))[1]));
-- no update / delete policy for anyone: copies in quota-docs are kept for good

/* ---------------- internal: ledger post, event, notify ---------------- */
create or replace function public.qr_post(p_quota uuid, p_country text, p_kind text, p_qty int, p_ref text default null, p_note text default null,
  p_use uuid default null, p_recruit uuid default null, p_exit uuid default null, p_run uuid default null, p_claim uuid default null, p_reverses bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare c text; nid bigint;
begin
  select company_id into c from public.qr_quotas where id = p_quota;
  insert into public.qr_ledger (company_id, quota_id, country, kind, qty, ref, note, use_request_id, recruit_id, exit_id, runaway_id, claim_id, reverses, by_name, by_role)
  values (c, p_quota, coalesce(p_country, '-'), p_kind, coalesce(p_qty, 1), p_ref, p_note, p_use, p_recruit, p_exit, p_run, p_claim, p_reverses, public.my_name(), public.qr_role_label())
  returning id into nid;
  return nid;
end $$;
revoke execute on function public.qr_post(uuid,text,text,int,text,text,uuid,uuid,uuid,uuid,uuid,bigint) from public, anon, authenticated;

create or replace function public.qr_event(p_company text, p_action text, p_note text default null, p_recruit uuid default null, p_batch uuid default null,
  p_use uuid default null, p_exit uuid default null, p_run uuid default null, p_claim uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.qr_events (company_id, recruit_id, batch_id, use_request_id, exit_id, runaway_id, claim_id, action, note, by_name, by_role)
  values (p_company, p_recruit, p_batch, p_use, p_exit, p_run, p_claim, p_action, p_note, coalesce(public.my_name(), 'system'), public.qr_role_label());
end $$;
revoke execute on function public.qr_event(text,text,text,uuid,uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;

-- in-app notification (bell) to the given roles in scope of the company
create or replace function public.qr_notify(p_company text, p_roles text[], p_title text, p_body text, p_link text, p_key text, p_critical boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare u record; app text := coalesce(nullif(public.cfg('notifications')->>'appUrl', ''), 'https://fw.sunrisebayumas.com/');
begin
  for u in select id, coalesce(nullif(full_name, ''), email) n from public.profiles
    where status = 'active' and role = any(p_roles) and id is distinct from auth.uid()
      and (role in ('super_admin','admin','general_manager') or coalesce(cardinality(company_ids), 0) = 0 or p_company = any(company_ids)
           or exists (select 1 from unnest(outlet_ids) o where public.outlet_company(o) = p_company)) loop
    insert into public.notification_deliveries (event, user_id, recipient, channel, title, body, link, critical, status, sent_at, dedupe_key)
    values ('quota', u.id, u.n, 'in_app', p_title, p_body, app || '#/' || p_link, p_critical, 'sent', now(), 'qr|' || p_key || '|' || u.id)
    on conflict (dedupe_key) do nothing;
  end loop;
end $$;
revoke execute on function public.qr_notify(text,text[],text,text,text,text,boolean) from public, anon, authenticated;

/* ---------------- rules ---------------- */
create or replace function public.qr_set_rules(p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  if public.qr_rank() < 4 and not (public.is_gm() and public.gm_can('settings')) then raise exception 'Only the CEO sets the quota rules.' using errcode = '42501'; end if;
  update public.qr_rules set
    cmo_missing_days = coalesce((p->>'cmo_missing_days')::int, cmo_missing_days), runaway_report_days = coalesce((p->>'runaway_report_days')::int, runaway_report_days),
    expiry_amber_days = coalesce((p->>'expiry_amber_days')::int, expiry_amber_days), expiry_red_days = coalesce((p->>'expiry_red_days')::int, expiry_red_days),
    util_amber_pct = coalesce((p->>'util_amber_pct')::int, util_amber_pct), payment_check_rm = coalesce((p->>'payment_check_rm')::numeric, payment_check_rm),
    templates = coalesce(p->'templates', templates), updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public.audit('qr_rules', 'quota', '1', 'Quota rules updated', p);
end $$;

/* ---------------- files ---------------- */
create or replace function public.qr_add_file(p_company text, p_kind text, p_path text, p_name text, p_mime text, p_size bigint, p_sha256 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public.qr_need(p_company, 1);
  if split_part(p_path, '/', 1) <> p_company then raise exception 'File path must start with the company id.'; end if;
  insert into public.qr_files (company_id, kind, path, name, mime, size, sha256, uploaded_by_name) values (p_company, p_kind, p_path, p_name, p_mime, p_size, lower(p_sha256), public.my_name())
  returning id into nid;
  perform public.audit('qr_file', 'quota_file', nid::text, 'Uploaded ' || p_kind || ': ' || coalesce(p_name, p_path), jsonb_build_object('sha256', p_sha256, 'size', p_size));
  return nid;
end $$;

/* ---------------- quota letters ---------------- */
-- HR records the letter; it opens (ledger 'approved') only when the GM or CEO — not the person who keyed it — confirms it against the original.
create or replace function public.qr_save_quota(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; nid uuid; c text := p->>'company_id';
begin
  if p->>'id' is null then
    perform public.qr_need(c, 1);
    insert into public.qr_quotas (company_id, ref_no, kind, approval_date, expiry_date, sector, subsector, job_title, breakdown, conditions, levy_note, notes, section60k_ref, section60k_expiry, letter_file, created_by_name)
    values (c, p->>'ref_no', coalesce(p->>'kind', 'new'), (p->>'approval_date')::date, (p->>'expiry_date')::date, p->>'sector', p->>'subsector', p->>'job_title',
      coalesce(p->'breakdown', '{}'::jsonb), p->>'conditions', p->>'levy_note', p->>'notes', p->>'section60k_ref', (p->>'section60k_expiry')::date, (p->>'letter_file')::uuid, public.my_name())
    returning id into nid;
    perform public.audit('qr_quota_add', 'quota', nid::text, 'Quota letter ' || (p->>'ref_no') || ' recorded (waiting for GM / CEO to open it)', p);
    perform public.qr_notify(c, array['super_admin','admin','general_manager'], 'Quota letter to confirm: ' || (p->>'ref_no'),
      'A new quota approval letter was recorded. Check it against the original and open it.', 'quota?tab=quotas', 'qopen|' || nid);
    return nid;
  end if;
  select * into q from public.qr_quotas where id = (p->>'id')::uuid for update;
  perform public.qr_need(q.company_id, 1);
  -- numbers and dates of an open letter change only through the ledger / an extension; descriptive fields may be corrected
  update public.qr_quotas set sector = coalesce(p->>'sector', sector), subsector = coalesce(p->>'subsector', subsector), job_title = coalesce(p->>'job_title', job_title),
    conditions = coalesce(p->>'conditions', conditions), levy_note = coalesce(p->>'levy_note', levy_note), notes = coalesce(p->>'notes', notes),
    letter_file = coalesce((p->>'letter_file')::uuid, letter_file),
    ref_no = case when status = 'pending' then coalesce(p->>'ref_no', ref_no) else ref_no end,
    approval_date = case when status = 'pending' then coalesce((p->>'approval_date')::date, approval_date) else approval_date end,
    expiry_date = case when status = 'pending' then coalesce((p->>'expiry_date')::date, expiry_date) else expiry_date end,
    breakdown = case when status = 'pending' then coalesce(p->'breakdown', breakdown) else breakdown end
  where id = q.id;
  perform public.audit('qr_quota_edit', 'quota', q.id::text, 'Quota letter ' || q.ref_no || ' details edited', p);
  return q.id;
end $$;

create or replace function public.qr_open_quota(p_id uuid, p_ok boolean, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; k text; v text;
begin
  select * into q from public.qr_quotas where id = p_id for update;
  if q.id is null or q.status <> 'pending' then raise exception 'This letter is not waiting to be opened.'; end if;
  perform public.qr_need(q.company_id, 3);
  if q.created_by = auth.uid() then raise exception 'You recorded this letter — another GM or the CEO confirms it.' using errcode = '42501'; end if;
  if not p_ok then
    update public.qr_quotas set status = 'rejected', notes = concat_ws(E'\n', notes, 'Rejected: ' || coalesce(p_note, '')) where id = q.id;
    perform public.audit('qr_quota_reject', 'quota', q.id::text, 'Quota letter ' || q.ref_no || ' not opened: ' || coalesce(p_note, ''), null);
    return;
  end if;
  for k, v in select key, value from jsonb_each_text(q.breakdown) loop
    if v::int > 0 then perform public.qr_post(q.id, k, 'approved', v::int, q.ref_no, coalesce(p_note, 'Approval letter opened')); end if;
  end loop;
  update public.qr_quotas set status = 'active', opened_by = auth.uid(), opened_by_name = public.my_name(), opened_at = now() where id = q.id;
  perform public.audit('qr_quota_open', 'quota', q.id::text, 'Quota letter ' || q.ref_no || ' opened: ' || q.breakdown::text, null);
end $$;

-- GM / CEO only, never the person who asked: expire, transfer, adjust, return (VDR cancelled), extension, import existing workers
create or replace function public.qr_move(p_quota uuid, p_country text, p_kind text, p_qty int, p_note text, p_to_quota uuid default null, p_new_expiry date default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; nid bigint;
begin
  select * into q from public.qr_quotas where id = p_quota;
  perform public.qr_need(q.company_id, 3);
  if coalesce(trim(p_note), '') = '' then raise exception 'Give the reason / reference for this movement.'; end if;
  if p_kind = 'extend' then
    if p_new_expiry is null then raise exception 'New expiry date needed.'; end if;
    update public.qr_quotas set extensions = extensions || jsonb_build_array(jsonb_build_object('from', expiry_date, 'to', p_new_expiry, 'ref', p_note, 'at', now(), 'by', public.my_name())),
      expiry_date = p_new_expiry where id = q.id;
    perform public.audit('qr_quota_extend', 'quota', q.id::text, 'Quota letter ' || q.ref_no || ' extended to ' || p_new_expiry, null);
    return null;
  end if;
  if p_kind not in ('expire','adjust_up','adjust_down','return','use_existing','transfer') then raise exception 'Movement % is not allowed here.', p_kind; end if;
  if q.status <> 'active' then raise exception 'The letter is not open.'; end if;
  if p_kind = 'transfer' then
    if p_to_quota is null then raise exception 'Choose the letter to transfer to.'; end if;
    nid := public.qr_post(q.id, p_country, 'transfer_out', p_qty, null, p_note);
    perform public.qr_post(p_to_quota, p_country, 'transfer_in', p_qty, q.ref_no, p_note);
  else
    nid := public.qr_post(q.id, p_country, p_kind, p_qty, null, p_note);
  end if;
  perform public.audit('qr_move', 'quota', q.id::text, initcap(replace(p_kind, '_', ' ')) || ' ' || p_qty || ' × ' || p_country || ' on ' || q.ref_no, jsonb_build_object('note', p_note));
  return nid;
end $$;

-- reverse a ledger entry (GM / CEO). The original stays; a mirror entry cancels it.
create or replace function public.qr_reverse(p_entry bigint, p_note text) returns bigint language plpgsql security definer set search_path = public as $$
declare e public.qr_ledger; nid bigint;
begin
  select * into e from public.qr_ledger where id = p_entry;
  perform public.qr_need(e.company_id, 3);
  if e.kind in ('reversal','use','reserve','release','claim_submit','claim_release','claim_approved','exit_cmo','exit_other','exit_other_elig','runaway','runaway_void','exit_void') then
    raise exception 'This entry is reversed through its own record (request, CMO, runaway case or claim).'; end if;
  if e.by_id = auth.uid() then raise exception 'Another GM or the CEO reverses your own entry.' using errcode = '42501'; end if;
  nid := public.qr_post(e.quota_id, e.country, 'reversal', e.qty, 'Reverses #' || e.id, p_note, p_reverses => e.id);
  perform public.audit('qr_reverse', 'quota_ledger', e.id::text, 'Ledger entry #' || e.id || ' reversed: ' || coalesce(p_note, ''), null);
  return nid;
end $$;

/* ---------------- Quota Use Requests ---------------- */
create or replace function public.qr_ur_log(p_id uuid, p_action text, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare u public.qr_use_requests;
begin
  update public.qr_use_requests set timeline = timeline || jsonb_build_array(jsonb_build_object('at', now(), 'by', public.my_name(), 'role', public.qr_role_label(), 'action', p_action, 'note', p_note))
  where id = p_id returning * into u;
  perform public.qr_event(u.company_id, p_action, p_note, p_batch => u.batch_id, p_use => u.id);
  perform public.audit('qr_use_' || lower(regexp_replace(split_part(p_action, ' ', 1), '\W', '', 'g')), 'quota_use', u.id::text, 'Quota Use Request Q-' || u.ref_no || ': ' || p_action || coalesce(' — ' || p_note, ''), null);
end $$;
revoke execute on function public.qr_ur_log(uuid,text,text) from public, anon, authenticated;

create or replace function public.qr_request_use(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; nid uuid; n int := (p->>'slots')::int; r uuid; ref bigint;
begin
  select * into q from public.qr_quotas where id = (p->>'quota_id')::uuid;
  if q.id is null then raise exception 'Choose the approval letter.'; end if;
  perform public.qr_need(q.company_id, 1);
  if public.qr_rank() >= 4 then raise exception 'Quota Use Requests are raised by HR or the GM and approved by the CEO.' using errcode = '42501'; end if;
  if q.status <> 'active' then raise exception 'The letter % is not open.', q.ref_no; end if;
  if q.expiry_date is not null and q.expiry_date < current_date then raise exception 'The letter % expired on %.', q.ref_no, q.expiry_date; end if;
  if coalesce(trim(p->>'purpose'), '') = '' then raise exception 'Give the purpose of this quota use.'; end if;
  insert into public.qr_use_requests (company_id, quota_id, country, slots, batch_id, recruit_ids, purpose, est_cost_rm, files, requested_by_name, requested_by_role)
  values (q.company_id, q.id, p->>'country', n, (p->>'batch_id')::uuid,
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'recruit_ids', '[]'::jsonb)) x), '{}'),
    p->>'purpose', (p->>'est_cost_rm')::numeric,
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'files', '[]'::jsonb)) x), '{}'),
    public.my_name(), public.qr_role_label())
  returning id, ref_no into nid, ref;
  perform public.qr_post(q.id, p->>'country', 'reserve', n, 'Q-' || ref, 'Reserved for Quota Use Request Q-' || ref, p_use => nid);
  for r in select x::uuid from jsonb_array_elements_text(coalesce(p->'recruit_ids', '[]'::jsonb)) x loop
    update public.qr_recruits set use_request_id = nid where id = r and company_id = q.company_id;
  end loop;
  perform public.qr_ur_log(nid, 'Requested', p->>'purpose');
  perform public.qr_notify(q.company_id, case when public.is_gm() then array['super_admin','admin'] else array['super_admin','admin','general_manager'] end,
    'Quota use waiting for your approval: Q-' || ref, n || ' × ' || (p->>'country') || ' from ' || q.ref_no || '. ' || (p->>'purpose'), 'quota?tab=approvals', 'ur|' || nid, true);
  return nid;
end $$;

-- p_action: approve | reject | return | cancel | resubmit
create or replace function public.qr_decide_use(p_id uuid, p_action text, p_note text default null) returns text language plpgsql security definer set search_path = public as $$
declare u public.qr_use_requests; ceo boolean := public.qr_rank() >= 4; gm boolean := public.is_gm() and public.is_active_user(); left_ int;
begin
  select * into u from public.qr_use_requests where id = p_id for update;
  if u.id is null then raise exception 'Request not found.'; end if;
  perform public.qr_need(u.company_id, 1);
  if p_action = 'cancel' then
    if u.requested_by <> auth.uid() and not ceo then raise exception 'Only the person who raised it (or the CEO) cancels it.' using errcode = '42501'; end if;
    if u.status not in ('pending','gm_approved','returned') then raise exception 'This request is already %.', u.status; end if;
  elsif p_action = 'resubmit' then
    if u.requested_by <> auth.uid() or u.status <> 'returned' then raise exception 'Only a returned request is resubmitted, by the person who raised it.' using errcode = '42501'; end if;
    update public.qr_use_requests set status = 'pending', gm_by = null, gm_by_name = null, gm_at = null, gm_note = null where id = u.id;
    perform public.qr_ur_log(u.id, 'Resubmitted', p_note);
    perform public.qr_notify(u.company_id, array['super_admin','admin','general_manager'], 'Quota use resubmitted: Q-' || u.ref_no, coalesce(p_note, u.purpose), 'quota?tab=approvals', 'urs|' || u.id || '|' || now()::text, true);
    return 'pending';
  else
    if not (ceo or gm) then raise exception 'Only the GM or the CEO decides Quota Use Requests.' using errcode = '42501'; end if;
    if u.requested_by = auth.uid() then raise exception 'You raised this request — you cannot approve or decide it yourself.' using errcode = '42501'; end if;
    if u.status not in ('pending','gm_approved') then raise exception 'This request is %, not waiting for a decision.', u.status; end if;
    if p_action in ('reject','return') and coalesce(trim(p_note), '') = '' then raise exception 'Add a note for the requester.'; end if;
  end if;

  if p_action = 'approve' then
    if ceo then
      update public.qr_use_requests set status = 'approved', ceo_by = auth.uid(), ceo_by_name = public.my_name(), ceo_at = now(), ceo_note = p_note,
        gm_skipped = (gm_by is null) where id = u.id;
      perform public.qr_ur_log(u.id, case when u.gm_by is null then 'Approved by CEO (GM step skipped)' else 'Approved by CEO' end, p_note);
      perform public.qr_notify(u.company_id, array['super_admin','admin','general_manager','hr_admin','hr_manager','manager'],
        'Quota use approved: Q-' || u.ref_no, 'Calling visa (VDR) may now be applied for ' || u.slots || ' × ' || u.country || '.', 'quota?tab=pipeline', 'ura|' || u.id);
      return 'approved';
    end if;
    if u.status = 'gm_approved' then raise exception 'The GM has already approved — this request now waits for the CEO.'; end if;
    update public.qr_use_requests set status = 'gm_approved', gm_by = auth.uid(), gm_by_name = public.my_name(), gm_at = now(), gm_note = p_note where id = u.id;
    perform public.qr_ur_log(u.id, 'Approved by GM — waiting for CEO', p_note);
    perform public.qr_notify(u.company_id, array['super_admin','admin'], 'Quota use waiting for CEO approval: Q-' || u.ref_no,
      'GM approved ' || u.slots || ' × ' || u.country || '. ' || u.purpose, 'quota?tab=approvals', 'urg|' || u.id, true);
    return 'gm_approved';
  elsif p_action = 'return' then
    update public.qr_use_requests set status = 'returned', closed_by = auth.uid(), closed_by_name = public.my_name(), closed_role = public.qr_role_label(), closed_at = now(), close_note = p_note where id = u.id;
    perform public.qr_ur_log(u.id, 'Returned for changes', p_note);
    return 'returned';
  elsif p_action in ('reject','cancel') then
    select coalesce(sum(d_resv), 0) into left_ from public.qr_ledger where use_request_id = u.id;
    if left_ > 0 then perform public.qr_post(u.quota_id, u.country, 'release', left_, 'Q-' || u.ref_no, case when p_action = 'reject' then 'Rejected' else 'Cancelled' end || ': slots released', p_use => u.id); end if;
    update public.qr_use_requests set status = case when p_action = 'reject' then 'rejected' else 'cancelled' end,
      closed_by = auth.uid(), closed_by_name = public.my_name(), closed_role = public.qr_role_label(), closed_at = now(), close_note = p_note where id = u.id;
    update public.qr_recruits set use_request_id = null where use_request_id = u.id and vdr_applied is null;
    perform public.qr_ur_log(u.id, case when p_action = 'reject' then 'Rejected — ' else 'Cancelled — ' end || left_ || ' slot(s) released', p_note);
    return case when p_action = 'reject' then 'rejected' else 'cancelled' end;
  end if;
  raise exception 'Unknown action %', p_action;
end $$;

-- after approval: release the slots that will not be used (e.g. fewer candidates selected)
create or replace function public.qr_release_unused(p_id uuid, p_qty int, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare u public.qr_use_requests;
begin
  select * into u from public.qr_use_requests where id = p_id for update;
  perform public.qr_need(u.company_id, 2);
  perform public.qr_post(u.quota_id, u.country, 'release', p_qty, 'Q-' || u.ref_no, coalesce(p_note, 'Unused slots released'), p_use => u.id);
  perform public.qr_ur_log(u.id, 'Released ' || p_qty || ' unused slot(s)', p_note);
end $$;

/* ---------------- batches and recruits ---------------- */
create or replace function public.qr_save_batch(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare b public.qr_batches; nid uuid; c text := p->>'company_id';
begin
  if p->>'id' is null then
    perform public.qr_need(c, 1);
    insert into public.qr_batches (company_id, quota_id, country, title, agent_name, agent_licence, ra_name, target_count, outlet_id, hostel_id, expected_arrival, budget, budget_total, notes, created_by_name)
    values (c, (p->>'quota_id')::uuid, p->>'country', p->>'title', p->>'agent_name', p->>'agent_licence', p->>'ra_name', coalesce((p->>'target_count')::int, 1),
      p->>'outlet_id', p->>'hostel_id', (p->>'expected_arrival')::date, coalesce(p->'budget', '{}'::jsonb), coalesce((p->>'budget_total')::numeric, 0), p->>'notes', public.my_name())
    returning id into nid;
    perform public.qr_event(c, 'Batch created', p->>'title', p_batch => nid);
    perform public.audit('qr_batch_add', 'quota_batch', nid::text, 'Recruitment batch ' || (p->>'title') || ' created', p);
    return nid;
  end if;
  select * into b from public.qr_batches where id = (p->>'id')::uuid for update;
  perform public.qr_need(b.company_id, 1);
  update public.qr_batches set title = coalesce(p->>'title', title), agent_name = coalesce(p->>'agent_name', agent_name), agent_licence = coalesce(p->>'agent_licence', agent_licence),
    ra_name = coalesce(p->>'ra_name', ra_name), target_count = coalesce((p->>'target_count')::int, target_count), outlet_id = coalesce(p->>'outlet_id', outlet_id),
    hostel_id = coalesce(p->>'hostel_id', hostel_id), expected_arrival = coalesce((p->>'expected_arrival')::date, expected_arrival),
    budget = coalesce(p->'budget', budget), budget_total = coalesce((p->>'budget_total')::numeric, budget_total), notes = coalesce(p->>'notes', notes),
    status = coalesce(p->>'status', status), updated_at = now() where id = b.id;
  perform public.audit('qr_batch_edit', 'quota_batch', b.id::text, 'Recruitment batch ' || b.title || ' updated', p);
  return b.id;
end $$;

-- VDR gate on the recruit row itself (in addition to the ledger trigger)
create or replace function public.qr_recruit_gate() returns trigger language plpgsql as $$
declare st text;
begin
  if (new.vdr_applied is not null and (tg_op = 'INSERT' or old.vdr_applied is null))
     or (coalesce((new.steps->'vdr_apply'->>'done')::boolean, false) and (tg_op = 'INSERT' or not coalesce((old.steps->'vdr_apply'->>'done')::boolean, false))) then
    select status into st from public.qr_use_requests where id = new.use_request_id;
    if st is distinct from 'approved' then
      raise exception 'Calling visa (VDR) cannot be applied: the Quota Use Request for this recruit is not approved by the CEO.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists qr_recruit_gate on public.qr_recruits;
create trigger qr_recruit_gate before insert or update on public.qr_recruits for each row execute function public.qr_recruit_gate();

create or replace function public.qr_save_recruit(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; nid uuid; c text; b public.qr_batches; was text;
begin
  if p->>'id' is null then
    select * into b from public.qr_batches where id = (p->>'batch_id')::uuid;
    c := coalesce(b.company_id, p->>'company_id');
    perform public.qr_need(c, 1);
    insert into public.qr_recruits (company_id, batch_id, country, full_name, passport_no, passport_expiry, ecr, dob, gender, job, phone, stage, steps, owner_id, outlet_id, hostel_id, created_by_name)
    values (c, b.id, coalesce(p->>'country', b.country), p->>'full_name', upper(p->>'passport_no'), (p->>'passport_expiry')::date, nullif(p->>'ecr', ''), (p->>'dob')::date, p->>'gender',
      p->>'job', p->>'phone', coalesce(p->>'stage', 'sourcing'), coalesce(p->'steps', '{}'::jsonb), coalesce((p->>'owner_id')::uuid, auth.uid()),
      coalesce(p->>'outlet_id', b.outlet_id), coalesce(p->>'hostel_id', b.hostel_id), public.my_name())
    returning id into nid;
    perform public.qr_event(c, 'Recruit added', p->>'full_name', p_recruit => nid, p_batch => b.id);
    perform public.audit('qr_recruit_add', 'quota_recruit', nid::text, 'Recruit ' || (p->>'full_name') || ' added', null);
    return nid;
  end if;
  select * into r from public.qr_recruits where id = (p->>'id')::uuid for update;
  perform public.qr_need(r.company_id, 1);
  if r.status <> 'active' then raise exception 'This recruit is % — no more changes.', r.status; end if;
  was := r.stage;
  update public.qr_recruits set full_name = coalesce(p->>'full_name', full_name), passport_no = coalesce(upper(p->>'passport_no'), passport_no),
    passport_expiry = coalesce((p->>'passport_expiry')::date, passport_expiry), ecr = coalesce(nullif(p->>'ecr', ''), ecr), dob = coalesce((p->>'dob')::date, dob),
    gender = coalesce(p->>'gender', gender), job = coalesce(p->>'job', job), phone = coalesce(p->>'phone', phone), stage = coalesce(p->>'stage', stage),
    steps = case when p ? 'steps' then steps || (p->'steps') else steps end,
    vdr_no = coalesce(p->>'vdr_no', vdr_no), vdr_applied = coalesce((p->>'vdr_applied')::date, vdr_applied), vdr_approved = coalesce((p->>'vdr_approved')::date, vdr_approved),
    vdr_expiry = coalesce((p->>'vdr_expiry')::date, vdr_expiry), flight_no = coalesce(p->>'flight_no', flight_no), flight_at = coalesce((p->>'flight_at')::timestamptz, flight_at),
    airport = coalesce(p->>'airport', airport), pickup_by = coalesce(p->>'pickup_by', pickup_by), transport = coalesce(p->>'transport', transport),
    arrived_at = coalesce((p->>'arrived_at')::timestamptz, arrived_at), hostel_id = coalesce(p->>'hostel_id', hostel_id), outlet_id = coalesce(p->>'outlet_id', outlet_id),
    owner_id = coalesce((p->>'owner_id')::uuid, owner_id), updated_at = now()
  where id = r.id returning * into r;
  -- the calling visa application consumes one approved slot ('use')
  if r.vdr_applied is not null and not exists (select 1 from public.qr_ledger where recruit_id = r.id and kind = 'use') then
    perform public.qr_post((select quota_id from public.qr_use_requests where id = r.use_request_id), r.country, 'use', 1, coalesce(r.vdr_no, 'VDR'), 'Calling visa applied: ' || r.full_name,
      p_use => r.use_request_id, p_recruit => r.id);
    perform public.qr_event(r.company_id, 'Calling visa (VDR) applied — 1 quota slot used', r.vdr_no, p_recruit => r.id, p_batch => r.batch_id);
  end if;
  -- flight booked: heads-up to HR for the hostel / airport pickup
  if r.flight_at is not null and (p ? 'flight_at') then
    perform public.qr_notify(r.company_id, array['hr_admin','hr_manager','manager','general_manager'], 'Arrival coming: ' || r.full_name,
      'Flight ' || coalesce(r.flight_no, '') || ' lands ' || to_char(r.flight_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY HH24:MI') || ' MYT. Prepare the hostel bed, airport pickup and authorisation letter.',
      'quota/recruit/' || r.id, 'arr|' || r.id || '|' || r.flight_at::text);
  end if;
  if r.stage is distinct from was then perform public.qr_event(r.company_id, 'Stage: ' || r.stage, null, p_recruit => r.id, p_batch => r.batch_id); end if;
  if p ? 'steps' then perform public.qr_event(r.company_id, 'Checklist updated', (select string_agg(k, ', ') from jsonb_object_keys(p->'steps') k), p_recruit => r.id); end if;
  perform public.audit('qr_recruit_edit', 'quota_recruit', r.id::text, 'Recruit ' || r.full_name || ' updated', p - 'steps');
  return r.id;
end $$;

create or replace function public.qr_drop_recruit(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  perform public.qr_need(r.company_id, 2);
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  update public.qr_recruits set status = 'dropped', drop_reason = p_reason, updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'Dropped', p_reason, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_recruit_drop', 'quota_recruit', r.id::text, 'Recruit ' || r.full_name || ' dropped: ' || p_reason, null);
end $$;

create or replace function public.qr_mark_converted(p_id uuid, p_worker text) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  perform public.qr_need(r.company_id, 1);
  if r.status <> 'active' then raise exception 'Already %.', r.status; end if;
  if not exists (select 1 from public.records where entity = 'workers' and id = p_worker) then raise exception 'The worker record is not uploaded yet — wait for sync and try again.'; end if;
  update public.qr_recruits set status = 'converted', worker_id = p_worker, stage = 'converted', updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'Converted to worker', p_worker, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_convert', 'quota_recruit', r.id::text, 'Recruit ' || r.full_name || ' converted to worker ' || p_worker, null);
end $$;

/* ---------------- payments ---------------- */
create or replace function public.qr_add_payment(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; c text := p->>'company_id'; lim numeric := (select payment_check_rm from public.qr_rules where id = 1); amt numeric := (p->>'amount_rm')::numeric;
begin
  perform public.qr_need(c, 1);
  insert into public.qr_payments (company_id, quota_id, batch_id, recruit_id, country, category, amount_rm, paid_on, payee, method, ref, note, receipt_file, status, created_by_name)
  values (c, (p->>'quota_id')::uuid, (p->>'batch_id')::uuid, (p->>'recruit_id')::uuid, p->>'country', p->>'category', amt, (p->>'paid_on')::date,
    p->>'payee', p->>'method', p->>'ref', p->>'note', (p->>'receipt_file')::uuid, case when amt >= lim then 'pending_check' else 'recorded' end, public.my_name())
  returning id into nid;
  perform public.qr_event(c, 'Payment recorded: ' || (p->>'category') || ' RM ' || amt, p->>'ref', p_recruit => (p->>'recruit_id')::uuid, p_batch => (p->>'batch_id')::uuid);
  perform public.audit('qr_payment_add', 'quota_payment', nid::text, 'Payment ' || (p->>'category') || ' RM ' || amt || ' recorded', p);
  return nid;
end $$;
create or replace function public.qr_check_payment(p_id uuid, p_void boolean default false, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
declare x public.qr_payments;
begin
  select * into x from public.qr_payments where id = p_id for update;
  perform public.qr_need(x.company_id, 2);
  if x.created_by = auth.uid() then raise exception 'You recorded this payment — another person checks it.' using errcode = '42501'; end if;
  if x.status = 'void' then raise exception 'Already void.'; end if;
  if p_void then
    if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
    update public.qr_payments set status = 'void', void_by = auth.uid(), void_by_name = public.my_name(), void_at = now(), void_reason = p_reason where id = x.id;
    perform public.audit('qr_payment_void', 'quota_payment', x.id::text, 'Payment ' || x.category || ' RM ' || x.amount_rm || ' voided: ' || p_reason, null);
  else
    update public.qr_payments set status = 'verified', checked_by = auth.uid(), checked_by_name = public.my_name(), checked_at = now() where id = x.id;
    perform public.audit('qr_payment_check', 'quota_payment', x.id::text, 'Payment ' || x.category || ' RM ' || x.amount_rm || ' verified', null);
  end if;
end $$;

/* ---------------- CMO register / exits ---------------- */
create or replace function public.qr_record_exit(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; c text := p->>'company_id'; k text := coalesce(p->>'kind', 'cmo'); q uuid := (p->>'quota_id')::uuid; ctry text := p->>'country';
begin
  perform public.qr_need(c, 1);
  if k = 'cmo' and (coalesce(trim(p->>'cmo_ref'), '') = '' or p->>'file_id' is null) then raise exception 'A CMO needs its reference number and the scanned copy.'; end if;
  if q is not null and not exists (select 1 from public.qr_quotas where id = q and company_id = c) then raise exception 'That approval letter belongs to another company.'; end if;
  insert into public.qr_exits (company_id, quota_id, country, worker_id, worker_no, worker_name, passport_no, permit_no, kind, cmo_ref, cmo_date, exit_reason, departure_date, flight_no, file_id, status, created_by_name)
  values (c, q, ctry, p->>'worker_id', p->>'worker_no', p->>'worker_name', upper(p->>'passport_no'), p->>'permit_no', k, nullif(trim(p->>'cmo_ref'), ''), (p->>'cmo_date')::date,
    p->>'exit_reason', (p->>'departure_date')::date, p->>'flight_no', (p->>'file_id')::uuid,
    case when k = 'cmo' or (k = 'death' and coalesce((p->>'eligible')::boolean, false)) then 'eligible' else 'not_eligible' end, public.my_name())
  returning id into nid;
  if q is not null then
    perform public.qr_post(q, ctry, case when k = 'cmo' then 'exit_cmo' when k = 'death' and coalesce((p->>'eligible')::boolean, false) then 'exit_other_elig' else 'exit_other' end, 1, coalesce(p->>'cmo_ref', k),
      case when k = 'cmo' then 'Exited via CMO — eligible for replacement: ' else initcap(k) || ': ' end || (p->>'worker_name'), p_exit => nid);
  end if;
  perform public.qr_event(c, case k when 'cmo' then 'CMO recorded' else initcap(k) || ' recorded' end, coalesce(p->>'cmo_ref', '') || ' ' || (p->>'worker_name'), p_exit => nid);
  perform public.audit('qr_exit_add', 'quota_exit', nid::text, case k when 'cmo' then 'CMO ' || (p->>'cmo_ref') else initcap(k) end || ' recorded for ' || (p->>'worker_name'), p);
  return nid;
end $$;

-- a wrong CMO entry is voided (GM / CEO, not the person who recorded it). The row and its copy stay for good.
create or replace function public.qr_void_exit(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare x public.qr_exits; e bigint;
begin
  select * into x from public.qr_exits where id = p_id for update;
  perform public.qr_need(x.company_id, 3);
  if x.created_by = auth.uid() then raise exception 'Another GM or the CEO voids your own entry.' using errcode = '42501'; end if;
  if x.status in ('claimed','replaced') then raise exception 'This CMO is in a replacement claim — it cannot be voided.'; end if;
  if x.status = 'void' then raise exception 'Already void.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  select id into e from public.qr_ledger where exit_id = x.id and kind in ('exit_cmo','exit_other','exit_other_elig') and not exists (select 1 from public.qr_ledger r where r.reverses = qr_ledger.id);
  if e is not null then perform public.qr_post(x.quota_id, x.country, 'exit_void', 1, x.cmo_ref, 'Voided: ' || p_reason, p_exit => x.id, p_reverses => e); end if;
  update public.qr_exits set status = 'void', void_reason = p_reason where id = x.id;
  perform public.qr_event(x.company_id, 'Exit record voided', p_reason, p_exit => x.id);
  perform public.audit('qr_exit_void', 'quota_exit', x.id::text, 'Exit record ' || coalesce(x.cmo_ref, x.kind) || ' for ' || x.worker_name || ' voided: ' || p_reason, null);
end $$;

/* ---------------- runaway cases ---------------- */
create or replace function public.qr_save_runaway(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare x public.qr_runaways; nid uuid; c text := p->>'company_id'; q uuid := (p->>'quota_id')::uuid; e bigint;
begin
  if p->>'id' is null then
    perform public.qr_need(c, 1);
    if q is not null and not exists (select 1 from public.qr_quotas where id = q and company_id = c) then raise exception 'That approval letter belongs to another company.'; end if;
    insert into public.qr_runaways (company_id, quota_id, country, worker_id, worker_no, worker_name, passport_no, permit_no, last_seen, reported_by_name, reported_at, bond_rm, created_by_name)
    values (c, q, p->>'country', p->>'worker_id', p->>'worker_no', p->>'worker_name', upper(p->>'passport_no'), p->>'permit_no', (p->>'last_seen')::date,
      coalesce(p->>'reported_by_name', public.my_name()), coalesce((p->>'reported_at')::timestamptz, now()), (p->>'bond_rm')::numeric, public.my_name())
    returning id into nid;
    if q is not null then perform public.qr_post(q, p->>'country', 'runaway', 1, 'RUNAWAY', 'Absconded (no CMO): ' || (p->>'worker_name'), p_run => nid); end if;
    perform public.qr_event(c, 'Runaway flagged', 'Last seen ' || (p->>'last_seen'), p_run => nid);
    perform public.audit('qr_runaway_add', 'quota_runaway', nid::text, 'Runaway case opened for ' || (p->>'worker_name') || ', last seen ' || (p->>'last_seen'), p);
    perform public.qr_notify(c, array['super_admin','admin','general_manager','hr_admin'], 'Runaway: ' || (p->>'worker_name'),
      'Last seen ' || (p->>'last_seen') || '. Police report and the Immigration report (FWCMS eRUNAWAY) are due.', 'quota?tab=exits', 'run|' || nid, true);
    return nid;
  end if;
  select * into x from public.qr_runaways where id = (p->>'id')::uuid for update;
  perform public.qr_need(x.company_id, 1);
  update public.qr_runaways set
    police_report_no = coalesce(p->>'police_report_no', police_report_no), police_report_date = coalesce((p->>'police_report_date')::date, police_report_date),
    police_file = coalesce((p->>'police_file')::uuid, police_file), imm_ref = coalesce(p->>'imm_ref', imm_ref), imm_date = coalesce((p->>'imm_date')::date, imm_date),
    imm_file = coalesce((p->>'imm_file')::uuid, imm_file), permit_cancel = coalesce(p->>'permit_cancel', permit_cancel), bond_rm = coalesce((p->>'bond_rm')::numeric, bond_rm),
    bond_status = coalesce(p->>'bond_status', bond_status), sita_rm = coalesce((p->>'sita_rm')::numeric, sita_rm), levy_note = coalesce(p->>'levy_note', levy_note),
    wages_owed_rm = coalesce((p->>'wages_owed_rm')::numeric, wages_owed_rm), money_owed_note = coalesce(p->>'money_owed_note', money_owed_note),
    followups = case when p ? 'followup' then followups || jsonb_build_array(jsonb_build_object('at', now(), 'by', public.my_name(), 'note', p->>'followup')) else followups end,
    updated_at = now()
  where id = x.id returning * into x;
  if p ? 'outcome' and p->>'outcome' <> x.outcome then
    perform public.qr_need(x.company_id, 2);
    -- found / returned to work: the runaway count comes off the tally (the original entry stays, mirrored)
    if p->>'outcome' in ('found','returned') and x.quota_id is not null then
      select id into e from public.qr_ledger where runaway_id = x.id and kind = 'runaway' order by id desc limit 1;
      if e is not null and not exists (select 1 from public.qr_ledger where reverses = e) then
        perform public.qr_post(x.quota_id, x.country, 'runaway_void', 1, 'RUNAWAY', initcap(p->>'outcome') || ': ' || x.worker_name, p_run => x.id, p_reverses => e);
      end if;
    end if;
    update public.qr_runaways set outcome = p->>'outcome', outcome_date = coalesce((p->>'outcome_date')::date, current_date), outcome_note = p->>'outcome_note' where id = x.id;
    perform public.qr_event(x.company_id, 'Outcome: ' || (p->>'outcome'), p->>'outcome_note', p_run => x.id);
  end if;
  perform public.qr_event(x.company_id, 'Runaway case updated', coalesce(p->>'followup', ''), p_run => x.id);
  perform public.audit('qr_runaway_edit', 'quota_runaway', x.id::text, 'Runaway case for ' || x.worker_name || ' updated', p);
  return x.id;
end $$;

/* ---------------- replacement claims ---------------- */
create or replace function public.qr_claim_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; c text := p->>'company_id'; x public.qr_exits; e uuid; n int := 0;
begin
  perform public.qr_need(c, 2);
  insert into public.qr_claims (company_id, title, announcement, notes, created_by_name) values (c, p->>'title', p->>'announcement', p->>'notes', public.my_name()) returning id into nid;
  for e in select v::uuid from jsonb_array_elements_text(coalesce(p->'exit_ids', '[]'::jsonb)) v loop
    select * into x from public.qr_exits where id = e for update;
    if x.id is null or x.company_id <> c then raise exception 'CMO % is not in this company.', e; end if;
    if x.status <> 'eligible' then raise exception 'CMO % (%) is already % — it cannot be claimed twice.', coalesce(x.cmo_ref, ''), x.worker_name, x.status using errcode = '23505'; end if;
    insert into public.qr_claim_items (claim_id, exit_id) values (nid, x.id);
    update public.qr_exits set status = 'claimed', claim_id = nid where id = x.id;
    if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_submit', 1, x.cmo_ref, 'In replacement claim: ' || (p->>'title'), p_exit => x.id, p_claim => nid); end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Select at least one eligible CMO.'; end if;
  perform public.qr_event(c, 'Replacement claim created (' || n || ' CMOs)', p->>'title', p_claim => nid);
  perform public.audit('qr_claim_add', 'quota_claim', nid::text, 'Replacement claim ' || (p->>'title') || ' with ' || n || ' CMO(s)', p);
  return nid;
end $$;

-- status: submitted (with gov ref) | approved / partly_approved (GM / CEO, with the new letter ref) | rejected
create or replace function public.qr_claim_status(p_id uuid, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare cl public.qr_claims; st text := p->>'status'; x record; nq uuid; ok_ids uuid[]; nok int := 0; bd jsonb := '{}'::jsonb;
begin
  select * into cl from public.qr_claims where id = p_id for update;
  perform public.qr_need(cl.company_id, 2);
  if st = 'submitted' then
    if cl.status <> 'draft' then raise exception 'Only a draft is submitted.'; end if;
    update public.qr_claims set status = 'submitted', submitted_at = coalesce((p->>'submitted_at')::date, current_date), gov_ref = coalesce(p->>'gov_ref', gov_ref),
      pack_file = coalesce((p->>'pack_file')::uuid, pack_file) where id = cl.id;
  elsif st in ('approved','partly_approved') then
    perform public.qr_need(cl.company_id, 3);
    if cl.status not in ('draft','submitted') then raise exception 'This claim is already %.', cl.status; end if;
    if cl.created_by = auth.uid() then raise exception 'You created this claim — another GM or the CEO records the result.' using errcode = '42501'; end if;
    if coalesce(trim(p->>'gov_ref'), '') = '' then raise exception 'Enter the reference of the replacement approval letter.'; end if;
    ok_ids := coalesce((select array_agg(v::uuid) from jsonb_array_elements_text(p->'approved_exit_ids') v),
                       (select array_agg(exit_id) from public.qr_claim_items where claim_id = cl.id and not released));
    for x in select e.* from public.qr_claim_items i join public.qr_exits e on e.id = i.exit_id where i.claim_id = cl.id and not i.released loop
      if x.id = any(ok_ids) then
        if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_approved', 1, p->>'gov_ref', 'Replacement approved', p_exit => x.id, p_claim => cl.id); end if;
        update public.qr_exits set status = 'replaced' where id = x.id;
        update public.qr_claim_items set approved = true where claim_id = cl.id and exit_id = x.id;
        bd := jsonb_set(bd, array[coalesce(x.country, '-')], to_jsonb(coalesce((bd->>coalesce(x.country, '-'))::int, 0) + 1));
        nok := nok + 1;
      else
        if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_release', 1, p->>'gov_ref', 'Not approved in this round — eligible again', p_exit => x.id, p_claim => cl.id); end if;
        update public.qr_exits set status = 'eligible', claim_id = null where id = x.id;
        update public.qr_claim_items set released = true, approved = false where claim_id = cl.id and exit_id = x.id;
      end if;
    end loop;
    -- the replacement approval becomes a new letter, opened at once (decided by GM / CEO), linked to the claim
    insert into public.qr_quotas (company_id, ref_no, kind, approval_date, expiry_date, breakdown, notes, status, claim_id, created_by_name, opened_by, opened_by_name, opened_at, letter_file)
    values (cl.company_id, p->>'gov_ref', 'replacement', coalesce((p->>'decided_on')::date, current_date), (p->>'expiry_date')::date, bd,
      'Replacement for claim C-' || cl.ref_no, 'active', cl.id, public.my_name(), auth.uid(), public.my_name(), now(), (p->>'letter_file')::uuid)
    returning id into nq;
    for x in select key k, value::int v from jsonb_each_text(bd) loop
      perform public.qr_post(nq, x.k, 'approved', x.v, p->>'gov_ref', 'Replacement quota from claim C-' || cl.ref_no, p_claim => cl.id);
    end loop;
    update public.qr_claims set status = case when nok = (select count(*) from public.qr_claim_items where claim_id = cl.id) then 'approved' else 'partly_approved' end,
      gov_ref = p->>'gov_ref', decided_on = coalesce((p->>'decided_on')::date, current_date), approved_count = nok, new_quota_id = nq,
      decided_by = auth.uid(), decided_by_name = public.my_name() where id = cl.id;
  elsif st = 'rejected' then
    perform public.qr_need(cl.company_id, 3);
    if cl.status not in ('draft','submitted') then raise exception 'This claim is already %.', cl.status; end if;
    for x in select e.* from public.qr_claim_items i join public.qr_exits e on e.id = i.exit_id where i.claim_id = cl.id and not i.released loop
      if x.quota_id is not null then perform public.qr_post(x.quota_id, x.country, 'claim_release', 1, null, 'Claim rejected — eligible again', p_exit => x.id, p_claim => cl.id); end if;
      update public.qr_exits set status = 'eligible', claim_id = null where id = x.id;
      update public.qr_claim_items set released = true, approved = false where claim_id = cl.id and exit_id = x.id;
    end loop;
    update public.qr_claims set status = 'rejected', decided_on = current_date, decided_by = auth.uid(), decided_by_name = public.my_name(), notes = concat_ws(E'\n', notes, p->>'note') where id = cl.id;
  else raise exception 'Unknown status %', st;
  end if;
  perform public.qr_event(cl.company_id, 'Claim ' || st, coalesce(p->>'gov_ref', p->>'note'), p_claim => cl.id);
  perform public.audit('qr_claim_' || st, 'quota_claim', cl.id::text, 'Replacement claim C-' || cl.ref_no || ' ' || st, p);
  return cl.id;
end $$;

/* ---------------- tally + reconciliation ---------------- */
-- per approval letter and country: ledger buckets + live worker counts. used = active + CMO + other exits + runaways + no-record exits + in pipeline
create or replace function public.qr_tally(p_company text default null) returns table (
  company_id text, quota_id uuid, ref_no text, kind text, expiry_date date, status text, country text,
  approved int, available int, reserved int, used int, lapsed int,
  active_workers int, in_pipeline int, exited_cmo int, exited_other int, runaways int, exited_unrecorded int,
  repl_eligible int, repl_applied int, repl_approved int, mismatch int
) language sql stable security definer set search_path = public as $$
  with q as (select * from public.qr_quotas where status in ('active','closed') and public.qr_scope(company_id) and (p_company is null or company_id = p_company)),
  l as (select l.quota_id, l.country,
      sum(case when l.kind in ('approved','transfer_in','adjust_up') then l.qty when l.kind in ('transfer_out','adjust_down') then -l.qty
               when l.kind = 'reversal' then (select case when r.kind in ('approved','transfer_in','adjust_up') then -r.qty when r.kind in ('transfer_out','adjust_down') then r.qty else 0 end from public.qr_ledger r where r.id = l.reverses) else 0 end)::int appr,
      sum(d_avail)::int a, sum(d_resv)::int r, sum(d_used)::int u, sum(d_lapsed)::int lp, sum(d_cmo)::int cmo, sum(d_other)::int oth, sum(d_run)::int run,
      sum(d_elig)::int el, sum(d_claim)::int cl, sum(d_repl)::int rp
    from public.qr_ledger l join q on q.id = l.quota_id group by 1, 2),
  w as (select data->>'quotaId' qid, coalesce(nullif(data->>'nationality', ''), '-') ctry, id wid,
      data->>'status' st from public.records where entity = 'workers' and not deleted and data->>'quotaId' is not null),
  wa as (select qid, ctry,
      count(*) filter (where st not in ('Absconded','Resigned','Terminated','Contract Ended','Repatriated'))::int act,
      count(*) filter (where st in ('Resigned','Terminated','Contract Ended','Repatriated')
        and not exists (select 1 from public.qr_exits x where x.worker_id = w.wid and x.status <> 'void'))::int unrec,
      count(*) filter (where st = 'Absconded' and not exists (select 1 from public.qr_runaways x where x.worker_id = w.wid))::int runrec
    from w group by 1, 2),
  pp as (select u.quota_id, u.country, count(*)::int n from public.qr_recruits r join public.qr_use_requests u on u.id = r.use_request_id
      where r.status = 'active' and exists (select 1 from public.qr_ledger g where g.recruit_id = r.id and g.kind = 'use') group by 1, 2)
  select q.company_id, q.id, q.ref_no, q.kind, q.expiry_date, q.status, l.country,
    coalesce(l.appr, 0), coalesce(l.a, 0), coalesce(l.r, 0), coalesce(l.u, 0), coalesce(l.lp, 0),
    coalesce(wa.act, 0), coalesce(pp.n, 0), coalesce(l.cmo, 0), coalesce(l.oth, 0), coalesce(l.run, 0) + coalesce(wa.runrec, 0), coalesce(wa.unrec, 0),
    coalesce(l.el, 0), coalesce(l.cl, 0), coalesce(l.rp, 0),
    coalesce(l.u, 0) - (coalesce(wa.act, 0) + coalesce(pp.n, 0) + coalesce(l.cmo, 0) + coalesce(l.oth, 0) + coalesce(l.run, 0) + coalesce(wa.runrec, 0) + coalesce(wa.unrec, 0))
  from q join l on l.quota_id = q.id
  left join wa on wa.qid = q.id::text and wa.ctry = l.country
  left join pp on pp.quota_id = q.id and pp.country = l.country
  order by q.company_id, q.approval_date, l.country
$$;
revoke execute on function public.qr_tally(text) from public, anon;
grant execute on function public.qr_tally(text) to authenticated;

/* ---------------- grants ---------------- */
do $$ declare f text; begin
  foreach f in array array['qr_set_rules(jsonb)','qr_add_file(text,text,text,text,text,bigint,text)','qr_save_quota(jsonb)','qr_open_quota(uuid,boolean,text)',
    'qr_move(uuid,text,text,int,text,uuid,date)','qr_reverse(bigint,text)','qr_request_use(jsonb)','qr_decide_use(uuid,text,text)','qr_release_unused(uuid,int,text)',
    'qr_save_batch(jsonb)','qr_save_recruit(jsonb)','qr_drop_recruit(uuid,text)','qr_mark_converted(uuid,text)','qr_add_payment(jsonb)','qr_check_payment(uuid,boolean,text)',
    'qr_record_exit(jsonb)','qr_void_exit(uuid,text)','qr_save_runaway(jsonb)','qr_claim_create(jsonb)','qr_claim_status(uuid,jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

/* ---------------- System Map entry (CEO Control Center) ---------------- */
insert into public.system_map (key, sort, title, content) values ('quota', 35, 'Quota & Recruitment module', jsonb_build_object('blocks', jsonb_build_array(
  jsonb_build_object('t', 'text', 'text', 'Admin-only module (CEO, GM, HR Admin, HR Manager) for everything before a worker arrives in Malaysia, plus the exit side of the quota (CMO register, runaway cases, replacement claims). Outlet Managers, Viewers and workers have no access — enforced by the database, not only the menu.'),
  jsonb_build_object('t', 'kv', 'rows', jsonb_build_array(
    jsonb_build_array('Tables', 'qr_quotas, qr_ledger (append-only), qr_use_requests, qr_batches, qr_recruits, qr_events, qr_payments, qr_exits (CMO register), qr_runaways, qr_claims, qr_claim_items, qr_files, qr_rules'),
    jsonb_build_array('Storage', 'Private bucket quota-docs — letters, receipts, CMO copies, police / Immigration reports, claim packs. No update or delete policy: copies are kept for good. SHA-256 of every file in qr_files.'),
    jsonb_build_array('Ledger', 'Every movement is an entry (approved, reserve, release, use, return, expire, transfer, adjust, CMO exit, runaway, claim). Rows never change; mistakes are reversed by a mirror entry. A balance can never go below zero.'),
    jsonb_build_array('Quota Use Request', 'Every use of quota is requested by HR or the GM and reserves the slots. GM then CEO approve; the CEO alone is final (GM step skipped); GM alone never is. Nobody decides their own request. Reject / cancel releases the slots.'),
    jsonb_build_array('Calling visa gate', 'Triggers qr_recruit_gate and qr_ledger_check refuse a VDR application or a ''use'' entry unless the Quota Use Request is approved by the CEO.'),
    jsonb_build_array('Double-claim guard', 'Unique index qr_claim_items_once: one CMO sits in one live claim only; approved CMOs become ''replaced'' for good.'),
    jsonb_build_array('Migration', '036_quota_recruitment.sql (additive only)'))),
  jsonb_build_object('t', 'steps', 'items', jsonb_build_array(
    'Record the approval letter (scan + numbers) → GM / CEO opens it after checking the original.',
    'HR raises a Quota Use Request for the batch → GM approves → CEO approves (or CEO directly).',
    'Pipeline per recruit → VDR applied (uses 1 slot) → flight → arrival letter → FOMEMA / PLKS → Convert to worker.',
    'On exit: record the CMO with its scan; it becomes replacement-eligible. Runaways get a runaway case (police + eRUNAWAY report).',
    'When the government opens replacement: select eligible CMOs → claim pack PDF → record the result → new replacement letter is posted.'))
))) on conflict (key) do update set title = excluded.title, content = excluded.content, sort = excluded.sort, updated_at = now();
