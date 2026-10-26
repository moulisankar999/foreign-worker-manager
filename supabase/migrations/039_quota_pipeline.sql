-- 039 Quota & Recruitment, part 4 (v1.4.0 draft). Additive: new columns / tables / functions; constraint lists only widen.
--  * CEO pipeline order (India default): 1 Quota approval → 2 Overseas recruitment → 3 Medical overseas → 4 Medical gate (Fit)
--    → 5 Calling visa (VDR) application → 6 VDR gate (approved + copy) → 7 Sent to India (agent downloads) → 8 Visa stamping
--    → 9 Emigration clearance (ECR: eMigrate + PoE; ECNR: not required) → 10 Air ticket → 11 KLIA airport clearance → 12 Pickup
--    → 13 Arrival at HQ → 14 HR brief → 15 Outlet manager brief → 16 Onboard (worker record).
--    The database refuses a step whose earlier stages are not complete; only the CEO can mark a stage done (with a note).
--  * "After calling visa process only the quota confirms its usage": an approved request RESERVES the slot; the slot becomes USED
--    only when the VDR is approved and its copy uploaded (automatic ledger entry). Drop-out before that releases the slot to
--    Available; drop-out after it keeps it Used and flags "Used, not arrived".
--  * Replacement application (Immigration): FOMEMA fail after arrival, or VDR approved but the worker did not arrive. HR applies to
--    Immigration, uploads Immigration's approval, an HR Admin (not the uploader) verifies → slot restored to Available
--    ("Replacement approved by Immigration"). The CEO / GM approve nothing here; they monitor HR follow-ups, nudge and reassign.

/* ---------------- rules ---------------- */
alter table public.qr_rules add column if not exists repl_apply_days int not null default 7;   -- apply to Immigration within N days
alter table public.qr_rules add column if not exists repl_chase_days int not null default 30;  -- chase Immigration after N days
alter table public.qr_rules add column if not exists verify_days int not null default 3;       -- HR Admin verifies uploads within N days
alter table public.qr_rules add column if not exists escalate_days int not null default 3;     -- overdue this long → GM and CEO are told

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
    repl_apply_days = coalesce((p->>'repl_apply_days')::int, repl_apply_days), repl_chase_days = coalesce((p->>'repl_chase_days')::int, repl_chase_days),
    verify_days = coalesce((p->>'verify_days')::int, verify_days), escalate_days = coalesce((p->>'escalate_days')::int, escalate_days),
    templates = coalesce(p->'templates', templates), updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public.audit('qr_rules', 'quota', '1', 'Quota rules updated', p);
end $$;

/* ---------------- recruit: stage documents ---------------- */
alter table public.qr_recruits add column if not exists medical_result text check (medical_result in ('fit','unfit'));
alter table public.qr_recruits add column if not exists medical_file uuid references public.qr_files(id);
alter table public.qr_recruits add column if not exists stamped_file uuid references public.qr_files(id);
alter table public.qr_recruits add column if not exists arrival_eta timestamptz;
alter table public.qr_recruits add column if not exists ticket_file uuid references public.qr_files(id);
alter table public.qr_recruits add column if not exists klia_person text;
alter table public.qr_recruits add column if not exists hr_ack_file uuid references public.qr_files(id);
alter table public.qr_recruits add column if not exists om_by_name text;
alter table public.qr_recruits add column if not exists out_kind text;      -- why the recruit left the pipeline
alter table public.qr_recruits add column if not exists out_at timestamptz;
alter table public.qr_recruits add column if not exists used_not_arrived boolean not null default false;
alter table public.qr_recruits add column if not exists stage_at timestamptz not null default now();

/* ---------------- the pipeline definition (one place; the app mirrors it in src/lib/quotaSteps.ts) ---------------- */
create or replace function public.qr_stage_label(k text) returns text language sql immutable as $$
  select case k when 'quota' then 'Quota approval' when 'recruit' then 'Overseas recruitment' when 'medical' then 'Medical overseas'
    when 'med_gate' then 'Medical gate (Fit)' when 'vdr' then 'Calling visa (VDR) application' when 'vdr_gate' then 'Calling visa approved'
    when 'sent' then 'Sent to India (agent)' when 'stamping' then 'Visa stamping' when 'emigration' then 'Emigration clearance'
    when 'ticket' then 'Air ticket' when 'klia' then 'KLIA airport clearance' when 'pickup' then 'Airport pickup' when 'hq' then 'Arrival at HQ'
    when 'hr_brief' then 'HR brief' when 'om_brief' then 'Outlet manager brief' when 'onboard' then 'Onboard' when 'converted' then 'Onboarded (worker)' else k end
$$;
-- ordered (stage, step, required) for a country / passport type. '_ecr' = passport type recorded (India).
create or replace function public.qr_pipeline_def(p_country text, p_ecr text) returns table (idx int, stage text, step text, req boolean)
language sql immutable as $$
  with base(idx, stage, step, req, ord) as (values
    (1, 'quota', '_quota', true, 1),
    (2, 'recruit', 'ra_check', false, 1), (2, 'recruit', 'selected', true, 2), (2, 'recruit', 'trade_test', false, 3), (2, 'recruit', 'offer', true, 4),
    (3, 'medical', 'medical', true, 1), (4, 'med_gate', 'med_fit', true, 1),
    (5, 'vdr', 'vdr_apply', true, 1), (6, 'vdr_gate', 'vdr_ok', true, 1), (7, 'sent', 'vdr_sent', true, 1), (8, 'stamping', 'visa_stamp', true, 1),
    (10, 'ticket', 'ticket', true, 1), (11, 'klia', 'klia', true, 1), (12, 'pickup', 'pickup', true, 1), (13, 'hq', 'arrived_hq', true, 1),
    (14, 'hr_brief', 'hr_brief', true, 1), (15, 'om_brief', 'om_brief', true, 1), (16, 'onboard', 'onboard', true, 1)),
  emi(step, req, ord) as (
    select * from (values ('_ecr', true, 0)) v where p_country = 'India'
    union all select * from (values ('demand_letter', false, 1), ('emigrate_reg', true, 2), ('pbby', false, 3), ('emig_clear', true, 4), ('pdot', false, 5)) v
      where p_country = 'India' and p_ecr = 'ECR'
    union all select * from (values ('pdot', false, 5)) v where p_country = 'India' and p_ecr = 'ECNR'
    union all select * from (values ('demand_attest', false, 1), ('dofe_pre', true, 2), ('orientation', false, 3), ('insurance_np', false, 4), ('labour_permit', true, 5)) v where p_country = 'Nepal'
    union all select * from (values ('attest_bd', false, 1), ('bmet', true, 2), ('welfare_bd', false, 3)) v where p_country = 'Bangladesh'
    union all select * from (values ('owic', true, 1)) v where p_country = 'Myanmar'
    union all select * from (values ('bp2mi', true, 1)) v where p_country = 'Indonesia'
    union all select * from (values ('slbfe', true, 1)) v where p_country = 'Sri Lanka'
    union all select * from (values ('beoe', true, 1)) v where p_country = 'Pakistan')
  select idx, stage, step, req from (
    select idx, stage, step, req, ord from base
    union all select 9, 'emigration', step, req, ord from emi) x
  order by idx, ord
