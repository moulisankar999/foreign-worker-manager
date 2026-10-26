-- 041 Quota & Recruitment, part 6: Oct 2026 regulation research folded in as rules (all editable in Rules & regulations).
--  * Quota application checklist before the letter (MyFutureJobs advert 14 days → PERKESO interviews → Section 60K → FWCMS → OSC → SKB).
--  * Levy paid within 15 days of the SKB, with a deadline follow-up. SKB valid 12 months.
--  * Sector rules (F&B: Indian cook / Indian community business only, no front-liners, title the same in every filing; plantation exempt from advert).
--  * Bond RM750 (India, guarantee ≥ 18 months), SPIKPA RM120/yr, workers' compensation; India eMigrate steps; ECR checks (women under 30 blocked,
--    age 18–45 at first entry); Immigration clearance within 6 hours; accommodation address before FOMEMA; PLKS 12 months, renew 3 months ahead.
--  * CMO: Immigration departure confirmation letter and bond refund tracking.  Minimum wage RM2,000 from 1 Jun 2027 and EPF 2%/2% stored as rules only.

alter table public.qr_quotas add column if not exists app_steps jsonb not null default '{}'::jsonb;
alter table public.qr_quotas add column if not exists app_template_id uuid references public.qr_reg_rules(id);
alter table public.qr_quotas add column if not exists levy_paid_on date;
alter table public.qr_quotas add column if not exists levy_file uuid references public.qr_files(id);
alter table public.qr_quotas add column if not exists job_title_check text;
alter table public.qr_recruits add column if not exists accom_address text;
alter table public.qr_recruits add column if not exists accom_confirmed_on date;
alter table public.qr_recruits add column if not exists imm_cleared_at timestamptz;
alter table public.qr_exits add column if not exists depart_letter_file uuid references public.qr_files(id);
alter table public.qr_exits add column if not exists bond_refund_status text check (bond_refund_status in ('not_applicable','pending','applied','refunded'));
alter table public.qr_exits add column if not exists bond_refund_on date;
alter table public.qr_exits add column if not exists bond_refund_rm numeric(12,2);

create or replace function public.qr_reg_catalog() returns table (key text, grp text, label text, unit text, kind text, scope_kind text, help text, ord int)
language sql immutable as $$ values
  ('letter_valid_months', 'Quota', 'Quota approval letter (SKB) validity', 'months', 'int', 'none', 'Expiry = approval date + this many months, unless the letter states its own expiry.', 10),
  ('expiry_warn_days', 'Quota', 'Unused balance warnings before expiry', 'days', 'int_list', 'none', 'Three warning points, largest first (amber, amber, red).', 20),
  ('quota_app', 'Quota', 'Quota application steps (before the letter)', 'steps', 'checklist', 'none', 'Advert, interviews, Section 60K, FWCMS, OSC interview and the SKB, in order.', 25),
  ('advert_days', 'Quota', 'MyFutureJobs advert period', 'days', 'int', 'none', 'Interviews start after the advert has run this long.', 27),
  ('levy_payment_days', 'Deadlines', 'Levy payment after the SKB', 'days', 'int', 'none', 'Counted from the quota approval (SKB) date.', 30),
  ('runaway_report_days', 'Deadlines', 'Runaway report (police + Immigration, JTKSM PA 2/13)', 'days', 'int', 'none', 'Counted from the day the worker was last seen.', 40),
  ('imm_clear_hours', 'Deadlines', 'Immigration clearance after landing', 'hours', 'int', 'none', 'The employer clears the worker at the airport within this time.', 45),
  ('fomema_days', 'Deadlines', 'FOMEMA medical after arrival', 'days', 'int', 'none', 'Counted from the arrival date. Confirm the accommodation address first.', 50),
  ('repl_apply_days', 'Deadlines', 'Apply to Immigration for a replacement', 'days', 'int', 'none', 'Counted from FOMEMA fail / did-not-arrive date.', 60),
  ('repl_chase_days', 'Deadlines', 'Chase Immigration for a reply', 'days', 'int', 'none', 'Counted from the application date.', 70),
  ('vdr_valid_months', 'Deadlines', 'Calling visa (VDR) validity', 'months', 'int', 'none', 'Counted from VDR approval; the worker must enter before it lapses.', 80),
  ('plks_valid_months', 'Deadlines', 'Work permit (PLKS) validity', 'months', 'int', 'none', 'Each PLKS issue / renewal.', 90),
  ('plks_renew_days', 'Deadlines', 'Start PLKS renewal before expiry', 'days', 'int', 'none', 'Renewal alert this many days before the permit expires.', 95),
  ('levy', 'Levy & fees', 'Annual levy per worker', 'RM / year', 'levy', 'sector', 'Per sector. Tiers apply only when the multi-tier levy is in force.', 100),
  ('min_wage', 'Levy & fees', 'Minimum wage', 'RM / month', 'money', 'none', 'Basic monthly minimum wage (stored as a rule; payroll unchanged).', 110),
  ('epf', 'Levy & fees', 'EPF for foreign workers', '%', 'object', 'none', 'Employer and employee rates and the monthly due day (stored as a rule; payroll unchanged).', 115),
  ('bond', 'Levy & fees', 'Security bond / bank guarantee', 'RM', 'money', 'country', 'Per source country, with the minimum guarantee validity.', 120),
  ('insurance', 'Levy & fees', 'Mandatory insurance', 'RM / year', 'items', 'none', 'Each insurance item and its yearly cost.', 130),
  ('fee_schedule', 'Levy & fees', 'Default cost items', 'RM', 'items', 'country', 'Default recruitment cost items per source country (optionally Country/Sector).', 140),
  ('sector_rules', 'Sector rules', 'Sector rules', '', 'sector', 'sector', 'Allowed source countries, job types, front-liner ban, cap, advert-first and age range per sector or Sector/Sub-sector.', 150),
  ('recruit_checks', 'Sector rules', 'Worker eligibility checks', '', 'checks', 'country', 'Per source country: age at first entry and passport-type conditions.', 155),
  ('pipeline', 'Country pipelines', 'Recruitment pipeline', 'stages', 'pipeline', 'country', 'Stages in order, documents, gates, owners, and the stage that marks the quota slot as used.', 160),
  ('replacement_rules', 'Replacement', 'Replacement via Immigration', '', 'replacement', 'none', 'Which exit types can be replaced and the documents each needs.', 170)
