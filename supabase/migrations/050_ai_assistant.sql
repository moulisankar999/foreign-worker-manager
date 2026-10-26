-- 050 AI Assistant (v1.5.0). Additive only: new config key, two new tables, new functions, System Map entry.
-- The LLM runs in the ai-assistant edge function with the CALLER's JWT, so every read goes through the same RLS /
-- role-scoped functions as the app (pull_records, profiles_v, requests_v, qr_*). Nothing here widens access.
-- Action tools only PREPARE drafts (ai_drafts); the user confirms in the app, which calls the normal functions.

insert into public.app_config (key, value) values ('ai_assistant', '{"dailyLimit": 40}'::jsonb) on conflict (key) do nothing;

-- per-user daily usage (Malaysia day). Written only by ai_begin().
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage own" on public.ai_usage;
create policy "ai usage own" on public.ai_usage for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.ai_usage from anon, authenticated;

-- drafts prepared by the assistant; only their owner can see or decide them
create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('request', 'note', 'reminder')),
  title text not null,
  worker_id text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'discarded')),
  result_ref text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists ai_drafts_user on public.ai_drafts (user_id, created_at desc);
alter table public.ai_drafts enable row level security;
drop policy if exists "ai drafts own" on public.ai_drafts;
create policy "ai drafts own" on public.ai_drafts for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.ai_drafts from anon, authenticated;

create or replace function public.ai_limit() returns int language sql stable security definer set search_path = public as $$
  select greatest(coalesce(nullif(public.cfg('ai_assistant')->>'dailyLimit', '')::int, 40), 0)
$$;
create or replace function public.ai_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kuala_Lumpur')::date $$;

-- usage for the caller (UI counter)
create or replace function public.ai_status() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('limit', public.ai_limit(),
    'used', coalesce((select n from public.ai_usage where user_id = auth.uid() and day = public.ai_today()), 0),
    'role', public.my_role())
  where public.is_active_user()
$$;

-- count one question against the caller's daily limit; raises when the limit is reached
create or replace function public.ai_begin() returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int := public.ai_limit(); used int;
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'Sign in with an active account to use the assistant.'; end if;
  insert into public.ai_usage (user_id, day, n) values (auth.uid(), public.ai_today(), 0) on conflict do nothing;
  select n into used from public.ai_usage where user_id = auth.uid() and day = public.ai_today() for update;
  if used >= lim then
    raise exception 'You have used all % assistant questions for today. The count resets at midnight (Malaysia time).', lim using errcode = 'P0001', hint = 'ai_limit';
  end if;
  update public.ai_usage set n = n + 1 where user_id = auth.uid() and day = public.ai_today();
  return jsonb_build_object('limit', lim, 'used', used + 1);
end $$;

