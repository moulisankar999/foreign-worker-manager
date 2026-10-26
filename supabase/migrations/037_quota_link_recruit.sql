-- 037: link a recruit to a Quota Use Request after the request was raised (additive).
-- Allowed while the request is pending / GM-approved / approved, same company and country, and never more recruits than slots.
create or replace function public.qr_link_recruit(p_recruit uuid, p_request uuid) returns void language plpgsql security definer set search_path = public as $$
declare r public.qr_recruits; u public.qr_use_requests; n int;
begin
  select * into r from public.qr_recruits where id = p_recruit for update;
  select * into u from public.qr_use_requests where id = p_request for update;
  if r.id is null or u.id is null then raise exception 'Recruit or request not found.'; end if;
  perform public.qr_need(r.company_id, 1);
  if r.company_id <> u.company_id or r.country <> u.country then raise exception 'The request is for another company or country.'; end if;
  if u.status not in ('pending','gm_approved','approved') then raise exception 'Request Q-% is %.', u.ref_no, u.status; end if;
  if r.vdr_applied is not null then raise exception 'The calling visa was already applied for this recruit.'; end if;
  select count(*) into n from public.qr_recruits where use_request_id = u.id and status <> 'dropped' and id <> r.id;
  if n >= u.slots then raise exception 'Request Q-% already covers % recruit(s) — all its slots.', u.ref_no, u.slots; end if;
  update public.qr_recruits set use_request_id = u.id, updated_at = now() where id = r.id;
  update public.qr_use_requests set recruit_ids = array(select distinct unnest(recruit_ids || r.id)) where id = u.id;
  perform public.qr_event(r.company_id, 'Linked to Quota Use Request Q-' || u.ref_no, null, p_recruit => r.id, p_use => u.id);
  perform public.audit('qr_recruit_link', 'quota_recruit', r.id::text, r.full_name || ' linked to Q-' || u.ref_no, null);
end $$;
revoke all on function public.qr_link_recruit(uuid, uuid) from public, anon;
grant execute on function public.qr_link_recruit(uuid, uuid) to authenticated;
