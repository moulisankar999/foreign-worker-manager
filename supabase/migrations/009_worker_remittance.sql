-- v1.1.2: worker remittance details (stored in records.data->'remittance').
-- Strictly additive: new functions + one new trigger + pull_records re-created with an extra strip.
-- Visibility (PDPA): only Super Admin / HR Admin / HR Manager see or change remittance details.
-- Outlet managers and every other role never receive the key and cannot overwrite it.

create or replace function public.can_view_remittance() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin','admin','hr_admin','hr_manager','manager') and public.is_active_user(), false)
$$;
create or replace function public.remittance_keys() returns text[] language sql immutable as $$
  select array['remittance']
$$;
grant execute on function public.can_view_remittance() to authenticated;

-- BEFORE trigger (fires after records_lww, alphabetical): non-HR users can never set, change or wipe remittance.
create or replace function public.records_remit_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare k text; changed boolean := false;
begin
  if new.entity <> 'workers' or auth.uid() is null then return new; end if;
  if not public.can_view_remittance() then
    foreach k in array public.remittance_keys() loop
      if tg_op = 'UPDATE' and old.data ? k then new.data := jsonb_set(new.data, array[k], old.data->k);
      else new.data := new.data - k; end if;
    end loop;
  elsif tg_op = 'UPDATE' and not new.deleted then
    foreach k in array public.remittance_keys() loop
      if (old.data->k) is distinct from (new.data->k) then changed := true; end if;
    end loop;
    if changed then
      -- audit WITHOUT the values (account numbers are personal data)
      perform public.audit('worker.remittance_change', 'worker', new.id,
        coalesce(new.data->>'workerNo','') || ' ' || coalesce(new.data->>'fullName','') || ': remittance details updated', null);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists records_remit_guard on public.records;
create trigger records_remit_guard before insert or update on public.records for each row execute function public.records_remit_guard();

-- pull_records (same as 007) + remittance stripped for roles that may not see it.
create or replace function public.pull_records(p_since timestamptz, p_limit int default 500)
returns table (entity text, id text, data jsonb, deleted boolean, client_ts timestamptz, server_ts timestamptz)
language sql stable security definer set search_path = public as $$
  with me as (select public.my_role() as role, public.can_view_salary() as sal, public.is_unscoped() as allw,
                     public.my_outlets() as outs, public.my_companies() as comps, public.can_view_remittance() as rem)
  select r.entity, r.id,
    case when not v.vis then '{}'::jsonb
         when r.entity = 'workers' and not me.sal and not me.rem then r.data - public.salary_keys() - public.remittance_keys()
         when r.entity = 'workers' and not me.sal then r.data - public.salary_keys()
         when r.entity = 'workers' and not me.rem then r.data - public.remittance_keys()
         else r.data end,
    r.deleted or not v.vis, r.client_ts, r.server_ts
  from public.records r cross join me
  cross join lateral (select case
      when r.entity in ('workers','remarks') then me.allw or coalesce(public.scope_ok(me.role, me.comps, me.outs, public.worker_outlet(r.worker_id)), false)
      else true end as vis) v
  where me.role is not null and r.server_ts > p_since
  order by r.server_ts
  limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;
