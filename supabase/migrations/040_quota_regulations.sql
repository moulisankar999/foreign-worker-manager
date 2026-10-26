-- 040 Quota & Recruitment, part 5: Rules & regulations as versioned data (nothing regulatory is hard-coded).
--  * qr_reg_rules: every regulatory value / process is a versioned rule (key + scope) with an effective-from date, source / circular
--    reference, optional circular PDF, note, verified flag and who changed it. Older versions stay; each record is judged by the
--    version in force on its own date (letter approval date, last-seen date, arrival date, trigger date, recruit start).
--  * Only the CEO and HR Admin edit. An HR Admin change waits for CEO approval (maker-checker). Everything is audited.
--  * qr_reg_impact previews what a change affects before it is saved.
--  * Pipeline templates per country (India ECR / ECNR via step conditions) are rules too; each recruit is pinned to the template
--    version in force when he was added, so template changes never break recruits already in progress.
--  * Sector rules (source countries, job types per country / sub-sector, cap, advert-first, age range) warn or block.
--  * Replacement rules: which exit types may be replaced via Immigration and the documents each needs.

/* ---------------- storage ---------------- */
create table if not exists public.qr_reg_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null, scope text not null default '',
  value jsonb not null, effective_from date not null,
  source_ref text, source_url text, file_id uuid references public.qr_files(id), note text, verified boolean not null default false,
  status text not null default 'active' check (status in ('pending','active','rejected','withdrawn','superseded')),
  created_by uuid default auth.uid(), created_by_name text, created_role text, created_at timestamptz not null default now(),
  decided_by uuid, decided_by_name text, decided_at timestamptz, decide_note text
);
create index if not exists qr_reg_rules_k on public.qr_reg_rules (key, scope, effective_from desc) where status = 'active';
alter table public.qr_reg_rules enable row level security;
drop policy if exists "qr read" on public.qr_reg_rules;
create policy "qr read" on public.qr_reg_rules for select to authenticated using (public.qr_rank() > 0);
revoke insert, update, delete, truncate on public.qr_reg_rules from anon, authenticated;

alter table public.qr_quotas add column if not exists expiry_auto boolean not null default false;
alter table public.qr_quotas add column if not exists rule_flags jsonb not null default '[]'::jsonb;
alter table public.qr_quotas add column if not exists advert_ref text;
alter table public.qr_quotas add column if not exists advert_date date;
alter table public.qr_use_requests add column if not exists rule_flags jsonb not null default '[]'::jsonb;
alter table public.qr_recruits add column if not exists template_id uuid references public.qr_reg_rules(id);
alter table public.qr_recruits add column if not exists rule_flags jsonb not null default '[]'::jsonb;
alter table public.qr_recruits add column if not exists fomema_on date;
alter table public.qr_recruits add column if not exists fomema_result text check (fomema_result in ('fit','unfit'));
alter table public.qr_recruits add column if not exists fomema_file uuid references public.qr_files(id);
alter table public.qr_replacements drop constraint if exists qr_replacements_kind_check;
alter table public.qr_replacements add constraint qr_replacements_kind_check check (kind in ('not_arrived','fomema_fail','runaway','death','transfer','other'));

/* ---------------- catalogue (labels / units / groups — presentation, not regulation) ---------------- */
create or replace function public.qr_reg_catalog() returns table (key text, grp text, label text, unit text, kind text, scope_kind text, help text, ord int)
language sql immutable as $$ values
  ('letter_valid_months', 'Quota', 'Quota letter validity', 'months', 'int', 'none', 'Expiry = approval date + this many months, unless the letter states its own expiry.', 10),
  ('expiry_warn_days', 'Quota', 'Unused balance warnings before expiry', 'days', 'int_list', 'none', 'Three warning points, largest first (amber, amber, red).', 20),
  ('runaway_report_days', 'Deadlines', 'Runaway report (police + Immigration)', 'days', 'int', 'none', 'Counted from the day the worker was last seen.', 30),
  ('fomema_days', 'Deadlines', 'FOMEMA medical after arrival', 'days', 'int', 'none', 'Counted from the arrival date.', 40),
  ('repl_apply_days', 'Deadlines', 'Apply to Immigration for a replacement', 'days', 'int', 'none', 'Counted from FOMEMA fail / did-not-arrive date.', 50),
  ('repl_chase_days', 'Deadlines', 'Chase Immigration for a reply', 'days', 'int', 'none', 'Counted from the application date.', 60),
  ('vdr_valid_months', 'Deadlines', 'Calling visa (VDR) validity', 'months', 'int', 'none', 'Counted from VDR approval; the worker must enter before it lapses.', 70),
  ('levy_payment_days', 'Deadlines', 'Levy payment window', 'days', 'int', 'none', 'Counted from VDR approval.', 80),
  ('levy', 'Levy & fees', 'Annual levy per worker', 'RM / year', 'levy', 'sector', 'Per sector. Tiers apply only when the multi-tier levy is in force.', 90),
  ('min_wage', 'Levy & fees', 'Minimum wage', 'RM / month', 'money', 'none', 'Basic monthly minimum wage.', 100),
  ('bond', 'Levy & fees', 'Security bond / deposit', 'RM', 'money', 'country', 'Per source country.', 110),
  ('insurance', 'Levy & fees', 'Mandatory insurance', 'RM', 'items', 'none', 'Each insurance item and its yearly cost.', 120),
  ('fee_schedule', 'Levy & fees', 'Default cost items', 'RM', 'items', 'country', 'Default recruitment cost items per source country (optionally Country/Sector).', 130),
  ('sector_rules', 'Sector rules', 'Sector rules', '', 'sector', 'sector', 'Allowed source countries, job types, cap, advert-first and age range per sector or Sector/Sub-sector.', 140),
  ('pipeline', 'Country pipelines', 'Recruitment pipeline', 'stages', 'pipeline', 'country', 'Stages in order, documents, gates, owners, and the stage that marks the quota slot as used.', 150),
  ('replacement_rules', 'Replacement', 'Replacement via Immigration', '', 'replacement', 'none', 'Which exit types can be replaced and the documents each needs.', 160)
$$;

/* ---------------- lookups (version in force on a date) ---------------- */
create or replace function public.qr_reg_row(p_key text, p_scope text default '', p_at date default current_date) returns public.qr_reg_rules
language sql stable security definer set search_path = public as $$
  select * from public.qr_reg_rules where key = p_key and status = 'active' and effective_from <= coalesce(p_at, current_date)
    and scope in (coalesce(p_scope, ''), split_part(coalesce(p_scope, ''), '/', 1), '*', '')
  order by (scope = coalesce(p_scope, '')) desc, (scope = split_part(coalesce(p_scope, ''), '/', 1)) desc, (scope = '*') desc, effective_from desc, created_at desc limit 1
$$;
create or replace function public.qr_reg(p_key text, p_scope text default '', p_at date default current_date) returns jsonb
language sql stable security definer set search_path = public as $$ select (public.qr_reg_row(p_key, p_scope, p_at)).value $$;
create or replace function public.qr_reg_int(p_key text, p_at date default current_date, p_scope text default '') returns int
language sql stable security definer set search_path = public as $$ select (public.qr_reg(p_key, p_scope, p_at) #>> '{}')::numeric::int $$;
create or replace function public.qr_reg_warn(p_n int, p_at date default current_date) returns int
language sql stable security definer set search_path = public as $$ select (public.qr_reg('expiry_warn_days', '', p_at)->>(p_n - 1))::int $$;

/* ---------------- pipeline templates ---------------- */
create or replace function public.qr_tpl_for(p_country text, p_at date default current_date) returns uuid
language sql stable security definer set search_path = public as $$ select (public.qr_reg_row('pipeline', coalesce(p_country, '*'), p_at)).id $$;
-- ordered steps of a template version for a passport type. Step "ecr" condition: only for that passport type.
drop function if exists public.qr_pipeline_def(text, text);
create or replace function public.qr_pipeline_def_t(p_tpl uuid, p_ecr text) returns table (idx int, stage text, step text, req boolean, requires text[], label text, stage_label text, owner text, hint text)
language sql stable security definer set search_path = public as $$
  select s.o::int, s.v->>'key', st.v->>'key', coalesce((st.v->>'req')::boolean, true),
    coalesce((select array_agg(x) from jsonb_array_elements_text(st.v->'requires') x), '{}'), coalesce(st.v->>'label', st.v->>'key'),
    coalesce(s.v->>'label', s.v->>'key'), s.v->>'owner', st.v->>'hint'
  from public.qr_reg_rules t, jsonb_array_elements(t.value->'stages') with ordinality s(v, o), jsonb_array_elements(coalesce(s.v->'steps', '[]'::jsonb)) with ordinality st(v, o2)
  where t.id = p_tpl and not coalesce((s.v->>'retired')::boolean, false) and not coalesce((st.v->>'retired')::boolean, false)
    and (st.v->>'ecr' is null or st.v->>'ecr' = p_ecr)
  order by s.o, st.o2
$$;
create or replace function public.qr_pipeline_def(p_country text, p_ecr text) returns table (idx int, stage text, step text, req boolean, requires text[], label text, stage_label text, owner text, hint text)
language sql stable security definer set search_path = public as $$ select * from public.qr_pipeline_def_t(public.qr_tpl_for(p_country), p_ecr) $$;
create or replace function public.qr_stage_label_t(p_tpl uuid, k text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select s->>'label' from public.qr_reg_rules t, jsonb_array_elements(t.value->'stages') s where t.id = p_tpl and s->>'key' = k limit 1), public.qr_stage_label(k))
$$;
create or replace function public.qr_stage_of(r public.qr_recruits) returns text language sql stable security definer set search_path = public as $$
  select case when r.status = 'converted' then 'converted' else coalesce(
    (select d.stage from public.qr_pipeline_def_t(r.template_id, r.ecr) d where d.req and not public.qr_step_done(r, d.step) order by d.idx limit 1), 'onboard') end
