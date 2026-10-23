-- v1.2.1 pay & contribution compliance (strictly additive: no drops, no deletes)
-- 1) new worker pay fields are treated like salary data (hidden from roles that may not see pay,
--    and protected from changes by them through the existing trigger)
-- 2) set_pay_config: CEO, HR Admin, or a General Manager with the compliance power may save the
--    pay-rule rates and the public-holiday list (audited). Everyone signed in can read app_config.
begin;

create or replace function public.salary_keys() returns text[] language sql immutable as $$
  select array['initialBasicPay','increments','allowances','bankName','bankAccount','loans','deductions',
               'payslips','minWageExempt','minWageExemptReason','hostelDeduction']
$$;

create or replace function public.set_pay_config(p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_key is null or p_key not in ('rates','holidays') then raise exception 'Unknown setting'; end if;
  if not public.is_active_user() or not (coalesce(public.my_role(), '') in ('super_admin','admin','hr_admin')
     or public.gm_can(case p_key when 'rates' then 'compliance.rates' else 'compliance.settings' end)) then
    raise exception 'You are not allowed to change pay rules' using errcode = '42501';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' then raise exception 'Invalid value'; end if;
  if length(p_value::text) > 200000 then raise exception 'Setting too large'; end if;
  insert into public.app_config (key, value) values (p_key, p_value)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public.audit('update', 'config', p_key,
    case p_key when 'rates' then 'Pay rules / contribution rates changed' else 'Public holiday list changed' end, null);
  return p_value;
end $$;
revoke execute on function public.set_pay_config(text, jsonb) from public, anon;
grant execute on function public.set_pay_config(text, jsonb) to authenticated;

commit;
