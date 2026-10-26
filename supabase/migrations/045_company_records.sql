-- 045 (v1.4.2): company records — details, SSM documents, directors; who may create / see / delete companies.
-- Additive: new tables, functions, policies, one new private bucket and a guard trigger on app_config 'companies'.
--   create companies : CEO, GM; HR Admin and HR Manager when Settings › HR permissions allow it (default ON)
--   see details + SSM copies : CEO, GM, HR Admin, HR Manager (in their scope)
--   see directors' IC/passport numbers and copies in full : CEO, GM, HR Admin (HR Manager: masked to the last 4)
--   edit after creation : CEO, GM, HR Admin everything; HR Manager the basic fields only (company details)
--   delete companies, documents, directors : CEO and GM only
--   Outlet Manager / Viewer : company name and sector only (the app_config list)

-- ---------- role helpers
create or replace function public.co_in_scope(c text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_unscoped() or c = any(public.my_companies())
    or exists (select 1 from unnest(public.my_outlets()) o where public.outlet_company(o) = c), false)
$$;
create or replace function public.co_full(c text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_active_user() and (public.is_ceo() or public.is_gm() or (public.my_role() = 'hr_admin' and public.co_in_scope(c))), false)
$$;
create or replace function public.co_view(c text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.co_full(c) or (public.is_active_user() and public.my_role() = 'hr_manager' and public.co_in_scope(c)), false)
$$;
create or replace function public.co_can_delete() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_active_user() and (public.is_ceo() or public.is_gm()), false)
$$;
create or replace function public.co_can_create() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_active_user() and (public.is_ceo() or public.is_gm()
    or (public.my_role() = 'hr_admin' and coalesce((public.cfg('hr_admin')->>'createCompanies')::boolean, true))
    or (public.my_role() = 'hr_manager' and coalesce((public.cfg('hr_admin')->>'hrmCreateCompanies')::boolean, true))), false)
$$;
grant execute on function public.co_in_scope(text), public.co_full(text), public.co_view(text), public.co_can_delete(), public.co_can_create() to authenticated;

-- ---------- tables
create table if not exists public.company_details (
  company_id text primary key,
  ssm_new text, ssm_old text, incorporated_on date, reg_address text, biz_address text, sector text, phone text, email text, notes text,
  created_at timestamptz not null default now(), created_by_name text, updated_at timestamptz not null default now(), updated_by_name text
);
create table if not exists public.company_docs (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  doc_type text not null default 'other', title text, path text not null unique, name text, mime text, size bigint,
  uploaded_at timestamptz not null default now(), uploaded_by_name text, expiry_date date
);
create index if not exists company_docs_co on public.company_docs (company_id);
create table if not exists public.company_directors (
  id uuid primary key default gen_random_uuid(), company_id text not null,
  full_name text not null, id_type text not null default 'ic', id_no text, nationality text, designation text not null default 'director',
  email text, mobile text, id_file text,
  created_at timestamptz not null default now(), created_by_name text, updated_at timestamptz not null default now(), updated_by_name text
);
create index if not exists company_directors_co on public.company_directors (company_id);
alter table public.company_details enable row level security;
alter table public.company_docs enable row level security;
alter table public.company_directors enable row level security;
revoke all on public.company_details, public.company_docs, public.company_directors from anon;

