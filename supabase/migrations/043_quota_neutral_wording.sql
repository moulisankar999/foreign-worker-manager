-- 043 (v1.4.2): quota timelines and alerts never name or describe a superior to a lower role. Additive only:
-- two masked views the 1.4.2+ app reads (old apps keep reading the base tables) and a wording patch to qr_alerts().
-- CEO and GM see the full wording; the GM never sees CEO powers (overrides, "GM step skipped").

-- rank of a stored role label (qr_role_label) on the qr_rank() scale: CEO 4, GM 3, HR Admin 2, HR Manager 1
create or replace function public.qr_label_rank(p text) returns int language sql immutable set search_path = public as $$
  select case p when 'CEO' then 4 when 'General Manager' then 3 when 'HR Admin' then 2 when 'HR Manager' then 1 else 0 end
$$;
grant execute on function public.qr_label_rank(text) to authenticated;

-- a timeline / event action as the viewer (qr_rank) may read it
create or replace function public.qr_neutral(p text, r int) returns text language sql immutable set search_path = public as $$
  select case
    when p is null or r >= 4 then p
    when p like 'Approved by CEO%' then 'Approved'
    when p like 'Approved by GM%' then case when r = 3 then 'Approved by GM — sent for final approval' else 'Approved — sent to the next approval step' end
    when p like 'CEO marked %' then 'Marked ' || substr(p, length('CEO marked ') + 1)
    else regexp_replace(regexp_replace(p, '\s*\(GM step skipped\)', '', 'g'), '\m(by|for|to) (the )?(CEO|GM / CEO)\M', '\1 the next approval step', 'g')
  end
$$;
grant execute on function public.qr_neutral(text, int) to authenticated;

-- Quota Use Requests: superior approvers are shown as "Approver", their step as neutral text; GM/CEO step columns and
-- "GM step skipped" only for those allowed to see them. security_invoker: the base table's RLS (company scope) still applies.
create or replace view public.qr_use_requests_v with (security_invoker = true, security_barrier = true) as
select u.id, u.ref_no, u.company_id, u.quota_id, u.country, u.slots, u.batch_id, u.recruit_ids, u.purpose, u.est_cost_rm, u.files, u.status,
  u.requested_by,
  case when public.qr_label_rank(u.requested_by_role) > v.r then 'Approver' else u.requested_by_name end as requested_by_name,
  case when public.qr_label_rank(u.requested_by_role) > v.r then 'Approver' else u.requested_by_role end as requested_by_role,
  u.requested_at,
  case when v.r >= 3 then u.gm_by end as gm_by, case when v.r >= 3 then u.gm_by_name end as gm_by_name,
  u.gm_at, case when v.r >= 3 then u.gm_note end as gm_note,
  case when v.r >= 4 then u.ceo_by end as ceo_by, case when v.r >= 4 then u.ceo_by_name end as ceo_by_name,
  u.ceo_at, u.ceo_note,
  case when v.r >= 4 then u.gm_skipped else false end as gm_skipped,
  case when public.qr_label_rank(u.closed_role) > v.r then null else u.closed_by end as closed_by,
  case when public.qr_label_rank(u.closed_role) > v.r then 'Approver' else u.closed_by_name end as closed_by_name,
  case when public.qr_label_rank(u.closed_role) > v.r then 'Approver' else u.closed_role end as closed_role,
  u.closed_at, u.close_note,
  coalesce((select jsonb_agg(case when public.qr_label_rank(t->>'role') > v.r
      then t || jsonb_build_object('by', 'Approver', 'role', 'Approver', 'action', public.qr_neutral(t->>'action', v.r))
      else t || jsonb_build_object('action', public.qr_neutral(t->>'action', v.r)) end order by o)
    from jsonb_array_elements(u.timeline) with ordinality x(t, o)), '[]'::jsonb) as timeline,
  u.rule_flags
from public.qr_use_requests u cross join lateral (select public.qr_rank() as r) v
where v.r > 0;
grant select on public.qr_use_requests_v to authenticated;
revoke all on public.qr_use_requests_v from anon;

create or replace view public.qr_events_v with (security_invoker = true, security_barrier = true) as
select e.id, e.at, e.company_id, e.recruit_id, e.batch_id, e.use_request_id, e.exit_id, e.runaway_id, e.claim_id,
  public.qr_neutral(e.action, v.r) as action, e.note,
  case when public.qr_label_rank(e.by_role) > v.r then null else e.by_id end as by_id,
  case when public.qr_label_rank(e.by_role) > v.r then 'Approver' else e.by_name end as by_name,
  case when public.qr_label_rank(e.by_role) > v.r then 'Approver' else e.by_role end as by_role
from public.qr_events e cross join lateral (select public.qr_rank() as r) v
where v.r > 0;
grant select on public.qr_events_v to authenticated;
revoke all on public.qr_events_v from anon;

-- alerts: "waiting N days for GM / CEO approval" and "CEO-approved" only for the CEO; others read neutral text
do $$ declare src text := pg_get_functiondef('public.qr_alerts()'::regprocedure); n text; begin
  if position('qr_rank() >= 4 then case when u.status' in src) = 0 then
    n := replace(src, 'case when u.status = ''gm_approved'' then ''the CEO'' else ''GM / CEO'' end || '' approval''',
      'case when public.qr_rank() >= 4 then case when u.status = ''gm_approved'' then ''the CEO'' else ''GM / CEO'' end || '' approval'' when public.qr_rank() = 3 and u.status = ''gm_approved'' then ''final approval'' else ''approval'' end');
    n := replace(n, 'without a CEO-approved Quota Use Request', 'without an approved Quota Use Request');
    if n = src then raise exception '043: qr_alerts() wording not found — check the function before applying'; end if;
    execute n;
  end if;
end $$;
