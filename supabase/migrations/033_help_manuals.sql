-- 033: Help — role-based PDF user manuals in a PRIVATE bucket.
-- Each signed-in person can download only the manual for their own role (plus the FW Worker guide for staff who
-- hand it out). The CEO can read all. Files are uploaded by the release script with the service key; no app writes.
-- (031 is reserved for request assign/escalate on main.)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manuals', 'manuals', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.manual_file_for_role(r text) returns text language sql immutable as $$
  select case r
    when 'super_admin'     then 'fwm-manual-ceo.pdf'
    when 'general_manager' then 'fwm-manual-general-manager.pdf'
    when 'hr_admin'        then 'fwm-manual-hr-admin.pdf'
    when 'hr_manager'      then 'fwm-manual-hr-manager.pdf'
    when 'outlet_manager'  then 'fwm-manual-outlet-manager.pdf'
    else null end
$$;

create or replace function public.can_read_manual(obj text) returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.my_worker_id() is not null then obj = 'fw-worker-manual.pdf'
    when public.my_role() = 'super_admin' then true
    when public.my_role() in ('general_manager', 'hr_admin', 'hr_manager', 'outlet_manager')
      then obj = public.manual_file_for_role(public.my_role()) or obj = 'fw-worker-manual.pdf'
    else false end
$$;
revoke all on function public.can_read_manual(text) from public, anon;
grant execute on function public.can_read_manual(text) to authenticated;

drop policy if exists "fwm read manuals" on storage.objects;
create policy "fwm read manuals" on storage.objects for select to authenticated
  using (bucket_id = 'manuals' and public.can_read_manual(name));
-- no insert/update/delete policies: only the service role (release script) writes to this bucket.
