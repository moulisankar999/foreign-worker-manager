-- 017 (v1.3.0): CEO-only "Software Control" — health monitor, client error log and the private system map.
-- Additive only: new tables, new functions, one new notification event, two new cron jobs.
-- Nothing here is readable by GM / HR / outlet managers: every table is RLS "CEO only" and has no client write policy.
-- The System Map CONTENT is NOT in this file (the repo is public); it is loaded separately into public.system_map.

-- ---------------------------------------------------------------- tables
create table if not exists public.health_checks (
  id bigint generated always as identity primary key,
  check_key text not null,
  status text not null check (status in ('green','amber','red','grey')),
  title text, summary text, advice text, area text,
  detail jsonb not null default '{}'::jsonb,
  source text,
  checked_at timestamptz not null default now()
);
create index if not exists health_checks_key_at on public.health_checks (check_key, checked_at desc);
alter table public.health_checks enable row level security;

create table if not exists public.health_latest (
  check_key text primary key,
  status text not null check (status in ('green','amber','red','grey')),
  title text, summary text, advice text, area text,
  detail jsonb not null default '{}'::jsonb,
  source text,
  sort int not null default 100,
  checked_at timestamptz not null default now(),
  changed_at timestamptz not null default now(),
  prev_status text
);
alter table public.health_latest enable row level security;

create table if not exists public.app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  count int not null default 1,
  user_id uuid, user_role text,
  kind text not null,
  message text not null,
  detail text, url text, app_version text, platform text, user_agent text,
  fingerprint text not null
);
create index if not exists app_errors_seen on public.app_errors (last_seen desc);
create index if not exists app_errors_fp on public.app_errors (fingerprint, last_seen desc);
alter table public.app_errors enable row level security;

create table if not exists public.system_map (
  key text primary key,
  sort int not null default 100,
  title text not null,
  content jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.system_map enable row level security;

drop policy if exists "ceo read" on public.health_checks;
create policy "ceo read" on public.health_checks for select to authenticated using (public.is_ceo());
drop policy if exists "ceo read" on public.health_latest;
create policy "ceo read" on public.health_latest for select to authenticated using (public.is_ceo());
drop policy if exists "ceo read" on public.app_errors;
create policy "ceo read" on public.app_errors for select to authenticated using (public.is_ceo());
drop policy if exists "ceo read" on public.system_map;
create policy "ceo read" on public.system_map for select to authenticated using (public.is_ceo());
revoke insert, update, delete, truncate on public.health_checks, public.health_latest, public.app_errors, public.system_map from anon, authenticated;
revoke select on public.health_checks, public.health_latest, public.app_errors, public.system_map from anon;

-- ---------------------------------------------------------------- CEO alerts stay CEO-only
-- Health alerts are written straight to the CEO's inbox / push / email queue (not through the shared notification
-- settings, which other admins can read). These restrictive policies hide them from anyone else who can read the log.
drop policy if exists "health alerts ceo only" on public.notification_events;
create policy "health alerts ceo only" on public.notification_events as restrictive for select using (event <> 'health_alert' or public.is_ceo());
drop policy if exists "health alerts ceo only" on public.notification_deliveries;
create policy "health alerts ceo only" on public.notification_deliveries as restrictive for select using (event <> 'health_alert' or public.is_ceo());

-- ---------------------------------------------------------------- record one result (server only: service role / cron / definer functions)
create or replace function public.health_record(p_key text, p_status text, p_title text, p_summary text, p_advice text,
  p_area text, p_detail jsonb default '{}'::jsonb, p_source text default 'db', p_sort int default null)