-- ---------- validation (formats) — sample companies may use the clearly invalid placeholder IC 000000-00-0000..9999
create or replace function public.co_validate() returns trigger language plpgsql set search_path = public as $$
declare d text; m int; dd int;
begin
  if tg_table_name = 'company_directors' then
    new.full_name := trim(coalesce(new.full_name, ''));
    if new.full_name = '' then raise exception 'Enter the director''s full name.'; end if;
    if new.id_type not in ('ic','passport') then raise exception 'ID type must be IC or passport.'; end if;
    if new.designation not in ('director','shareholder','director_shareholder') then raise exception 'Designation must be director, shareholder or both.'; end if;
    if coalesce(trim(new.id_no), '') <> '' then
      if new.id_type = 'ic' then
        d := regexp_replace(new.id_no, '[\s-]', '', 'g');
        if d !~ '^\d{12}$' then raise exception 'IC number must be 12 digits (YYMMDD-PB-###G).'; end if;
        m := substr(d, 3, 2)::int; dd := substr(d, 5, 2)::int;
        if not (new.company_id like 'sample-%' and d like '000000%') and (m not between 1 and 12 or dd not between 1 and 31) then
          raise exception 'IC number must start with a valid date of birth (YYMMDD).'; end if;
        new.id_no := substr(d, 1, 6) || '-' || substr(d, 7, 2) || '-' || substr(d, 9, 4);
      else
        new.id_no := upper(regexp_replace(new.id_no, '\s', '', 'g'));
        if new.id_no !~ '^[A-Z0-9]{5,15}$' then raise exception 'Passport number must be 5–15 letters or digits.'; end if;
        if coalesce(trim(new.nationality), '') = '' then raise exception 'Give the nationality for a passport.'; end if;
      end if;
    end if;
    if new.id_type = 'ic' and coalesce(trim(new.nationality), '') = '' then new.nationality := 'Malaysia'; end if;
    if coalesce(trim(new.mobile), '') <> '' then
      new.mobile := regexp_replace(new.mobile, '[\s()-]', '', 'g');
      if new.mobile ~ '^0\d' then new.mobile := '+6' || new.mobile; elsif new.mobile ~ '^60\d' then new.mobile := '+' || new.mobile; end if;
      if new.mobile !~ '^\+60\d{8,10}$' then raise exception 'Mobile must be a Malaysian number like +60123456789.'; end if;
    end if;
    if coalesce(trim(new.email), '') <> '' then
      new.email := lower(trim(new.email));
      if new.email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Email address is not valid.'; end if;
    end if;
    new.updated_at := now(); new.updated_by_name := public.my_name();
  elsif tg_table_name = 'company_details' then
    if coalesce(trim(new.phone), '') <> '' then
      new.phone := regexp_replace(new.phone, '[\s()-]', '', 'g');
      if new.phone ~ '^0\d' then new.phone := '+6' || new.phone; elsif new.phone ~ '^60\d' then new.phone := '+' || new.phone; end if;
      if new.phone !~ '^\+60\d{8,10}$' then raise exception 'Phone must be a Malaysian number like +60312345678.'; end if;
    end if;
    if coalesce(trim(new.ssm_new), '') <> '' and regexp_replace(new.ssm_new, '\s', '', 'g') !~ '^\d{12}$' then raise exception 'SSM number (new format) must be 12 digits, e.g. 201901012345.'; end if;
    if coalesce(trim(new.ssm_old), '') <> '' and upper(regexp_replace(new.ssm_old, '\s', '', 'g')) !~ '^\d{1,7}-?[A-Z]$' then raise exception 'SSM number (old format) looks like 1234567-X.'; end if;
    new.ssm_new := nullif(regexp_replace(coalesce(new.ssm_new, ''), '\s', '', 'g'), ''); new.ssm_old := nullif(upper(regexp_replace(coalesce(new.ssm_old, ''), '\s', '', 'g')), '');
    if coalesce(trim(new.email), '') <> '' then
      new.email := lower(trim(new.email));
      if new.email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Email address is not valid.'; end if;
    end if;
    new.updated_at := now(); new.updated_by_name := public.my_name();
  elsif tg_table_name = 'company_docs' then
    if new.doc_type not in ('form9','form24','form49','einfo','profile','other') then raise exception 'Unknown SSM document type.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists co_validate on public.company_directors;
create trigger co_validate before insert or update on public.company_directors for each row execute function public.co_validate();
drop trigger if exists co_validate on public.company_details;
create trigger co_validate before insert or update on public.company_details for each row execute function public.co_validate();
drop trigger if exists co_validate on public.company_docs;
create trigger co_validate before insert or update on public.company_docs for each row execute function public.co_validate();

