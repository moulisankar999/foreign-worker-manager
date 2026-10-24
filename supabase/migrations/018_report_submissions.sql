-- 018 (Reports): required printed report submissions — the CEO schedules reports that must be printed, signed by
-- HR Manager → HR Admin → General Manager → CEO and filed, on a routine (monthly / quarterly / half-yearly / yearly).
-- Additive only: two new tables, new functions, RLS. No existing object is changed.
-- NOTE: numbered 018 to follow 017_control_center (v1.3.0) — renumber at merge if needed.

create table if not exists public.report_schedules (
  id uuid primary key default gen_random_uuid(),
  report_id text not null,
  title text not null,
  frequency text not null default 'monthly' check (frequency in ('monthly','quarterly','half_yearly','yearly')),
  due_day int not null default 7 check (due_day between 1 and 28),
  company_id text,                       -- null = all companies
  filters jsonb not null default '{}'::jsonb,
  start_period text,                     -- first period that must be submitted (e.g. 2026-10, 2026-Q4, 2026-H2, 2026)
  notes text,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.report_submissions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.report_schedules(id) on delete cascade,
  period text not null,
  status text not null default 'pending',
  -- { generated|printed|prepared|verified|reviewed|approved|filed: { at, by, by_name, by_role, note } }
  steps jsonb not null default '{}'::jsonb,
  file_ref text,                         -- physical file / binder reference written when filed
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, period)
);
create index if not exists report_submissions_schedule_idx on public.report_submissions(schedule_id);

alter table public.report_schedules enable row level security;
alter table public.report_submissions enable row level security;

-- who sees a schedule: CEO / GM / HR Admin / HR Manager within their company scope (viewers and outlet managers do not)
create or replace function public.report_scope_ok(p_company text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_active_user() and public.my_role() in ('super_admin','admin','general_manager','hr_admin','hr_manager','manager')
    and (p_company is null or public.is_unscoped() or p_company = any(public.my_companies())
         or exists (select 1 from unnest(public.my_outlets()) o where public.outlet_company(o) = p_company)), false)
$$;

-- who may create / change schedules: the CEO, or a General Manager the CEO allowed compliance settings
create or replace function public.report_can_schedule() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_active_user() and (public.is_ceo() or public.gm_can('compliance.settings')), false)
$$;

drop policy if exists "report schedules read" on public.report_schedules;
create policy "report schedules read" on public.report_schedules for select using (public.report_scope_ok(company_id));
drop policy if exists "report submissions read" on public.report_submissions;
create policy "report submissions read" on public.report_submissions for select
  using (exists (select 1 from public.report_schedules s where s.id = schedule_id and public.report_scope_ok(s.company_id)));
-- no direct writes: everything goes through the functions below (audited)
revoke insert, update, delete on public.report_schedules, public.report_submissions from anon, authenticated;
grant select on public.report_schedules, public.report_submissions to authenticated;