-- audit one chat turn: tool names and sizes only — never the question, the answer or any worker value
create or replace function public.ai_log_chat(p_tools text[], p_lang text, p_provider text, p_ok boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_user() then return; end if;
  perform public.audit('ai.chat', 'assistant', null,
    case when p_ok then 'Asked the assistant' else 'Assistant question failed' end
      || case when coalesce(cardinality(p_tools), 0) > 0 then ' (looked up: ' || array_to_string(p_tools[1:8], ', ') || ')' else '' end,
    jsonb_build_object('tools', coalesce(to_jsonb(p_tools[1:8]), '[]'::jsonb), 'lang', left(coalesce(p_lang, ''), 12), 'provider', left(coalesce(p_provider, ''), 20), 'ok', p_ok));
end $$;

-- the assistant prepares a draft for the caller; nothing is created or changed until the caller confirms in the app
create or replace function public.ai_draft_create(p_kind text, p_title text, p_worker_id text, p_payload jsonb) returns public.ai_drafts
language plpgsql security definer set search_path = public as $$
declare d public.ai_drafts; v_role text := public.my_role();
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'Sign in with an active account.'; end if;
  if p_kind not in ('request', 'note', 'reminder') then raise exception 'Unknown draft kind'; end if;
  if p_kind in ('request', 'note') and v_role = 'viewer' then raise exception 'Your role is view-only: it cannot raise requests or add notes.'; end if;
  if p_worker_id is not null and not public.can_see_worker(p_worker_id) then raise exception 'That worker is not in your scope.'; end if;
  if p_kind in ('request', 'note') and p_worker_id is null then raise exception 'Pick a worker for this draft.'; end if;
  if (select count(*) from public.ai_drafts where user_id = auth.uid() and status = 'draft' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many open drafts. Confirm or discard some first.';
  end if;
  insert into public.ai_drafts (kind, title, worker_id, payload) values (p_kind, left(coalesce(nullif(trim(p_title), ''), p_kind), 200), p_worker_id, coalesce(p_payload, '{}'::jsonb))
  returning * into d;
  perform public.audit('ai.draft', 'ai_drafts', d.id::text, 'Assistant prepared a ' || p_kind || ' draft: ' || d.title,
    jsonb_build_object('kind', p_kind, 'worker_id', p_worker_id, 'type', p_payload->>'type'));
  return d;
end $$;

-- the caller confirms (after the app ran the normal function) or discards their own draft
create or replace function public.ai_draft_decide(p_id uuid, p_status text, p_ref text default null) returns public.ai_drafts
language plpgsql security definer set search_path = public as $$
declare d public.ai_drafts;
begin
  if p_status not in ('confirmed', 'discarded') then raise exception 'Use confirmed or discarded'; end if;
  select * into d from public.ai_drafts where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Draft not found.'; end if;
  if d.status <> 'draft' then raise exception 'This draft was already %.', d.status; end if;
  update public.ai_drafts set status = p_status, result_ref = left(p_ref, 120), decided_at = now() where id = p_id returning * into d;
  perform public.audit(case when p_status = 'confirmed' then 'ai.confirm' else 'ai.discard' end, 'ai_drafts', d.id::text,
    case when p_status = 'confirmed' then 'Confirmed assistant draft: ' else 'Discarded assistant draft: ' end || d.title,
    jsonb_build_object('kind', d.kind, 'worker_id', d.worker_id, 'ref', d.result_ref));
  return d;
end $$;

-- CEO sets the per-user daily limit (0 pauses the assistant for everyone)
create or replace function public.ai_set_limit(p_limit int) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_super() then raise exception 'Only the CEO can change the assistant limit.'; end if;
  if p_limit is null or p_limit < 0 or p_limit > 1000 then raise exception 'Daily limit must be between 0 and 1000.'; end if;
  update public.app_config set value = coalesce(value, '{}'::jsonb) || jsonb_build_object('dailyLimit', p_limit), updated_at = now(), updated_by = auth.uid()
    where key = 'ai_assistant' returning value into v;
  if v is null then insert into public.app_config (key, value) values ('ai_assistant', jsonb_build_object('dailyLimit', p_limit)) returning value into v; end if;
  perform public.audit('ai.limit', 'app_config', 'ai_assistant', 'Assistant daily limit set to ' || p_limit || ' questions per user', jsonb_build_object('dailyLimit', p_limit));
  return v;
end $$;

revoke execute on function public.ai_begin(), public.ai_status(), public.ai_log_chat(text[], text, text, boolean),
  public.ai_draft_create(text, text, text, jsonb), public.ai_draft_decide(uuid, text, text), public.ai_set_limit(int), public.ai_limit() from public, anon;
grant execute on function public.ai_begin(), public.ai_status(), public.ai_log_chat(text[], text, text, boolean),
  public.ai_draft_create(text, text, text, jsonb), public.ai_draft_decide(uuid, text, text), public.ai_set_limit(int), public.ai_limit() to authenticated;

insert into public.system_map (key, sort, title, content) values ('ai_assistant', 37, 'AI Assistant', jsonb_build_object('blocks', jsonb_build_array(
  jsonb_build_object('t', 'text', 'text', 'Chat assistant for every staff role (left menu → Assistant). It answers from the data the signed-in user can already see and prepares drafts; it never approves, deletes or overrides anything. Dormant until the CEO sets the provider key as an edge-function secret.'),
  jsonb_build_object('t', 'kv', 'rows', jsonb_build_array(
    jsonb_build_array('Edge function', 'ai-assistant: verifies the user, then runs every lookup with the CALLER''s JWT (pull_records, profiles_v, requests_v, qr_master, qr_followups, qr_recruits, qr_reg_rules), so RLS and hide-superiors apply exactly as in the app.'),
    jsonb_build_array('Provider', 'Secrets AI_PROVIDER (gemini default | openai | anthropic), AI_API_KEY, optional AI_MODEL. The key lives only in Supabase secrets — never in the app or the repo. No key → the CEO sees "not switched on yet", other roles do not see the menu item.'),
    jsonb_build_array('Privacy', 'Passport numbers are masked to the last 4 digits; PINs, phone numbers, bank and remittance details are never sent; pay is sent only to roles that may see salary. Questions and answers are not stored on the server.'),
    jsonb_build_array('Drafts', 'ai_drafts (owner-only). Request / note / reminder drafts; Confirm in the app runs the normal request_create or remark save, then ai_draft_decide marks the draft confirmed.'),
    jsonb_build_array('Limits & audit', 'app_config.ai_assistant.dailyLimit (default 40 questions per user per Malaysia day, CEO changes it on the Assistant page). ai_usage counts; audit actions ai.chat (tool names only), ai.draft, ai.confirm, ai.discard, ai.limit — visible under the normal hide-superiors audit rule.'),
    jsonb_build_array('Migration', '050 (additive only)')))
))) on conflict (key) do update set title = excluded.title, content = excluded.content, sort = excluded.sort, updated_at = now();