$$;
create or replace function public.qr_stage_idx(r public.qr_recruits) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select d.idx from public.qr_pipeline_def_t(r.template_id, r.ecr) d where d.req and not public.qr_step_done(r, d.step) order by d.idx limit 1), 999)
$$;
-- does the row satisfy one requirement token?  col | col=value | agent:<doc kind> | a|b (any of)
create or replace function public.qr_req_ok(j jsonb, p_id uuid, tok text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare t text;
begin
  foreach t in array string_to_array(tok, '|') loop
    if t like 'agent:%' then
      if exists (select 1 from public.qr_agent_docs a where a.recruit_id = p_id and a.kind = substr(t, 7) and a.status = 'accepted') then return true; end if;
    elsif position('=' in t) > 0 then
      if j->>split_part(t, '=', 1) = split_part(t, '=', 2) then return true; end if;
    elsif coalesce(j->>t, '') <> '' then return true;
    end if;
  end loop;
  return false;
end $$;

-- pin each new recruit to the template in force today (fires before the gate: trigger names sort alphabetically)
create or replace function public.qr_tpl_pin() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.template_id is null then
    new.template_id := public.qr_tpl_for(new.country, coalesce(new.created_at::date, current_date));
    if new.template_id is null then raise exception 'No recruitment pipeline is set for % — add one in Rules & regulations.', new.country; end if;
  end if;
  if new.vdr_approved is not null and new.vdr_expiry is null and public.qr_reg_int('vdr_valid_months', new.vdr_approved) is not null then
    new.vdr_expiry := (new.vdr_approved + make_interval(months => public.qr_reg_int('vdr_valid_months', new.vdr_approved)))::date;
  end if;
  return new;
end $$;
drop trigger if exists qr_a_tpl_pin on public.qr_recruits;
create trigger qr_a_tpl_pin before insert or update on public.qr_recruits for each row execute function public.qr_tpl_pin();

-- the gate, now driven by the recruit's template version
create or replace function public.qr_pipeline_gate() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; d record; cur record; ov boolean; j jsonb; tok text;
begin
  if tg_op = 'UPDATE' and new.status <> 'active' and old.status <> 'active' then return new; end if;
  if new.vdr_applied is not null and (tg_op = 'INSERT' or old.vdr_applied is null) and not coalesce((new.steps->'vdr_apply'->>'done')::boolean, false)
     and exists (select 1 from public.qr_pipeline_def_t(new.template_id, new.ecr) x where x.step = 'vdr_apply') then
    new.steps := new.steps || jsonb_build_object('vdr_apply', jsonb_build_object('done', true, 'date', new.vdr_applied, 'by_name', public.my_name(), 'at', now()));
  end if;
  j := to_jsonb(new);
  for k, v in select key, value from jsonb_each(new.steps) loop
    continue when not coalesce((v->>'done')::boolean, false);
    continue when tg_op = 'UPDATE' and coalesce((old.steps->k->>'done')::boolean, false);
    select * into d from public.qr_pipeline_def_t(new.template_id, new.ecr) x where x.step = k limit 1;
    continue when d.idx is null;
    select x.* into cur from public.qr_pipeline_def_t(new.template_id, new.ecr) x where x.idx < d.idx and x.req and not public.qr_step_done(new, x.step) order by x.idx limit 1;
    if cur.idx is not null then
      raise exception 'Stage "%" cannot start: "%" is not complete yet.', d.stage_label, cur.stage_label using errcode = 'P0001';
    end if;
    ov := coalesce((v->>'override')::boolean, false);
    if ov and (public.qr_rank() < 4 or coalesce(trim(v->>'note'), '') = '') then raise exception 'Only the CEO marks a stage done without its documents, with a note.' using errcode = '42501'; end if;
    continue when ov;
    foreach tok in array d.requires loop
      if not public.qr_req_ok(j, new.id, tok) then
        raise exception '%: %', d.stage_label, coalesce(d.hint, 'complete "' || replace(replace(tok, '|', '" or "'), '_', ' ') || '" first.');
      end if;
    end loop;
  end loop;
  if tg_op = 'INSERT' or new.stage is distinct from public.qr_stage_of(new) then
    if new.status in ('active','converted') then new.stage := public.qr_stage_of(new); new.stage_at := now(); end if;
  end if;
  return new;
end $$;

-- the slot is used when the template's "use step" is newly done (CEO default: Calling visa approved)
create or replace function public.qr_pipeline_after() returns trigger language plpgsql security definer set search_path = public as $$
declare us text := coalesce((select value->>'use_step' from public.qr_reg_rules where id = new.template_id), 'vdr_ok');
begin
  if coalesce((new.steps->us->>'done')::boolean, false) and (tg_op = 'INSERT' or not coalesce((old.steps->us->>'done')::boolean, false))
     and not exists (select 1 from public.qr_ledger l where l.recruit_id = new.id and l.kind = 'use' and not exists (select 1 from public.qr_ledger x where x.reverses = l.id)) then
    perform public.qr_post((select quota_id from public.qr_use_requests where id = new.use_request_id), new.country, 'use', 1, coalesce(new.vdr_no, 'VDR'),
      public.qr_stage_label_t(new.template_id, (select x.stage from public.qr_pipeline_def_t(new.template_id, new.ecr) x where x.step = us limit 1)) || ': ' || new.full_name,
      p_use => new.use_request_id, p_recruit => new.id);
    perform public.qr_event(new.company_id, 'Quota slot now USED (' || public.qr_stage_label_t(new.template_id, (select x.stage from public.qr_pipeline_def_t(new.template_id, new.ecr) x where x.step = us limit 1)) || ')', new.vdr_no, p_recruit => new.id, p_batch => new.batch_id);
  end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    perform public.qr_event(new.company_id, 'Stage: ' || public.qr_stage_label_t(new.template_id, new.stage), null, p_recruit => new.id, p_batch => new.batch_id);
  end if;
  return null;
end $$;
create or replace function public.qr_used_lock() returns trigger language plpgsql security definer set search_path = public as $$
declare us text := coalesce((select value->>'use_step' from public.qr_reg_rules where id = new.template_id), 'vdr_ok');
begin
  if coalesce((old.steps->us->>'done')::boolean, false) and not coalesce((new.steps->us->>'done')::boolean, false) then
    raise exception 'The quota slot is already used at this step — it cannot be un-ticked.' using errcode = '42501'; end if;
  return new;
end $$;

create or replace function public.qr_stage_override(p_id uuid, p_stage text, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; add jsonb := '{}'::jsonb; d record;
begin
  if public.qr_rank() < 4 then raise exception 'Only the CEO marks a stage done without its documents.' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Give the reason.'; end if;
  select * into r from public.qr_recruits where id = p_id for update;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  if p_stage = (select (value->'stages'->0)->>'key' from public.qr_reg_rules where id = r.template_id) or p_stage = 'onboard' then
    raise exception 'Quota approval and onboarding cannot be marked done — they need the approval / the worker record.'; end if;
  for d in select * from public.qr_pipeline_def_t(r.template_id, r.ecr) x where x.stage = p_stage and x.req and left(x.step, 1) <> '_' loop
    if not public.qr_step_done(r, d.step) then
      add := add || jsonb_build_object(d.step, jsonb_build_object('done', true, 'date', current_date, 'override', true, 'note', p_note, 'by_name', public.my_name(), 'at', now()));
    end if;
  end loop;
  if add = '{}'::jsonb then raise exception 'Nothing to mark in this stage.'; end if;
  update public.qr_recruits set steps = steps || add, updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'CEO marked "' || public.qr_stage_label_t(r.template_id, p_stage) || '" done', p_note, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_stage_override', 'quota_recruit', r.id::text, 'CEO marked ' || public.qr_stage_label_t(r.template_id, p_stage) || ' done for ' || r.full_name || ': ' || p_note, null);
end $$;

-- outlet manager: the stage owned by 'outlet_manager' in the recruit's template
create or replace function public.qr_om_stage(r public.qr_recruits) returns text language sql stable security definer set search_path = public as $$
  select s->>'key' from public.qr_reg_rules t, jsonb_array_elements(t.value->'stages') s where t.id = r.template_id and s->>'owner' = 'outlet_manager' limit 1
$$;
drop function if exists public.qr_om_incoming();
create function public.qr_om_incoming() returns table (id uuid, full_name text, outlet_id text, arrival date, task text, done boolean, ready boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.full_name, r.outlet_id, coalesce(r.arrived_at, r.arrival_eta)::date,
    coalesce((select s->>'task' from public.qr_reg_rules t, jsonb_array_elements(t.value->'stages') s where t.id = r.template_id and s->>'owner' = 'outlet_manager' limit 1),
      'Welcome him at the outlet and confirm the brief here.'),
    coalesce((r.steps->(select x.step from public.qr_pipeline_def_t(r.template_id, r.ecr) x where x.stage = public.qr_om_stage(r) limit 1)->>'done')::boolean, false),
    r.stage = public.qr_om_stage(r)
  from public.qr_recruits r
  where public.is_active_user() and public.my_role() = 'outlet_manager' and r.outlet_id = any(public.my_outlets())
    and r.status = 'active' and (r.arrival_eta is not null or r.arrived_at is not null)
  order by 4
$$;
create or replace function public.qr_om_confirm(p_id uuid, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; st text; sp text;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  if r.id is null or not (public.is_active_user() and public.my_role() = 'outlet_manager' and r.outlet_id = any(public.my_outlets())) then
    raise exception 'Only the outlet manager of this outlet confirms the brief.' using errcode = '42501'; end if;
  st := public.qr_om_stage(r);
  if st is null or r.stage <> st then raise exception 'Not yet — this recruit is at "%".', public.qr_stage_label_t(r.template_id, r.stage); end if;
  select x.step into sp from public.qr_pipeline_def_t(r.template_id, r.ecr) x where x.stage = st limit 1;
  update public.qr_recruits set steps = steps || jsonb_build_object(sp, jsonb_build_object('done', true, 'date', current_date, 'note', p_note, 'by_name', public.my_name(), 'at', now())),
    om_by_name = public.my_name(), updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'Outlet manager brief confirmed', p_note, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_om_brief', 'quota_recruit', r.id::text, 'Outlet manager brief confirmed for ' || r.full_name, null);
end $$;
grant execute on function public.qr_om_incoming() to authenticated;

create or replace function public.qr_mark_converted(p_id uuid, p_worker text) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; last_stage text;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  perform public.qr_need(r.company_id, 1);
  if r.status <> 'active' then raise exception 'Already %.', r.status; end if;
  select (value->'stages'->-1)->>'key' into last_stage from public.qr_reg_rules where id = r.template_id;
  if public.qr_stage_of(r) <> last_stage then raise exception 'Onboard comes last: "%" is not complete yet.', public.qr_stage_label_t(r.template_id, public.qr_stage_of(r)); end if;
  if not exists (select 1 from public.records where entity = 'workers' and id = p_worker) then raise exception 'The worker record is not uploaded yet — wait for sync and try again.'; end if;
  update public.qr_recruits set status = 'converted', worker_id = p_worker,
    steps = steps || jsonb_build_object('onboard', jsonb_build_object('done', true, 'date', current_date, 'by_name', public.my_name(), 'at', now())), updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'Onboarded — worker record created (slot: used / active worker)', p_worker, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_convert', 'quota_recruit', r.id::text, 'Recruit ' || r.full_name || ' onboarded as worker ' || p_worker, null);
end $$;

/* ---------------- letter expiry from the rule in force on the approval date ---------------- */
create or replace function public.qr_quota_default_expiry() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.approval_date is not null and (new.expiry_date is null or (tg_op = 'UPDATE' and new.expiry_auto and new.approval_date is distinct from old.approval_date)) then
    new.expiry_date := (new.approval_date + make_interval(months => coalesce(public.qr_reg_int('letter_valid_months', new.approval_date), 12)))::date;
    new.expiry_auto := true;
  end if;
  return new;
end $$;

/* ---------------- sector rules ---------------- */
-- evaluate one sector rule value against a request / recruit. Returns warnings; rule.mode = 'block' makes callers refuse.
create or replace function public.qr_sector_eval(rule jsonb, p_country text, p_job text, p_dob date, p_sub text, p_on date default current_date)
returns setof text language plpgsql stable as $$
declare jr jsonb; age int;
begin
  if rule is null then return; end if;
  if p_country is not null and jsonb_typeof(rule->'countries') = 'array' and jsonb_array_length(rule->'countries') > 0 and not (rule->'countries') ? p_country then
    return next p_country || ' is not an allowed source country for this sector.'; end if;
  if p_job is not null and jsonb_typeof(rule->'jobs') = 'array' and jsonb_array_length(rule->'jobs') > 0
     and not exists (select 1 from jsonb_array_elements_text(rule->'jobs') j where lower(j) = lower(trim(p_job))) then
    return next 'Job "' || p_job || '" is not an allowed job type for this sector.'; end if;
  for jr in select x from jsonb_array_elements(coalesce(rule->'job_rules', '[]'::jsonb)) x where lower(x->>'job') = lower(trim(coalesce(p_job, ''))) loop
    if jr ? 'countries' and p_country is not null and not (jr->'countries') ? p_country then
      return next p_job || ' may only come from ' || (select string_agg(c, ', ') from jsonb_array_elements_text(jr->'countries') c) || '.'; end if;
    if jr ? 'sub_sectors' and (jr->>'country' is null or jr->>'country' = p_country)
       and not exists (select 1 from jsonb_array_elements_text(jr->'sub_sectors') s where lower(s) = lower(coalesce(p_sub, ''))) then
      return next coalesce(jr->>'note', p_job || ' from ' || coalesce(jr->>'country', p_country) || ' only in ' || (select string_agg(s, ', ') from jsonb_array_elements_text(jr->'sub_sectors') s)) || '.'; end if;
  end loop;
  if p_dob is not null then
    age := extract(year from age(p_on, p_dob));
    if (rule ? 'age_min' and age < (rule->>'age_min')::int) or (rule ? 'age_max' and age > (rule->>'age_max')::int) then
      return next 'Age ' || age || ' is outside ' || coalesce(rule->>'age_min', '?') || '–' || coalesce(rule->>'age_max', '?') || ' for this sector.'; end if;
  end if;
end $$;
create or replace function public.qr_sector_scope(q public.qr_quotas) returns text language sql stable as $$
  select coalesce(nullif(q.sector, ''), '-') || case when coalesce(q.subsector, '') <> '' then '/' || q.subsector else '' end
$$;

create or replace function public.qr_quota_rule_check() returns trigger language plpgsql security definer set search_path = public as $$
declare rule jsonb := public.qr_reg('sector_rules', public.qr_sector_scope(new), coalesce(new.approval_date, current_date)); f jsonb := '[]'::jsonb; c text;
begin
  if rule is null then new.rule_flags := '[]'::jsonb; return new; end if;
  for c in select key from jsonb_each(coalesce(new.breakdown, '{}'::jsonb)) loop
    f := f || coalesce((select jsonb_agg(x) from public.qr_sector_eval(rule, c, null, null, new.subsector) x), '[]'::jsonb);
  end loop;
  if coalesce((rule->>'advert_first')::boolean, false) and coalesce(new.advert_ref, '') = '' then
    f := f || to_jsonb(coalesce(rule->>'advert_note', 'Advertise locally first (MYFutureJobs) and record the advert reference.')); end if;
  if rule ? 'cap' and (select coalesce(sum(t.approved), 0) from public.qr_tally(new.company_id) t join public.qr_quotas q on q.id = t.quota_id
       where coalesce(q.sector, '') = coalesce(new.sector, '') and q.id <> new.id) + (select coalesce(sum(value::int), 0) from jsonb_each_text(coalesce(new.breakdown, '{}'::jsonb)) where value ~ '^\d+$') > (rule->>'cap')::int then
    f := f || to_jsonb('Above the sector cap of ' || (rule->>'cap') || ' foreign workers.'); end if;
  if jsonb_array_length(f) > 0 and rule->>'mode' = 'block' and public.qr_rank() < 4 then
    raise exception 'Sector rule: %', (select string_agg(x, ' ') from jsonb_array_elements_text(f) x); end if;
  new.rule_flags := f;
  return new;
end $$;
drop trigger if exists qr_quota_rule_check on public.qr_quotas;
create trigger qr_quota_rule_check before insert or update of breakdown, sector, subsector, approval_date, advert_ref on public.qr_quotas for each row execute function public.qr_quota_rule_check();

create or replace function public.qr_use_rule_check() returns trigger language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; rule jsonb; f jsonb;
begin
  select * into q from public.qr_quotas where id = new.quota_id;
  rule := public.qr_reg('sector_rules', public.qr_sector_scope(q), current_date);
  f := coalesce((select jsonb_agg(x) from public.qr_sector_eval(rule, new.country, null, null, q.subsector) x), '[]'::jsonb);
  if jsonb_array_length(f) > 0 and rule->>'mode' = 'block' then raise exception 'Sector rule: %', (select string_agg(x, ' ') from jsonb_array_elements_text(f) x); end if;
  new.rule_flags := f;
  return new;
end $$;
drop trigger if exists qr_use_rule_check on public.qr_use_requests;
create trigger qr_use_rule_check before insert on public.qr_use_requests for each row execute function public.qr_use_rule_check();

create or replace function public.qr_recruit_rule_check() returns trigger language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; rule jsonb; f jsonb;
begin
  if tg_op = 'UPDATE' and new.job is not distinct from old.job and new.dob is not distinct from old.dob and new.country is not distinct from old.country
     and new.use_request_id is not distinct from old.use_request_id then return new; end if;
  select qq.* into q from public.qr_quotas qq where qq.id = coalesce((select quota_id from public.qr_use_requests where id = new.use_request_id), (select quota_id from public.qr_batches where id = new.batch_id));
  if q.id is null then return new; end if;
  rule := public.qr_reg('sector_rules', public.qr_sector_scope(q), current_date);
  f := coalesce((select jsonb_agg(x) from public.qr_sector_eval(rule, new.country, new.job, new.dob, q.subsector) x), '[]'::jsonb);
  if jsonb_array_length(f) > 0 and rule->>'mode' = 'block' then raise exception 'Sector rule: %', (select string_agg(x, ' ') from jsonb_array_elements_text(f) x); end if;
  new.rule_flags := f;
  return new;
end $$;
drop trigger if exists qr_recruit_rule_check on public.qr_recruits;
create trigger qr_recruit_rule_check before insert or update on public.qr_recruits for each row execute function public.qr_recruit_rule_check();

/* ---------------- replacement rules ---------------- */
do $$ declare src text := pg_get_functiondef('public.qr_repl_create(jsonb)'::regprocedure); n text; begin
  n := replace(src, $q$  if k not in ('not_arrived','fomema_fail') then raise exception 'Replacement applications are only for FOMEMA fail or VDR approved but not arrived. Runaways are not replaceable.'; end if;$q$,
    $q$  if not coalesce((public.qr_reg('replacement_rules', '', (p->>'trigger_date')::date)->'kinds'->k->>'allowed')::boolean, false) then
    raise exception '%', coalesce(public.qr_reg('replacement_rules', '', (p->>'trigger_date')::date)->'kinds'->k->>'note', 'This exit type cannot be replaced under the rules in force.'); end if;
  if k not in ('not_arrived','fomema_fail') then raise exception 'This exit type is allowed by the rules but has no replacement form yet.'; end if;$q$);
  if n = src and src not like '%replacement_rules%' then raise exception '040: qr_repl_create body not as expected'; end if;
  execute n;
  src := pg_get_functiondef('public.qr_repl_step(uuid,text,jsonb)'::regprocedure);
  n := replace(src, $q$    if c.kind = 'fomema_fail' and coalesce((p->>'fomema_file')::uuid, c.fomema_file) is null then raise exception 'Attach the FOMEMA unfit result.'; end if;
    if c.kind = 'fomema_fail' and coalesce((p->>'repat_file')::uuid, c.repat_file) is null and coalesce((p->>'exit_id')::uuid, c.exit_id) is null then
      raise exception 'Attach the repatriation proof or link his CMO.'; end if;$q$,
    $q$    declare tok text; j jsonb := to_jsonb(c) || jsonb_strip_nulls(p); begin
      foreach tok in array coalesce((select array_agg(x) from jsonb_array_elements_text(public.qr_reg('replacement_rules', '', c.trigger_date)->'kinds'->c.kind->'docs') x), '{}') loop
        if not public.qr_req_ok(j, c.recruit_id, tok) then
          raise exception 'Attach %.', coalesce(public.qr_reg('replacement_rules', '', c.trigger_date)->'labels'->>tok, replace(replace(tok, '|', ' or '), '_', ' ')); end if;
      end loop;
    end;$q$);
  if n = src and src not like '%replacement_rules%' then raise exception '040: qr_repl_step body not as expected'; end if;
  execute n;
end $$;

/* ---------------- FOMEMA after arrival ---------------- */
create or replace function public.qr_recruit_fomema(p_id uuid, p_on date, p_result text, p_file uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  if r.arrived_at is null then raise exception 'FOMEMA is recorded after arrival.'; end if;
  if p_result not in ('fit','unfit') then raise exception 'Result is Fit or Unfit.'; end if;
  if p_file is not null and not exists (select 1 from public.qr_files where id = p_file and company_id = r.company_id) then raise exception 'File must belong to this company.'; end if;
  update public.qr_recruits set fomema_on = p_on, fomema_result = p_result, fomema_file = coalesce(p_file, fomema_file), updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'FOMEMA ' || upper(p_result), p_note, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_fomema', 'quota_recruit', r.id::text, 'FOMEMA ' || p_result || ' for ' || r.full_name, jsonb_build_object('on', p_on, 'note', p_note));
  if p_result = 'unfit' then
    perform public.qr_notify(r.company_id, array['hr_admin','hr_manager','super_admin','general_manager'], 'FOMEMA unfit: ' || r.full_name,
      'Repatriate him and apply to Immigration for a replacement.', 'quota/recruit/' || r.id, 'fomu|' || r.id, true);
  end if;
end $$;

/* ---------------- HR follow-ups, every deadline from the rule in force on the item's own date ---------------- */
create or replace function public.qr_followups_core(p_all boolean) returns table (
  kind text, ref text, company_id text, title text, step text, owner_id uuid, owner_name text, started date, due date, days_late int, link text, nudges int
) language sql stable security definer set search_path = public as $$
  with ru as (select * from public.qr_rules where id = 1),
  raw as (
    select 'replacement'::text kind, c.id::text ref, c.company_id, 'Replacement application R-' || c.ref_no || ': ' || r.full_name title,
      case c.status when 'to_apply' then 'Apply to Immigration' when 'applied' then 'Chase Immigration for the approval' else 'HR Admin to verify the approval' end step,
      case when c.status = 'approval_uploaded' then null else c.owner_id end def_owner, case when c.status = 'approval_uploaded' then 'HR Admin' else c.owner_name end def_name,
      c.trigger_date started,
      case c.status when 'to_apply' then c.trigger_date + coalesce(public.qr_reg_int('repl_apply_days', c.trigger_date), 7)
        when 'applied' then c.applied_on + coalesce(public.qr_reg_int('repl_chase_days', c.applied_on), 30) else c.uploaded_at::date + ru.verify_days end due,
      'quota?tab=exits&sub=repl&id=' || c.id link
    from public.qr_replacements c join public.qr_recruits r on r.id = c.recruit_id, ru where c.status in ('to_apply','applied','approval_uploaded')
    union all
    select 'runaway', x.id::text, x.company_id, 'Runaway report: ' || x.worker_name,
      case when x.police_report_no is null and x.imm_ref is null then 'Police report and Immigration (eRUNAWAY) report' when x.imm_ref is null then 'Immigration (eRUNAWAY) report' else 'Police report' end,
      x.created_by, x.created_by_name, x.last_seen, x.last_seen + coalesce(public.qr_reg_int('runaway_report_days', x.last_seen), 14), 'quota?tab=exits&run=' || x.id
    from public.qr_runaways x where x.outcome = 'open' and (x.imm_ref is null or x.police_report_no is null)
    union all
    select 'cmo', w.id, w.data->>'companyId', 'CMO not uploaded: ' || coalesce(w.data->>'fullName', w.id) || coalesce(' (' || (w.data->>'workerNo') || ')', ''), 'Upload the Check Out Memo',
      null, 'HR (unassigned)', coalesce(nullif(w.data->>'exitDate', '')::date, w.server_ts::date), coalesce(nullif(w.data->>'exitDate', '')::date, w.server_ts::date) + ru.cmo_missing_days, 'quota?tab=exits&newexit=' || w.id
    from public.records w, ru where w.entity = 'workers' and not w.deleted and w.data->>'quotaId' is not null
      and w.data->>'status' in ('Resigned','Terminated','Contract Ended','Repatriated')
      and not exists (select 1 from public.qr_exits x where x.worker_id = w.id and x.status <> 'void')
    union all
    select 'una', r.id::text, r.company_id, 'Used, not arrived: ' || r.full_name, 'Apply to Immigration for a replacement', r.owner_id, null,
      r.out_at::date, r.out_at::date + coalesce(public.qr_reg_int('repl_apply_days', r.out_at::date), 7), 'quota/recruit/' || r.id
    from public.qr_recruits r where r.status = 'dropped' and r.used_not_arrived
      and not exists (select 1 from public.qr_replacements c where c.recruit_id = r.id and c.status not in ('withdrawn'))
    union all
    select 'fomema_unfit', r.id::text, r.company_id, 'FOMEMA unfit: ' || r.full_name, 'Apply to Immigration for a replacement', r.owner_id, null,
      r.fomema_on, r.fomema_on + coalesce(public.qr_reg_int('repl_apply_days', r.fomema_on), 7), 'quota/recruit/' || r.id
    from public.qr_recruits r where r.fomema_result = 'unfit'
      and not exists (select 1 from public.qr_replacements c where c.recruit_id = r.id and c.status not in ('withdrawn'))
    union all
    select 'fomema', r.id::text, r.company_id, 'FOMEMA medical: ' || r.full_name, 'Book and record the FOMEMA result', r.owner_id, null,
      r.arrived_at::date, r.arrived_at::date + coalesce(public.qr_reg_int('fomema_days', r.arrived_at::date), 30), 'quota/recruit/' || r.id
    from public.qr_recruits r where r.arrived_at is not null and r.fomema_result is null and r.status in ('active','converted')
    union all
    select 'vdr_expiry', r.id::text, r.company_id, 'Calling visa expiring: ' || r.full_name, 'He must enter Malaysia before ' || to_char(r.vdr_expiry, 'DD Mon YYYY'), r.owner_id, null,
      r.vdr_approved, r.vdr_expiry, 'quota/recruit/' || r.id
    from public.qr_recruits r where r.status = 'active' and r.arrived_at is null and r.vdr_expiry is not null and r.vdr_expiry <= current_date + 30
    union all
    select 'agent_doc', a.id::text, a.company_id, 'Verify agent upload: ' || a.kind || ' — ' || r.full_name, 'Accept or reject the upload', null, 'HR', a.submitted_at::date,
      a.submitted_at::date + ru.verify_days, 'quota?tab=agents&sub=verify'
    from public.qr_agent_docs a join public.qr_recruits r on r.id = a.recruit_id, ru where a.status = 'submitted'
    union all
    select 'use_idle', u.id::text, u.company_id, 'Q-' || u.ref_no || ': approved, slots still reserved', 'Move the recruits on or release the slots', u.requested_by, u.requested_by_name,
      u.ceo_at::date, u.ceo_at::date + ru.stall_days, 'quota?tab=approvals&r=' || u.id
    from public.qr_use_requests u, ru where u.status = 'approved' and (select coalesce(sum(d_resv), 0) from public.qr_ledger l where l.use_request_id = u.id) > 0
  )
  select raw.kind, raw.ref, raw.company_id, raw.title, raw.step,
    coalesce(m.owner_id, raw.def_owner), coalesce(m.owner_name, raw.def_name, (select coalesce(nullif(full_name, ''), email) from public.profiles where id = raw.def_owner), 'HR (unassigned)'),
    raw.started, raw.due, (current_date - raw.due)::int, raw.link, coalesce(jsonb_array_length(m.nudges), 0)
  from raw left join public.qr_task_meta m on m.kind = raw.kind and m.ref = raw.ref
  where p_all or (public.qr_rank() > 0 and (raw.company_id is null or public.qr_scope(raw.company_id)))
  order by (current_date - raw.due) desc
$$;
revoke execute on function public.qr_followups_core(boolean) from public, anon, authenticated;

/* ---------------- alerts + master read the warning days rule ---------------- */
do $$ declare src text; n text; begin
  src := pg_get_functiondef('public.qr_alerts()'::regprocedure);
  n := replace(replace(replace(src, 'ru.expiry_amber_days', 'public.qr_reg_warn(1)'), 'ru.expiry_mid_days', 'public.qr_reg_warn(2)'), 'ru.expiry_red_days', 'public.qr_reg_warn(3)');
  if n <> src then execute n; end if;
  src := pg_get_functiondef('public.qr_master(text)'::regprocedure);
  n := replace(src, '(select expiry_amber_days from public.qr_rules where id = 1)', 'public.qr_reg_warn(1)');
  if n <> src then execute n; end if;
end $$;

/* ---------------- editing rules: CEO direct, HR Admin → CEO approval ---------------- */
create or replace function public.qr_reg_can_edit() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (public.qr_rank() >= 4 or public.my_role() = 'hr_admin')
$$;
create or replace function public.qr_reg_validate(p_key text, p_scope text, v jsonb) returns void language plpgsql stable security definer set search_path = public as $$
declare c record; s jsonb; keys text[] := '{}'; st jsonb; tok text; t text; cols text[];
begin
  select * into c from public.qr_reg_catalog() x where x.key = p_key;
  if c.key is null then raise exception 'Unknown rule %.', p_key; end if;
  if c.scope_kind = 'none' and coalesce(p_scope, '') <> '' then raise exception 'This rule has no scope.'; end if;
  if c.scope_kind <> 'none' and coalesce(p_scope, '') = '' then raise exception 'Choose the % this rule applies to (or * for all).', c.scope_kind; end if;
  if c.kind = 'int' and (jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1200) then raise exception '% must be a number of %.', c.label, c.unit; end if;
  if c.kind = 'int_list' and (jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 3
      or (v->>0)::int <= (v->>1)::int or (v->>1)::int <= (v->>2)::int or (v->>2)::int < 0) then raise exception 'Give three warning points, largest first (e.g. 90, 60, 30).'; end if;
  if c.kind = 'money' and (jsonb_typeof(v) <> 'object' or (v ? 'rm' and jsonb_typeof(v->'rm') not in ('number','null'))) then raise exception 'Amount must be a number in RM.'; end if;
  if c.kind = 'levy' and (jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'tiers') <> 'array' or jsonb_array_length(v->'tiers') = 0) then raise exception 'Give at least one levy rate.'; end if;
  if c.kind = 'items' and (jsonb_typeof(v) <> 'object' or jsonb_typeof(v->'items') <> 'array') then raise exception 'Give the list of items.'; end if;
  if c.kind = 'sector' and (jsonb_typeof(v) <> 'object' or coalesce(v->>'mode', 'warn') not in ('warn','block')) then raise exception 'Sector rule: mode is warn or block.'; end if;
  if c.kind = 'replacement' and jsonb_typeof(v->'kinds') <> 'object' then raise exception 'Give the replacement rule per exit type.'; end if;
  if c.kind = 'pipeline' then
    select array_agg(column_name::text) into cols from information_schema.columns where table_schema = 'public' and table_name = 'qr_recruits';
    if jsonb_typeof(v->'stages') <> 'array' or jsonb_array_length(v->'stages') < 2 then raise exception 'A pipeline needs at least two stages.'; end if;
    if (v->'stages'->0)->>'key' <> 'quota' then raise exception 'The first stage must be Quota approval (key quota).'; end if;
    if (v->'stages'->-1)->>'key' <> 'onboard' then raise exception 'The last stage must be Onboard (key onboard).'; end if;
    for s in select x from jsonb_array_elements(v->'stages') x loop
      if coalesce(s->>'key', '') = '' or coalesce(s->>'label', '') = '' then raise exception 'Every stage needs a key and a name.'; end if;
      if s->>'key' = any(keys) then raise exception 'Stage key % is used twice.', s->>'key'; end if;
      keys := keys || (s->>'key');
      for st in select x from jsonb_array_elements(coalesce(s->'steps', '[]'::jsonb)) x loop
        if coalesce(st->>'key', '') = '' then raise exception 'Stage %: every step needs a key.', s->>'label'; end if;
        if ('#' || (st->>'key')) = any(keys) then raise exception 'Step key % is used twice.', st->>'key'; end if;
        keys := keys || ('#' || (st->>'key'));
        foreach tok in array coalesce((select array_agg(x) from jsonb_array_elements_text(st->'requires') x), '{}') loop
          foreach t in array string_to_array(tok, '|') loop
            if not (t like 'agent:%' or split_part(t, '=', 1) = any(cols)) then raise exception 'Stage %: unknown document / field "%".', s->>'label', t; end if;
          end loop;
        end loop;
      end loop;
    end loop;
    if not ('#' || coalesce(v->>'use_step', '')) = any(keys) then raise exception 'Choose the step that marks the quota slot as used.'; end if;
  end if;
end $$;

-- what a proposed change affects (shown before saving)
create or replace function public.qr_reg_impact(p jsonb) returns table (level text, text text, n int) language plpgsql stable security definer set search_path = public as $$
declare k text := p->>'key'; sc text := coalesce(p->>'scope', ''); v jsonb := p->'value'; eff date := coalesce((p->>'effective_from')::date, current_date);
  oldv jsonb := public.qr_reg(k, sc, eff); nxt date; m int; cnt int; cnt2 int; cur uuid; s text;
begin
  if not public.qr_reg_can_edit() then raise exception 'Only the CEO or HR Admin changes rules.' using errcode = '42501'; end if;
  select min(effective_from) into nxt from public.qr_reg_rules where key = k and scope = sc and status = 'active' and effective_from > eff;
  if k = 'letter_valid_months' then
    m := (v #>> '{}')::int;
    select count(*) filter (where (approval_date + make_interval(months => m))::date < expiry_date), count(*) filter (where (approval_date + make_interval(months => m))::date > expiry_date)
      into cnt, cnt2 from public.qr_quotas where expiry_auto and approval_date >= eff and (nxt is null or approval_date < nxt) and status in ('active','pending','draft');
    return query select 'amber', cnt || ' letter(s) approved on or after ' || to_char(eff, 'DD Mon YYYY') || ' now expire sooner', cnt where cnt > 0;
    return query select 'info', cnt2 || ' letter(s) approved on or after ' || to_char(eff, 'DD Mon YYYY') || ' now expire later', cnt2 where cnt2 > 0;
    select count(*) into cnt from public.qr_quotas where approval_date < eff;
    return query select 'info', cnt || ' older letter(s) keep the validity in force when they were approved', cnt;
  elsif k = 'expiry_warn_days' then
    select count(distinct quota_id) into cnt from public.qr_tally(null) t where t.available > 0 and t.expiry_date - current_date <= (v->>0)::int;
    return query select 'info', cnt || ' letter(s) with unused balance fall inside the first warning (' || (v->>0) || ' days)', cnt;
  elsif k in ('runaway_report_days','repl_apply_days','repl_chase_days','fomema_days','vdr_valid_months','levy_payment_days') then
    m := (v #>> '{}')::int;
    if k = 'runaway_report_days' then
      select count(*), count(*) filter (where last_seen + m < current_date) into cnt, cnt2 from public.qr_runaways where outcome = 'open' and (imm_ref is null or police_report_no is null) and last_seen >= eff and (nxt is null or last_seen < nxt);
    elsif k = 'fomema_days' then
      select count(*), count(*) filter (where arrived_at::date + m < current_date) into cnt, cnt2 from public.qr_recruits where arrived_at is not null and fomema_result is null and arrived_at::date >= eff and (nxt is null or arrived_at::date < nxt);
    elsif k = 'repl_apply_days' then
      select count(*), count(*) filter (where trigger_date + m < current_date) into cnt, cnt2 from public.qr_replacements where status = 'to_apply' and trigger_date >= eff and (nxt is null or trigger_date < nxt);
    elsif k = 'repl_chase_days' then
      select count(*), count(*) filter (where applied_on + m < current_date) into cnt, cnt2 from public.qr_replacements where status = 'applied' and applied_on >= eff and (nxt is null or applied_on < nxt);
    elsif k = 'vdr_valid_months' then
      select count(*), 0 into cnt, cnt2 from public.qr_recruits where vdr_approved >= eff and status = 'active' and arrived_at is null;
    else cnt := 0; cnt2 := 0;
    end if;
    return query select 'info', cnt || ' open item(s) dated on or after ' || to_char(eff, 'DD Mon YYYY') || ' take the new deadline', cnt;
    return query select 'amber', cnt2 || ' of them would be overdue at once', cnt2 where cnt2 > 0;
    return query select 'info', 'Items dated before ' || to_char(eff, 'DD Mon YYYY') || ' keep the deadline in force at the time', 0;
  elsif k = 'sector_rules' then
    select count(*) into cnt from public.qr_quotas q where q.status = 'active' and public.qr_sector_scope(q) like sc || '%'
      and exists (select 1 from jsonb_each(q.breakdown) b where exists (select 1 from public.qr_sector_eval(v, b.key, null, null, q.subsector)));
    select count(*) into cnt2 from public.qr_recruits r join public.qr_batches b on b.id = r.batch_id join public.qr_quotas q on q.id = b.quota_id
      where r.status = 'active' and public.qr_sector_scope(q) like sc || '%' and exists (select 1 from public.qr_sector_eval(v, r.country, r.job, r.dob, q.subsector));
    return query select case when v->>'mode' = 'block' then 'red' else 'amber' end, cnt || ' active letter(s) would be flagged', cnt;
    return query select case when v->>'mode' = 'block' then 'red' else 'amber' end, cnt2 || ' recruit(s) in progress would be flagged', cnt2;
  elsif k = 'pipeline' then
    cur := public.qr_tpl_for(sc, eff);
    select count(*) into cnt from public.qr_recruits where status = 'active' and template_id = cur;
    return query select 'info', cnt || ' recruit(s) in progress stay on the current version (no change to their stages)', cnt;
    for s in select x->>'label' from jsonb_array_elements(v->'stages') x where not exists (select 1 from public.qr_reg_rules t, jsonb_array_elements(t.value->'stages') o where t.id = cur and o->>'key' = x->>'key') loop
      return query select 'info', 'New stage: ' || s, 0; end loop;
    for s in select o->>'label' from public.qr_reg_rules t, jsonb_array_elements(t.value->'stages') o where t.id = cur and not exists (select 1 from jsonb_array_elements(v->'stages') x where x->>'key' = o->>'key' and not coalesce((x->>'retired')::boolean, false)) loop
      return query select 'amber', 'Retired stage: ' || s || ' (kept on older recruits'' history)', 0; end loop;
    return query select 'info', 'New ' || sc || ' recruits from ' || to_char(eff, 'DD Mon YYYY') || ' follow the new version', 0;
  elsif k = 'replacement_rules' then
    select count(*) into cnt from public.qr_replacements c where c.status in ('to_apply','applied','approval_uploaded') and not coalesce((v->'kinds'->c.kind->>'allowed')::boolean, false);
    return query select 'amber', cnt || ' open replacement application(s) are of a type the new rule no longer allows (they continue under the old rule)', cnt where cnt > 0;
    return query select 'info', 'Applies to cases triggered on or after ' || to_char(eff, 'DD Mon YYYY'), 0;
  else
    select count(*) into cnt from public.qr_batches where status not in ('closed','cancelled');
    return query select 'info', 'Used for cost estimates from ' || to_char(eff, 'DD Mon YYYY') || ' (' || cnt || ' open batch(es); recorded payments do not change)', cnt;
  end if;
  if oldv is null then return query select 'info', 'First version of this rule', 0; end if;
end $$;

create or replace function public.qr_reg_activate(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_reg_rules; nxt date;
begin
  select * into r from public.qr_reg_rules where id = p_id;
  update public.qr_reg_rules set status = 'superseded' where key = r.key and scope = r.scope and effective_from = r.effective_from and status = 'active' and id <> r.id;
  update public.qr_reg_rules set status = 'active' where id = r.id;
  if r.key = 'letter_valid_months' then
    select min(effective_from) into nxt from public.qr_reg_rules where key = r.key and status = 'active' and effective_from > r.effective_from;
    update public.qr_quotas set expiry_date = (approval_date + make_interval(months => (r.value #>> '{}')::int))::date
    where expiry_auto and approval_date >= r.effective_from and (nxt is null or approval_date < nxt);
  end if;
end $$;
revoke execute on function public.qr_reg_activate(uuid) from public, anon, authenticated;

create or replace function public.qr_reg_propose(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid; k text := p->>'key'; sc text := coalesce(p->>'scope', ''); ceo boolean := public.qr_rank() >= 4; lbl text;
  app text := coalesce(nullif(public.cfg('notifications')->>'appUrl', ''), 'https://fw.sunrisebayumas.com/'); u record;
begin
  if not public.qr_reg_can_edit() then raise exception 'Only the CEO or HR Admin changes rules.' using errcode = '42501'; end if;
  if p->>'effective_from' is null then raise exception 'Give the effective-from date.'; end if;
  if coalesce(trim(p->>'source_ref'), '') = '' then raise exception 'Give the source (circular / gazette / letter reference).'; end if;
  perform public.qr_reg_validate(k, sc, p->'value');
  if (p->>'file_id') is not null and not exists (select 1 from public.qr_files where id = (p->>'file_id')::uuid and company_id = '_gov') then raise exception 'Attach the circular through Upload circular.'; end if;
  select label into lbl from public.qr_reg_catalog() where key = k;
  insert into public.qr_reg_rules (key, scope, value, effective_from, source_ref, source_url, file_id, note, verified, status, created_by_name, created_role)
  values (k, sc, p->'value', (p->>'effective_from')::date, p->>'source_ref', p->>'source_url', (p->>'file_id')::uuid, p->>'note', coalesce((p->>'verified')::boolean, false),
    'pending', public.my_name(), public.qr_role_label()) returning id into nid;
  if ceo then
    update public.qr_reg_rules set decided_by = auth.uid(), decided_by_name = public.my_name(), decided_at = now(), decide_note = 'Set by the CEO' where id = nid;
    perform public.qr_reg_activate(nid);
  else
    for u in select id, coalesce(nullif(full_name, ''), email) n from public.profiles where status = 'active' and role in ('super_admin','admin') loop
      insert into public.notification_deliveries (event, user_id, recipient, channel, title, body, link, critical, status, sent_at, dedupe_key)
      values ('quota', u.id, u.n, 'in_app', 'Rule change to approve: ' || lbl || case when sc <> '' then ' (' || sc || ')' else '' end,
        public.my_name() || ' proposes a change from ' || to_char((p->>'effective_from')::date, 'DD Mon YYYY') || '. Source: ' || (p->>'source_ref'), app || '#/quota?tab=rules&pending=1', true, 'sent', now(), 'qr|reg|' || nid || '|' || u.id)
      on conflict (dedupe_key) do nothing;
    end loop;
  end if;
  perform public.audit(case when ceo then 'qr_reg_set' else 'qr_reg_proposed' end, 'quota_rule', nid::text,
    lbl || case when sc <> '' then ' (' || sc || ')' else '' end || case when ceo then ' set' else ' proposed' end || ' from ' || (p->>'effective_from') || ' — ' || (p->>'source_ref'), p);
  return nid;
end $$;
create or replace function public.qr_reg_decide(p_id uuid, p_approve boolean, p_note text default null) returns text language plpgsql security definer set search_path = public as $$
declare r public.qr_reg_rules; lbl text;
begin
  select * into r from public.qr_reg_rules where id = p_id for update;
  if r.id is null then raise exception 'Rule change not found.'; end if;
  if r.status <> 'pending' then raise exception 'Already %.', r.status; end if;
  if r.created_by = auth.uid() and p_approve then raise exception 'You proposed this change — the CEO approves it.' using errcode = '42501'; end if;
  if r.created_by = auth.uid() and not p_approve then
    update public.qr_reg_rules set status = 'withdrawn', decided_at = now(), decided_by = auth.uid(), decided_by_name = public.my_name(), decide_note = p_note where id = r.id;
    perform public.audit('qr_reg_withdrawn', 'quota_rule', r.id::text, 'Rule change withdrawn', null);
    return 'withdrawn';
  end if;
  if public.qr_rank() < 4 then raise exception 'Only the CEO approves rule changes.' using errcode = '42501'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then raise exception 'Give the reason.'; end if;
  update public.qr_reg_rules set decided_by = auth.uid(), decided_by_name = public.my_name(), decided_at = now(), decide_note = p_note,
    status = case when p_approve then status else 'rejected' end where id = r.id;
  if p_approve then perform public.qr_reg_activate(r.id); end if;
  select label into lbl from public.qr_reg_catalog() where key = r.key;
  perform public.audit(case when p_approve then 'qr_reg_approved' else 'qr_reg_rejected' end, 'quota_rule', r.id::text,
    lbl || case when r.scope <> '' then ' (' || r.scope || ')' else '' end || case when p_approve then ' approved' else ' rejected: ' || p_note end, null);
  return case when p_approve then 'active' else 'rejected' end;
end $$;
-- cost estimate for a country / sector from the rules in force (levy + bond + insurance + fee schedule)
create or replace function public.qr_cost_template(p_country text, p_sector text, p_at date default current_date) returns table (category text, label text, rm numeric, source text)
language sql stable security definer set search_path = public as $$
  select 'levy', 'Levy (' || coalesce(t->>'label', 'standard') || ')', nullif(t->>'rm', '')::numeric, (public.qr_reg_row('levy', p_sector, p_at)).source_ref
    from jsonb_array_elements(coalesce(public.qr_reg('levy', p_sector, p_at)->'tiers', '[]'::jsonb)) with ordinality x(t, o) where o = 1
  union all select 'bond', 'Security bond / deposit', nullif(public.qr_reg('bond', p_country, p_at)->>'rm', '')::numeric, (public.qr_reg_row('bond', p_country, p_at)).source_ref
    where public.qr_reg('bond', p_country, p_at) is not null
  union all select 'insurance', i->>'name', nullif(i->>'rm', '')::numeric, (public.qr_reg_row('insurance', '', p_at)).source_ref
    from jsonb_array_elements(coalesce(public.qr_reg('insurance', '', p_at)->'items', '[]'::jsonb)) i
  union all select coalesce(i->>'category', 'other'), i->>'label', nullif(i->>'rm', '')::numeric, (public.qr_reg_row('fee_schedule', p_country || '/' || coalesce(p_sector, ''), p_at)).source_ref
    from jsonb_array_elements(coalesce(public.qr_reg('fee_schedule', p_country || '/' || coalesce(p_sector, ''), p_at)->'items', '[]'::jsonb)) i
$$;

/* ---------------- seed: values researched so far (each with its source; verified = confirmed against the source) ---------------- */
do $$
declare india jsonb; emi jsonb; c text; seed text := 'System seed (CEO defaults / research)';
begin
  india := $j${
  "use_step": "vdr_ok",
  "stages": [
    {"key": "quota", "label": "Quota approval", "owner": "gm_ceo", "docs": ["Quota Use Request"], "gate": "Use request approved by the CEO (GM recommends)",
     "steps": [{"key": "_quota", "label": "Quota Use Request approved"}]},
    {"key": "recruit", "label": "Overseas recruitment", "owner": "hr", "docs": ["Interview record", "Offer letter"], "gate": "Selected and offer accepted",
     "steps": [{"key": "ra_check", "label": "Agent licence checked", "req": false}, {"key": "selected", "label": "Selected at interview"},
               {"key": "trade_test", "label": "Trade test", "req": false}, {"key": "offer", "label": "Offer accepted"}]},
    {"key": "medical", "label": "Medical overseas", "owner": "agent", "docs": ["Medical report"], "gate": "Result recorded with the report",
     "steps": [{"key": "medical", "label": "Medical done", "requires": ["medical_result", "medical_file|agent:medical"], "hint": "Record the result (Fit / Unfit) and attach the medical report (HR upload or the agent's accepted upload)."}]},
    {"key": "med_gate", "label": "Medical gate (Fit)", "owner": "hr", "docs": [], "gate": "Only Fit moves on; Unfit ends the recruit and releases the slot",
     "steps": [{"key": "med_fit", "label": "Medically fit", "requires": ["medical_result=fit"], "hint": "Only a Fit result moves on. For Unfit, end the recruit with the reason."}]},
    {"key": "vdr", "label": "Calling visa (VDR) application", "owner": "hr", "docs": ["VDR application"], "gate": "Applied in FWCMS",
     "steps": [{"key": "vdr_apply", "label": "VDR applied"}]},
    {"key": "vdr_gate", "label": "Calling visa approved", "owner": "hr", "docs": ["Approved VDR copy"], "gate": "Approved with the copy uploaded — quota slot becomes USED",
     "steps": [{"key": "vdr_ok", "label": "VDR approved", "requires": ["vdr_file"], "hint": "Upload the approved VDR copy first."}]},
    {"key": "sent", "label": "Sent to India (agent)", "owner": "agent", "docs": ["VDR shared with the agent"], "gate": "Agent downloaded the VDR",
     "steps": [{"key": "vdr_sent", "label": "VDR downloaded by the agent", "requires": ["vdr_file"]}]},
    {"key": "stamping", "label": "Visa stamping", "owner": "agent", "docs": ["Stamped visa page"], "gate": "Stamped at the Malaysian consulate / High Commission",
     "steps": [{"key": "visa_stamp", "label": "Visa stamped", "requires": ["stamped_file"], "hint": "Upload the stamped visa page."}]},
    {"key": "emigration", "label": "Emigration clearance", "owner": "agent", "docs": ["eMigrate registration", "PoE clearance"], "gate": "ECR: eMigrate + Protector of Emigrants clearance. ECNR: not required",
     "skip_label": "Not required (ECNR)",
     "steps": [{"key": "_ecr", "label": "Passport type (ECR / ECNR) recorded"},
               {"key": "demand_letter", "label": "Demand letter attested", "req": false, "ecr": "ECR"},
               {"key": "emigrate_reg", "label": "eMigrate registration", "ecr": "ECR"},
               {"key": "pbby", "label": "PBBY insurance", "req": false, "ecr": "ECR"},
               {"key": "emig_clear", "label": "PoE emigration clearance", "ecr": "ECR"},
               {"key": "pdot", "label": "Pre-departure orientation (PDOT)", "req": false}]},
    {"key": "ticket", "label": "Air ticket", "owner": "hr", "docs": ["Ticket"], "gate": "Flight, date, arrival time and ticket copy",
     "steps": [{"key": "ticket", "label": "Ticket booked", "requires": ["flight_no", "flight_at", "arrival_eta", "ticket_file"], "hint": "Enter the flight number, departure date, arrival time and attach the ticket."}]},
    {"key": "klia", "label": "KLIA airport clearance", "owner": "hr", "docs": ["Authorisation letter / pass"], "gate": "Employer's person named",
     "steps": [{"key": "klia", "label": "Cleared at KLIA by the employer", "requires": ["klia_person"], "hint": "Name the officer / person collecting him and print the authorisation letter."}]},
    {"key": "pickup", "label": "Airport pickup", "owner": "hr", "docs": [], "gate": "Driver and vehicle",
     "steps": [{"key": "pickup", "label": "Picked up", "requires": ["pickup_by", "transport"], "hint": "Enter the driver / person and the vehicle."}]},
    {"key": "hq", "label": "Arrival at HQ", "owner": "hr", "docs": [], "gate": "Arrival time recorded",
     "steps": [{"key": "arrived_hq", "label": "Arrived at HQ", "requires": ["arrived_at"], "hint": "Enter the arrival time."}]},
    {"key": "hr_brief", "label": "HR brief", "owner": "hr", "docs": ["Signed acknowledgement"], "gate": "Checklist done and acknowledgement signed",
     "steps": [{"key": "hr_brief", "label": "HR brief done", "requires": ["hr_ack_file"], "hint": "Attach the signed acknowledgement."}]},
    {"key": "om_brief", "label": "Outlet manager brief", "owner": "outlet_manager", "docs": [], "gate": "Outlet assigned and the outlet manager confirms",
     "task": "Welcome him at the outlet, show the workplace, shift hours, safety and outlet rules, then confirm the brief here.",
     "steps": [{"key": "om_brief", "label": "Outlet manager confirmed", "requires": ["outlet_id"], "hint": "Assign the outlet first."}]},
    {"key": "onboard", "label": "Onboard", "owner": "hr", "docs": ["Worker record"], "gate": "Worker record created (passport, visa, medical, costs carried over)",
     "steps": [{"key": "onboard", "label": "Worker record created"}]}
  ]}$j$::jsonb;
  if not exists (select 1 from public.qr_reg_rules where key = 'pipeline') then
    insert into public.qr_reg_rules (key, scope, value, effective_from, source_ref, note, verified, created_by_name, created_role)
    values ('pipeline', 'India', india, '2020-01-01', 'CEO instruction 26 Oct 2026 (India recruitment order)', 'India default. ECR passports need eMigrate + PoE clearance; ECNR skips the emigration stage.', true, seed, 'System');
    foreach c in array array['Nepal','Bangladesh','Myanmar','Indonesia','Sri Lanka','Pakistan','*'] loop
      emi := case c
        when 'Nepal' then '[{"key":"demand_attest","label":"Demand letter attested (Embassy)","req":false},{"key":"dofe_pre","label":"DoFE pre-approval"},{"key":"orientation","label":"Orientation training","req":false},{"key":"insurance_np","label":"Nepal insurance","req":false},{"key":"labour_permit","label":"Final labour permit (sticker)"}]'
        when 'Bangladesh' then '[{"key":"attest_bd","label":"Attestation (High Commission)","req":false},{"key":"bmet","label":"BMET clearance (smart card)"},{"key":"welfare_bd","label":"Welfare fund","req":false}]'
        when 'Myanmar' then '[{"key":"owic","label":"OWIC card"}]'
        when 'Indonesia' then '[{"key":"bp2mi","label":"BP2MI / SISKOP2MI clearance"}]'
        when 'Sri Lanka' then '[{"key":"slbfe","label":"SLBFE registration"}]'
        when 'Pakistan' then '[{"key":"beoe","label":"BE&OE / Protector clearance"}]'
        else '[{"key":"emig_other","label":"Exit clearance in the home country","req":false}]' end::jsonb;
      insert into public.qr_reg_rules (key, scope, value, effective_from, source_ref, note, verified, created_by_name, created_role)
      values ('pipeline', c,
        jsonb_set(india, '{stages}', (select jsonb_agg(case when s->>'key' = 'emigration' then (s - 'skip_label') || jsonb_build_object('label', 'Exit clearance (home country)', 'gate', 'Home-country exit clearance', 'docs', '[]'::jsonb, 'steps', emi)
          when s->>'key' = 'sent' then s || jsonb_build_object('label', 'Sent to the source country (agent)') else s end order by o) from jsonb_array_elements(india->'stages') with ordinality x(s, o))),
        '2020-01-01', 'CEO order with the country''s exit clearance', case when c = '*' then 'Any other source country' else null end, false, seed, 'System');
    end loop;
  end if;
  if not exists (select 1 from public.qr_reg_rules where key <> 'pipeline') then
    insert into public.qr_reg_rules (key, scope, value, effective_from, source_ref, source_url, note, verified, created_by_name, created_role) values
    ('letter_valid_months', '', '12', '2020-01-01', 'Quota approval letter (KDN / JTK) — CEO default', null, 'Validity is printed on each letter; when the letter states its own expiry, that date wins.', true, seed, 'System'),
    ('expiry_warn_days', '', '[90,60,30]', '2020-01-01', 'CEO default', null, 'Warnings when unused balance remains.', true, seed, 'System'),
    ('runaway_report_days', '', '14', '2020-01-01', 'CEO default; Immigration expects runaways to be reported without delay (FWCMS eRUNAWAY)', null, null, true, seed, 'System'),
    ('fomema_days', '', '30', '2020-01-01', 'FOMEMA: medical examination within 30 days of arrival', 'https://www.fomema.my', null, true, seed, 'System'),
    ('repl_apply_days', '', '7', '2026-10-26', 'CEO instruction 26 Oct 2026', null, 'Internal deadline for HR to apply to Immigration.', true, seed, 'System'),
    ('repl_chase_days', '', '30', '2026-10-26', 'CEO instruction 26 Oct 2026', null, 'Chase Immigration if no reply.', true, seed, 'System'),
    ('vdr_valid_months', '', '6', '2020-01-01', 'Immigration VDR approval letter', null, 'Check against each VDR approval letter — awaiting confirmation by the regulation research.', false, seed, 'System'),
    ('levy_payment_days', '', '30', '2020-01-01', 'Immigration levy payment (FWCMS)', null, 'Awaiting confirmation by the regulation research.', false, seed, 'System'),
    ('levy', 'Services', '{"tiers":[{"label":"Peninsular Malaysia","rm":1850},{"label":"Sabah / Sarawak","rm":1010}],"multi_tier":false,"note":"Multi-Tier Levy Model not in force (deferred)."}', '2020-01-01', 'Foreign worker levy schedule (Immigration / MOHR)', null, 'Multi-tier levy deferred — update here when in force.', false, seed, 'System'),
    ('levy', 'Manufacturing', '{"tiers":[{"label":"Peninsular Malaysia","rm":1850},{"label":"Sabah / Sarawak","rm":1010}],"multi_tier":false}', '2020-01-01', 'Foreign worker levy schedule (Immigration / MOHR)', null, null, false, seed, 'System'),
    ('levy', 'Construction', '{"tiers":[{"label":"Peninsular Malaysia","rm":1850},{"label":"Sabah / Sarawak","rm":1010}],"multi_tier":false}', '2020-01-01', 'Foreign worker levy schedule (Immigration / MOHR)', null, null, false, seed, 'System'),
    ('levy', 'Plantation', '{"tiers":[{"label":"Peninsular Malaysia","rm":640},{"label":"Sabah / Sarawak","rm":590}],"multi_tier":false}', '2020-01-01', 'Foreign worker levy schedule (Immigration / MOHR)', null, null, false, seed, 'System'),
    ('levy', 'Agriculture', '{"tiers":[{"label":"Peninsular Malaysia","rm":640},{"label":"Sabah / Sarawak","rm":410}],"multi_tier":false}', '2020-01-01', 'Foreign worker levy schedule (Immigration / MOHR)', null, null, false, seed, 'System'),
    ('min_wage', '', '{"rm":1700}', '2025-02-01', 'Minimum Wages Order 2024 (RM1,700 / month)', null, 'From 1 Feb 2025 (1 Aug 2025 for employers with fewer than five workers).', true, seed, 'System'),
    ('bond', '*', '{"rm":null}', '2020-01-01', 'Immigration security bond (per nationality)', null, 'Amount per nationality awaiting the regulation research.', false, seed, 'System'),
    ('insurance', '', '{"items":[{"name":"SPIKPA hospitalisation & surgical insurance","rm":null,"note":"Mandatory; cover RM20,000 a year"},{"name":"SOCSO Employment Injury Scheme","rm":null,"note":"Mandatory contribution for foreign workers"}]}', '2020-01-01', 'Immigration / SOCSO requirements', null, 'Premiums awaiting the regulation research.', false, seed, 'System'),
    ('fee_schedule', '*', '{"items":[{"category":"visa","label":"VP(TE) visa / permit fee","rm":null},{"category":"medical","label":"FOMEMA medical","rm":null},{"category":"agent_fee","label":"Agent fee","rm":null},{"category":"ticket","label":"Air ticket","rm":null},{"category":"other","label":"Processing / ISC","rm":null}]}', '2020-01-01', 'Default cost items (fill amounts per country)', null, 'Amounts awaiting the regulation research.', false, seed, 'System'),
    ('sector_rules', 'Services', '{"mode":"warn","countries":["India","Nepal","Myanmar","Indonesia","Bangladesh","Sri Lanka","Pakistan","Vietnam","Cambodia","Laos","Thailand","Philippines","Uzbekistan","Kazakhstan","Turkmenistan"],"jobs":[],"job_rules":[{"job":"Cook","country":"India","sub_sectors":["Restaurant (Indian cuisine)"],"note":"Indian cooks only in Indian restaurants"}],"advert_first":true,"advert_note":"Advertise on MYFutureJobs first and record the advert reference.","age_min":18,"age_max":45}', '2020-01-01', 'JTK / KDN sector conditions for the services (restaurant) sub-sector', null, 'Source-country list awaiting the regulation research; mode is Warn until confirmed.', false, seed, 'System'),
    ('replacement_rules', '', '{"kinds":{"fomema_fail":{"allowed":true,"docs":["approval_file","fomema_file","repat_file|exit_id"]},"not_arrived":{"allowed":true,"docs":["approval_file"]},"runaway":{"allowed":false,"note":"Runaways are not replaceable."},"death":{"allowed":false,"note":"Deaths do not qualify for replacement."},"transfer":{"allowed":false,"note":"Transfers do not qualify for replacement."}},"labels":{"approval_file":"Immigration''s approval letter","fomema_file":"the FOMEMA unfit result","repat_file|exit_id":"the repatriation proof or his CMO"}}', '2026-10-26', 'CEO instruction 26 Oct 2026 (Immigration replacement)', null, null, true, seed, 'System');
  end if;
end $$;

-- recruits created before templates: pin to the version in force when they were added; recompute stages
update public.qr_recruits set template_id = public.qr_tpl_for(country, created_at::date) where template_id is null;
update public.qr_recruits set stage = public.qr_stage_of(qr_recruits) where status in ('active','converted') and stage is distinct from public.qr_stage_of(qr_recruits);

/* ---------------- grants ---------------- */
do $$ declare f text; begin
  foreach f in array array['qr_reg_catalog()','qr_reg(text,text,date)','qr_reg_int(text,date,text)','qr_reg_warn(integer,date)','qr_tpl_for(text,date)','qr_pipeline_def_t(uuid,text)',
    'qr_pipeline_def(text,text)','qr_stage_label_t(uuid,text)','qr_reg_impact(jsonb)','qr_reg_propose(jsonb)','qr_reg_decide(uuid,boolean,text)','qr_reg_can_edit()',
    'qr_cost_template(text,text,date)','qr_recruit_fomema(uuid,date,text,uuid,text)','qr_om_confirm(uuid,text)','qr_stage_override(uuid,text,text)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['qr_reg_row(text,text,date)','qr_req_ok(jsonb,uuid,text)','qr_reg_validate(text,text,jsonb)','qr_om_stage(public.qr_recruits)','qr_sector_scope(public.qr_quotas)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
  end loop;
end $$;
