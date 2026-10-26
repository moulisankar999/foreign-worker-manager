-- 1.6.0 Birthdays: automatic company wish to the worker (Worker app), morning list for HR / GM / CEO,
-- personal in-app wishes from staff. Additive only. In-app only: no SMS / WhatsApp / email.

create table if not exists public.worker_wishes (
  id bigint generated always as identity primary key,
  worker_id text not null,
  year int not null,
  kind text not null check (kind in ('auto', 'personal')),
  message text,                       -- personal wishes: the text as sent; auto wishes: rendered from the template at read time
  sender_id uuid,
  sender_name text,
  sender_role text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create unique index if not exists worker_wishes_auto_once on public.worker_wishes (worker_id, year) where kind = 'auto';
create index if not exists worker_wishes_worker on public.worker_wishes (worker_id, created_at desc);
alter table public.worker_wishes enable row level security;
revoke all on public.worker_wishes from anon, authenticated;
-- no direct access: staff read through bday_wishes() (masks superiors), workers through worker_wishes()

create or replace function public.bday_role_ok() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('super_admin', 'admin', 'general_manager', 'hr_admin', 'hr_manager'), false)
$$;

-- birthday of a dob (YYYY-MM-DD…) in a given year; 29 Feb -> 28 Feb in non-leap years; null if unparseable
create or replace function public.bday_in_year(p_dob text, p_year int) returns date language plpgsql immutable as $$
declare m int; d int;
begin
  if p_dob is null or p_dob !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  m := substr(p_dob, 6, 2)::int; d := substr(p_dob, 9, 2)::int;
  if m < 1 or m > 12 or d < 1 or d > 31 then return null; end if;
  if m = 2 and d = 29 and not (p_year % 4 = 0 and (p_year % 100 <> 0 or p_year % 400 = 0)) then d := 28; end if;
  return make_date(p_year, m, d);
exception when others then return null;
end $$;

create or replace function public.bday_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

create or replace function public.bday_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object('autoWish', true, 'notifyStaff', true, 'templates', jsonb_build_object(
    'en', 'Happy birthday, {{name}}! 🎉 Everyone at {{company}} wishes you a wonderful year ahead — good health, happiness and success. Thank you for being part of our family.',
    'ms', 'Selamat hari jadi, {{name}}! 🎉 Semua di {{company}} mendoakan tahun yang indah untuk anda — sihat, bahagia dan berjaya. Terima kasih kerana menjadi sebahagian daripada keluarga kami.',
    'ta', 'இனிய பிறந்தநாள் வாழ்த்துகள், {{name}}! 🎉 {{company}} குடும்பம் முழுவதும் உங்களுக்கு ஆரோக்கியம், மகிழ்ச்சி மற்றும் வெற்றி நிறைந்த ஆண்டை வாழ்த்துகிறது. எங்கள் குடும்பத்தின் ஒரு பகுதியாக இருப்பதற்கு நன்றி.',
    'hi', 'जन्मदिन की हार्दिक शुभकामनाएँ, {{name}}! 🎉 {{company}} में हम सब आपको अच्छे स्वास्थ्य, खुशी और सफलता से भरे साल की शुभकामनाएँ देते हैं। हमारे परिवार का हिस्सा बनने के लिए धन्यवाद।',
    'te', 'పుట్టినరోజు శుభాకాంక్షలు, {{name}}! 🎉 {{company}} లో మనందరం మీకు ఆరోగ్యం, ఆనందం, విజయంతో నిండిన సంవత్సరం కావాలని కోరుకుంటున్నాం. మా కుటుంబంలో భాగమైనందుకు ధన్యవాదాలు.',
    'ml', 'ജന്മദിനാശംസകൾ, {{name}}! 🎉 {{company}}-ലെ എല്ലാവരും നിങ്ങൾക്ക് ആരോഗ്യവും സന്തോഷവും വിജയവും നിറഞ്ഞ ഒരു വർഷം ആശംസിക്കുന്നു. ഞങ്ങളുടെ കുടുംബത്തിന്റെ ഭാഗമായതിന് നന്ദി.',
    'kn', 'ಹುಟ್ಟುಹಬ್ಬದ ಶುಭಾಶಯಗಳು, {{name}}! 🎉 {{company}} ನ ಎಲ್ಲರೂ ನಿಮಗೆ ಆರೋಗ್ಯ, ಸಂತೋಷ ಮತ್ತು ಯಶಸ್ಸಿನ ವರ್ಷವನ್ನು ಹಾರೈಸುತ್ತೇವೆ. ನಮ್ಮ ಕುಟುಂಬದ ಭಾಗವಾಗಿರುವುದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.',
    'bn', 'শুভ জন্মদিন, {{name}}! 🎉 {{company}}-এর সবাই আপনাকে সুস্বাস্থ্য, আনন্দ ও সাফল্যে ভরা একটি বছর কামনা করে। আমাদের পরিবারের অংশ হওয়ার জন্য ধন্যবাদ।',
    'ne', 'जन्मदिनको शुभकामना, {{name}}! 🎉 {{company}} का हामी सबै तपाईंलाई राम्रो स्वास्थ्य, खुशी र सफलताले भरिएको वर्षको शुभकामना दिन्छौं। हाम्रो परिवारको हिस्सा हुनुभएकोमा धन्यवाद।',
    'my', 'မွေးနေ့မှာ ပျော်ရွှင်ပါစေ၊ {{name}}! 🎉 {{company}} မှ အားလုံးက ကျန်းမာခြင်း၊ ပျော်ရွှင်ခြင်းနှင့် အောင်မြင်ခြင်းများ ပြည့်စုံသော နှစ်ဖြစ်ပါစေဟု ဆုတောင်းပါသည်။ ကျွန်ုပ်တို့မိသားစုဝင် ဖြစ်သည့်အတွက် ကျေးဇူးတင်ပါသည်။'))