$$;
create or replace function public.qr_step_done(r public.qr_recruits, k text) returns boolean language sql stable security definer set search_path = public as $$
  select case k
    when '_quota' then exists (select 1 from public.qr_use_requests u where u.id = r.use_request_id and u.status = 'approved')
    when '_ecr' then r.ecr is not null
    else coalesce((r.steps->k->>'done')::boolean, false) end
$$;
-- current stage = the first stage with a required step not done
create or replace function public.qr_stage_of(r public.qr_recruits) returns text language sql stable security definer set search_path = public as $$
  select case when r.status = 'converted' then 'converted' else coalesce(
    (select d.stage from public.qr_pipeline_def(r.country, r.ecr) d where d.req and not public.qr_step_done(r, d.step) order by d.idx limit 1), 'onboard') end
$$;
create or replace function public.qr_stage_idx(r public.qr_recruits) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select d.idx from public.qr_pipeline_def(r.country, r.ecr) d where d.req and not public.qr_step_done(r, d.step) order by d.idx limit 1), 17)
$$;

-- BEFORE trigger: order + per-stage documents. CEO override (steps.k.override = true + note) skips the document check of that step only.
create or replace function public.qr_pipeline_gate() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; d record; cur int; ov boolean; v jsonb;
begin
  if new.status <> 'active' and tg_op = 'UPDATE' and old.status <> 'active' then return new; end if;
  -- a calling visa application is the step vdr_apply
  if new.vdr_applied is not null and (tg_op = 'INSERT' or old.vdr_applied is null) and not coalesce((new.steps->'vdr_apply'->>'done')::boolean, false) then
    new.steps := new.steps || jsonb_build_object('vdr_apply', jsonb_build_object('done', true, 'date', new.vdr_applied, 'by_name', public.my_name(), 'at', now()));
  end if;
  for k, v in select key, value from jsonb_each(new.steps) loop
    continue when not coalesce((v->>'done')::boolean, false);
    continue when tg_op = 'UPDATE' and coalesce((old.steps->k->>'done')::boolean, false);
    select * into d from public.qr_pipeline_def(new.country, new.ecr) x where x.step = k;
    continue when d.idx is null;                                  -- not a pipeline step (free note / old key)
    -- order: every required step of the earlier stages must be done
    select min(x.idx) into cur from public.qr_pipeline_def(new.country, new.ecr) x where x.idx < d.idx and x.req and not public.qr_step_done(new, x.step);
    if cur is not null then
      raise exception 'Stage "%" cannot start: "%" is not complete yet.', public.qr_stage_label(d.stage),
        public.qr_stage_label((select x.stage from public.qr_pipeline_def(new.country, new.ecr) x where x.idx = cur limit 1)) using errcode = 'P0001';
    end if;
    ov := coalesce((v->>'override')::boolean, false);
    if ov and (public.qr_rank() < 4 or coalesce(trim(v->>'note'), '') = '') then raise exception 'Only the CEO marks a stage done without its documents, with a note.' using errcode = '42501'; end if;
    continue when ov;
    if k = 'medical' and (new.medical_result is null or (new.medical_file is null and not exists (select 1 from public.qr_agent_docs a where a.recruit_id = new.id and a.kind = 'medical' and a.status = 'accepted'))) then
      raise exception 'Medical: record the result (Fit / Unfit) and attach the medical report (HR upload or the agent''s accepted upload).'; end if;
    if k = 'med_fit' and new.medical_result is distinct from 'fit' then raise exception 'Medical gate: only a Fit result moves on. For Unfit, end the recruit with the reason.'; end if;
    if k in ('vdr_ok','vdr_sent') and new.vdr_file is null then raise exception 'Calling visa: upload the approved VDR copy first.'; end if;
    if k = 'visa_stamp' and new.stamped_file is null then raise exception 'Visa stamping: upload the stamped visa page.'; end if;
    if k = 'ticket' and (new.flight_no is null or new.flight_at is null or new.arrival_eta is null or new.ticket_file is null) then
      raise exception 'Air ticket: enter the flight number, departure date, arrival time and attach the ticket.'; end if;
    if k = 'klia' and coalesce(trim(new.klia_person), '') = '' then raise exception 'KLIA clearance: name the officer / person collecting him and print the authorisation letter.'; end if;
    if k = 'pickup' and (coalesce(trim(new.pickup_by), '') = '' or coalesce(trim(new.transport), '') = '') then raise exception 'Pickup: enter the driver / person and the vehicle.'; end if;
    if k = 'arrived_hq' and new.arrived_at is null then raise exception 'Arrival at HQ: enter the arrival time.'; end if;
    if k = 'hr_brief' and new.hr_ack_file is null then raise exception 'HR brief: attach the signed acknowledgement.'; end if;
    if k = 'om_brief' and new.outlet_id is null then raise exception 'Outlet manager brief: assign the outlet first.'; end if;
  end loop;
  if tg_op = 'INSERT' or new.stage is distinct from public.qr_stage_of(new) then
    if new.status = 'active' or new.status = 'converted' then new.stage := public.qr_stage_of(new); new.stage_at := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists qr_pipeline_gate on public.qr_recruits;
create trigger qr_pipeline_gate before insert or update on public.qr_recruits for each row execute function public.qr_pipeline_gate();

-- AFTER trigger: the slot is USED only when the VDR is approved with its copy (stage 6 passed); stage changes go on the timeline
create or replace function public.qr_pipeline_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce((new.steps->'vdr_ok'->>'done')::boolean, false) and (tg_op = 'INSERT' or not coalesce((old.steps->'vdr_ok'->>'done')::boolean, false))
     and not exists (select 1 from public.qr_ledger l where l.recruit_id = new.id and l.kind = 'use' and not exists (select 1 from public.qr_ledger x where x.reverses = l.id)) then
    perform public.qr_post((select quota_id from public.qr_use_requests where id = new.use_request_id), new.country, 'use', 1, coalesce(new.vdr_no, 'VDR'),
      'Calling visa approved: ' || new.full_name, p_use => new.use_request_id, p_recruit => new.id);
    perform public.qr_event(new.company_id, 'Calling visa approved — quota slot now USED', new.vdr_no, p_recruit => new.id, p_batch => new.batch_id);
  end if;
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    perform public.qr_event(new.company_id, 'Stage: ' || public.qr_stage_label(new.stage), null, p_recruit => new.id, p_batch => new.batch_id);
  end if;
  return null;
end $$;
drop trigger if exists qr_pipeline_after on public.qr_recruits;
create trigger qr_pipeline_after after insert or update on public.qr_recruits for each row execute function public.qr_pipeline_after();

-- qr_save_recruit no longer posts 'use' when the VDR is applied, and no longer logs the stage (the triggers do)
do $$ declare src text := pg_get_functiondef('public.qr_save_recruit(jsonb)'::regprocedure); n text; begin
  n := replace(src, 'if r.vdr_applied is not null and not exists (select 1 from public.qr_ledger where recruit_id = r.id and kind = ''use'') then',
                    'if false then  -- 039: the slot is used when the VDR is APPROVED (qr_pipeline_after)');
  n := replace(n, 'if r.stage is distinct from was then perform public.qr_event(r.company_id, ''Stage: '' || r.stage, null, p_recruit => r.id, p_batch => r.batch_id); end if;', '');
  if position('if false then' in n) = 0 then raise exception '039: qr_save_recruit body not as expected'; end if;
  execute n;
