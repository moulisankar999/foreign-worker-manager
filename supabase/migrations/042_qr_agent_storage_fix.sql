-- 042: fix for 038 "qr agent vdr read" storage policy (live outage since v1.4.0).
-- The policy read public.qr_agent_grants directly, but authenticated has no grant on it, so EVERY signed-in
-- storage.objects SELECT (documents, logos, manuals, quota files) failed with 42501. Same rule, checked via a
-- SECURITY DEFINER helper. Touches only qr_agent_has_grant() and the "qr agent vdr read" policy.
create or replace function public.qr_agent_has_grant(p_path text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.qr_agent_grants g where g.user_id = auth.uid() and g.path = p_path and g.expires_at > now())
$$;
revoke all on function public.qr_agent_has_grant(text) from public, anon;
grant execute on function public.qr_agent_has_grant(text) to authenticated;
drop policy if exists "qr agent vdr read" on storage.objects;
create policy "qr agent vdr read" on storage.objects for select to authenticated using (bucket_id = 'quota-docs' and public.qr_agent_me() is not null
  and public.qr_agent_has_grant(name));
