-- 016 (v1.2.2): trackers & risk — hostel register, hiring tracker, tracker rules, zero-cost declaration
-- translations, worker grievance channel (public link / QR, anonymous allowed), PDPA breach log and
-- tighter limits on medical documents. Additive only: new tables, new functions, create-or-replace.

-- ---------------------------------------------------------------- pay data: the cost tracker is pay data
create or replace function public.salary_keys() returns text[] language sql immutable as $$
  select array['initialBasicPay','increments','allowances','bankName','bankAccount','loans','deductions',
               'payslips','minWageExempt','minWageExemptReason','hostelDeduction','costs']
$$;

-- ---------------------------------------------------------------- PDPA: medical documents are restricted
create or replace function public.is_medical_category(c text) returns boolean language sql immutable as $$
  select coalesce(c ~* '(medical|fomema|hospital|health)', false)
$$;
create or replace function public.is_restricted_category(c text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(c in (select jsonb_array_elements_text(public.cfg('vault')->'restricted')), false) or public.is_medical_category(c)
$$;

-- files attached to a worker's expiry documents: outlet managers / viewers cannot open FOMEMA / medical files
create or replace function public.storage_can_read(p_name text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare parts text[] := string_to_array(p_name, '/');
begin
  if not public.is_active_user() then return false; end if;
  if parts[1] = 'workers' and array_length(parts, 1) >= 2 then
    if public.my_role() in ('outlet_manager','viewer') and array_length(parts, 1) >= 4 and exists (
      select 1 from public.records r,
        lateral jsonb_array_elements(case when jsonb_typeof(r.data->'documents') = 'array' then r.data->'documents' else '[]'::jsonb end) d
      where r.entity = 'workers' and r.id = parts[2] and d->>'id' = parts[3] and public.is_medical_category(d->>'type')) then
      return false;
    end if;
    return public.can_see_worker(parts[2]);
  end if;
  if parts[1] = 'vault' then
    return exists (select 1 from public.documents d where d.file_path = p_name and public.can_see_document(d.worker_id, d.category));
  end if;
  return public.is_staff();
end $$;

-- ---------------------------------------------------------------- tracker settings (hostels, hiring, rules, translations)
create or replace function public.set_tracker_config(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r text := public.my_role();
begin
  if p_key is null or p_key not in ('hostels','hiring','trackers') then raise exception 'Unknown setting'; end if;
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  if p_key = 'trackers' then
    if not (r in ('super_admin','admin','hr_admin') or public.gm_can('compliance.settings')) then
      raise exception 'Only the CEO, HR Admin or a General Manager with the settings power can change these rules';
    end if;
  elsif not (r in ('super_admin','admin','hr_admin','hr_manager') or public.gm_can('compliance.settings')) then
    raise exception 'Only HR or the CEO can change this register';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' then raise exception 'Invalid value'; end if;
  if length(p_value::text) > 1000000 then raise exception 'Too large'; end if;
  insert into public.app_config (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.audit('update', 'config', p_key,
    case p_key when 'hostels' then 'Hostel register changed' when 'hiring' then 'Hiring tracker changed' else 'Tracker rules changed' end, null);
end $$;

-- translation of a printed form (the zero-cost recruitment declaration), like set_consent_translation
create or replace function public.set_form_translation(p_form text, p_lang text, p_text jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; cur jsonb;
begin
  if p_form is null or p_form not in ('zerocost') then raise exception 'Unknown form'; end if;
  if not (public.is_active_user() and (public.my_role() in ('super_admin','admin','hr_admin') or public.gm_can('compliance.settings'))) then
    raise exception 'Only the CEO, HR Admin or a General Manager can edit form translations';
  end if;
  if p_lang is null or p_lang !~ '^[a-z]{2,5}$' then raise exception 'Invalid language'; end if;
  k := p_form || '_translations';
  select value into cur from public.app_config where key = k;
  cur := coalesce(cur, '{}'::jsonb);
  if not (cur ? 'items') then cur := jsonb_set(cur, '{items}', '{}'::jsonb); end if;
  if p_text is null or jsonb_typeof(p_text) <> 'object' or p_text = '{}'::jsonb then
    cur := jsonb_set(cur, '{items}', (cur->'items') - p_lang);
  else
    if length(p_text::text) > 40000 then raise exception 'Too large'; end if;
    cur := jsonb_set(cur, array['items', p_lang], p_text || jsonb_build_object('updatedAt', now(), 'updatedBy', auth.uid()));
  end if;
  insert into public.app_config (key, value) values (k, cur)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.audit('update', 'config', k, 'Form translation changed: ' || p_form || ' / ' || p_lang, null);
end $$;

-- ---------------------------------------------------------------- grievance channel
create table if not exists public.grievance_links (
  company_id text primary key,
  token text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.grievance_links enable row level security;   -- no policies: only through the functions below

create table if not exists public.grievances (
  id uuid primary key default gen_random_uuid(),
  ref_no text not null unique,
  company_id text not null,
  outlet_id text,
  category text not null,
  message text not null,
  anonymous boolean not null default true,
  name text, contact text, worker_no text,
  language text,
  track_hash text not null,
  status text not null default 'new' check (status in ('new','in_review','action_taken','closed')),
  public_reply text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists grievances_company_idx on public.grievances (company_id, created_at desc);
create index if not exists grievances_hash_idx on public.grievances (track_hash);
alter table public.grievances enable row level security;

-- who can read grievances: CEO / admin / GM / HR Admin / HR Manager, for their companies (never outlet managers)
create or replace function public.can_see_grievance(p_company text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and public.my_role() in ('super_admin','admin','general_manager','hr_admin','hr_manager')
    and (public.is_unscoped() or p_company = any(public.my_companies())
      or exists (select 1 from public.records o where o.entity = 'outlets' and not o.deleted and o.id = any(public.my_outlets())
                 and coalesce(nullif(o.data->>'companyId', ''), 'main') = p_company))
$$;
drop policy if exists "grievances read" on public.grievances;
create policy "grievances read" on public.grievances for select to authenticated using (public.can_see_grievance(company_id));

create or replace function public.grievance_code() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
  from (select extensions.gen_random_bytes(10) b) x, generate_series(0, 9) i
$$;

-- public: what the link is for (company name + outlet list). No worker data.
create or replace function public.grievance_link_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare l public.grievance_links; cname text;
begin
  select * into l from public.grievance_links where token = p_token and enabled;
  if not found then return jsonb_build_object('ok', false); end if;
  select c->>'name' into cname from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) c where c->>'id' = l.company_id;
  return jsonb_build_object('ok', true, 'company', coalesce(cname, 'Company'),
    'outlets', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.data->>'name') order by o.data->>'name')
      from public.records o where o.entity = 'outlets' and not o.deleted and coalesce(nullif(o.data->>'companyId', ''), 'main') = l.company_id), '[]'::jsonb));
end $$;

-- public: submit a grievance. Anonymous allowed (name / contact dropped). Rate-limited per company link.
create or replace function public.submit_grievance(p_token text, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare l public.grievance_links; code text; ref text; anon boolean; msg text; cat text; outlet text;
begin
  select * into l from public.grievance_links where token = p_token and enabled;
  if not found then raise exception 'This link is not active. Ask HR for the current link.'; end if;
  if (select count(*) from public.grievances where company_id = l.company_id and created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.grievances where company_id = l.company_id and created_at > now() - interval '1 day') >= 100 then
    raise exception 'Too many reports right now. Please try again later.';
  end if;
  msg := btrim(coalesce(p->>'message', ''));
  if length(msg) < 10 then raise exception 'Please write a little more (at least 10 letters).'; end if;
  if length(msg) > 4000 then raise exception 'Message is too long (max 4000 letters).'; end if;
  cat := coalesce(p->>'category', 'other');
  if cat not in ('pay','hours','passport','housing','safety','harassment','fees','discrimination','other') then cat := 'other'; end if;
  outlet := nullif(p->>'outletId', '');
  if outlet is not null and not exists (select 1 from public.records o where o.entity = 'outlets' and not o.deleted and o.id = outlet
      and coalesce(nullif(o.data->>'companyId', ''), 'main') = l.company_id) then outlet := null; end if;
  anon := coalesce((p->>'anonymous')::boolean, true);
  code := public.grievance_code();
  ref := 'G-' || to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYMMDD') || '-' || substr(public.grievance_code(), 1, 4);
  insert into public.grievances (ref_no, company_id, outlet_id, category, message, anonymous, name, contact, worker_no, language, track_hash, history)
  values (ref, l.company_id, outlet, cat, msg, anon,
    case when anon then null else left(nullif(btrim(p->>'name'), ''), 120) end,
    case when anon then null else left(nullif(btrim(p->>'contact'), ''), 120) end,
    case when anon then null else left(nullif(btrim(p->>'workerNo'), ''), 40) end,
    left(nullif(p->>'language', ''), 10),
    encode(extensions.digest(code, 'sha256'), 'hex'),
    jsonb_build_array(jsonb_build_object('at', now(), 'status', 'new', 'by', 'Submitted')));
  return jsonb_build_object('ref', ref, 'code', code);
end $$;

-- public: check the status with the private tracking code
create or replace function public.grievance_status(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('ok', true, 'ref', g.ref_no, 'status', g.status, 'category', g.category,
      'submitted', g.created_at, 'updated', g.updated_at, 'reply', g.public_reply)
    from public.grievances g where g.track_hash = encode(extensions.digest(upper(btrim(coalesce(p_code, ''))), 'sha256'), 'hex') limit 1),
    jsonb_build_object('ok', false))
$$;

-- HR: get (or create / rotate / switch off) the company link
create or replace function public.get_grievance_link(p_company text, p_rotate boolean default false, p_enabled boolean default null) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare l public.grievance_links; mgr boolean;
begin
  if p_company is null or not public.can_see_grievance(p_company) then raise exception 'Not allowed'; end if;
  mgr := public.my_role() in ('super_admin','admin','hr_admin','general_manager');
  select * into l from public.grievance_links where company_id = p_company;
  if not found then
    if not mgr then return jsonb_build_object('ok', false, 'reason', 'Ask the CEO or HR Admin to create the link'); end if;
    insert into public.grievance_links (company_id, token, updated_by) values (p_company, lower(public.grievance_code()) || lower(public.grievance_code()), auth.uid()) returning * into l;
    perform public.audit('create', 'grievance_link', p_company, 'Grievance link created', null);
  elsif mgr and (p_rotate or (p_enabled is not null and p_enabled <> l.enabled)) then
    update public.grievance_links set
      token = case when p_rotate then lower(public.grievance_code()) || lower(public.grievance_code()) else token end,
      enabled = coalesce(p_enabled, enabled), updated_at = now(), updated_by = auth.uid()
    where company_id = p_company returning * into l;
    perform public.audit('update', 'grievance_link', p_company,
      case when p_rotate then 'Grievance link changed (old link stops working)' when l.enabled then 'Grievance link switched on' else 'Grievance link switched off' end, null);
  end if;
  return jsonb_build_object('ok', true, 'token', l.token, 'enabled', l.enabled, 'canManage', mgr);
end $$;

-- HR: move a grievance along (status, internal note, reply the worker sees with the tracking code)
create or replace function public.update_grievance(p_id uuid, p_status text, p_note text default null, p_reply text default null) returns void
language plpgsql volatile security definer set search_path = public as $$
declare g public.grievances; who text;
begin
  select * into g from public.grievances where id = p_id;
  if not found or not public.can_see_grievance(g.company_id) then raise exception 'Not allowed'; end if;
  if p_status not in ('new','in_review','action_taken','closed') then raise exception 'Invalid status'; end if;
  select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = auth.uid();
  update public.grievances set status = p_status,
    public_reply = case when p_reply is null then public_reply else left(nullif(btrim(p_reply), ''), 2000) end,
    history = history || jsonb_build_array(jsonb_build_object('at', now(), 'status', p_status, 'by', coalesce(who, 'HR'), 'note', left(nullif(btrim(coalesce(p_note, '')), ''), 2000))),
    updated_at = now(), updated_by = auth.uid()
  where id = p_id;
  perform public.audit('update', 'grievance', g.ref_no, 'Grievance ' || g.ref_no || ' → ' || p_status, null);
end $$;

-- ---------------------------------------------------------------- PDPA data breach log
create table if not exists public.pdpa_breaches (
  id uuid primary key default gen_random_uuid(),
  found_at date not null,
  occurred_at date,
  title text not null,
  description text,
  data_types text,
  people_affected integer,
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  actions text,
  commissioner_notified boolean not null default false,
  commissioner_notified_at date,
  people_notified boolean not null default false,
  people_notified_at date,
  status text not null default 'open' check (status in ('open','contained','closed')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.pdpa_breaches enable row level security;
create or replace function public.can_see_breaches() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (public.my_role() in ('super_admin','admin','hr_admin') or public.gm_can('compliance.settings'))
$$;
drop policy if exists "breaches read" on public.pdpa_breaches;
create policy "breaches read" on public.pdpa_breaches for select to authenticated using (public.can_see_breaches());

create or replace function public.save_breach(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; d date;
begin
  if not public.can_see_breaches() then raise exception 'Only the CEO, HR Admin or a General Manager can keep the breach log'; end if;
  if btrim(coalesce(p->>'title', '')) = '' then raise exception 'Title is required'; end if;
  d := coalesce(nullif(p->>'found_at', '')::date, current_date);
  if v_id is null or not exists (select 1 from public.pdpa_breaches where id = v_id) then
    insert into public.pdpa_breaches (found_at, occurred_at, title, description, data_types, people_affected, severity, actions,
      commissioner_notified, commissioner_notified_at, people_notified, people_notified_at, status, created_by, updated_by)
    values (d, nullif(p->>'occurred_at', '')::date, left(p->>'title', 200), left(p->>'description', 4000), left(p->>'data_types', 500),
      nullif(p->>'people_affected', '')::int, coalesce(nullif(p->>'severity', ''), 'medium'), left(p->>'actions', 4000),
      coalesce((p->>'commissioner_notified')::boolean, false), nullif(p->>'commissioner_notified_at', '')::date,
      coalesce((p->>'people_notified')::boolean, false), nullif(p->>'people_notified_at', '')::date,
      coalesce(nullif(p->>'status', ''), 'open'), auth.uid(), auth.uid())
    returning id into v_id;
    perform public.audit('create', 'pdpa_breach', v_id::text, 'Data breach logged', null);
  else
    update public.pdpa_breaches set found_at = d, occurred_at = nullif(p->>'occurred_at', '')::date, title = left(p->>'title', 200),
      description = left(p->>'description', 4000), data_types = left(p->>'data_types', 500), people_affected = nullif(p->>'people_affected', '')::int,
      severity = coalesce(nullif(p->>'severity', ''), 'medium'), actions = left(p->>'actions', 4000),
      commissioner_notified = coalesce((p->>'commissioner_notified')::boolean, false), commissioner_notified_at = nullif(p->>'commissioner_notified_at', '')::date,
      people_notified = coalesce((p->>'people_notified')::boolean, false), people_notified_at = nullif(p->>'people_notified_at', '')::date,
      status = coalesce(nullif(p->>'status', ''), 'open'), updated_at = now(), updated_by = auth.uid()
    where id = v_id;
    perform public.audit('update', 'pdpa_breach', v_id::text, 'Data breach log updated', null);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on public.grievance_links, public.grievances, public.pdpa_breaches from anon;
revoke insert, update, delete on public.grievance_links, public.grievances, public.pdpa_breaches from authenticated;
grant select on public.grievances, public.pdpa_breaches to authenticated;
do $$
declare f text;
begin
  foreach f in array array['set_tracker_config(text,jsonb)','set_form_translation(text,text,jsonb)','get_grievance_link(text,boolean,boolean)',
    'update_grievance(uuid,text,text,text)','save_breach(jsonb)','can_see_grievance(text)','can_see_breaches()','grievance_code()'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated, service_role';
  end loop;
  foreach f in array array['grievance_link_info(text)','submit_grievance(text,jsonb)','grievance_status(text)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to anon, authenticated, service_role';
  end loop;
end $$;
