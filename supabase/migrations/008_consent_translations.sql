-- 008 (v1.1.2): consent-form translations per worker language.
-- Additive & non-destructive: one new config row (only if missing) and one new function. No drops, no deletes.
-- Super Admin and HR Admin may correct the translation of one language; every change is audited.
begin;

insert into public.app_config (key, value) values ('consent_translations', '{"items":{}}'::jsonb)
on conflict (key) do nothing;

create or replace function public.set_consent_translation(p_lang text, p_text jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; n text; k text; entry jsonb;
begin
  if not public.is_active_user() or coalesce(public.my_role(), '') not in ('super_admin','admin','hr_admin') then
    raise exception 'You are not allowed to change consent translations' using errcode = '42501';
  end if;
  if p_lang is null or p_lang !~ '^[a-z]{2,5}$' then raise exception 'Invalid language code'; end if;
  if p_text is not null then
    if jsonb_typeof(p_text) <> 'object' or jsonb_typeof(coalesce(p_text->'text', '{}'::jsonb)) <> 'object' then raise exception 'Invalid translation'; end if;
    if length(p_text::text) > 20000 then raise exception 'Translation too long'; end if;
    for k in select jsonb_object_keys(coalesce(p_text->'text', '{}'::jsonb)) loop
      if jsonb_typeof(p_text->'text'->k) <> 'string' then raise exception 'Invalid translation field %', k; end if;
    end loop;
    select coalesce(nullif(full_name,''), email) into n from public.profiles where id = auth.uid();
    entry := jsonb_build_object('text', coalesce(p_text->'text', '{}'::jsonb),
      'checked', coalesce((p_text->>'checked')::boolean, false),
      'checkedBy', left(coalesce(p_text->>'checkedBy', ''), 120),
      'updatedAt', now(), 'updatedBy', coalesce(n, ''));
  end if;
  insert into public.app_config (key, value) values ('consent_translations', '{"items":{}}'::jsonb) on conflict (key) do nothing;
  select value into v from public.app_config where key = 'consent_translations' for update;
  v := coalesce(v, '{}'::jsonb);
  if jsonb_typeof(v->'items') is distinct from 'object' then v := jsonb_set(v, '{items}', '{}'::jsonb); end if;
  if p_text is null then v := jsonb_set(v, '{items}', (v->'items') - p_lang);
  else v := jsonb_set(v, array['items', p_lang], entry); end if;
  update public.app_config set value = v, updated_at = now(), updated_by = auth.uid() where key = 'consent_translations';
  perform public.audit(case when p_text is null then 'reset' else 'update' end, 'consent_translation', p_lang,
    case when p_text is null then 'Consent form translation reset to built-in: ' else 'Consent form translation changed: ' end || p_lang,
    case when p_text is null then null else jsonb_build_object('checked', entry->'checked', 'fields', (select count(*) from jsonb_object_keys(entry->'text'))) end);
  return v;
end $$;
revoke execute on function public.set_consent_translation(text, jsonb) from public, anon;
grant execute on function public.set_consent_translation(text, jsonb) to authenticated;

commit;