-- ---------- HR Manager edits only the basic fields after creation: company_details yes; directors / documents no (policies below)
-- ---------- audit (IC / passport numbers are never written to the audit log in full)
create or replace function public.co_mask(v text) returns text language sql immutable as $$
  select case when coalesce(v, '') = '' then null else '••••' || right(regexp_replace(v, '[^A-Za-z0-9]', '', 'g'), 4) end
$$;
create or replace function public.co_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old)); co text := r->>'company_id'; what text;
begin
  if r ? 'id_no' then r := r || jsonb_build_object('id_no', public.co_mask(r->>'id_no')); end if;
  what := case tg_table_name when 'company_directors' then 'director ' || coalesce(r->>'full_name', '') when 'company_docs' then 'SSM document ' || coalesce(r->>'doc_type', '') else 'company details' end;
  perform public.audit('company.' || replace(tg_table_name, 'company_', '') || '.' || lower(tg_op), 'company', co,
    initcap(lower(tg_op)) || ' ' || what || ' (' || co || ')', r - 'created_at' - 'updated_at');
  return null;
end $$;
drop trigger if exists co_audit on public.company_details;
create trigger co_audit after insert or update or delete on public.company_details for each row execute function public.co_audit();
drop trigger if exists co_audit on public.company_docs;
create trigger co_audit after insert or update or delete on public.company_docs for each row execute function public.co_audit();
drop trigger if exists co_audit on public.company_directors;
create trigger co_audit after insert or update or delete on public.company_directors for each row execute function public.co_audit();

-- ---------- row rules
drop policy if exists "co details read" on public.company_details;
create policy "co details read" on public.company_details for select to authenticated using (public.co_view(company_id));
drop policy if exists "co details add" on public.company_details;
create policy "co details add" on public.company_details for insert to authenticated with check (public.co_view(company_id));
drop policy if exists "co details edit" on public.company_details;
create policy "co details edit" on public.company_details for update to authenticated using (public.co_view(company_id)) with check (public.co_view(company_id));
drop policy if exists "co details delete" on public.company_details;
create policy "co details delete" on public.company_details for delete to authenticated using (public.co_can_delete());

drop policy if exists "co docs read" on public.company_docs;
create policy "co docs read" on public.company_docs for select to authenticated using (public.co_view(company_id));
drop policy if exists "co docs add" on public.company_docs;
create policy "co docs add" on public.company_docs for insert to authenticated with check (public.co_full(company_id) and split_part(path, '/', 1) = company_id);
drop policy if exists "co docs edit" on public.company_docs;
create policy "co docs edit" on public.company_docs for update to authenticated using (public.co_full(company_id)) with check (public.co_full(company_id) and split_part(path, '/', 1) = company_id);
drop policy if exists "co docs delete" on public.company_docs;
create policy "co docs delete" on public.company_docs for delete to authenticated using (public.co_can_delete());

-- directors: the table itself only for CEO / GM / HR Admin; everyone else who may see details reads company_directors_v (masked)
drop policy if exists "co directors read" on public.company_directors;
create policy "co directors read" on public.company_directors for select to authenticated using (public.co_full(company_id));
drop policy if exists "co directors add" on public.company_directors;
create policy "co directors add" on public.company_directors for insert to authenticated with check (public.co_full(company_id) and (id_file is null or split_part(id_file, '/', 1) = company_id));
drop policy if exists "co directors edit" on public.company_directors;
create policy "co directors edit" on public.company_directors for update to authenticated using (public.co_full(company_id)) with check (public.co_full(company_id) and (id_file is null or split_part(id_file, '/', 1) = company_id));
drop policy if exists "co directors delete" on public.company_directors;
create policy "co directors delete" on public.company_directors for delete to authenticated using (public.co_can_delete());
grant select, insert, update, delete on public.company_details, public.company_docs, public.company_directors to authenticated;

create or replace view public.company_directors_v with (security_invoker = false) as
  select d.id, d.company_id, d.full_name, d.id_type,
    case when public.co_full(d.company_id) then d.id_no else public.co_mask(d.id_no) end as id_no,
    d.nationality, d.designation, d.email, d.mobile,
    case when public.co_full(d.company_id) then d.id_file end as id_file,
    (d.id_file is not null) as has_id_file, public.co_full(d.company_id) as full_view,
    d.created_at, d.created_by_name, d.updated_at, d.updated_by_name
  from public.company_directors d where public.co_view(d.company_id);
