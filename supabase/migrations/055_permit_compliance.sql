-- 1.6.4: permit-vs-outlet compliance (CEO only). Additive: new functions only; no table, column or row is changed.
-- A worker's "permit company" is the company that holds his KDN approval and calling visa. It comes from, in order:
--   1. the worker's own field  data->>'permitCompanyId'  (set in the worker form, Job step), else
--   2. the company of his KDN / quota approval letter  data->>'quotaId'  → qr_quotas.company_id, else
--   3. the "Employer named on the work permit" text  data->>'permitEmployer'  when it matches a company name, else unknown.
-- The compliance status and the report exist ONLY in permit_compliance(), which refuses everyone but the CEO.

create or replace function public.pc_norm(t text) returns text language sql immutable set search_path = public as $$
  select regexp_replace(regexp_replace(lower(coalesce(t, '')), '\m(sdn|bhd|berhad|sendirian|plt|enterprise|ent)\M', '', 'g'), '[^a-z0-9]', '', 'g')
$$;
-- "Services – F&B restaurant" → "services"; "Mining & quarrying" → "mining"
create or replace function public.pc_sector(t text) returns text language sql immutable set search_path = public as $$
  select nullif(lower(split_part(trim(split_part(split_part(coalesce(t, ''), '–', 1), ' - ', 1)), ' ', 1)), '')
$$;
revoke all on function public.pc_norm(text) from public, anon, authenticated;
revoke all on function public.pc_sector(text) from public, anon, authenticated;

create or replace function public.permit_compliance() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cos jsonb := coalesce(public.cfg('companies')->'items', '[]'::jsonb);
  ws jsonb; os jsonb;
begin
  if not coalesce(public.is_ceo(), false) then
    raise exception 'Only the CEO can open the permit compliance report.' using errcode = '42501';
  end if;

  with co as (
    select e->>'id' id, e->>'name' name, e->>'sector' sector, coalesce((e->>'demo')::boolean, false) or e->>'id' = 'demo-apple' demo
    from jsonb_array_elements(cos) e
  ), o as (
    select r.id, r.data->>'name' name, r.data->>'type' type, nullif(r.data->>'companyId', '') company_id
    from public.records r where r.entity = 'outlets' and not r.deleted
  ), w as (
    select r.id, r.data d from public.records r
    where r.entity = 'workers' and not r.deleted
      and coalesce(r.data->>'status', '') not in ('Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated', 'Deceased')
  ), x as (
    select w.id, w.d, o.id oid, o.name oname, o.type otype, o.company_id ocid, oc.name ocname, oc.sector ocsector, coalesce(oc.demo, false) demo,
      q.id qid, q.ref_no, q.sector qsector, q.subsector qsub, q.job_title qjob, q.company_id qcid,
      nullif(w.d->>'permitCompanyId', '') manual,
      (select c.id from co c where public.pc_norm(c.name) <> '' and public.pc_norm(c.name) = public.pc_norm(w.d->>'permitEmployer') limit 1) by_text
    from w
    left join o on o.id = w.d->>'outletId'
    left join co oc on oc.id = o.company_id
    left join public.qr_quotas q on q.id::text = nullif(w.d->>'quotaId', '')
  ), y as (
    select x.*, coalesce(manual, qcid, by_text) pcid,
      case when manual is not null then 'worker' when qcid is not null then 'kdn' when by_text is not null then 'permit_employer' else null end psrc,
      coalesce(qsector, nullif(d->>'permitSector', '')) ksector
    from x
  ), z as (
    select y.*, pc.name pcname,
      (public.pc_sector(ksector) is not null and public.pc_sector(ocsector) is not null and public.pc_sector(ksector) <> public.pc_sector(ocsector)) sector_bad,
      (coalesce(qjob, '') <> '' and coalesce(d->>'jobCategory', '') <> ''
        and position(public.pc_norm(qjob) in public.pc_norm(d->>'jobCategory')) = 0 and position(public.pc_norm(d->>'jobCategory') in public.pc_norm(qjob)) = 0) job_bad
    from y left join co pc on pc.id = y.pcid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'name', d->>'fullName', 'workerNo', d->>'workerNo', 'status', d->>'status', 'nationality', d->>'nationality',
      'job', d->>'jobCategory', 'business', coalesce(nullif(d->>'businessType', ''), otype),
      'outletId', oid, 'outlet', oname, 'outletType', otype, 'outletCompanyId', ocid, 'outletCompany', ocname, 'outletSector', ocsector,
      'permitCompanyId', pcid, 'permitCompany', coalesce(pcname, case when pcid is not null then pcid end), 'permitSource', psrc,
      'kdnId', qid, 'kdnRef', ref_no, 'kdnSector', ksector, 'kdnSubsector', qsub, 'kdnJob', qjob,
      'sectorMismatch', sector_bad, 'jobMismatch', job_bad, 'demo', demo,
      'status2', case when pcid is null then 'unknown' when ocid is distinct from pcid then 'mismatch' else 'compliant' end,
      'risk', case when pcid is null then 'needs_data'
                   when ocid is distinct from pcid then case when sector_bad or job_bad then 'critical' else 'high' end
                   when sector_bad or job_bad then 'medium' else 'ok' end
    ) order by oname nulls last, d->>'fullName'), '[]'::jsonb) into ws from z;

  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.data->>'name', 'type', o.data->>'type', 'companyId', nullif(o.data->>'companyId', ''),
      'company', (select e->>'name' from jsonb_array_elements(cos) e where e->>'id' = o.data->>'companyId'), 'state', o.data->>'state',
      'demo', coalesce(o.data->>'companyId' = 'demo-apple' or exists (select 1 from jsonb_array_elements(cos) e where e->>'id' = o.data->>'companyId' and coalesce((e->>'demo')::boolean, false)), false)) order by o.data->>'name'), '[]'::jsonb)
    into os from public.records o where o.entity = 'outlets' and not o.deleted;

  return jsonb_build_object('generatedAt', now(), 'workers', ws, 'outlets', os,
    'companies', (select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'name', e->>'name', 'sector', e->>'sector')), '[]'::jsonb) from jsonb_array_elements(cos) e));
end $$;
revoke all on function public.permit_compliance() from public, anon;
grant execute on function public.permit_compliance() to authenticated;