$$;

-- validation for the new rule kinds (wraps the 040 validator)
do $$ declare src text := pg_get_functiondef('public.qr_reg_validate(text,text,jsonb)'::regprocedure); n text; begin
  n := replace(src, $q$  if c.kind = 'replacement' and$q$, $q$  if c.kind = 'checklist' and (jsonb_typeof(v->'steps') <> 'array' or jsonb_array_length(v->'steps') = 0) then raise exception 'Give the steps in order.'; end if;
  if c.kind = 'checks' and (jsonb_typeof(v) <> 'object' or coalesce(v->>'mode', 'block') not in ('warn','block')) then raise exception 'Eligibility checks: mode is warn or block.'; end if;
  if c.kind = 'object' and jsonb_typeof(v) <> 'object' then raise exception 'Give the values.'; end if;
  if c.kind = 'replacement' and$q$);
  if n = src and src not like '%checklist%' then raise exception '041: validator not as expected'; end if;
  execute n;
end $$;

/* ---------------- quota application checklist ---------------- */
create or replace function public.qr_quota_app_tpl() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.app_template_id is null then new.app_template_id := (public.qr_reg_row('quota_app', '', coalesce(new.created_at::date, current_date))).id; end if;
  return new;
end $$;
drop trigger if exists qr_a_quota_app_tpl on public.qr_quotas;
create trigger qr_a_quota_app_tpl before insert on public.qr_quotas for each row execute function public.qr_quota_app_tpl();

create or replace function public.qr_quota_app_list(p_id uuid) returns table (idx int, key text, label text, req boolean, done boolean, skipped boolean, info jsonb, hint text, fields jsonb)
language sql stable security definer set search_path = public as $$
  select o::int, s->>'key', s->>'label',
    coalesce((s->>'req')::boolean, true) and not (s->>'key' = 'advert' and not coalesce((public.qr_reg('sector_rules', public.qr_sector_scope(q), coalesce(q.approval_date, current_date))->>'advert_first')::boolean, true)),
    coalesce((q.app_steps->(s->>'key')->>'done')::boolean, false),
    s->>'key' = 'advert' and not coalesce((public.qr_reg('sector_rules', public.qr_sector_scope(q), coalesce(q.approval_date, current_date))->>'advert_first')::boolean, true),
    q.app_steps->(s->>'key'), s->>'hint', coalesce(s->'fields', '[]'::jsonb)
  from public.qr_quotas q join public.qr_reg_rules t on t.id = coalesce(q.app_template_id, (public.qr_reg_row('quota_app', '', q.created_at::date)).id),
    jsonb_array_elements(t.value->'steps') with ordinality x(s, o)
  where q.id = p_id and public.qr_scope(q.company_id) and not coalesce((s->>'retired')::boolean, false)
  order by o
