-- 011 (v1.2.0): government agency links ("Check now") for Settings → Agencies & Integrations.
-- Additive & non-destructive: one new config row (only if missing) and one new function. No drops, no deletes.
-- Super Admin and HR Admin may edit the list (links must be https). Every change is audited.
-- No API keys are stored: the "API integration (future)" field is a disabled placeholder.
begin;

insert into public.app_config (key, value) values ('agencies', '{"items":[{"id":"imi-fomema","name":"Immigration — FOMEMA status check","short":"FOMEMA status (IMI)","icon":"🩺","url":"https://eservices.imi.gov.my/myimms/FomemaStatus?lang=en","enabled":true,"notes":"Check the worker’s FOMEMA medical result with the passport number and nationality.","copy":["passport","nationality"],"remindDays":30,"api":{"endpoint":"","enabled":false}},{"id":"imi-app","name":"Immigration — application status","short":"Application status (IMI)","icon":"🛂","url":"https://imigresen-online.imi.gov.my/eservices/main?pra","enabled":true,"notes":"Check a permit / pass application with the application or reference number.","copy":["application","passport"],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"imi-epass","name":"Immigration — ePass validity check","short":"ePass check (IMI)","icon":"🪪","url":"https://imigresen-online.imi.gov.my/eservices/checkEpassValid?semakan","enabled":true,"notes":"Check that the worker’s pass (PLKS) is valid.","copy":["passport","nationality","permit"],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"fwcms","name":"FWCMS (Foreign Worker Centralised Management System)","short":"FWCMS","icon":"🏛️","url":"https://fwcms.com.my/","enabled":true,"notes":"Employer login for PLKS renewals, levy and worker records.","copy":["passport","permit"],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"fomema","name":"FOMEMA employer portal (fomema2u)","short":"FOMEMA portal","icon":"🏥","url":"https://www.fomema2u.com.my/","enabled":true,"notes":"Register workers for the medical exam and see results.","copy":["passport","nationality"],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"eppax","name":"ePPAx (Immigration employer portal)","short":"ePPAx","icon":"🧾","url":"https://www.eppax.gov.my/eppax/login","enabled":true,"notes":"Employer portal for pass applications and payments.","copy":["passport","application"],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"akta446","name":"Act 446 portal (worker accommodation, JTKSM)","short":"Act 446 (housing)","icon":"🏠","url":"https://akta446.mohr.gov.my/login","enabled":true,"notes":"Certificate for Accommodation applications and records.","copy":[],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"myfuturejobs","name":"MYFutureJobs (job adverts before hiring)","short":"MYFutureJobs","icon":"📣","url":"https://myfuturejobs.gov.my/","enabled":true,"notes":"Advertise vacancies to locals before applying for foreign workers.","copy":[],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"perkeso","name":"PERKESO ASSIST (SOCSO employer portal)","short":"PERKESO","icon":"🛡️","url":"https://assist.perkeso.gov.my/","enabled":true,"notes":"Register workers and pay SOCSO contributions. The site may show a waiting-room queue at busy times.","copy":["passport","workerNo"],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"kwsp","name":"EPF i-Akaun Employer (KWSP)","short":"EPF (KWSP)","icon":"🏦","url":"https://secure.kwsp.gov.my/employer/employer/login","enabled":true,"notes":"Register workers and pay EPF contributions.","copy":["passport","workerNo"],"remindDays":0,"api":{"endpoint":"","enabled":false}},{"id":"spikpa","name":"SPIKPA (hospitalisation & surgical insurance)","short":"SPIKPA","icon":"💊","url":"https://spikpa.moh.gov.my/","enabled":true,"notes":"Check the worker’s SPIKPA insurance cover.","copy":["passport","nationality"],"remindDays":0,"api":{"endpoint":"","enabled":false}}]}'::jsonb)
on conflict (key) do nothing;

create or replace function public.set_agencies(p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a jsonb; items jsonb := '[]'::jsonb; n int := 0;
begin
  if not public.is_active_user() or coalesce(public.my_role(), '') not in ('super_admin','admin','hr_admin') then
    raise exception 'You are not allowed to change agency links' using errcode = '42501';
  end if;
  if p_value is null or jsonb_typeof(p_value->'items') is distinct from 'array' then raise exception 'Invalid agency list'; end if;
  if length(p_value::text) > 50000 then raise exception 'Agency list too long'; end if;
  for a in select * from jsonb_array_elements(p_value->'items') loop
    n := n + 1;
    if n > 60 then raise exception 'Too many agencies'; end if;
    if jsonb_typeof(a) <> 'object' or coalesce(a->>'id','') !~ '^[a-z0-9-]{2,40}$' then raise exception 'Invalid agency id'; end if;
    if coalesce(a->>'url','') !~* '^https://[^[:space:]]+$' then raise exception 'Agency link must start with https:// (%)', a->>'id'; end if;
    items := items || jsonb_build_array(jsonb_build_object(
      'id', a->>'id',
      'name', left(coalesce(a->>'name',''), 120),
      'short', left(coalesce(a->>'short',''), 60),
      'icon', left(coalesce(a->>'icon',''), 8),
      'url', left(a->>'url', 500),
      'enabled', coalesce((a->>'enabled')::boolean, true),
      'notes', left(coalesce(a->>'notes',''), 1000),
      'copy', case when jsonb_typeof(a->'copy') = 'array' then a->'copy' else '[]'::jsonb end,
      'remindDays', greatest(0, least(3650, coalesce((a->>'remindDays')::int, 0))),
      'api', jsonb_build_object('endpoint', left(coalesce(a->'api'->>'endpoint',''), 300), 'enabled', false)));
  end loop;
  insert into public.app_config (key, value) values ('agencies', jsonb_build_object('items', items))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.audit('update', 'agencies', 'agencies', 'Agency links changed (' || n || ' agencies)', null);
  return jsonb_build_object('items', items);
end $$;
revoke execute on function public.set_agencies(jsonb) from public, anon;
grant execute on function public.set_agencies(jsonb) to authenticated;

commit;
