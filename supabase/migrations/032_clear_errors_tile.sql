-- v1.3.4: "Clear list" in Software Control → Errors also resets the "App errors (last 24 h)" tile right away.
-- Before, the rows were deleted but the tile (which feeds the Errors tab badge) kept the old count until the next
-- 30-minute health run, so the badge still showed the cleared errors. Replaces one function; no table changes.
create or replace function public.clear_client_errors() returns int language plpgsql security definer set search_path = public as $$
declare n int; e_n int;
begin
  if not public.is_ceo() then raise exception 'Only the CEO can do this' using errcode = '42501'; end if;
  delete from public.app_errors where id is not null; get diagnostics n = row_count;  -- WHERE needed (pg_safeupdate)
  select coalesce(sum(count), 0) into e_n from public.app_errors where last_seen > now() - interval '24 hours';
  perform public.health_record('app_errors', case when e_n >= 50 then 'red' when e_n >= 5 then 'amber' else 'green' end,
    'App errors (last 24 h)', e_n || ' error(s) reported by users'' devices in the last 24 hours.',
    case when e_n >= 5 then 'Open the Errors tab to see what failed and on which screen.' else 'Nothing to do.' end,
    'Software Control → Errors', jsonb_build_object('count24h', e_n, 'clearedAt', now()), 'db', 160);
  perform public.audit('control.clear_errors', 'app_errors', null, 'Error list cleared by the CEO (' || n || ' entries)', null);
  return n;
end $$;
revoke execute on function public.clear_client_errors() from public, anon;
grant execute on function public.clear_client_errors() to authenticated;