returns void language plpgsql security definer set search_path = public as $$
declare old text; rank_old int; rank_new int; ev bigint; app text; t text; b text; dk text; u record; n int := 0;
begin
  if p_status not in ('green','amber','red','grey') then raise exception 'bad status'; end if;
  insert into public.health_checks (check_key, status, title, summary, advice, area, detail, source)
  values (p_key, p_status, p_title, left(p_summary, 2000), left(p_advice, 2000), p_area, coalesce(p_detail, '{}'::jsonb), p_source);
  select status into old from public.health_latest where check_key = p_key;
  insert into public.health_latest as h (check_key, status, title, summary, advice, area, detail, source, sort, checked_at, changed_at, prev_status)
  values (p_key, p_status, p_title, left(p_summary, 2000), left(p_advice, 2000), p_area, coalesce(p_detail, '{}'::jsonb), p_source, coalesce(p_sort, 100), now(), now(), null)
  on conflict (check_key) do update set status = excluded.status, title = excluded.title, summary = excluded.summary,
    advice = excluded.advice, area = excluded.area, detail = excluded.detail, source = excluded.source,
    sort = coalesce(p_sort, h.sort), checked_at = now(),
    changed_at = case when h.status is distinct from excluded.status then now() else h.changed_at end,
    prev_status = case when h.status is distinct from excluded.status then h.status else h.prev_status end;
  -- keep 30 days of history
  delete from public.health_checks where check_key = p_key and checked_at < now() - interval '30 days';
  rank_old := case coalesce(old, 'green') when 'red' then 3 when 'amber' then 2 else 1 end;
  rank_new := case p_status when 'red' then 3 when 'amber' then 2 else 1 end;
  if rank_new > 1 and rank_new <> rank_old then
    app := coalesce(nullif(public.cfg('notifications')->>'appUrl', ''), 'https://fw.sunrisebayumas.com/') || '#/control';
    t := case p_status when 'red' then '🔴 ' else '🟠 ' end || coalesce(p_title, p_key) || case p_status when 'red' then ': needs action now' else ': needs attention soon' end;
    b := coalesce(p_summary, '') || ' Where: ' || coalesce(p_area, '-') || '. What to do: ' || coalesce(p_advice, '-');
    dk := 'health|' || p_key || '|' || p_status || '|' || to_char(now(), 'YYYYMMDDHH24MI');
    insert into public.notification_events (event, entity, entity_id, vars, dedupe_key)
    values ('health_alert', 'health', p_key, jsonb_build_object('status', p_status, 'title', p_title), dk)
    on conflict (dedupe_key) do nothing returning id into ev;
    if ev is not null then
      for u in select id, coalesce(nullif(full_name, ''), email) as name, email from public.profiles where role in ('super_admin','admin') and status = 'active' loop
        insert into public.notification_deliveries (event_id, event, user_id, recipient, channel, address, title, body, link, critical, status, last_error, sent_at, dedupe_key)
        select ev, 'health_alert', u.id, u.name, c.ch, case when c.ch = 'email' then u.email end, t, b, app, true,
          case when c.ch = 'in_app' then 'sent' when c.ch = 'email' and u.email is null then 'skipped' else 'queued' end,
          case when c.ch = 'email' and u.email is null then 'no email on profile' end,
          case when c.ch = 'in_app' then now() end, dk || '|' || u.id || '|' || c.ch
        from (values ('in_app'), ('push'), ('email')) c(ch)
        on conflict (dedupe_key) do nothing;
        n := n + 3;
      end loop;
      update public.notification_events set recipients = n where id = ev;
    end if;
  end if;
end $$;
revoke execute on function public.health_record(text, text, text, text, text, text, jsonb, text, int) from public, anon, authenticated;

