-- Foreign Worker Manager: cloud schema (records + profiles + push), RLS, storage
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Profiles & roles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'viewer' check (role in ('admin','manager','viewer')),
  status text not null default 'pending' check (status in ('active','pending','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;
create or replace function public.is_active_user() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;
create or replace function public.can_write() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin','manager'), false)
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- first sign-up becomes active admin; others pending viewers
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(424242);
  if not exists (select 1 from public.profiles where role = 'admin' and status = 'active') then
    insert into public.profiles (id, email, full_name, role, status)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'admin', 'active');
  else
    insert into public.profiles (id, email, full_name, role, status)
    values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''), 'viewer', 'pending');
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- keep at least one active admin
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.id := old.id; new.email := old.email;
  if old.role = 'admin' and old.status = 'active' and (new.role <> 'admin' or new.status <> 'active') then
    if not exists (select 1 from public.profiles where role = 'admin' and status = 'active' and id <> old.id) then
      raise exception 'There must be at least one active admin';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

drop policy if exists "read own or admin reads all" on public.profiles;
create policy "read own or admin reads all" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "admin updates" on public.profiles;
create policy "admin updates" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin deletes" on public.profiles;
create policy "admin deletes" on public.profiles for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

-- ---------- Generic synced records (workers, outlets, jobs, settings) ----------
create table if not exists public.records (
  entity text not null check (entity in ('workers','outlets','jobs','settings')),
  id text not null,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  client_ts timestamptz not null default now(),
  server_ts timestamptz not null default clock_timestamp(),
  updated_by uuid default auth.uid(),
  primary key (entity, id)
);
create index if not exists records_server_ts_idx on public.records (server_ts);
alter table public.records enable row level security;
alter table public.records replica identity full;

-- last-write-wins by client timestamp; server_ts is the pull cursor
create or replace function public.records_lww() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.client_ts < old.client_ts then
    return null; -- older write loses
  end if;
  new.server_ts := clock_timestamp();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists records_lww on public.records;
create trigger records_lww before insert or update on public.records for each row execute function public.records_lww();

drop policy if exists "active users read" on public.records;
create policy "active users read" on public.records for select to authenticated using (public.is_active_user());
drop policy if exists "writers insert" on public.records;
create policy "writers insert" on public.records for insert to authenticated with check (public.can_write());
drop policy if exists "writers update" on public.records;
create policy "writers update" on public.records for update to authenticated using (public.can_write()) with check (public.can_write());
drop policy if exists "admin hard delete" on public.records;
create policy "admin hard delete" on public.records for delete to authenticated using (public.is_admin());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;

-- ---------- Push subscriptions & alert log ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subs" on public.push_subscriptions;
create policy "own subs" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active_user());

create table if not exists public.alert_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  digest text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, day, digest)
);
alter table public.alert_log enable row level security; -- no policies: service role only

-- ---------- Storage: private attachments bucket ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 10485760)
on conflict (id) do nothing;
drop policy if exists "fwm read attachments" on storage.objects;
create policy "fwm read attachments" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_active_user());
drop policy if exists "fwm write attachments" on storage.objects;
create policy "fwm write attachments" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.can_write());
drop policy if exists "fwm update attachments" on storage.objects;
create policy "fwm update attachments" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and public.can_write());
drop policy if exists "fwm delete attachments" on storage.objects;
create policy "fwm delete attachments" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.can_write());

grant usage on schema public to anon, authenticated;
revoke all on public.records, public.profiles, public.push_subscriptions, public.alert_log from anon;
