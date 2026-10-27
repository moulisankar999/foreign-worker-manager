-- v1.6.4 (t204u): HR records quota (KDN) letters and may also open them. Allowed to open: HR Admin, HR Manager, GM, CEO
-- (legacy 'admin' = CEO). The same person may record and open. Who recorded and who opened stay on the letter and in the audit log.
-- Additive: only qr_open_quota is replaced; no table or column changes.
create or replace function public.qr_open_quota(p_id uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public set "TimeZone" = 'Asia/Kuala_Lumpur' as $$
declare q public.qr_quotas; k text; v text;
begin
  select * into q from public.qr_quotas where id = p_id for update;
  if q.id is null or q.status <> 'pending' then raise exception 'This letter is not waiting to be opened.'; end if;
  if not public.is_active_user() or coalesce(public.my_role(), '') not in ('super_admin', 'admin', 'general_manager', 'hr_admin', 'hr_manager') then
    raise exception 'Your role cannot do this in Approval & Recruitment.' using errcode = '42501';
  end if;
  perform public.qr_need(q.company_id, 1);   -- company scope
  if not p_ok then
    update public.qr_quotas set status = 'rejected', notes = concat_ws(E'\n', notes, 'Rejected: ' || coalesce(p_note, '')) where id = q.id;
    perform public.audit('qr_quota_reject', 'quota', q.id::text, 'Quota letter ' || q.ref_no || ' not opened by ' || coalesce(public.my_name(), '?')
      || ' (recorded by ' || coalesce(q.created_by_name, '?') || '): ' || coalesce(p_note, ''), null);
    return;
  end if;
  for k, v in select key, value from jsonb_each_text(q.breakdown) loop
    if v::int > 0 then perform public.qr_post(q.id, k, 'approved', v::int, q.ref_no, coalesce(p_note, 'Approval letter opened')); end if;
  end loop;
  update public.qr_quotas set status = 'active', opened_by = auth.uid(), opened_by_name = public.my_name(), opened_at = now() where id = q.id;
  perform public.audit('qr_quota_open', 'quota', q.id::text, 'Quota letter ' || q.ref_no || ' opened by ' || coalesce(public.my_name(), '?')
    || ' (recorded by ' || coalesce(q.created_by_name, '?') || '): ' || q.breakdown::text, jsonb_build_object('recorded_by', q.created_by, 'recorded_by_name', q.created_by_name, 'opened_by', auth.uid()));
end $$;
revoke all on function public.qr_open_quota(uuid, boolean, text) from public, anon;
grant execute on function public.qr_open_quota(uuid, boolean, text) to authenticated;

-- KDN letters list only "source countries" without a split: such a letter is recorded with one bucket "Any source country".
-- The sector country check skips that bucket (it is not a country). Patched in place; safe to re-run.
do $mig$
declare src text; dst text;
begin
  src := pg_get_functiondef('public.qr_sector_eval(jsonb,text,text,date,text,date)'::regprocedure);
  dst := replace(src, 'if p_country is not null and jsonb_typeof(rule->''countries'')', 'if p_country is not null and p_country <> ''Any source country'' and jsonb_typeof(rule->''countries'')');
  if dst <> src then execute dst; end if;
end $mig$;