$$;

-- effective config: defaults, overridden by app_config 'birthdays' (templates merged per language)
create or replace function public.bday_cfg() returns jsonb language sql stable security definer set search_path = public as $$
  select public.bday_defaults() || coalesce(public.cfg('birthdays'), '{}'::jsonb) - 'templates'
    || jsonb_build_object('templates', (public.bday_defaults()->'templates') || coalesce(public.cfg('birthdays')->'templates', '{}'::jsonb))
$$;

create or replace function public.bday_company(p_worker text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e->>'name' from jsonb_array_elements(coalesce(public.cfg('companies')->'items', '[]'::jsonb)) e
      where e->>'id' = public.outlet_company(public.worker_outlet(p_worker)) limit 1),
    (select data->>'companyName' from public.records where entity = 'settings' and id = 'app'), 'the company')
$$;

create or replace function public.bday_render(p_tpl text, p_name text, p_company text) returns text language sql immutable as $$
  select replace(replace(coalesce(p_tpl, ''), '{{name}}', coalesce(p_name, '')), '{{company}}', coalesce(p_company, ''))
$$;

create or replace function public.bday_exited(p_status text) returns boolean language sql immutable as $$
  select coalesce(p_status in ('Absconded', 'Resigned', 'Terminated', 'Contract Ended', 'Repatriated'), false)
$$;

-- config for staff (templates for the pre-filled wish) — the 4 birthday roles only
create or replace function public.bday_config() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.bday_role_ok() then raise exception 'not allowed'; end if;
  return public.bday_cfg();
end $$;

