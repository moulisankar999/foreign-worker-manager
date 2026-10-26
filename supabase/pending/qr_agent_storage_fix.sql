-- FIX for v1.4.0 (038 "qr agent vdr read"): the storage policy read public.qr_agent_grants directly, but authenticated has no
-- grant on that table, so EVERY signed-in storage.objects read (documents, logos, manuals, quota files) failed with
-- 42501 "permission denied for table qr_agent_grants". Same rule, now checked through a SECURITY DEFINER helper.
-- Owner: quota module — fold into its next migration (042+) so a fresh install gets it after 038.
create or replace function public.qr_agent_has_grant(p_path text) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.qr_agent_grants g where g.user_id = auth.uid() and g.path = p_path and g.expires_at > now())
$$;
revoke all on function public.qr_agent_has_grant(text) from public, anon;
grant execute on function public.qr_agent_has_grant(text) to authenticated;
drop policy if exists "qr agent vdr read" on storage.objects;
create policy "qr agent vdr read" on storage.objects for select to authenticated using (bucket_id = 'quota-docs' and public.qr_agent_me() is not null
  and public.qr_agent_has_grant(name));