-- create / update / deactivate a schedule
create or replace function public.save_report_schedule(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_old public.report_schedules;
begin
  if not public.report_can_schedule() then raise exception 'Only the CEO (or a General Manager with compliance settings power) can set required report submissions'; end if;
  if coalesce(p->>'report_id','') = '' or coalesce(p->>'title','') = '' then raise exception 'Report and title are required'; end if;
  if v_id is null then
    insert into public.report_schedules (report_id, title, frequency, due_day, company_id, filters, start_period, notes, active, created_by, created_by_name)
    values (p->>'report_id', p->>'title', coalesce(p->>'frequency','monthly'), coalesce((p->>'due_day')::int, 7), nullif(p->>'company_id',''),
            coalesce(p->'filters','{}'::jsonb), nullif(p->>'start_period',''), nullif(p->>'notes',''), coalesce((p->>'active')::boolean, true), auth.uid(), public.my_name())
    returning id into v_id;
    perform public.audit('report_schedule_create', 'report_schedule', v_id::text, 'Required submission: ' || (p->>'title') || ' (' || coalesce(p->>'frequency','monthly') || ')', p);
  else
    select * into v_old from public.report_schedules where id = v_id;
    if not found then raise exception 'Schedule not found'; end if;
    update public.report_schedules set
      report_id = coalesce(p->>'report_id', report_id), title = coalesce(p->>'title', title), frequency = coalesce(p->>'frequency', frequency),
      due_day = coalesce((p->>'due_day')::int, due_day), company_id = case when p ? 'company_id' then nullif(p->>'company_id','') else company_id end,
      filters = coalesce(p->'filters', filters), start_period = case when p ? 'start_period' then nullif(p->>'start_period','') else start_period end,
      notes = case when p ? 'notes' then nullif(p->>'notes','') else notes end, active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = v_id;
    perform public.audit('report_schedule_update', 'report_schedule', v_id::text, 'Required submission changed: ' || coalesce(p->>'title', v_old.title), p);
  end if;
  return v_id;
end $$;

create or replace function public.delete_report_schedule(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v public.report_schedules;
begin
  if not public.is_ceo() then raise exception 'Only the CEO can delete a required submission (switch it off instead)'; end if;
  select * into v from public.report_schedules where id = p_id;
  if not found then return; end if;
  delete from public.report_schedules where id = p_id;
  perform public.audit('report_schedule_delete', 'report_schedule', p_id::text, 'Required submission deleted: ' || v.title, to_jsonb(v));
end $$;

-- record one step of a submission. Order: generated → printed → prepared (HR Manager) → verified (HR Admin)
-- → reviewed (General Manager) → approved (CEO) → filed. A higher role may sign a lower level when that role is vacant;
-- nobody but the CEO may sign two consecutive signature levels (four-eyes check). 'reset' (CEO) starts the period again.
create or replace function public.report_submission_step(p_schedule uuid, p_period text, p_step text, p_note text default null, p_file_ref text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.report_schedules; sub public.report_submissions;
  r text := public.my_role(); rk int; need int; prev text; v_steps jsonb; ord text[] := array['generated','printed','prepared','verified','reviewed','approved','filed'];
  i int; entry jsonb;
begin
  if r = 'admin' then r := 'super_admin'; elsif r = 'manager' then r := 'hr_manager'; end if;
  rk := public.rank_of(r);
  select * into s from public.report_schedules where id = p_schedule;
  if not found or not public.report_scope_ok(s.company_id) then raise exception 'Not allowed for this report'; end if;
  if coalesce(p_period,'') !~ '^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]|H[12]))?$' then raise exception 'Bad period'; end if;
  insert into public.report_submissions (schedule_id, period) values (p_schedule, p_period) on conflict (schedule_id, period) do nothing;
  select * into sub from public.report_submissions where schedule_id = p_schedule and period = p_period for update;
  v_steps := sub.steps;

  if p_step = 'reset' then
    if r <> 'super_admin' then raise exception 'Only the CEO can reset a submission'; end if;
    update public.report_submissions set steps = '{}'::jsonb, status = 'pending', file_ref = null, updated_at = now() where id = sub.id;
    perform public.audit('report_submission_reset', 'report_submission', sub.id::text, s.title || ' ' || p_period || ' reset', jsonb_build_object('note', p_note, 'before', v_steps));
    return '{}'::jsonb;
  end if;

  i := array_position(ord, p_step);
  if i is null then raise exception 'Unknown step %', p_step; end if;
  need := case p_step when 'generated' then 1 when 'printed' then 1 when 'prepared' then 1 when 'verified' then 2 when 'reviewed' then 3 when 'approved' then 4 else 1 end;
  if p_step = 'approved' and r <> 'super_admin' then raise exception 'Only the CEO gives final approval'; end if;
  if rk < least(need, 3) then raise exception 'Your role cannot sign this level'; end if;
  if p_step = 'filed' and not (v_steps ? 'approved') then raise exception 'File the report only after CEO approval'; end if;
  if i > 2 then
    prev := ord[i - 1];
    if not (v_steps ? prev) then raise exception 'Previous step (%) is not done yet', prev; end if;
    if v_steps ? p_step and p_step <> 'filed' then raise exception 'Already signed'; end if;
    if r <> 'super_admin' and p_step in ('verified','reviewed') and (v_steps->prev->>'by') = auth.uid()::text then
      raise exception 'Another person must sign this level (you signed the previous one)';
    end if;
  end if;
  entry := jsonb_build_object('at', now(), 'by', auth.uid(), 'by_name', public.my_name(), 'by_role', r, 'note', nullif(p_note,''));
  v_steps := jsonb_set(v_steps, array[p_step], entry, true);
  update public.report_submissions set steps = v_steps,
    status = case when v_steps ? 'filed' then 'filed' when v_steps ? 'approved' then 'approved' when v_steps ? 'reviewed' then 'reviewed'
                  when v_steps ? 'verified' then 'verified' when v_steps ? 'prepared' then 'prepared' when v_steps ? 'printed' then 'printed' else 'generated' end,
    file_ref = coalesce(nullif(p_file_ref,''), file_ref), updated_at = now()
  where id = sub.id;
  if p_step not in ('generated') then
    perform public.audit('report_submission_' || p_step, 'report_submission', sub.id::text, s.title || ' ' || p_period || ': ' || p_step, entry || jsonb_build_object('file_ref', p_file_ref));
  end if;
  return v_steps;
end $$;

do $$
declare f text;
begin
  foreach f in array array['report_scope_ok(text)','report_can_schedule()','save_report_schedule(jsonb)','delete_report_schedule(uuid)','report_submission_step(uuid,text,text,text,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated, service_role';
  end loop;
end $$;
