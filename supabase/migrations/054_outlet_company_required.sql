-- 1.6.2: every outlet must belong to a company (additive; existing rows are not changed).
-- Until now records_lww (013_ceo_gm.sql) silently filled a missing outlet companyId with the old copy's company,
-- the user's first company or the built-in 'main'. 'main' no longer exists on LIVE, so a missing company is now
-- refused instead. This trigger runs before records_lww (triggers fire in name order: records_a_… < records_lww),
-- so records_lww's 'main' fallback is never reached for a live (not deleted) outlet.
-- Deleted outlets (the app pushes them with empty data) are left to records_lww, which keeps the old company.
create or replace function public.records_outlet_company_required() returns trigger
language plpgsql security definer set search_path = public as $$
declare co text := nullif(trim(coalesce(new.data->>'companyId', '')), '');
begin
  if new.entity <> 'outlets' or coalesce(new.deleted, false) then return new; end if;
  if co is null then
    raise exception 'Choose the company this outlet belongs to.' using errcode = '23514';
  end if;
  -- a new outlet, a restored one, or a move to another company must name a company that exists
  if (tg_op = 'INSERT' or coalesce(old.deleted, false) or co is distinct from nullif(old.data->>'companyId', ''))
     and not exists (select 1 from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e where e->>'id' = co) then
    raise exception 'Company "%" was not found. Choose one of your companies for this outlet.', co using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.records_outlet_company_required() from public, anon, authenticated;

drop trigger if exists records_a_outlet_company on public.records;
create trigger records_a_outlet_company before insert or update on public.records
  for each row execute function public.records_outlet_company_required();