-- GM and above: auto-wish on/off, staff morning list on/off, templates per language
create or replace function public.bday_config_save(p_cfg jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare t jsonb := '{}'::jsonb; k text; v text;
begin
  if coalesce(public.my_role() not in ('super_admin', 'admin', 'general_manager'), true) then raise exception 'Only the CEO or GM can change birthday settings'; end if;
  for k, v in select key, value from jsonb_each_text(coalesce(p_cfg->'templates', '{}'::jsonb)) loop
    if k !~ '^[a-z]{2}$' then continue; end if;
    if length(v) > 1000 then raise exception 'Template too long (%): max 1000 characters', k; end if;
    if btrim(v) <> '' then t := t || jsonb_build_object(k, v); end if;
  end loop;
  insert into public.app_config (key, value) values ('birthdays', jsonb_build_object(
      'autoWish', coalesce((p_cfg->>'autoWish')::boolean, true), 'notifyStaff', coalesce((p_cfg->>'notifyStaff')::boolean, true), 'templates', t))
    on conflict (key) do update set value = excluded.value;
  return public.bday_cfg();
end $$;

-- staff: wishes this year for workers they can see; superiors shown as 'Management'
create or replace function public.bday_wishes(p_year int default null) returns table (id bigint, worker_id text, kind text, sender_name text, sender_role text, created_at timestamptz, read_at timestamptz, mine boolean)
language plpgsql stable security definer set search_path = public as $$
declare me int := coalesce(public.user_rank(auth.uid()), 0);
begin
  if not public.bday_role_ok() then raise exception 'not allowed'; end if;
  return query
    select w.id, w.worker_id, w.kind,
      case when w.kind = 'auto' then null when w.sender_id = auth.uid() or public.role_rank(w.sender_role) <= me then w.sender_name else '' end,
      case when w.kind = 'auto' then null when w.sender_id = auth.uid() or public.role_rank(w.sender_role) <= me then w.sender_role else 'management' end,
      w.created_at, w.read_at, w.sender_id = auth.uid()
    from public.worker_wishes w
    where w.year = coalesce(p_year, extract(year from public.bday_today())::int) and public.can_see_worker(w.worker_id)
    order by w.created_at;
end $$;

-- staff: send a personal in-app wish (signed with the sender's name and role)
create or replace function public.bday_send_wish(p_worker text, p_message text) returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.profiles; w jsonb; msg text := btrim(coalesce(p_message, '')); n int; rid bigint; label text;
begin
  if not public.bday_role_ok() then raise exception 'Only HR, the GM or the CEO can send birthday wishes'; end if;
  if not public.can_see_worker(p_worker) then raise exception 'Worker not found'; end if;
  select data into w from public.records where entity = 'workers' and id = p_worker;
  if w is null or coalesce((w->>'deleted')::boolean, false) then raise exception 'Worker not found'; end if;
  if public.bday_exited(w->>'status') then raise exception 'This worker has left — wishes are not sent'; end if;
  if length(msg) < 2 then raise exception 'Write a short message'; end if;
  if length(msg) > 1000 then raise exception 'Message too long (max 1000 characters)'; end if;
  select * into me from public.profiles where id = auth.uid();
  select count(*) into n from public.worker_wishes where sender_id = auth.uid() and worker_id = p_worker and created_at > now() - interval '1 day';
  if n >= 3 then raise exception 'You already sent this worker 3 wishes today'; end if;
  label := case me.role when 'super_admin' then 'CEO' when 'admin' then 'CEO' when 'general_manager' then 'GM' when 'hr_admin' then 'HR Admin' when 'hr_manager' then 'HR Manager' else me.role end;
  insert into public.worker_wishes (worker_id, year, kind, message, sender_id, sender_name, sender_role)
    values (p_worker, extract(year from public.bday_today())::int, 'personal', msg, auth.uid(), coalesce(nullif(me.full_name, ''), split_part(me.email, '@', 1)), me.role)
    returning id into rid;
  return jsonb_build_object('id', rid, 'signedAs', coalesce(nullif(me.full_name, ''), split_part(me.email, '@', 1)) || ' · ' || label);
end $$;

-- worker app: my wishes from the last 30 days (auto wishes rendered in every language; the app picks its own)
create or replace function public.worker_wishes() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare wid text; w jsonb; c jsonb := public.bday_cfg(); comp text; first text; res jsonb;
begin
  perform public.worker_require(); wid := public.my_worker_id();
  select data into w from public.records where entity = 'workers' and id = wid;
  comp := public.bday_company(wid);
  first := split_part(btrim(coalesce(w->>'fullName', '')), ' ', 1);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'at', x.created_at, 'read', x.read_at is not null,
      'from', case when x.kind = 'auto' then comp else x.sender_name end,
      'role', case x.sender_role when 'super_admin' then 'CEO' when 'admin' then 'CEO' when 'general_manager' then 'GM' when 'hr_admin' then 'HR Admin' when 'hr_manager' then 'HR Manager' else null end,
      'message', x.message,
      'messages', case when x.kind = 'auto' then (select jsonb_object_agg(t.key, public.bday_render(t.value, first, comp)) from jsonb_each_text(c->'templates') t) end)
      order by x.created_at desc), '[]'::jsonb) into res
  from public.worker_wishes x where x.worker_id = wid and x.created_at > now() - interval '30 days';
  return jsonb_build_object('today', public.bday_in_year(w->>'dob', extract(year from public.bday_today())::int) = public.bday_today(), 'name', first, 'company', comp, 'wishes', res);
end $$;

create or replace function public.worker_wish_read(p_ids bigint[]) returns int language plpgsql security definer set search_path = public as $$
declare wid text; n int;
begin
  perform public.worker_require(); wid := public.my_worker_id();
  update public.worker_wishes set read_at = now() where worker_id = wid and id = any(p_ids) and read_at is null;
  get diagnostics n = row_count; return n;
end $$;