$$;
-- mark one application step done: p = {date, ref, link, file_id, note}. Steps go in order; the interview step waits for the advert period.
create or replace function public.qr_quota_app_step(p_id uuid, p_key text, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; s record; prev record; f text; adv date; days int;
begin
  select * into q from public.qr_quotas where id = p_id for update;
  if q.id is null then raise exception 'Letter not found.'; end if;
  perform public.qr_need(q.company_id, 2);
  select * into s from public.qr_quota_app_list(p_id) x where x.key = p_key;
  if s.key is null then raise exception 'Unknown step.'; end if;
  select * into prev from public.qr_quota_app_list(p_id) x where x.idx < s.idx and x.req and not x.done order by x.idx limit 1;
  if prev.key is not null then raise exception '"%" cannot be marked yet: "%" is not complete.', s.label, prev.label; end if;
  for f in select jsonb_array_elements_text(s.fields) loop
    if coalesce(p->>f, '') = '' then raise exception '%: give the %.', s.label, replace(replace(f, 'file_id', 'document'), '_', ' '); end if;
  end loop;
  if (p->>'file_id') is not null and not exists (select 1 from public.qr_files where id = (p->>'file_id')::uuid and company_id = q.company_id) then raise exception 'File must belong to this company.'; end if;
  if p_key = 'perkeso' then
    adv := coalesce((q.app_steps->'advert'->>'start')::date, (q.app_steps->'advert'->>'date')::date);
    days := coalesce(public.qr_reg_int('advert_days', coalesce(adv, current_date)), 14);
    if adv is not null and coalesce((p->>'date')::date, current_date) < adv + days then
      raise exception 'The MyFutureJobs advert must run % days (from %) before the PERKESO interviews.', days, to_char(adv, 'DD Mon YYYY'); end if;
  end if;
  update public.qr_quotas set app_steps = app_steps || jsonb_build_object(p_key, (p - 'id') || jsonb_build_object('done', true, 'by_name', public.my_name(), 'at', now())),
    advert_ref = case when p_key = 'advert' then coalesce(p->>'link', p->>'ref', advert_ref) else advert_ref end,
    advert_date = case when p_key = 'advert' then coalesce((p->>'start')::date, (p->>'date')::date, advert_date) else advert_date end,
    section60k_ref = case when p_key = 's60k' then coalesce(p->>'ref', section60k_ref) else section60k_ref end
  where id = q.id;
  perform public.audit('qr_quota_app_step', 'quota', q.id::text, 'Quota application: ' || s.label || ' done', p);
end $$;
create or replace function public.qr_quota_levy_paid(p_id uuid, p_on date, p_file uuid default null, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas;
begin
  select * into q from public.qr_quotas where id = p_id for update;
  perform public.qr_need(q.company_id, 2);
  if p_file is not null and not exists (select 1 from public.qr_files where id = p_file and company_id = q.company_id) then raise exception 'File must belong to this company.'; end if;
  update public.qr_quotas set levy_paid_on = p_on, levy_file = coalesce(p_file, levy_file) where id = q.id;
  perform public.audit('qr_levy_paid', 'quota', q.id::text, 'Levy paid on ' || p_on || ' for ' || coalesce(q.ref_no, ''), jsonb_build_object('note', p_note));
end $$;

/* ---------------- worker eligibility checks (country rule) ---------------- */
create or replace function public.qr_recruit_checks_eval(rule jsonb, p_ecr text, p_gender text, p_dob date, p_on date) returns setof text language plpgsql stable as $$
declare age int; c jsonb;
begin
  if rule is null or p_dob is null then return; end if;
  age := extract(year from age(coalesce(p_on, current_date), p_dob));
  if (rule ? 'age_min' and age < (rule->>'age_min')::int) or (rule ? 'age_max' and age > (rule->>'age_max')::int) then
    return next 'Age ' || age || ' at first entry is outside ' || (rule->>'age_min') || '–' || (rule->>'age_max') || '.'; end if;
  for c in select x from jsonb_array_elements(coalesce(rule->'conditions', '[]'::jsonb)) x loop
    if (c->>'ecr' is null or c->>'ecr' = p_ecr) and (c->>'gender' is null or upper(left(coalesce(p_gender, ''), 1)) = upper(left(c->>'gender', 1)))
       and c ? 'age_min' and age < (c->>'age_min')::int then
      return next coalesce(c->>'note', 'Not eligible.'); end if;
  end loop;
end $$;
create or replace function public.qr_recruit_rule_check() returns trigger language plpgsql security definer set search_path = public as $$
declare q public.qr_quotas; rule jsonb; f jsonb := '[]'::jsonb; ck jsonb; f2 jsonb; on_d date := coalesce(new.arrival_eta::date, new.created_at::date, current_date);
begin
  if tg_op = 'UPDATE' and new.job is not distinct from old.job and new.dob is not distinct from old.dob and new.country is not distinct from old.country
     and new.use_request_id is not distinct from old.use_request_id and new.ecr is not distinct from old.ecr and new.gender is not distinct from old.gender then return new; end if;
  select qq.* into q from public.qr_quotas qq where qq.id = coalesce((select quota_id from public.qr_use_requests where id = new.use_request_id), (select quota_id from public.qr_batches where id = new.batch_id));
  if q.id is not null then
    rule := public.qr_reg('sector_rules', public.qr_sector_scope(q), current_date);
    f := coalesce((select jsonb_agg(x) from public.qr_sector_eval(rule - 'age_min' - 'age_max', new.country, new.job, null, q.subsector) x), '[]'::jsonb);
    if jsonb_array_length(f) > 0 and rule->>'mode' = 'block' then raise exception 'Sector rule: %', (select string_agg(x, ' ') from jsonb_array_elements_text(f) x); end if;
    if rule ? 'age_min' and public.qr_reg('recruit_checks', new.country, on_d) is null then
      f := f || coalesce((select jsonb_agg(x) from public.qr_sector_eval(jsonb_build_object('age_min', rule->'age_min', 'age_max', rule->'age_max'), null, null, new.dob, null, on_d) x), '[]'::jsonb); end if;
  end if;
  ck := public.qr_reg('recruit_checks', new.country, on_d);
  f2 := coalesce((select jsonb_agg(x) from public.qr_recruit_checks_eval(ck, new.ecr, new.gender, new.dob, on_d) x), '[]'::jsonb);
  if jsonb_array_length(f2) > 0 and coalesce(ck->>'mode', 'block') = 'block' then raise exception 'Not eligible: %', (select string_agg(x, ' ') from jsonb_array_elements_text(f2) x); end if;
  new.rule_flags := f || f2;
  return new;
end $$;

/* ---------------- accommodation before FOMEMA; Immigration clearance time ---------------- */
create or replace function public.qr_recruit_arrival(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  update public.qr_recruits set
    accom_address = coalesce(nullif(trim(p->>'accom_address'), ''), accom_address),
    accom_confirmed_on = case when p ? 'accom_address' then current_date else accom_confirmed_on end,
    imm_cleared_at = coalesce((p->>'imm_cleared_at')::timestamptz, imm_cleared_at), updated_at = now() where id = r.id;
  perform public.audit('qr_arrival_info', 'quota_recruit', r.id::text, 'Arrival details updated for ' || r.full_name, p);
end $$;
do $$ declare src text := pg_get_functiondef('public.qr_recruit_fomema(uuid,date,text,uuid,text)'::regprocedure); n text; begin
  n := replace(src, $q$  if p_result not in ('fit','unfit')$q$, $q$  if coalesce(r.accom_address, '') = '' then raise exception 'Confirm his accommodation address first (FOMEMA needs it).'; end if;
  if p_result not in ('fit','unfit')$q$);
  if n = src and src not like '%accommodation address%' then raise exception '041: fomema body not as expected'; end if;
  execute n;
end $$;

/* ---------------- CMO: departure confirmation and bond refund ---------------- */
create or replace function public.qr_exit_followup(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare x public.qr_exits;
begin
  select * into x from public.qr_exits where id = p_id for update;
  if x.id is null then raise exception 'Exit not found.'; end if;
  perform public.qr_need(x.company_id, 1);
  if (p->>'depart_letter_file') is not null and not exists (select 1 from public.qr_files where id = (p->>'depart_letter_file')::uuid and company_id = x.company_id) then raise exception 'File must belong to this company.'; end if;
  if p ? 'bond_refund_status' and p->>'bond_refund_status' not in ('not_applicable','pending','applied','refunded') then raise exception 'Unknown bond refund status.'; end if;
  update public.qr_exits set depart_letter_file = coalesce((p->>'depart_letter_file')::uuid, depart_letter_file),
    bond_refund_status = coalesce(p->>'bond_refund_status', bond_refund_status), bond_refund_on = coalesce((p->>'bond_refund_on')::date, bond_refund_on),
    bond_refund_rm = coalesce((p->>'bond_refund_rm')::numeric, bond_refund_rm) where id = x.id;
  perform public.audit('qr_exit_followup', 'quota_exit', x.id::text, 'Exit follow-up for ' || coalesce(x.worker_name, ''), p);
end $$;

/* ---------------- follow-ups: + levy deadline, + accommodation, + bond refund ---------------- */
do $$ declare src text := pg_get_functiondef('public.qr_followups_core(boolean)'::regprocedure); n text; begin
  n := replace(src, $q$    union all
    select 'agent_doc',$q$, $q$    union all
    select 'levy', q.id::text, q.company_id, 'Levy payment: ' || coalesce(q.ref_no, 'quota letter'), 'Pay the levy and upload the receipt', q.created_by, q.created_by_name,
      q.approval_date, q.approval_date + coalesce(public.qr_reg_int('levy_payment_days', q.approval_date), 15), 'quota?tab=letters&q=' || q.id
    from public.qr_quotas q where q.status = 'active' and q.kind <> 'additional' and q.approval_date is not null and q.levy_paid_on is null and q.approval_date >= date '2026-10-01'
    union all
    select 'bond_refund', x.id::text, x.company_id, 'Bond refund: ' || coalesce(x.worker_name, ''), 'Claim the security bond refund', x.created_by, x.created_by_name,
      x.cmo_date, x.cmo_date + 60, 'quota?tab=exits&exit=' || x.id
    from public.qr_exits x where x.status <> 'void' and x.bond_refund_status in ('pending','applied')
    union all
    select 'agent_doc',$q$);
  if n = src and src not like '%bond_refund%' then raise exception '041: followups body not as expected'; end if;
  execute n;
end $$;

/* ---------------- research values (Oct 2026) ---------------- */
do $$
declare seed text := 'System seed (CEO defaults / research)'; res text := 'Regulation research Oct 2026'; india jsonb; nv jsonb;
begin
  -- corrections to the 040 seed rows (still the seed, not a regulatory change)
  update public.qr_reg_rules set value = '15', source_ref = 'Immigration / FWCMS: levy paid within 15 days of the quota approval (SKB)', verified = true,
    note = 'Counted from the SKB approval date.' where key = 'levy_payment_days' and created_by_name = seed;
  update public.qr_reg_rules set source_ref = 'Quota approval letter (SKB, KDN) — valid 12 months', verified = true where key = 'letter_valid_months' and created_by_name = seed;
  update public.qr_reg_rules set source_ref = 'JTKSM Form PA 2/13 — report a runaway to the police and Immigration within 14 days', verified = true, note = 'Record the police report number and the Immigration report.'
    where key = 'runaway_report_days' and created_by_name = seed;
  update public.qr_reg_rules set source_ref = 'FOMEMA: examination within 30 days of arrival', verified = true, note = 'Confirm the accommodation address first.' where key = 'fomema_days' and created_by_name = seed;
  update public.qr_reg_rules set value = '{"items":[{"name":"SPIKPA hospitalisation & surgical insurance","rm":120,"note":"Mandatory; RM120 a year"},{"name":"Workers'' compensation (SOCSO Employment Injury Scheme)","rm":null,"note":"Mandatory for foreign workers"}]}',
    source_ref = 'SPIKPA (Immigration) RM120/yr; SOCSO Employment Injury Scheme', verified = true, note = null where key = 'insurance' and created_by_name = seed;
  update public.qr_reg_rules set value = '{"mode":"warn","countries":["India","Nepal","Myanmar","Indonesia","Bangladesh","Sri Lanka","Pakistan","Vietnam","Cambodia","Laos","Thailand","Philippines","Uzbekistan","Kazakhstan","Turkmenistan"],"jobs":[],"job_rules":[{"job":"Cook","country":"India","sub_sectors":["Restaurant (Indian cuisine)","Indian community business"],"note":"Indian workers in F&B only as cooks in Indian restaurants / Indian community businesses"}],"india_jobs":["Cook"],"no_front_liner":true,"front_liner_note":"Foreign workers may not serve as front-liners (cashier, waiter at counter, receptionist).","same_title_note":"Use the same job title in the advert, Section 60K, FWCMS, the SKB and the VDR.","advert_first":true,"advert_note":"Advertise on MyFutureJobs for 14 days first and record the advert link.","age_min":18,"age_max":45}',
    source_ref = 'JTK / KDN services (F&B) sub-sector conditions — research Oct 2026', verified = true, note = 'Mode is Warn; switch to Block to refuse.' where key = 'sector_rules' and scope = 'Services' and created_by_name = seed;
  if not exists (select 1 from public.qr_reg_rules where key = 'sector_rules' and scope = 'Plantation') then
    insert into public.qr_reg_rules (key, scope, value, effective_from, source_ref, note, verified, created_by_name, created_role) values
    ('sector_rules', 'Plantation', '{"mode":"warn","countries":[],"jobs":[],"advert_first":false,"age_min":18,"age_max":45}', '2020-01-01', res, 'Plantation is exempt from the MyFutureJobs advert.', true, seed, 'System');
  end if;
  if not exists (select 1 from public.qr_reg_rules where key = 'bond' and scope = 'India') then
    insert into public.qr_reg_rules (key, scope, value, effective_from, source_ref, note, verified, created_by_name, created_role, created_at) values
    ('bond', 'India', '{"rm":750,"guarantee_min_months":18}', '2020-01-01', 'Immigration security bond — India RM750 (bank / insurance guarantee valid ≥ 18 months)', 'Refund after the worker leaves (track on the CMO).', true, seed, 'System', now()),
    ('quota_app', '', '{"steps":[
      {"key":"advert","label":"MyFutureJobs advert (14 days)","fields":["link","start"],"hint":"Record the advert link and start date."},
      {"key":"interview_form","label":"Day-8 interview form uploaded","fields":["file_id"],"hint":"Upload the interview form generated on day 8."},
      {"key":"perkeso","label":"PERKESO interviews","fields":["date"],"hint":"Interview local candidates referred by PERKESO."},
      {"key":"s60k","label":"Section 60K approval","fields":["ref"],"hint":"JTK Section 60K approval reference."},
      {"key":"fwcms","label":"FWCMS quota application","fields":["ref"]},
      {"key":"osc","label":"OSC interview","fields":["date"]},
      {"key":"skb","label":"Approval letter (SKB)","fields":["ref"],"hint":"Record the approval date on the letter and upload the SKB."}]}', '2020-01-01', res, 'Plantation skips the advert.', true, seed, 'System', now()),
    ('advert_days', '', '14', '2020-01-01', 'MyFutureJobs: advertise 14 days before applying', null, true, seed, 'System', now()),
    ('imm_clear_hours', '', '6', '2020-01-01', 'Immigration: clear new arrivals at the airport within 6 hours', null, true, seed, 'System', now()),
    ('plks_valid_months', '', '12', '2020-01-01', 'PLKS (VP(TE)) issued / renewed for 12 months', null, true, seed, 'System', now()),
    ('plks_renew_days', '', '90', '2020-01-01', 'Start renewal 3 months before the PLKS expires', null, true, seed, 'System', now()),
    ('min_wage', '', '{"rm":2000,"exempt_note":"Firms with turnover under RM50m exempt"}', '2027-06-01', 'Minimum wage RM2,000 from 1 Jun 2027 (research Oct 2026)', 'Stored as a rule only; payroll is not changed.', false, seed, 'System', now()),
    ('epf', '', '{"employer_pct":2,"employee_pct":2,"due_day":15}', '2025-10-01', 'EPF for foreign workers 2% / 2%, due by the 15th', 'Stored as a rule only; payroll is not changed.', true, seed, 'System', now()),
    ('recruit_checks', 'India', '{"mode":"block","age_min":18,"age_max":45,"conditions":[{"ecr":"ECR","gender":"F","age_min":30,"note":"Women under 30 with ECR passports cannot emigrate for work (India)."}]}', '2020-01-01', 'India Emigration Act rules (ECR) and Malaysian age 18–45 at first entry', null, true, seed, 'System', now());
  end if;
  -- India pipeline, new version from today (recruits already in progress stay on their version)
  if not exists (select 1 from public.qr_reg_rules where key = 'pipeline' and scope = 'India' and source_ref = res) then
    select value into india from public.qr_reg_rules where key = 'pipeline' and scope = 'India' and status = 'active' order by effective_from desc limit 1;
    nv := jsonb_set(india, '{stages}', (select jsonb_agg(z order by o) from (
      select o, case s->>'key'
        when 'emigration' then s || jsonb_build_object('label', 'India emigration (eMigrate)', 'docs', '["eMigrate registration","Power of attorney","Demand","Attested contract","PBBY policy","PoE clearance"]'::jsonb,
          'steps', '[{"key":"_ecr","label":"Passport type (ECR / ECNR) recorded"},
            {"key":"emigrate_employer","label":"Employer eMigrate registration (High Commission attestation, ~1 week)","ecr":"ECR","hint":"Record the registration expiry date."},
            {"key":"agent_poa","label":"Agent power of attorney and worker count","ecr":"ECR"},
            {"key":"emigrate_reg","label":"eMigrate demand raised","ecr":"ECR"},
            {"key":"contract_attest","label":"Employment contract attested","ecr":"ECR"},
            {"key":"pbby","label":"PBBY insurance","ecr":"ECR"},
            {"key":"emig_clear","label":"Protector of Emigrants clearance","ecr":"ECR"},
            {"key":"pdot","label":"Pre-departure orientation (PDOT)","req":false}]'::jsonb)
        when 'klia' then s || jsonb_build_object('gate', 'Cleared by the employer within the Immigration time limit (6 hours)')
        else s end z
      from jsonb_array_elements(india->'stages') with ordinality x(s, o)
      union all select 10.5, '{"key":"departure","label":"Departure","owner":"agent","docs":["Boarding pass"],"gate":"Worker departed India","steps":[{"key":"departed","label":"Departed","requires":["flight_at"]}]}'::jsonb) y));
    perform public.qr_reg_validate('pipeline', 'India', nv);
    insert into public.qr_reg_rules (key, scope, value, effective_from, source_ref, note, verified, created_by_name, created_role)
    values ('pipeline', 'India', nv, current_date, res, 'Adds eMigrate employer registration, power of attorney, demand, contract attestation, PBBY and PoE (ECR), and a Departure stage.', true, seed, 'System');
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['qr_quota_app_list(uuid)','qr_quota_app_step(uuid,text,jsonb)','qr_quota_levy_paid(uuid,date,uuid,text)','qr_recruit_arrival(uuid,jsonb)','qr_exit_followup(uuid,jsonb)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- front-liner ban (sector rule flag) and India job list per sub-sector
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
  if p_job is not null and p_country = 'India' and jsonb_typeof(rule->'india_jobs') = 'array' and jsonb_array_length(rule->'india_jobs') > 0
     and not exists (select 1 from jsonb_array_elements_text(rule->'india_jobs') j where lower(j) = lower(trim(p_job))) then
    return next 'Indian workers in this sector only as: ' || (select string_agg(j, ', ') from jsonb_array_elements_text(rule->'india_jobs') j) || '.'; end if;
  if p_job is not null and coalesce((rule->>'no_front_liner')::boolean, false)
     and lower(p_job) ~ '(cashier|waiter|waitress|front|receptionist|counter|server|captain|host)' then
    return next coalesce(rule->>'front_liner_note', 'Foreign workers may not be front-liners.'); end if;
  for jr in select x from jsonb_array_elements(coalesce(rule->'job_rules', '[]'::jsonb)) x where lower(x->>'job') = lower(trim(coalesce(p_job, ''))) loop
    if jr ? 'countries' and p_country is not null and not (jr->'countries') ? p_country then
      return next p_job || ' may only come from ' || (select string_agg(c, ', ') from jsonb_array_elements_text(jr->'countries') c) || '.'; end if;
    if jr ? 'sub_sectors' and (jr->>'country' is null or jr->>'country' = p_country)
       and not exists (select 1 from jsonb_array_elements_text(jr->'sub_sectors') s where lower(s) = lower(coalesce(p_sub, ''))) then
      return next coalesce(jr->>'note', p_job || ' only in ' || (select string_agg(s, ', ') from jsonb_array_elements_text(jr->'sub_sectors') s)) || '.'; end if;
  end loop;
  if p_dob is not null then
    age := extract(year from age(p_on, p_dob));
    if (rule ? 'age_min' and age < (rule->>'age_min')::int) or (rule ? 'age_max' and age > (rule->>'age_max')::int) then
      return next 'Age ' || age || ' is outside ' || coalesce(rule->>'age_min', '?') || '–' || coalesce(rule->>'age_max', '?') || ' for this sector.'; end if;
  end if;
end $$;

/* ---------------- System Map (039 pipeline + 040/041 rules) ---------------- */
insert into public.system_map (key, sort, title, content) values ('quota', 35, 'Quota & Recruitment module', jsonb_build_object('blocks', jsonb_build_array(
  jsonb_build_object('t', 'text', 'text', 'Admin-only module (CEO, GM, HR Admin, HR Manager) for quota letters, their use and the road from quota approval to onboarding, plus exits (CMO register, runaway cases) and Immigration replacements. Outlet Managers see only the minimum for their outlet''s incoming recruits (name, arrival, their brief task). External agents get a separate, very small portal. Enforced by the database, not only the menu.'),
  jsonb_build_object('t', 'kv', 'rows', jsonb_build_array(
    jsonb_build_array('Rules & regulations', 'qr_reg_rules: every regulatory value and process is a versioned rule (key + scope) with effective-from date, source / circular reference, optional circular PDF, verified flag and who changed it. qr_reg(key, scope, date) returns the version in force on that date, so each record is judged by the rule in force at its own date. CEO edits apply at once; HR Admin edits wait for CEO approval (qr_reg_propose / qr_reg_decide). qr_reg_impact previews the effect before saving. All audited.'),
    jsonb_build_array('Pipelines', 'Per-country pipeline templates are rules (stages, steps, documents, gates, owners, the step that marks the slot used). A recruit is pinned to the template version in force when added (qr_recruits.template_id), so changes never break recruits already in progress. Gate trigger qr_pipeline_gate enforces order; only the CEO overrides, with a note.'),
    jsonb_build_array('Quota slots', 'Approved request = Reserved (awaiting VDR). The slot becomes Used only when the template''s use step is done (default: VDR approved with its copy). Dropping before that releases the slot with a reason. Used but not arrived / FOMEMA unfit → replacement application.'),
    jsonb_build_array('Replacement (Immigration)', 'qr_replacements: HR applies, uploads Immigration''s approval, a different HR Admin verifies → ledger entry imm_replacement "Replacement approved by Immigration" restores 1 slot (once). Which exit types qualify and their documents come from replacement_rules (runaway, death, transfer: no).'),
    jsonb_build_array('HR follow-ups', 'qr_followups(): replacements, runaway reports, missing CMOs, used-not-arrived, FOMEMA due / unfit, calling visa expiring, levy payment, bond refunds, agent uploads, idle approvals — each due date from the rule in force on the item''s date. GM / CEO nudge or reassign; qr_followups_sweep notifies owners daily and escalates.'),
    jsonb_build_array('Sector & eligibility checks', 'Sector rules (source countries, jobs, Indian roles, no front-liners, cap, advert-first, age) and country checks (age at first entry, ECR conditions) store rule_flags on letters, requests and recruits; mode Block refuses.'),
    jsonb_build_array('Quota application', 'quota_app checklist per letter (MyFutureJobs advert → day-8 interview form → PERKESO → Section 60K → FWCMS → OSC → SKB), in order; plantation skips the advert. Levy due within levy_payment_days of the SKB.'),
    jsonb_build_array('Master table', 'qr_master(): per letter, company subtotal, sector total and grand total of approved / reserved / used / pending cancellation / balance / expiring unused / runaways; qr_stage_counts() for the stage board.'),
    jsonb_build_array('Agents', 'Agent logins have no staff profile. They see only recruits of batches assigned to them, upload documents (HR accepts / rejects) and download the calling visa through an audited grant. Revoke ends access at once.'),
    jsonb_build_array('Migration', '036–041 (additive only): 039 pipeline, 040 rules & regulations, 041 Oct 2026 research values'))),
  jsonb_build_object('t', 'steps', 'items', jsonb_build_array(
    'Quota application checklist → SKB recorded (valid per rule, default 12 months) → levy paid.',
    'HR raises a Quota Use Request → GM recommends → CEO approves (final). Slots reserved.',
    'Per recruit, following the country pipeline: recruitment → medical (Fit) → VDR applied → VDR approved + copy (slot USED) → agent → stamping → emigration (India ECR: eMigrate, PBBY, PoE) → ticket → departure → KLIA clearance → pickup → HQ → HR brief → outlet manager brief → onboard (worker record).',
    'After arrival: accommodation address → FOMEMA within the rule''s days. Unfit → repatriate → replacement application.',
    'On exit: CMO with its scan, Immigration departure letter, bond refund. Runaways: police + Immigration reports within the rule''s days.'))
))) on conflict (key) do update set title = excluded.title, content = excluded.content, sort = excluded.sort, updated_at = now();