revoke all on public.company_directors_v from anon;
grant select on public.company_directors_v to authenticated;

-- ---------- storage: private bucket company-docs
--   <company>/ssm/…        SSM copies   read: co_view   add: co_full
--   <company>/directors/…  IC/passport  read: co_full   add: co_full
--   staging/<uid>/…        uploads made while creating a company (write-only for the uploader; readable once linked to a row)
--   delete: CEO / GM only
insert into storage.buckets (id, name, public, file_size_limit) values ('company-docs', 'company-docs', false, 15728640) on conflict (id) do nothing;
create or replace function public.co_file_read(p text) returns boolean language sql stable security definer set search_path = public as $$
  select public.co_can_delete()  -- CEO / GM see everything in full (and must see a file to remove it)
      or exists (select 1 from public.company_docs d where d.path = p and public.co_view(d.company_id))
      or exists (select 1 from public.company_directors d where d.id_file = p and public.co_full(d.company_id))
      or (split_part(p, '/', 2) = 'ssm' and public.co_view(split_part(p, '/', 1)) and split_part(p, '/', 1) <> 'staging')
      or (split_part(p, '/', 2) = 'directors' and public.co_full(split_part(p, '/', 1)) and split_part(p, '/', 1) <> 'staging')
$$;
create or replace function public.co_file_add(p text) returns boolean language sql stable security definer set search_path = public as $$
  select case when split_part(p, '/', 1) = 'staging' then split_part(p, '/', 2) = auth.uid()::text and public.co_can_create()
              else split_part(p, '/', 2) in ('ssm','directors') and public.co_full(split_part(p, '/', 1)) end
$$;
grant execute on function public.co_file_read(text), public.co_file_add(text) to authenticated;
drop policy if exists "company docs read" on storage.objects;
create policy "company docs read" on storage.objects for select to authenticated using (bucket_id = 'company-docs' and public.co_file_read(name));
drop policy if exists "company docs add" on storage.objects;
create policy "company docs add" on storage.objects for insert to authenticated with check (bucket_id = 'company-docs' and public.co_file_add(name));
drop policy if exists "company docs remove" on storage.objects;
create policy "company docs remove" on storage.objects for delete to authenticated using (bucket_id = 'company-docs' and public.co_can_delete());

-- ---------- create a company (one call, all fields). HR Manager may write everything here, and afterwards sees the details
-- and SSM copies but directors' IC/passport only masked.
create or replace function public.company_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare v_name text := trim(coalesce(p->>'name', '')); v_id text; base text; i int := 2; items jsonb; d jsonb; x jsonb; nd int := 0; nf int := 0;
        me uuid := auth.uid(); v_claims text;