-- daily sweep (pg_cron, 08:05 Malaysia time): auto wish once per worker per year + morning list per staff member (own scope)
-- p_workers / p_staff narrow the sweep (used by the TEST suite only; the cron job passes nothing)
drop function if exists public.bday_sweep(date);
create or replace function public.bday_sweep(p_day date default null, p_workers text[] default null, p_staff uuid[] default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_day, public.bday_today()); y int := extract(year from coalesce(p_day, public.bday_today()))::int;
  c jsonb := public.bday_cfg(); auto_n int := 0; staff_n int := 0; p record; names text; cnt int; ev bigint;
begin
  if auth.uid() is not null and coalesce(public.my_role() not in ('super_admin', 'admin'), true) then raise exception 'not allowed'; end if;
  create temp table if not exists _bday (id text, name text, outlet text) on commit drop;
  truncate _bday;
  insert into _bday select r.id, r.data->>'fullName', r.data->>'outletId' from public.records r
    where r.entity = 'workers' and not coalesce((r.data->>'deleted')::boolean, false) and not public.bday_exited(r.data->>'status')
      and public.bday_in_year(r.data->>'dob', y) = d and (p_workers is null or r.id = any(p_workers));
  if coalesce((c->>'autoWish')::boolean, true) then
    insert into public.worker_wishes (worker_id, year, kind) select b.id, y, 'auto' from _bday b on conflict do nothing;
    get diagnostics auto_n = row_count;
  end if;
  if coalesce((c->>'notifyStaff')::boolean, true) then
    for p in select pr.id, pr.role, pr.company_ids, pr.outlet_ids from public.profiles pr
             where pr.status = 'active' and pr.role in ('super_admin', 'admin', 'general_manager', 'hr_admin', 'hr_manager') and (p_staff is null or pr.id = any(p_staff)) loop
      select count(*), string_agg(b.name, ', ' order by b.name) into cnt, names from _bday b
        where public.scope_ok(p.role, p.company_ids, p.outlet_ids, b.outlet) and public.demo_ok(p.company_ids, p.outlet_ids, b.outlet);
      if cnt = 0 then continue; end if;
      if cnt > 6 then names := (select string_agg(n, ', ') from (select b.name n from _bday b where public.scope_ok(p.role, p.company_ids, p.outlet_ids, b.outlet) and public.demo_ok(p.company_ids, p.outlet_ids, b.outlet) order by b.name limit 5) s) || ' +' || (cnt - 5); end if;
      ev := public.notify('birthdays_today', null, null, jsonb_build_object('count', cnt, 'names', names, 'go', 'birthdays'), 'bday|' || d || '|' || p.id, array[p.id]);
      if ev is not null then
        update public.notification_deliveries set link = coalesce(nullif(public.cfg('notifications')->>'appUrl', ''), 'https://fw.sunrisebayumas.com/') || '#/birthdays' where event_id = ev;
        staff_n := staff_n + 1;
      end if;
    end loop;
  end if;
  return jsonb_build_object('day', d, 'birthdays', (select count(*) from _bday), 'autoWishes', auto_n, 'staffNotified', staff_n);
end $$;

-- notification event (added only if the CEO's config does not have it yet)
update public.app_config set value = jsonb_set(value, '{events,birthdays_today}', jsonb_build_object(
    'label', 'Today''s birthdays (morning list)', 'group', 'Workers', 'critical', false, 'enabled', true,
    'recipients', jsonb_build_array('super_admin', 'hr_admin', 'hr_manager'), 'channels', jsonb_build_object('in_app', true, 'push', true),
    'worker', '{}'::jsonb, 'title', '🎂 {{count}} birthday(s) today', 'sms', '', 'body', '{{names}} — open Birthdays to send a wish.'))
  where key = 'notifications' and value ? 'events' and not (value->'events' ? 'birthdays_today');

revoke all on function public.bday_sweep(date, text[], uuid[]) from public, anon, authenticated;
revoke all on function public.bday_cfg(), public.bday_company(text) from public, anon, authenticated;
revoke all on function public.bday_config_save(jsonb), public.bday_config(), public.bday_wishes(int), public.bday_send_wish(text, text), public.worker_wishes(), public.worker_wish_read(bigint[]) from public, anon;
grant execute on function public.bday_config_save(jsonb), public.bday_config(), public.bday_wishes(int), public.bday_send_wish(text, text), public.worker_wishes(), public.worker_wish_read(bigint[]) to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fwm-birthdays';
    perform cron.schedule('fwm-birthdays', '5 0 * * *', 'select public.bday_sweep()'); -- 00:05 UTC = 08:05 Malaysia time
  end if;
end $$;