end $$;
-- calling visa copy: the gate step only (sending to the agent is its own stage, ticked when the agent downloads it)
create or replace function public.qr_set_vdr_copy(p_recruit uuid, p_file uuid, p_approved date default null) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; f public.qr_files;
begin
  select * into r from public.qr_recruits where id = p_recruit for update;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  select * into f from public.qr_files where id = p_file;
  if f.id is null or f.company_id <> r.company_id then raise exception 'The calling visa copy must be a file of the same company.'; end if;
  if r.vdr_applied is null then raise exception 'Apply the calling visa (VDR) first — the copy is uploaded after approval.'; end if;
  update public.qr_recruits set vdr_file = f.id, vdr_approved = coalesce(p_approved, vdr_approved, current_date),
    steps = steps || jsonb_build_object('vdr_ok', jsonb_build_object('done', true, 'date', coalesce(p_approved, vdr_approved, current_date), 'by_name', public.my_name(), 'at', now())),
    updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'Calling visa copy uploaded', f.name, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_vdr_copy', 'quota_recruit', r.id::text, 'Calling visa copy uploaded for ' || r.full_name, jsonb_build_object('file', f.id));
end $$;
create or replace function public.agent_vdr_grant(p_recruit uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; f public.qr_files; ag text;
begin
  if public.qr_agent_me() is null then raise exception 'Your agent access is not active.' using errcode = '42501'; end if;
  if not public.qr_agent_has_recruit(p_recruit) then raise exception 'This recruit is not in a batch assigned to you.' using errcode = '42501'; end if;
  select * into r from public.qr_recruits where id = p_recruit;
  select * into f from public.qr_files where id = r.vdr_file;
  if f.id is null then raise exception 'HR has not uploaded the calling visa copy yet.'; end if;
  delete from public.qr_agent_grants where expires_at < now();
  insert into public.qr_agent_grants (user_id, path, expires_at) values (auth.uid(), f.path, now() + interval '2 minutes');
  perform public.qr_agent_audit('qr_agent_download', r.id::text, 'Downloaded calling visa copy for ' || r.full_name, jsonb_build_object('file', f.id));
  select agency into ag from public.qr_agents where user_id = auth.uid();
  if not coalesce((r.steps->'vdr_sent'->>'done')::boolean, false) then
    update public.qr_recruits set steps = steps || jsonb_build_object('vdr_sent', jsonb_build_object('done', true, 'date', current_date, 'by_name', ag || ' (agent)', 'at', now(), 'note', 'Downloaded by the agent')),
      updated_at = now() where id = r.id;
    insert into public.qr_events (company_id, recruit_id, batch_id, action, note, by_name, by_role) values (r.company_id, r.id, r.batch_id, 'Calling visa downloaded by the agent', f.name, ag, 'Agent');
  end if;
  return jsonb_build_object('path', f.path, 'name', f.name);
end $$;

-- stage documents and data (HR Manager and up, own company)
create or replace function public.qr_recruit_docs(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; fk text;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  if r.status <> 'active' then raise exception 'This recruit is % — no more changes.', r.status; end if;
  foreach fk in array array['medical_file','stamped_file','ticket_file','hr_ack_file'] loop
    if p ? fk and not exists (select 1 from public.qr_files f where f.id = (p->>fk)::uuid and f.company_id = r.company_id) then raise exception 'File for % must belong to this company.', fk; end if;
  end loop;
  if p->>'medical_result' = 'unfit' and coalesce(trim(p->>'reason'), '') = '' then raise exception 'Unfit: give the reason (it ends this recruit and releases the slot).'; end if;
  update public.qr_recruits set
    medical_result = coalesce(nullif(p->>'medical_result', ''), medical_result), medical_file = coalesce((p->>'medical_file')::uuid, medical_file),
    stamped_file = coalesce((p->>'stamped_file')::uuid, stamped_file), ticket_file = coalesce((p->>'ticket_file')::uuid, ticket_file),
    hr_ack_file = coalesce((p->>'hr_ack_file')::uuid, hr_ack_file), arrival_eta = coalesce((p->>'arrival_eta')::timestamptz, arrival_eta),
    flight_no = coalesce(nullif(p->>'flight_no', ''), flight_no), flight_at = coalesce((p->>'flight_at')::timestamptz, flight_at),
    klia_person = coalesce(nullif(p->>'klia_person', ''), klia_person), pickup_by = coalesce(nullif(p->>'pickup_by', ''), pickup_by),
    transport = coalesce(nullif(p->>'transport', ''), transport), arrived_at = coalesce((p->>'arrived_at')::timestamptz, arrived_at),
    outlet_id = coalesce(nullif(p->>'outlet_id', ''), outlet_id), stamped_on = coalesce((p->>'stamped_on')::date, stamped_on), updated_at = now()
  where id = r.id;
  perform public.qr_event(r.company_id, 'Documents / details updated', (select string_agg(k, ', ') from jsonb_object_keys(p) k), p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_recruit_docs', 'quota_recruit', r.id::text, 'Stage details for ' || r.full_name, p);
  if p->>'medical_result' = 'unfit' then perform public.qr_recruit_out(r.id, 'medical_unfit', p->>'reason'); end if;
end $$;

-- CEO only: mark a stage done with a note (order still applies: earlier stages first)
create or replace function public.qr_stage_override(p_id uuid, p_stage text, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; add jsonb := '{}'::jsonb; d record;
begin
  if public.qr_rank() < 4 then raise exception 'Only the CEO marks a stage done without its documents.' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Give the reason.'; end if;
  if p_stage in ('quota','onboard') then raise exception 'Quota approval and onboarding cannot be marked done — they need the approval / the worker record.'; end if;
  select * into r from public.qr_recruits where id = p_id for update;
  for d in select * from public.qr_pipeline_def(r.country, r.ecr) x where x.stage = p_stage and x.req and left(x.step, 1) <> '_' loop
    if not public.qr_step_done(r, d.step) then
      add := add || jsonb_build_object(d.step, jsonb_build_object('done', true, 'date', current_date, 'override', true, 'note', p_note, 'by_name', public.my_name(), 'at', now()));
    end if;
  end loop;
  if add = '{}'::jsonb then raise exception 'Nothing to mark in this stage.'; end if;
  update public.qr_recruits set steps = steps || add, updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'CEO marked "' || public.qr_stage_label(p_stage) || '" done', p_note, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_stage_override', 'quota_recruit', r.id::text, 'CEO marked ' || public.qr_stage_label(p_stage) || ' done for ' || r.full_name || ': ' || p_note, null);
end $$;

-- leaving the pipeline. Before the VDR is approved: the reserved slot goes back to Available (release, with the reason).
-- After the VDR is approved: the slot stays USED and the recruit is flagged "Used, not arrived" (a replacement application can follow).
create or replace function public.qr_recruit_out(p_id uuid, p_kind text, p_reason text) returns text language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; u public.qr_use_requests; used_ boolean; left_ int; res text;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  if r.status <> 'active' then raise exception 'This recruit is already %.', r.status; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason.'; end if;
  if p_kind not in ('not_selected','medical_unfit','vdr_rejected','withdrawn','not_stamped','did_not_travel','other') then raise exception 'Unknown reason type %', p_kind; end if;
  used_ := exists (select 1 from public.qr_ledger l where l.recruit_id = r.id and l.kind = 'use' and not exists (select 1 from public.qr_ledger x where x.reverses = l.id));
  select * into u from public.qr_use_requests where id = r.use_request_id;
  if used_ then
    update public.qr_recruits set status = 'dropped', drop_reason = p_reason, out_kind = p_kind, out_at = now(), used_not_arrived = (r.arrived_at is null), updated_at = now() where id = r.id;
    res := 'used_not_arrived';
    perform public.qr_event(r.company_id, 'Left after VDR approval — slot stays USED (Used, not arrived)', p_reason, p_recruit => r.id, p_batch => r.batch_id);
    perform public.qr_notify(r.company_id, array['super_admin','general_manager'], 'Used, not arrived: ' || r.full_name, p_reason || '. HR can apply to Immigration for a replacement.', 'quota/recruit/' || r.id, 'una|' || r.id, true);
  else
    update public.qr_recruits set status = 'dropped', drop_reason = p_reason, out_kind = p_kind, out_at = now(), updated_at = now() where id = r.id;
    select coalesce(sum(d_resv), 0) into left_ from public.qr_ledger where use_request_id = u.id;
    if u.id is not null and u.status = 'approved' and left_ > 0 then
      perform public.qr_post(u.quota_id, u.country, 'release', 1, 'Q-' || u.ref_no, replace(p_kind, '_', ' ') || ': ' || r.full_name || ' — ' || p_reason, p_use => u.id, p_recruit => r.id);
      res := 'released';
    else res := 'no_slot';
    end if;
    perform public.qr_event(r.company_id, 'Left the pipeline (' || replace(p_kind, '_', ' ') || ')' || case when res = 'released' then ' — slot back to Available' else '' end, p_reason, p_recruit => r.id, p_batch => r.batch_id);
  end if;
  perform public.audit('qr_recruit_out', 'quota_recruit', r.id::text, r.full_name || ' left the pipeline: ' || replace(p_kind, '_', ' ') || ' — ' || p_reason, jsonb_build_object('result', res));
  return res;
end $$;
create or replace function public.qr_drop_recruit(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
begin perform public.qr_recruit_out(p_id, 'other', p_reason); end $$;

-- onboarding = stage 16: only after the outlet manager brief (or by the CEO)
create or replace function public.qr_mark_converted(p_id uuid, p_worker text) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  perform public.qr_need(r.company_id, 1);
  if r.status <> 'active' then raise exception 'Already %.', r.status; end if;
  if public.qr_stage_of(r) <> 'onboard' then raise exception 'Onboard comes last: "%" is not complete yet.', public.qr_stage_label(public.qr_stage_of(r)); end if;
  if not exists (select 1 from public.records where entity = 'workers' and id = p_worker) then raise exception 'The worker record is not uploaded yet — wait for sync and try again.'; end if;
  update public.qr_recruits set status = 'converted', worker_id = p_worker,
    steps = steps || jsonb_build_object('onboard', jsonb_build_object('done', true, 'date', current_date, 'by_name', public.my_name(), 'at', now())), updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'Onboarded — worker record created (slot: used / active worker)', p_worker, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_convert', 'quota_recruit', r.id::text, 'Recruit ' || r.full_name || ' onboarded as worker ' || p_worker, null);
end $$;

/* ---------------- Outlet Manager: only the incoming recruit's name, arrival date and the brief task ---------------- */
create or replace function public.qr_om_incoming() returns table (id uuid, full_name text, outlet_id text, arrival date, task text, done boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.full_name, r.outlet_id, coalesce(r.arrived_at, r.arrival_eta)::date,
    'Welcome him at the outlet, show the workplace, shift hours, safety and outlet rules, then confirm the brief here.',
    coalesce((r.steps->'om_brief'->>'done')::boolean, false)
  from public.qr_recruits r
  where public.is_active_user() and public.my_role() = 'outlet_manager' and r.outlet_id = any(public.my_outlets())
    and r.status = 'active' and r.stage in ('ticket','klia','pickup','hq','hr_brief','om_brief')
  order by 4
$$;
create or replace function public.qr_om_confirm(p_id uuid, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits;
begin
  select * into r from public.qr_recruits where id = p_id for update;
  if r.id is null or not (public.is_active_user() and public.my_role() = 'outlet_manager' and r.outlet_id = any(public.my_outlets())) then
    raise exception 'Only the outlet manager of this outlet confirms the brief.' using errcode = '42501'; end if;
  if r.stage <> 'om_brief' then raise exception 'The HR brief comes first — this recruit is at "%".', public.qr_stage_label(r.stage); end if;
  update public.qr_recruits set steps = steps || jsonb_build_object('om_brief', jsonb_build_object('done', true, 'date', current_date, 'note', p_note, 'by_name', public.my_name(), 'at', now())),
    om_by_name = public.my_name(), updated_at = now() where id = r.id;
  perform public.qr_event(r.company_id, 'Outlet manager brief confirmed', p_note, p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_om_brief', 'quota_recruit', r.id::text, 'Outlet manager brief confirmed for ' || r.full_name, null);
end $$;

/* ---------------- Replacement application (Immigration) ---------------- */
alter table public.qr_ledger drop constraint if exists qr_ledger_kind_check;
alter table public.qr_ledger add constraint qr_ledger_kind_check check (kind in ('approved','reserve','release','use','use_existing','return','expire','transfer_out','transfer_in',
  'adjust_up','adjust_down','exit_cmo','exit_other','exit_other_elig','exit_void','runaway','runaway_void','claim_submit','claim_release','claim_approved','reversal','imm_replacement'));
alter table public.qr_ledger add column if not exists repl_id uuid;
create unique index if not exists qr_ledger_repl_once on public.qr_ledger (repl_id) where repl_id is not null;
do $$ declare src text := pg_get_functiondef('public.qr_ledger_fill()'::regprocedure); n text; begin
  if position('imm_replacement' in src) = 0 then
    n := replace(src, 'when ''reversal'' then null;', 'when ''reversal'' then null;' || chr(10) || '    when ''imm_replacement'' then new.d_used := -q; new.d_avail := q;   -- Immigration approved a replacement: slot back to Available');
    if n = src then raise exception '039: qr_ledger_fill body not as expected'; end if;
    execute n;
  end if;
end $$;

create table if not exists public.qr_replacements (
  id uuid primary key default gen_random_uuid(), ref_no bigserial,
  company_id text not null, recruit_id uuid not null references public.qr_recruits(id), use_entry bigint not null references public.qr_ledger(id),
  quota_id uuid not null, country text not null, worker_id text,
  kind text not null check (kind in ('not_arrived','fomema_fail')),
  reason text not null, trigger_date date not null,                 -- the day it happened (did not arrive / FOMEMA result)
  fomema_file uuid references public.qr_files(id), repat_file uuid references public.qr_files(id), exit_id uuid references public.qr_exits(id),
  status text not null default 'to_apply' check (status in ('to_apply','applied','approval_uploaded','restored','refused','withdrawn')),
  applied_on date, imm_ref text, approval_file uuid references public.qr_files(id), approval_date date,
  uploaded_by uuid, uploaded_by_name text, uploaded_at timestamptz,
  verified_by uuid, verified_by_name text, verified_at timestamptz, ledger_id bigint,
  owner_id uuid, owner_name text, notes jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(), created_by_name text, created_at timestamptz not null default now(), closed_note text
);
create unique index if not exists qr_replacements_once on public.qr_replacements (recruit_id) where status not in ('refused','withdrawn');
alter table public.qr_replacements enable row level security;
drop policy if exists "qr read" on public.qr_replacements;
create policy "qr read" on public.qr_replacements for select to authenticated using (public.qr_scope(company_id));
revoke insert, update, delete, truncate on public.qr_replacements from anon, authenticated;

-- HR task meta for follow-ups: owner (reassign) and nudges. kind + ref identify the task (replacement | runaway | cmo | agent_doc | use_idle | una)
create table if not exists public.qr_task_meta (
  kind text not null, ref text not null, owner_id uuid, owner_name text, nudges jsonb not null default '[]'::jsonb, updated_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table public.qr_task_meta enable row level security;
drop policy if exists "qr read" on public.qr_task_meta;
create policy "qr read" on public.qr_task_meta for select to authenticated using (public.qr_rank() > 0);
revoke insert, update, delete, truncate on public.qr_task_meta from anon, authenticated;

create or replace function public.qr_hr_only() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if public.qr_rank() not in (1, 2) then raise exception 'HR Admin or HR Manager does this. The CEO and GM monitor it in HR follow-ups.' using errcode = '42501'; end if;
end $$;

create or replace function public.qr_repl_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; e bigint; nid uuid; k text := p->>'kind';
begin
  perform public.qr_hr_only();
  select * into r from public.qr_recruits where id = (p->>'recruit_id')::uuid;
  if r.id is null then raise exception 'Recruit not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  select l.id into e from public.qr_ledger l where l.recruit_id = r.id and l.kind = 'use' and not exists (select 1 from public.qr_ledger x where x.reverses = l.id) limit 1;
  if e is null then raise exception 'This slot is not Used (the VDR was never approved) — no replacement application is needed.'; end if;
  if coalesce(trim(p->>'reason'), '') = '' or p->>'trigger_date' is null then raise exception 'Give the reason and the date it happened.'; end if;
  if k = 'not_arrived' and r.arrived_at is not null then raise exception 'He arrived — use "FOMEMA fail" if the Malaysian medical failed.'; end if;
  if k = 'not_arrived' and not (r.status = 'dropped' and r.used_not_arrived) then raise exception 'First record that he will not arrive (End recruit, after VDR approval).'; end if;
  if k = 'fomema_fail' and r.arrived_at is null then raise exception 'FOMEMA fail applies only after arrival.'; end if;
  if k not in ('not_arrived','fomema_fail') then raise exception 'Replacement applications are only for FOMEMA fail or VDR approved but not arrived. Runaways are not replaceable.'; end if;
  insert into public.qr_replacements (company_id, recruit_id, use_entry, quota_id, country, worker_id, kind, reason, trigger_date, fomema_file, repat_file, exit_id, owner_id, owner_name, created_by_name)
  select r.company_id, r.id, e, l.quota_id, l.country, r.worker_id, k, p->>'reason', (p->>'trigger_date')::date, (p->>'fomema_file')::uuid, (p->>'repat_file')::uuid, (p->>'exit_id')::uuid,
    coalesce((p->>'owner_id')::uuid, auth.uid()), coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = (p->>'owner_id')::uuid), public.my_name()), public.my_name()
  from public.qr_ledger l where l.id = e returning id into nid;
  perform public.qr_event(r.company_id, 'Replacement application opened (' || case when k = 'fomema_fail' then 'FOMEMA fail' else 'did not arrive' end || ') — slot Pending cancellation', p->>'reason', p_recruit => r.id, p_batch => r.batch_id);
  perform public.audit('qr_repl_add', 'quota_replacement', nid::text, 'Replacement application for ' || r.full_name, p);
  return nid;
end $$;

-- HR steps: applied (date + ref) → approval uploaded (Immigration letter) → HR Admin verifies (not the uploader) → slot restored
create or replace function public.qr_repl_step(p_id uuid, p_step text, p jsonb default '{}'::jsonb) returns text language plpgsql security definer set search_path = public as $$
declare c public.qr_replacements; r public.qr_recruits; nid bigint;
begin
  select * into c from public.qr_replacements where id = p_id for update;
  if c.id is null then raise exception 'Replacement application not found.'; end if;
  perform public.qr_need(c.company_id, 1);
  perform public.qr_hr_only();
  select * into r from public.qr_recruits where id = c.recruit_id;
  if p_step = 'applied' then
    if c.status <> 'to_apply' then raise exception 'Already %.', c.status; end if;
    if p->>'applied_on' is null or coalesce(trim(p->>'imm_ref'), '') = '' then raise exception 'Enter the date applied and the Immigration reference.'; end if;
    update public.qr_replacements set status = 'applied', applied_on = (p->>'applied_on')::date, imm_ref = p->>'imm_ref' where id = c.id;
  elsif p_step = 'upload' then
    if c.status not in ('applied','approval_uploaded') then raise exception 'Apply to Immigration first.'; end if;
    if not exists (select 1 from public.qr_files f where f.id = (p->>'approval_file')::uuid and f.company_id = c.company_id) then raise exception 'Attach Immigration''s approval letter.'; end if;
    if c.kind = 'fomema_fail' and coalesce((p->>'fomema_file')::uuid, c.fomema_file) is null then raise exception 'Attach the FOMEMA unfit result.'; end if;
    if c.kind = 'fomema_fail' and coalesce((p->>'repat_file')::uuid, c.repat_file) is null and coalesce((p->>'exit_id')::uuid, c.exit_id) is null then
      raise exception 'Attach the repatriation proof or link his CMO.'; end if;
    update public.qr_replacements set status = 'approval_uploaded', approval_file = (p->>'approval_file')::uuid, approval_date = coalesce((p->>'approval_date')::date, current_date),
      fomema_file = coalesce((p->>'fomema_file')::uuid, fomema_file), repat_file = coalesce((p->>'repat_file')::uuid, repat_file), exit_id = coalesce((p->>'exit_id')::uuid, exit_id),
      uploaded_by = auth.uid(), uploaded_by_name = public.my_name(), uploaded_at = now() where id = c.id;
    perform public.qr_notify(c.company_id, array['hr_admin'], 'Verify Immigration approval: ' || r.full_name, 'Replacement application R-' || c.ref_no || ' — check the letter and verify.', 'quota?tab=exits&sub=repl', 'rpv|' || c.id);
  elsif p_step = 'verify' then
    if public.qr_rank() <> 2 then raise exception 'An HR Admin verifies the Immigration approval.' using errcode = '42501'; end if;
    if c.status <> 'approval_uploaded' then raise exception 'Nothing to verify (status %).', c.status; end if;
    if c.uploaded_by = auth.uid() then raise exception 'You uploaded this approval — another HR Admin verifies it.' using errcode = '42501'; end if;
    insert into public.qr_ledger (company_id, quota_id, country, kind, qty, ref, note, use_request_id, recruit_id, repl_id, by_name, by_role)
    select c.company_id, c.quota_id, c.country, 'imm_replacement', 1, c.imm_ref, 'Replacement approved by Immigration: ' || r.full_name || ' (R-' || c.ref_no || ')', l.use_request_id, r.id, c.id, public.my_name(), public.qr_role_label()
    from public.qr_ledger l where l.id = c.use_entry returning id into nid;
    update public.qr_replacements set status = 'restored', verified_by = auth.uid(), verified_by_name = public.my_name(), verified_at = now(), ledger_id = nid where id = c.id;
  elsif p_step in ('refused','withdrawn') then
    if c.status in ('restored','refused','withdrawn') then raise exception 'Already %.', c.status; end if;
    if coalesce(trim(p->>'note'), '') = '' then raise exception 'Give the reason.'; end if;
    update public.qr_replacements set status = p_step, closed_note = p->>'note' where id = c.id;
  else raise exception 'Unknown step %', p_step;
  end if;
  perform public.qr_event(c.company_id, 'Replacement application R-' || c.ref_no || ': ' || case p_step when 'applied' then 'applied to Immigration' when 'upload' then 'Immigration approval uploaded'
    when 'verify' then 'verified — slot restored to Available (Replacement approved by Immigration)' else p_step end, coalesce(p->>'imm_ref', p->>'note'), p_recruit => c.recruit_id);
  perform public.audit('qr_repl_' || p_step, 'quota_replacement', c.id::text, 'Replacement application R-' || c.ref_no || ' ' || p_step, p);
  return (select status from public.qr_replacements where id = c.id);
end $$;

/* ---------------- tally, master, stage counts (Reserved = approved, awaiting VDR; Used = VDR approved) ---------------- */
drop function if exists public.qr_master(text);
drop function if exists public.qr_tally(text);
create function public.qr_tally(p_company text default null) returns table (
  company_id text, quota_id uuid, ref_no text, kind text, expiry_date date, status text, country text,
  approved int, available int, reserved int, used int, lapsed int,
  active_workers int, in_pipeline int, exited_cmo int, exited_other int, runaways int, exited_unrecorded int,
  repl_eligible int, repl_applied int, repl_approved int, mismatch int,
  pending_cancel int, used_not_arrived int, imm_restored int
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
  -- recruits holding a USED slot that is not yet a worker: in the pipeline after VDR approval, or left without arriving (until Immigration restores it)
  uu as (select g.quota_id, g.country, r.id rid, r.status, r.used_not_arrived from public.qr_ledger g join public.qr_recruits r on r.id = g.recruit_id
      where g.kind = 'use' and not exists (select 1 from public.qr_ledger x where x.reverses = g.id)
        and not exists (select 1 from public.qr_ledger x where x.repl_id is not null and x.recruit_id = r.id)),
  pp as (select quota_id, country, count(*) filter (where status = 'active')::int n, count(*) filter (where status = 'dropped')::int una from uu group by 1, 2),
  rc as (select c.quota_id, c.country, count(*) filter (where c.status in ('to_apply','applied','approval_uploaded'))::int pend,
      count(*) filter (where c.status = 'restored')::int rest, count(*) filter (where c.status = 'restored' and c.kind = 'fomema_fail')::int rest_f
    from public.qr_replacements c group by 1, 2)
  select q.company_id, q.id, q.ref_no, q.kind, q.expiry_date, q.status, l.country,
    coalesce(l.appr, 0), coalesce(l.a, 0), coalesce(l.r, 0), coalesce(l.u, 0), coalesce(l.lp, 0),
    coalesce(wa.act, 0), coalesce(pp.n, 0), coalesce(l.cmo, 0), coalesce(l.oth, 0), coalesce(l.run, 0) + coalesce(wa.runrec, 0), coalesce(wa.unrec, 0),
    coalesce(l.el, 0), coalesce(l.cl, 0), coalesce(l.rp, 0),
    coalesce(l.u, 0) + coalesce(rc.rest_f, 0) - (coalesce(wa.act, 0) + coalesce(pp.n, 0) + coalesce(pp.una, 0) + coalesce(l.cmo, 0) + coalesce(l.oth, 0) + coalesce(l.run, 0) + coalesce(wa.runrec, 0) + coalesce(wa.unrec, 0)),
    coalesce(rc.pend, 0), coalesce(pp.una, 0), coalesce(rc.rest, 0)
  from q join l on l.quota_id = q.id
  left join wa on wa.qid = q.id::text and wa.ctry = l.country
  left join pp on pp.quota_id = q.id and pp.country = l.country
  left join rc on rc.quota_id = q.id and rc.country = l.country
  order by q.company_id, q.approval_date, l.country
$$;
revoke execute on function public.qr_tally(text) from public, anon;
grant execute on function public.qr_tally(text) to authenticated;

create function public.qr_master(p_company text default null) returns table (
  level text, company_id text, sector text, quota_id uuid, ref_no text, expiry_date date, days_left int, letters int,
  approved int, reserved int, used int, available int, lapsed int, expiring_unused int, runaways int, active_workers int,
  pending_cancel int, used_not_arrived int, in_pipeline int
) language sql stable security definer set search_path = public as $$
  with t as (select * from public.qr_tally(p_company)),
  per as (
    select t.company_id, coalesce(nullif(q.sector, ''), 'Unspecified') sector, t.quota_id, t.ref_no, t.expiry_date, (t.expiry_date - current_date) dl,
      sum(t.approved)::int appr, sum(t.reserved)::int resv, sum(t.used)::int used, sum(t.available)::int avail, sum(t.lapsed)::int lps,
      sum(t.runaways)::int run, sum(t.active_workers)::int act, sum(t.pending_cancel)::int pc, sum(t.used_not_arrived)::int una, sum(t.in_pipeline)::int pip
    from t join public.qr_quotas q on q.id = t.quota_id group by 1, 2, 3, 4, 5),
  r as (select (select expiry_amber_days from public.qr_rules where id = 1) amber)
  select case when grouping(per.company_id) = 0 and grouping(per.quota_id) = 0 then 'letter' when grouping(per.company_id) = 0 then 'company'
              when grouping(per.sector) = 0 then 'sector' else 'total' end,
    per.company_id, case when grouping(per.sector) = 0 then per.sector else string_agg(distinct per.sector, ', ') end,
    per.quota_id, per.ref_no, per.expiry_date,
    min(per.dl) filter (where per.avail > 0)::int, count(*)::int,
    coalesce(sum(per.appr), 0)::int, coalesce(sum(per.resv), 0)::int, coalesce(sum(per.used), 0)::int, coalesce(sum(per.avail), 0)::int, coalesce(sum(per.lps), 0)::int,
    coalesce(sum(per.avail) filter (where per.dl is not null and per.dl <= (select amber from r)), 0)::int,
    coalesce(sum(per.run), 0)::int, coalesce(sum(per.act), 0)::int, coalesce(sum(per.pc), 0)::int, coalesce(sum(per.una), 0)::int, coalesce(sum(per.pip), 0)::int
  from per
  group by grouping sets ((per.company_id, per.sector, per.quota_id, per.ref_no, per.expiry_date), (per.company_id), (per.sector), ())
$$;
revoke execute on function public.qr_master(text) from public, anon;
grant execute on function public.qr_master(text) to authenticated;

create or replace function public.qr_stage_counts(p_company text default null) returns table (company_id text, stage text, n int)
language sql stable security definer set search_path = public as $$
  select r.company_id, r.stage, count(*)::int from public.qr_recruits r
  where r.status = 'active' and public.qr_scope(r.company_id) and (p_company is null or r.company_id = p_company) group by 1, 2
$$;

/* ---------------- HR follow-ups: HR does it, CEO / GM monitor (nudge, reassign) ---------------- */
create or replace function public.qr_followups_core(p_all boolean) returns table (
  kind text, ref text, company_id text, title text, step text, owner_id uuid, owner_name text, started date, due date, days_late int, link text, nudges int
) language sql stable security definer set search_path = public as $$
  with ru as (select * from public.qr_rules where id = 1),
  raw as (
    -- replacement applications (Immigration)
    select 'replacement'::text kind, c.id::text ref, c.company_id, 'Replacement application R-' || c.ref_no || ': ' || r.full_name title,
      case c.status when 'to_apply' then 'Apply to Immigration' when 'applied' then 'Chase Immigration for the approval' else 'HR Admin to verify the approval' end step,
      case when c.status = 'approval_uploaded' then null else c.owner_id end def_owner, case when c.status = 'approval_uploaded' then 'HR Admin' else c.owner_name end def_name,
      c.trigger_date started,
      case c.status when 'to_apply' then c.trigger_date + ru.repl_apply_days when 'applied' then c.applied_on + ru.repl_chase_days else c.uploaded_at::date + ru.verify_days end due,
      'quota?tab=exits&sub=repl&id=' || c.id link
    from public.qr_replacements c join public.qr_recruits r on r.id = c.recruit_id, ru where c.status in ('to_apply','applied','approval_uploaded')
    union all
    -- runaway reports (police + Immigration eRUNAWAY) within the deadline
    select 'runaway', x.id::text, x.company_id, 'Runaway report: ' || x.worker_name,
      case when x.police_report_no is null and x.imm_ref is null then 'Police report and Immigration (eRUNAWAY) report' when x.imm_ref is null then 'Immigration (eRUNAWAY) report' else 'Police report' end,
      x.created_by, x.created_by_name, x.last_seen, x.last_seen + ru.runaway_report_days, 'quota?tab=exits&run=' || x.id
    from public.qr_runaways x, ru where x.outcome = 'open' and (x.imm_ref is null or x.police_report_no is null)
    union all
    -- CMO not uploaded for a worker who left
    select 'cmo', w.id, w.data->>'companyId', 'CMO not uploaded: ' || coalesce(w.data->>'fullName', w.id) || coalesce(' (' || (w.data->>'workerNo') || ')', ''), 'Upload the Check Out Memo',
      null, 'HR (unassigned)', coalesce(nullif(w.data->>'exitDate', '')::date, w.server_ts::date), coalesce(nullif(w.data->>'exitDate', '')::date, w.server_ts::date) + ru.cmo_missing_days, 'quota?tab=exits&newexit=' || w.id
    from public.records w, ru where w.entity = 'workers' and not w.deleted and w.data->>'quotaId' is not null
      and w.data->>'status' in ('Resigned','Terminated','Contract Ended','Repatriated')
      and not exists (select 1 from public.qr_exits x where x.worker_id = w.id and x.status <> 'void')
    union all
    -- used, not arrived, and no replacement application yet
    select 'una', r.id::text, r.company_id, 'Used, not arrived: ' || r.full_name, 'Decide: apply to Immigration for a replacement', r.owner_id, null,
      r.out_at::date, r.out_at::date + ru.repl_apply_days, 'quota/recruit/' || r.id
    from public.qr_recruits r, ru where r.status = 'dropped' and r.used_not_arrived
      and not exists (select 1 from public.qr_replacements c where c.recruit_id = r.id and c.status not in ('withdrawn'))
    union all
    -- agent uploads waiting for HR to accept / reject
    select 'agent_doc', a.id::text, a.company_id, 'Verify agent upload: ' || a.kind || ' — ' || r.full_name, 'Accept or reject the upload', null, 'HR', a.submitted_at::date,
      a.submitted_at::date + ru.verify_days, 'quota?tab=agents&sub=verify'
    from public.qr_agent_docs a join public.qr_recruits r on r.id = a.recruit_id, ru where a.status = 'submitted'
    union all
    -- approved request idle: reserved slots and no calling visa progress
    select 'use_idle', u.id::text, u.company_id, 'Q-' || u.ref_no || ': approved, slots still reserved', 'Apply the calling visas or release the slots', u.requested_by, u.requested_by_name,
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
create or replace function public.qr_followups() returns table (
  kind text, ref text, company_id text, title text, step text, owner_id uuid, owner_name text, started date, due date, days_late int, link text, nudges int
) language sql stable security definer set search_path = public as $$ select * from public.qr_followups_core(false) $$;

create or replace function public.qr_task_nudge(p_kind text, p_ref text, p_note text default null) returns void language plpgsql security definer set search_path = public as $$
declare f record; app text := coalesce(nullif(public.cfg('notifications')->>'appUrl', ''), 'https://fw.sunrisebayumas.com/');
begin
  if public.qr_rank() < 3 then raise exception 'The CEO or GM nudges HR follow-ups.' using errcode = '42501'; end if;
  select * into f from public.qr_followups() x where x.kind = p_kind and x.ref = p_ref;
  if f.kind is null then raise exception 'This follow-up is closed.'; end if;
  insert into public.qr_task_meta (kind, ref, nudges) values (p_kind, p_ref, jsonb_build_array(jsonb_build_object('at', now(), 'by', public.my_name(), 'note', p_note)))
  on conflict (kind, ref) do update set nudges = qr_task_meta.nudges || excluded.nudges, updated_at = now();
  if f.owner_id is not null then
    insert into public.notification_deliveries (event, user_id, recipient, channel, title, body, link, critical, status, sent_at, dedupe_key)
    values ('quota', f.owner_id, f.owner_name, 'in_app', 'Reminder from ' || public.qr_role_label() || ': ' || f.title, coalesce(p_note, f.step), app || '#/' || f.link, true, 'sent', now(),
      'qr|nudge|' || p_kind || '|' || p_ref || '|' || extract(epoch from now())::bigint);
  else
    perform public.qr_notify(f.company_id, array['hr_admin','hr_manager'], 'Reminder from ' || public.qr_role_label() || ': ' || f.title, coalesce(p_note, f.step), f.link, 'nudge|' || p_kind || '|' || p_ref || '|' || extract(epoch from now())::bigint, true);
  end if;
  perform public.audit('qr_task_nudge', 'quota_task', p_kind || ':' || p_ref, 'Nudged ' || f.owner_name || ': ' || f.title, jsonb_build_object('note', p_note));
end $$;
create or replace function public.qr_task_reassign(p_kind text, p_ref text, p_owner uuid) returns void language plpgsql security definer set search_path = public as $$
declare f record; o record;
begin
  if public.qr_rank() < 3 then raise exception 'The CEO or GM reassigns HR follow-ups.' using errcode = '42501'; end if;
  select * into f from public.qr_followups() x where x.kind = p_kind and x.ref = p_ref;
  if f.kind is null then raise exception 'This follow-up is closed.'; end if;
  select id, role, coalesce(nullif(full_name, ''), email) n, company_ids into o from public.profiles where id = p_owner and status = 'active';
  if o.id is null or o.role not in ('hr_admin','hr_manager') then raise exception 'Assign it to an HR Admin or HR Manager.'; end if;
  if coalesce(cardinality(o.company_ids), 0) > 0 and not (f.company_id = any(o.company_ids)) then raise exception '% does not cover this company.', o.n; end if;
  insert into public.qr_task_meta (kind, ref, owner_id, owner_name) values (p_kind, p_ref, o.id, o.n)
  on conflict (kind, ref) do update set owner_id = excluded.owner_id, owner_name = excluded.owner_name, updated_at = now();
  if p_kind = 'replacement' then update public.qr_replacements set owner_id = o.id, owner_name = o.n where id = p_ref::uuid; end if;
  perform public.qr_notify(f.company_id, array['hr_admin','hr_manager'], 'Assigned to ' || o.n || ': ' || f.title, f.step, f.link, 'reassign|' || p_kind || '|' || p_ref || '|' || o.id);
  perform public.audit('qr_task_reassign', 'quota_task', p_kind || ':' || p_ref, f.title || ' reassigned to ' || o.n, null);
end $$;
-- daily sweep (service role / daily-alerts): overdue → the owner; overdue more than escalate_days → GM and CEO. One message per task per day.
create or replace function public.qr_followups_sweep() returns int language plpgsql security definer set search_path = public as $$
declare f record; n int := 0; esc int := (select escalate_days from public.qr_rules where id = 1); app text := coalesce(nullif(public.cfg('notifications')->>'appUrl', ''), 'https://fw.sunrisebayumas.com/');
begin
  for f in select * from public.qr_followups_core(true) x where x.days_late > 0 loop
    if f.owner_id is not null then
      insert into public.notification_deliveries (event, user_id, recipient, channel, title, body, link, critical, status, sent_at, dedupe_key)
      values ('quota', f.owner_id, f.owner_name, 'in_app', 'Overdue ' || f.days_late || ' day(s): ' || f.title, f.step, app || '#/' || f.link, false, 'sent', now(), 'qr|due|' || f.kind || '|' || f.ref || '|' || current_date)
      on conflict (dedupe_key) do nothing;
    else
      perform public.qr_notify(f.company_id, array['hr_admin','hr_manager'], 'Overdue ' || f.days_late || ' day(s): ' || f.title, f.step, f.link, 'due|' || f.kind || '|' || f.ref || '|' || current_date);
    end if;
    if f.days_late > esc then
      perform public.qr_notify(f.company_id, array['super_admin','general_manager'], 'HR follow-up overdue ' || f.days_late || ' day(s): ' || f.title, 'Owner: ' || f.owner_name || '. ' || f.step, 'quota?tab=overview&sub=followups', 'esc|' || f.kind || '|' || f.ref || '|' || current_date, true);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.qr_followups_sweep() from public, anon, authenticated;
grant execute on function public.qr_followups_sweep() to service_role;

-- a used slot cannot be un-done by un-ticking the VDR gate
create or replace function public.qr_used_lock() returns trigger language plpgsql as $$
begin
  if coalesce((old.steps->'vdr_ok'->>'done')::boolean, false) and not coalesce((new.steps->'vdr_ok'->>'done')::boolean, false) then
    raise exception 'The calling visa is approved and the slot is used — this cannot be un-ticked.' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists qr_used_lock on public.qr_recruits;
create trigger qr_used_lock before update on public.qr_recruits for each row execute function public.qr_used_lock();

/* ---------------- alerts: add "used, not arrived" and overdue replacement applications ---------------- */
do $$ declare src text := pg_get_functiondef('public.qr_alerts()'::regprocedure); n text; begin
  if position('used_not_arrived' in src) = 0 then
    n := replace(src, 'and w.close_date - current_date <= ru.window_warn_days',
      'and w.close_date - current_date <= ru.window_warn_days
  union all
  -- 7. VDR approved (slot used) but he will not arrive, and HR has not opened a replacement application
  select ''amber'', ''used_not_arrived'', r.company_id, r.id::text,
    r.full_name || '': calling visa approved (slot USED) but he did not arrive — HR to apply to Immigration for a replacement'', ''quota/recruit/'' || r.id
  from public.qr_recruits r where r.status = ''dropped'' and r.used_not_arrived and public.qr_scope(r.company_id)
    and not exists (select 1 from public.qr_replacements c where c.recruit_id = r.id and c.status <> ''withdrawn'')
  union all
  -- 8. replacement application (Immigration) overdue
  select ''red'', ''replacement_overdue'', f.company_id, f.ref, f.title || '' — '' || f.step || '', '' || f.days_late || '' day(s) late (owner: '' || f.owner_name || '')'', f.link
  from public.qr_followups() f where f.kind = ''replacement'' and f.days_late > 0');
    n := replace(n, '|| '' slot(s) still not used — apply the calling visa or release them''', '|| '' slot(s) still reserved (awaiting calling visa approval) — move the recruits on or release the slots''');
    if n = src then raise exception '039: qr_alerts body not as expected'; end if;
    execute n;
  end if;
end $$;

/* ---------------- grants ---------------- */
do $$ declare f text; begin
  foreach f in array array['qr_recruit_docs(uuid,jsonb)','qr_stage_override(uuid,text,text)','qr_recruit_out(uuid,text,text)','qr_om_incoming()','qr_om_confirm(uuid,text)',
    'qr_repl_create(jsonb)','qr_repl_step(uuid,text,jsonb)','qr_followups()','qr_task_nudge(text,text,text)','qr_task_reassign(text,text,uuid)','qr_stage_counts(text)',
    'qr_pipeline_def(text,text)','qr_stage_label(text)'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  foreach f in array array['qr_step_done(public.qr_recruits,text)','qr_stage_of(public.qr_recruits)','qr_stage_idx(public.qr_recruits)','qr_hr_only()'] loop
    execute 'revoke execute on function public.' || f || ' from public, anon';
  end loop;
end $$;

-- existing recruits: recompute the stage under the new order (no data change)
update public.qr_recruits set stage = public.qr_stage_of(qr_recruits) where status in ('active','converted') and stage is distinct from public.qr_stage_of(qr_recruits);