begin
  if not public.co_can_create() then raise exception 'You can''t create companies.' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'Enter the company name.'; end if;
  perform pg_advisory_xact_lock(hashtext('fwm.companies'));
  items := coalesce(public.cfg('companies')->'items', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(items) e where lower(e->>'name') = lower(v_name)) then raise exception 'A company with this name already exists.'; end if;
  base := left(trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g')), 24);
  if base = '' or base like 'sample-%' or base = 'staging' then base := 'company-' || coalesce(nullif(base, ''), 'new'); end if;
  if p->>'sample' = 'true' and auth.uid() is null then base := 'sample-' || base; end if;  -- seeding only (service role)
  v_id := base;
  while exists (select 1 from jsonb_array_elements(items) e where e->>'id' = v_id) loop v_id := base || '-' || i; i := i + 1; end loop;
  perform set_config('fwm.company_create', 'on', true);
  insert into public.app_config (key, value) values ('companies', jsonb_build_object('items', items || jsonb_strip_nulls(jsonb_build_object('id', v_id, 'name', v_name, 'sector', nullif(trim(coalesce(p->>'sector', '')), ''),
      'demo', case when p->>'sample' = 'true' and auth.uid() is null then true end, 'sample', case when p->>'sample' = 'true' and auth.uid() is null then true end))))
    on conflict (key) do update set value = jsonb_set(coalesce(app_config.value, '{}'::jsonb), '{items}', excluded.value->'items');
  perform set_config('fwm.company_create', 'off', true);
  d := coalesce(p->'details', '{}'::jsonb);
  insert into public.company_details (company_id, ssm_new, ssm_old, incorporated_on, reg_address, biz_address, sector, phone, email, notes, created_by_name)
  values (v_id, d->>'ssm_new', d->>'ssm_old', nullif(d->>'incorporated_on', '')::date, d->>'reg_address', d->>'biz_address', nullif(trim(coalesce(p->>'sector', '')), ''), d->>'phone', d->>'email', d->>'notes', public.my_name());
  for x in select * from jsonb_array_elements(coalesce(p->'docs', '[]'::jsonb)) loop
    if me is not null and split_part(x->>'path', '/', 1) || '/' || split_part(x->>'path', '/', 2) <> 'staging/' || me::text then raise exception 'Upload the SSM copy again.'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'company-docs' and o.name = x->>'path') then raise exception 'An SSM copy did not finish uploading — attach it again.'; end if;
    insert into public.company_docs (company_id, doc_type, title, path, name, mime, size, expiry_date, uploaded_by_name)
    values (v_id, coalesce(nullif(x->>'doc_type', ''), 'other'), x->>'title', x->>'path', x->>'name', x->>'mime', nullif(x->>'size', '')::bigint, nullif(x->>'expiry_date', '')::date, public.my_name());
    nf := nf + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'directors', '[]'::jsonb)) loop
    if coalesce(x->>'id_file', '') <> '' then
      if me is not null and split_part(x->>'id_file', '/', 1) || '/' || split_part(x->>'id_file', '/', 2) <> 'staging/' || me::text then raise exception 'Upload the IC / passport copy again.'; end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'company-docs' and o.name = x->>'id_file') then raise exception 'An IC / passport copy did not finish uploading — attach it again.'; end if;
    end if;
    insert into public.company_directors (company_id, full_name, id_type, id_no, nationality, designation, email, mobile, id_file, created_by_name)
    values (v_id, x->>'full_name', coalesce(nullif(x->>'id_type', ''), 'ic'), x->>'id_no', x->>'nationality', coalesce(nullif(x->>'designation', ''), 'director'), x->>'email', x->>'mobile', nullif(x->>'id_file', ''), public.my_name());
    nd := nd + 1;
  end loop;
  -- a creator limited to some companies gets the new company added to his scope (as the system: users cannot change their own scope)
  if me is not null and not public.is_unscoped() then
    v_claims := current_setting('request.jwt.claims', true);
    perform set_config('fwm.user_admin', 'on', true); perform set_config('request.jwt.claims', '', true);
    update public.profiles set company_ids = array_append(coalesce(company_ids, '{}'), v_id) where id = me and not (v_id = any(coalesce(company_ids, '{}')));
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true); perform set_config('fwm.user_admin', 'off', true);
  end if;
  perform public.audit('company.create', 'company', v_id, 'Company created: ' || v_name, jsonb_build_object('directors', nd, 'documents', nf, 'sector', p->>'sector'));
  return jsonb_build_object('id', v_id, 'name', v_name, 'directors', nd, 'documents', nf);
end $$;
revoke all on function public.company_create(jsonb) from public, anon;
grant execute on function public.company_create(jsonb) to authenticated;