-- a batch from the edge function / GitHub workflow: [{key,status,title,summary,advice,area,detail,sort}]
create or replace function public.health_record_many(p_items jsonb, p_source text) returns int
language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    perform public.health_record(it->>'key', it->>'status', it->>'title', it->>'summary', it->>'advice', it->>'area',
      coalesce(it->'detail', '{}'::jsonb), p_source, nullif(it->>'sort', '')::int);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.health_record_many(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- checks that run inside the database
create or replace function public.health_db_checks() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  db_bytes bigint; st_bytes bigint; db_lim bigint := 500 * 1024 * 1024; st_lim bigint := 1024 * 1024 * 1024; pct numeric;
  rows jsonb; j record; job jsonb := '[]'::jsonb; worst text := 'green'; subs int; p_sent int; p_fail int; bk timestamptz; days int;
  ren jsonb; r jsonb; d date; left_days int; s text; out jsonb := '[]'::jsonb; e_n int;
begin
  -- database size
  db_bytes := pg_database_size(current_database());
  pct := round(100.0 * db_bytes / db_lim, 1);
  perform public.health_record('db_size', case when pct >= 90 then 'red' when pct >= 70 then 'amber' else 'green' end,
    'Database space', pg_size_pretty(db_bytes) || ' of 500 MB used (' || pct || '%), ' || pg_size_pretty(greatest(db_lim - db_bytes, 0)) || ' left.',
    case when pct >= 70 then 'Delete old exports / audit history, or move to the Supabase Pro plan before it fills up.' else 'Nothing to do.' end,
    'Supabase → Database (free plan limit 500 MB)', jsonb_build_object('bytes', db_bytes, 'limit', db_lim, 'pct', pct), 'db', 40);
  -- storage size
  select coalesce(sum(nullif(metadata->>'size', '')::bigint), 0) into st_bytes from storage.objects;
  pct := round(100.0 * st_bytes / st_lim, 1);
  perform public.health_record('storage_size', case when pct >= 90 then 'red' when pct >= 70 then 'amber' else 'green' end,
    'File storage space', pg_size_pretty(st_bytes) || ' of 1 GB used (' || pct || '%), ' || pg_size_pretty(greatest(st_lim - st_bytes, 0)) || ' left.',
    case when pct >= 70 then 'Remove duplicate or old scans, or move to the Supabase Pro plan.' else 'Nothing to do.' end,
    'Supabase → Storage (free plan limit 1 GB)', jsonb_build_object('bytes', st_bytes, 'limit', st_lim, 'pct', pct), 'db', 50);
  -- row counts
  rows := jsonb_build_object(
    'workers', (select count(*) from public.records where entity = 'workers' and not deleted),
    'outlets', (select count(*) from public.records where entity = 'outlets' and not deleted),
    'jobs', (select count(*) from public.records where entity = 'jobs' and not deleted),
    'users', (select count(*) from public.profiles where status = 'active'),
    'requests', (select count(*) from public.requests),
    'documents', (select count(*) from public.documents),
    'notifications', (select count(*) from public.notification_deliveries),
    'audit_log', (select count(*) from public.audit_log));
  perform public.health_record('row_counts', 'green', 'Records in the database',
    (rows->>'workers') || ' workers, ' || (rows->>'users') || ' active users, ' || (rows->>'requests') || ' requests, ' || (rows->>'documents') || ' vault documents.',
    'Nothing to do — for information.', 'Supabase → Table editor', rows, 'db', 60);
  -- scheduled jobs (daily 08:00 alerts, notification sweep / dispatch)
  for j in select jb.jobname,
      (select d.status from cron.job_run_details d where d.jobid = jb.jobid order by d.start_time desc limit 1) as st,
      (select d.start_time from cron.job_run_details d where d.jobid = jb.jobid order by d.start_time desc limit 1) as at,
      (select left(d.return_message, 200) from cron.job_run_details d where d.jobid = jb.jobid order by d.start_time desc limit 1) as msg
    from cron.job jb where jb.jobname like 'fwm-%' and jb.jobname not like 'fwm-health%' loop
    job := job || jsonb_build_object('job', j.jobname, 'status', j.st, 'at', j.at, 'message', j.msg);
    if j.st = 'failed' then worst := 'red';
    elsif j.at is null or (j.jobname = 'fwm-daily-alerts' and j.at < now() - interval '26 hours')
       or (j.jobname like 'fwm-notify%' and j.at < now() - interval '30 minutes') then
      if worst = 'green' then worst := 'amber'; end if;
    end if;
  end loop;
  perform public.health_record('cron', worst, 'Scheduled jobs (daily alerts & notifications)',
    case worst when 'green' then 'All ' || jsonb_array_length(job) || ' scheduled jobs ran on time.'
      when 'red' then 'A scheduled job failed on its last run.' else 'A scheduled job has not run when expected.' end,
    case worst when 'green' then 'Nothing to do.' else 'Open Supabase → Integrations → Cron → job history to see the error; the daily 08:00 alerts and notification sending depend on these jobs.' end,
    'Supabase → Cron (pg_cron)', jsonb_build_object('jobs', job), 'db', 70);
  -- push notifications
  select count(*) into subs from public.push_subscriptions;
  select count(*) filter (where status = 'sent'), count(*) filter (where status = 'failed') into p_sent, p_fail
    from public.notification_deliveries where channel = 'push' and created_at > now() - interval '24 hours';
  perform public.health_record('push', case when p_fail > 0 and p_fail >= p_sent then 'red' when p_fail > 0 then 'amber' else 'green' end,
    'Push notifications', subs || ' device(s) signed up. Last 24 h: ' || p_sent || ' sent, ' || p_fail || ' failed.',
    case when p_fail > 0 then 'Some phones did not get alerts. Ask those users to open Settings → Phone alerts → Turn on phone alerts again.' else 'Nothing to do.' end,
    'Supabase → Edge Functions → notify-dispatch / daily-alerts', jsonb_build_object('subscriptions', subs, 'sent24h', p_sent, 'failed24h', p_fail), 'db', 80);
  -- last backup (recorded when the CEO / HR downloads "Backup" in Settings)
  bk := nullif(public.cfg('last_backup')->>'at', '')::timestamptz;
  days := case when bk is null then null else extract(day from now() - bk)::int end;
  perform public.health_record('backup', case when bk is null or days > 60 then 'red' when days > 30 then 'amber' else 'green' end,
    'Last backup', case when bk is null then 'No backup has been downloaded from the app yet.' else 'Last backup downloaded ' || days || ' day(s) ago (' || to_char(bk at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY') || ').' end,
    case when bk is null or days > 30 then 'Open Settings → Backup & data → Download backup and keep the file somewhere safe (Google Drive / OneDrive).' else 'Nothing to do.' end,
    'Settings → Backup & data', jsonb_build_object('at', bk, 'days', days), 'db', 150);
  -- client errors in the last 24 h
  select coalesce(sum(count), 0) into e_n from public.app_errors where last_seen > now() - interval '24 hours';
  perform public.health_record('app_errors', case when e_n >= 50 then 'red' when e_n >= 5 then 'amber' else 'green' end,
    'App errors (last 24 h)', e_n || ' error(s) reported by users'' devices in the last 24 hours.',
    case when e_n >= 5 then 'Open the Errors tab to see what failed and on which screen.' else 'Nothing to do.' end,
    'Software Control → Errors', jsonb_build_object('count24h', e_n), 'db', 160);
  -- renewal dates (from the private system map: content.renewals = [{key,title,date,where,advice}])
  select content->'renewals' into ren from public.system_map where key = 'renewals';
  for r in select * from jsonb_array_elements(coalesce(ren, '[]'::jsonb)) loop
    d := nullif(r->>'date', '')::date; if d is null then continue; end if;
    left_days := d - (now() at time zone 'Asia/Kuala_Lumpur')::date;
    s := case when left_days < 14 then 'red' when left_days < 60 then 'amber' else 'green' end;
    perform public.health_record('renew_' || (r->>'key'), s, r->>'title',
      case when left_days < 0 then 'Expired ' || -left_days || ' day(s) ago (' || to_char(d, 'DD Mon YYYY') || ').' else left_days || ' day(s) left — expires ' || to_char(d, 'DD Mon YYYY') || '.' end,
      case when s = 'green' then 'Nothing to do yet. ' || coalesce(r->>'advice', '') else coalesce(r->>'advice', 'Renew it now.') end,
      r->>'where', jsonb_build_object('date', d, 'days', left_days), 'db', coalesce(nullif(r->>'sort', '')::int, 200));
  end loop;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.health_db_checks() from public, anon, authenticated;

-- ---------------------------------------------------------------- client error log (any signed-in active user may ADD; only the CEO may READ)
create or replace function public.log_client_error(p_kind text, p_message text, p_detail text default null, p_url text default null,
  p_version text default null, p_platform text default null, p_agent text default null) returns void
language plpgsql security definer set search_path = public as $$
declare fp text; recent int; uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if not exists (select 1 from public.profiles where id = uid and status in ('active','pending')) then return; end if;
  select count(*) into recent from public.app_errors where user_id = uid and last_seen > now() - interval '1 hour';
  if recent >= 30 then return; end if; -- flood guard
  fp := md5(coalesce(p_kind, '') || '|' || left(coalesce(p_message, ''), 300) || '|' || coalesce(uid::text, ''));
  update public.app_errors set count = count + 1, last_seen = now(), url = left(p_url, 500), app_version = left(p_version, 20)
    where fingerprint = fp and last_seen > now() - interval '1 hour';
  if found then return; end if;
  insert into public.app_errors (user_id, user_role, kind, message, detail, url, app_version, platform, user_agent, fingerprint)
  values (uid, public.my_role(), left(coalesce(p_kind, 'error'), 40), left(coalesce(p_message, '(no message)'), 1000), left(p_detail, 4000),
    left(p_url, 500), left(p_version, 20), left(p_platform, 20), left(p_agent, 300), fp);
  delete from public.app_errors where last_seen < now() - interval '90 days';
end $$;
revoke execute on function public.log_client_error(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.log_client_error(text, text, text, text, text, text, text) to authenticated;

-- the CEO can clear the error list
create or replace function public.clear_client_errors() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_ceo() then raise exception 'Only the CEO can do this' using errcode = '42501'; end if;
  delete from public.app_errors where id is not null; get diagnostics n = row_count; return n;  -- WHERE needed (pg_safeupdate)
end $$;
revoke execute on function public.clear_client_errors() from public, anon;
grant execute on function public.clear_client_errors() to authenticated;

-- "backup downloaded" stamp (HR / CEO who can download a backup)
create or replace function public.note_backup() returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return; end if;
  insert into public.app_config (key, value) values ('last_backup', jsonb_build_object('at', now(), 'by', auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end $$;
revoke execute on function public.note_backup() from public, anon;
grant execute on function public.note_backup() to authenticated;
-- last_backup is only for the CEO's health board
-- additive: a RESTRICTIVE policy on top of the existing "config read" policy (which is left unchanged)
drop policy if exists "last backup ceo only" on public.app_config;
create policy "last backup ceo only" on public.app_config as restrictive for select using (key <> 'last_backup' or public.is_ceo());

-- ---------------------------------------------------------------- every 30 minutes: database checks + the health-check edge function
select cron.unschedule(jobid) from cron.job where jobname in ('fwm-health-db', 'fwm-health-http');
select cron.schedule('fwm-health-db', '7,37 * * * *', $$select public.health_db_checks()$$);
select cron.schedule('fwm-health-http', '9,39 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_functions_url') || '/health-check',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fwm_cron_secret')),
    body := '{"source":"cron"}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from vault.decrypted_secrets where name = 'fwm_functions_url')
$$);
