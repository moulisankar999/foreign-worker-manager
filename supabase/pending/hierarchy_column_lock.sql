-- HOLD — do NOT apply until every installed client is v1.4.1 or newer (old v1.3.8 and v1.4.0 apps select '*' on these
-- tables and would be locked out with a 403 "Could not load your account").
-- Check first: select app_version, count(*) from app_errors where last_seen > now() - interval '14 days' group by 1;
-- and confirm the iOS / Android stores carry v1.4.1+. Apply on TEST, run all suites, back up live, then apply.
-- Effect: signed-in users read only the columns that do not name anyone; names come from the masked *_v views.
-- signed-in users read only the columns that do not name anyone (realtime only sends the readable columns too)
revoke select on public.profiles from anon, authenticated;
grant select (id, email, full_name, role, status, created_at, updated_at, outlet_ids, phone, notify_optout, wa_optin, wa_optin_at, company_ids,
  requested_company_id, requested_outlet_id, approved_at, rejected_at, reject_reason, paused_at, pause_reason, resumed_at, deleted_at,
  must_change_password, pw_reset_at, added_at) on public.profiles to authenticated;
revoke select on public.requests from anon, authenticated;
grant select (id, ref_no, type, worker_id, outlet_id, title, data, amount, priority, status, required_level, created_by, created_at, updated_at,
  decided_at, applied_at, result, ceo_locked, source, confidential, manager_due_at, manager_overdue, manager_decided_at, assigned_at) on public.requests to authenticated;
revoke select on public.request_events from anon, authenticated;
grant select (id, request_id, at, action, from_status, to_status) on public.request_events to authenticated;
revoke select on public.hr_tasks from anon, authenticated;
grant select (id, request_id, worker_id, kind, status, created_at, done_at, done_note) on public.hr_tasks to authenticated;

