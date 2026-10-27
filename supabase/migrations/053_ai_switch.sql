-- 1.6.1 — AI Assistant on/off switch (CEO only). Additive: no table, column or row is dropped.
-- app_config.ai_assistant.enabled — absent means ON (the 1.6.0 behaviour), so applying this changes nothing until the CEO switches it off.

create or replace function public.ai_on() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(nullif(public.cfg('ai_assistant')->>'enabled', '')::boolean, true)
$$;

-- usage for the caller (UI counter) + whether the CEO has the Assistant switched on
create or replace function public.ai_status() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('limit', public.ai_limit(),
    'used', coalesce((select n from public.ai_usage where user_id = auth.uid() and day = public.ai_today()), 0),
    'role', public.my_role(), 'on', public.ai_on())
  where public.is_active_user()
$$;

-- count one question against the caller's daily limit; refuses when switched off or at the limit
create or replace function public.ai_begin() returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int := public.ai_limit(); used int;
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'Sign in with an active account to use the assistant.'; end if;
  if not public.ai_on() then raise exception 'The Assistant has been turned off by your administrator.' using errcode = 'P0001', hint = 'ai_off'; end if;
  insert into public.ai_usage (user_id, day, n) values (auth.uid(), public.ai_today(), 0) on conflict do nothing;
  select n into used from public.ai_usage where user_id = auth.uid() and day = public.ai_today() for update;
  if used >= lim then
    raise exception 'You have used all % assistant questions for today. The count resets at midnight (Malaysia time).', lim using errcode = 'P0001', hint = 'ai_limit';
  end if;
  update public.ai_usage set n = n + 1 where user_id = auth.uid() and day = public.ai_today();
  return jsonb_build_object('limit', lim, 'used', used + 1);
end $$;

-- the switch itself: CEO (super admin) only
create or replace function public.ai_set_enabled(p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_super() then raise exception 'Only the CEO can turn the Assistant on or off.'; end if;
  if p_on is null then raise exception 'Choose on or off.'; end if;
  update public.app_config set value = coalesce(value, '{}'::jsonb) || jsonb_build_object('enabled', p_on), updated_at = now(), updated_by = auth.uid()
    where key = 'ai_assistant' returning value into v;
  if v is null then insert into public.app_config (key, value) values ('ai_assistant', jsonb_build_object('dailyLimit', 40, 'enabled', p_on)) returning value into v; end if;
  perform public.audit('ai.switch', 'app_config', 'ai_assistant', case when p_on then 'Assistant turned on for everyone' else 'Assistant turned off for everyone' end, jsonb_build_object('enabled', p_on));
  return v;
end $$;

-- direct table writes to the ai_assistant key: CEO (super admin) only — before, a GM with "compliance.settings" fell through to it.
create or replace function public.config_can_write(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select k is distinct from 'gm_powers' and case when k = 'ai_assistant' then public.is_super() else (public.is_ceo() or public.gm_can(case k
    when 'approval_rules' then 'requests.rules' when 'hr_admin' then 'hr.flags' when 'vault' then 'workers.vault'
    when 'emergency_reasons' then 'requests.emergency' when 'wa_templates' then 'notifications.settings' when 'notifications' then 'notifications.settings'
    when 'companies' then 'org.companies' when 'user_approvals' then 'hr.approvers' when 'passport' then 'passport.settings'
    when 'consent_translations' then 'passport.consent' when 'agencies' then 'agencies.edit' when 'compliance' then 'compliance.settings'
    when 'rates' then 'compliance.rates' else 'compliance.settings' end)) end
$$;

revoke execute on function public.ai_set_enabled(boolean), public.ai_on() from public, anon;
grant execute on function public.ai_set_enabled(boolean), public.ai_on() to authenticated;

update public.system_map set content = jsonb_set(content, '{blocks,1,rows}', (content #> '{blocks,1,rows}') || jsonb_build_array(
    jsonb_build_array('On / off switch', 'Settings → AI Assistant (CEO only). app_config.ai_assistant.enabled (absent = on). Off hides the Assistant for every role and ai_begin() / the edge function refuse questions. ai_set_enabled(); audit ai.switch. Migration 053.'))),
  updated_at = now()
where key = 'ai_assistant' and not (content::text like '%On / off switch%');
