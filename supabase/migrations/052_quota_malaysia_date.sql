-- 052 (1.6.0): quota & recruitment server code works in the Malaysia business date.
-- current_date / ::date inside these functions used the database session zone (UTC), so between 00:00 and 08:00 MYT
-- "today" was still yesterday (rules effective today not yet in force, template pins on the old version, overrides refused).
-- Additive: only sets the function-level TimeZone; bodies are unchanged. Re-runnable.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'qr\_%' or p.proname in ('agent_vdr_grant', 'save_breach'))
      and (p.prosrc ilike '%current_date%' or p.prosrc ilike '%::date%' or p.prosrc ilike '%now()%')
  loop
    execute format('alter function %s set timezone to %L', r.sig, 'Asia/Kuala_Lumpur');
  end loop;
end $$;