-- HR Manager / HR Admin / GM / CEO: rename or change the sector (the basic fields) of a company they may see
create or replace function public.company_update_basic(p_id text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare items jsonb; v_name text := nullif(trim(coalesce(p->>'name', '')), '');
begin
  if not public.co_view(p_id) then raise exception 'You can''t change this company.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('fwm.companies'));
  items := coalesce(public.cfg('companies')->'items', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(items) e where e->>'id' = p_id) then raise exception 'Company not found.'; end if;
  if v_name is not null and exists (select 1 from jsonb_array_elements(items) e where lower(e->>'name') = lower(v_name) and e->>'id' <> p_id) then raise exception 'A company with this name already exists.'; end if;
  perform set_config('fwm.company_create', 'on', true);
  update public.app_config set value = jsonb_set(value, '{items}', (select jsonb_agg(case when e->>'id' = p_id then jsonb_strip_nulls(e || jsonb_build_object('name', coalesce(v_name, e->>'name'),
      'sector', case when p ? 'sector' then nullif(trim(coalesce(p->>'sector', '')), '') else e->>'sector' end)) else e end order by n) from jsonb_array_elements(items) with ordinality t(e, n)))
   where key = 'companies';
  perform set_config('fwm.company_create', 'off', true);
  if p ? 'sector' then update public.company_details set sector = nullif(trim(coalesce(p->>'sector', '')), '') where company_id = p_id; end if;
  perform public.audit('company.edit', 'company', p_id, 'Company basic details changed', p);
end $$;
revoke all on function public.company_update_basic(text, jsonb) from public, anon;
grant execute on function public.company_update_basic(text, jsonb) to authenticated;

-- delete a company: CEO / GM only, and only when nothing depends on it (outlets, workers, quota letters)
create or replace function public.company_blockers(p_id text) returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.records where entity = 'outlets' and not deleted and coalesce(nullif(data->>'companyId', ''), 'main') = p_id) then 'Move or remove its outlets first.'
    when exists (select 1 from public.records w where w.entity = 'workers' and not w.deleted and (w.data->>'companyId' = p_id
                   or public.outlet_company(nullif(w.data->>'outletId', '')) = p_id and nullif(w.data->>'outletId', '') is not null)) then 'It still has workers — move them to another company (or archive them) first.'
    when exists (select 1 from public.qr_quotas q where q.company_id = p_id) then 'It has quota approval letters on record — they must stay; the company cannot be deleted.'
  end
$$;
create or replace function public.company_delete(p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare items jsonb; why text; paths jsonb;
begin
  if not public.co_can_delete() then raise exception 'You can''t delete companies.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('fwm.companies'));
  items := coalesce(public.cfg('companies')->'items', '[]'::jsonb);
  if not exists (select 1 from jsonb_array_elements(items) e where e->>'id' = p_id) then raise exception 'Company not found.'; end if;
  if jsonb_array_length(items) <= 1 then raise exception 'Keep at least one company.'; end if;
  why := public.company_blockers(p_id);
  if why is not null then raise exception '%', why; end if;
  select coalesce(jsonb_agg(path), '[]'::jsonb) into paths from (select path from public.company_docs where company_id = p_id union all select id_file from public.company_directors where company_id = p_id and id_file is not null) t;
  delete from public.company_directors where company_id = p_id;
  delete from public.company_docs where company_id = p_id;
  delete from public.company_details where company_id = p_id;
  update public.app_config set value = jsonb_set(value, '{items}', (select coalesce(jsonb_agg(e order by n), '[]'::jsonb) from jsonb_array_elements(items) with ordinality t(e, n) where e->>'id' <> p_id)) where key = 'companies';
  perform public.audit('company.delete', 'company', p_id, 'Company deleted: ' || p_id, null);
  return jsonb_build_object('paths', paths);
end $$;
revoke all on function public.company_delete(text) from public, anon;
grant execute on function public.company_delete(text) to authenticated;

-- ---------- guard on direct writes to the company list (Settings saves the whole list): only CEO / GM remove a company, and only
-- without dependants; additions need the create permission. Server-side jobs (no signed-in user) and the RPCs above pass.
create or replace function public.companies_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare gone text; why text;
begin
  if new.key <> 'companies' or auth.uid() is null or coalesce(current_setting('fwm.company_create', true), '') = 'on'
     or coalesce(current_setting('fwm.sample_cleanup_cfg', true), '') = 'on' then return new; end if;
  for gone in select e->>'id' from jsonb_array_elements(coalesce(case when tg_op = 'UPDATE' then old.value end, '{}'::jsonb)->'items') e
              where not exists (select 1 from jsonb_array_elements(coalesce(new.value->'items', '[]'::jsonb)) n where n->>'id' = e->>'id') loop
    if not public.co_can_delete() then raise exception 'You can''t delete companies.' using errcode = '42501'; end if;
    why := public.company_blockers(gone);
    if why is not null then raise exception 'Company %: %', gone, why; end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(coalesce(new.value->'items', '[]'::jsonb)) n
             where not exists (select 1 from jsonb_array_elements(coalesce(case when tg_op = 'UPDATE' then old.value end, '{}'::jsonb)->'items') e where e->>'id' = n->>'id'))
     and not public.co_can_create() then raise exception 'You can''t create companies.' using errcode = '42501'; end if;
  return new;
end $$;
drop trigger if exists companies_guard on public.app_config;
create trigger companies_guard before insert or update on public.app_config for each row execute function public.companies_guard();

-- ---------- Remove sample data (044) also clears the sample companies' details, SSM copies and directors
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
    'company_directors', (select count(*) from public.company_directors where company_id like 'sample-%'),
    'company_docs', (select count(*) from public.company_docs where company_id like 'sample-%'),
    'company_details', (select count(*) from public.company_details where company_id like 'sample-%'),
    'claim_items', (select count(*) from public.qr_claim_items i join public.qr_claims c on c.id = i.claim_id where c.company_id like 'sample-%'),
    'workers', (select count(*) from public.records where entity = 'workers' and not deleted and coalesce(data->>'companyId', '') like 'sample-%'),
    'outlets', (select count(*) from public.records where entity = 'outlets' and not deleted and coalesce(data->>'companyId', '') like 'sample-%'),
    'companies', (select coalesce(jsonb_agg(e->>'name' order by e->>'name'), '[]'::jsonb) from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' like 'sample-%'),
    'hostels', (select count(*) from jsonb_array_elements(coalesce(public.cfg('hostels')->'items', '[]'::jsonb)) e where e->>'id' like 'sample-%'),
    'users', (select count(*) from public.profiles where id in (select public.sample_users()) and status <> 'deleted'),
    'files', (select count(*) from storage.objects where (bucket_id = 'quota-docs' and name like 'sample-%') or (bucket_id = 'attachments' and name like 'workers/sample-%') or (bucket_id = 'company-docs' and name like 'sample-%')),
    'total', (select count(*) from public.qr_quotas where company_id like 'sample-%')
           + (select count(*) from public.records where entity in ('workers','outlets') and not deleted and coalesce(data->>'companyId', '') like 'sample-%')
           + (select count(*) from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' like 'sample-%')
           + (select count(*) from storage.objects where (bucket_id = 'quota-docs' and name like 'sample-%') or (bucket_id = 'attachments' and name like 'workers/sample-%') or (bucket_id = 'company-docs' and name like 'sample-%')));
end $$;
revoke all on function public.sample_data_preview() from public, anon;
grant execute on function public.sample_data_preview() to authenticated;

create or replace function public.remove_sample_data(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare res jsonb := '{}'::jsonb; t text; n bigint; paths jsonb; att jsonb; cdocs jsonb;
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
  select coalesce(jsonb_agg(name order by name), '[]'::jsonb) into cdocs from storage.objects where bucket_id = 'company-docs' and name like 'sample-%';
  delete from public.company_directors where company_id like 'sample-%';
  get diagnostics n = row_count; res := res || jsonb_build_object('company_directors', n);
  delete from public.company_docs where company_id like 'sample-%';
  get diagnostics n = row_count; res := res || jsonb_build_object('company_docs', n);
  delete from public.company_details where company_id like 'sample-%';
  get diagnostics n = row_count; res := res || jsonb_build_object('company_details', n);
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
  return res || jsonb_build_object('paths', paths, 'attachments', att, 'company_files', cdocs);
end $$;
revoke all on function public.remove_sample_data(text) from public, anon;
grant execute on function public.remove_sample_data(text) to authenticated;
