-- 006: WhatsApp Business Cloud API as the primary outbound channel. Additive only (new columns/tables/functions).
-- SMS (OneWaySMS) becomes a fallback: WhatsApp failed / not delivered in time / person has no WhatsApp opt-in.
-- Business-initiated WhatsApp messages use APPROVED utility templates (supabase/functions/_shared/wa-templates.json).
begin;

-- ---------- opt-in (staff profiles; workers keep waOptIn / waOptInAt in their record JSON) ----------
alter table public.profiles add column if not exists wa_optin boolean not null default false;
alter table public.profiles add column if not exists wa_optin_at timestamptz;

-- ---------- delivery log: WhatsApp template, delivery receipts, fallback link ----------
alter table public.notification_deliveries add column if not exists wa_template text;
alter table public.notification_deliveries add column if not exists wa_lang text;
alter table public.notification_deliveries add column if not exists vars jsonb;
alter table public.notification_deliveries add column if not exists fallback_body text;
alter table public.notification_deliveries add column if not exists fallback_of bigint;
alter table public.notification_deliveries add column if not exists wa_status text;
alter table public.notification_deliveries add column if not exists delivered_at timestamptz;
alter table public.notification_deliveries add column if not exists status_at timestamptz;
alter table public.notification_deliveries drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries add constraint notification_deliveries_status_check
  check (status in ('queued','sending','sent','delivered','read','failed','skipped'));
create index if not exists notification_deliveries_provider_id on public.notification_deliveries (provider_id) where provider_id is not null;

-- ---------- inbound WhatsApp messages (replies) ----------
create table if not exists public.whatsapp_inbound (
  id bigint generated always as identity primary key,
  wamid text unique,
  from_number text,
  profile_name text,
  user_id uuid,
  worker_id text,
  type text,
  text text,
  context_id text,
  payload jsonb,
  action text,
  received_at timestamptz not null default now()
);
alter table public.whatsapp_inbound enable row level security;
drop policy if exists "wa inbound read" on public.whatsapp_inbound;
create policy "wa inbound read" on public.whatsapp_inbound for select to authenticated using (public.is_super());
grant select on public.whatsapp_inbound to authenticated;
revoke all on public.whatsapp_inbound from anon;

-- template approval status (written by the wa-admin Edge Function; read by Settings → Notifications)
insert into public.app_config (key, value) values ('wa_templates', '{"items":{},"syncedAt":null}'::jsonb) on conflict (key) do nothing;

-- new defaults: WhatsApp primary, email for details + digest, SMS off (fallback only). Only replaces a config that predates WhatsApp.
update public.app_config set value = '{"enabled":{"in_app":true,"push":true,"email":false,"sms":false,"whatsapp":false},"appUrl":"https://moulisankar999.github.io/foreign-worker-manager/","smsSender":"FWM","email":{"fromName":"FW Manager","fromEmail":""},"quietHours":{"enabled":true,"start":"22:00","end":"07:00"},"digest":{"enabled":true,"time":"08:00"},"rateLimitPerHour":{"sms":6,"email":30,"whatsapp":6},"costs":{"sms":0.115,"email":0.002,"whatsapp":0.0564},"whatsapp":{"language":"en","workerLanguage":"en","requireOptIn":true},"fallback":{"enabled":true,"onFailed":true,"onNoWhatsApp":true,"undeliveredMinutes":60,"criticalOnly":true},"events":{"request_submitted":{"label":"Request submitted","group":"Requests","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} for {{worker}}","sms":"New {{type}} request {{ref}} for worker {{workerNo}}. Please open FW Manager app.","wa":"fwm_request_submitted"},"request_returned":{"label":"Returned for more info","group":"Requests","critical":false,"enabled":true,"recipients":["requester"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} returned: more info needed","sms":"Request {{ref}} returned for more info. Please open FW Manager app.","wa":"fwm_request_needs_info"},"request_recommended":{"label":"Recommended (waiting HR Admin)","group":"Requests","critical":false,"enabled":true,"recipients":["hr_admin"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} waiting for your approval","sms":"Request {{ref}} ({{type}}) waiting for your approval. Please open FW Manager app.","wa":"fwm_approval_pending"},"request_escalated":{"label":"Escalated to Super Admin","group":"Requests","critical":false,"enabled":true,"recipients":["super_admin"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} escalated to you","sms":"Request {{ref}} ({{type}}) escalated for your approval. Please open FW Manager app.","wa":"fwm_approval_pending"},"request_approved":{"label":"Approved","group":"Requests","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} approved","sms":"Request {{ref}} ({{type}}) approved. Please open FW Manager app.","wa":"fwm_request_approved"},"request_rejected":{"label":"Rejected","group":"Requests","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} rejected","sms":"Request {{ref}} ({{type}}) rejected. Please open FW Manager app.","wa":"fwm_request_rejected"},"request_completed":{"label":"Applied / closed","group":"Requests","critical":false,"enabled":true,"recipients":["requester"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} completed","sms":"Request {{ref}} ({{type}}) completed. Please open FW Manager app.","wa":"fwm_request_completed"},"request_cancelled":{"label":"Cancelled by requester","group":"Requests","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true},"worker":{},"title":"{{ref}} {{type}} cancelled","sms":"Request {{ref}} cancelled."},"comment_added":{"label":"Comment on a request","group":"Requests","critical":false,"enabled":true,"recipients":["participants"],"channels":{"in_app":true,"push":true,"whatsapp":true},"worker":{},"title":"New comment on {{ref}}","sms":"New comment on request {{ref}}. Please open FW Manager app.","wa":"fwm_new_comment"},"approval_overdue":{"label":"Approval waiting > 24 h","group":"Requests","critical":true,"enabled":true,"recipients":["approver"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"⏰ {{ref}} {{type}} waiting over 24 h","sms":"Request {{ref}} ({{type}}) waiting over 24h for your approval. Please open FW Manager app.","wa":"fwm_approval_pending"},"emergency_submitted":{"label":"Emergency leave submitted","group":"Emergency leave","critical":true,"enabled":true,"recipients":["hr_manager","hr_admin"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"🚨 Emergency leave {{ref}}: {{worker}}","sms":"URGENT emergency leave {{ref}} for worker {{workerNo}}. Please review in FW Manager app.","wa":"fwm_emergency_leave"},"emergency_decided":{"label":"Emergency leave decided","group":"Emergency leave","critical":true,"enabled":true,"recipients":["requester","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{"whatsapp":true},"title":"Emergency leave {{ref}} {{status}}","sms":"Emergency leave {{ref}} for worker {{workerNo}} {{status}}. Please open FW Manager app.","workerSms":"Your emergency leave is {{status}}. Please contact your manager.","wa":"fwm_emergency_decided","workerWa":"fwm_worker_leave_update"},"leave_decided":{"label":"Leave decided (message to worker)","group":"Leave","critical":false,"enabled":true,"recipients":[],"channels":{},"worker":{"whatsapp":true},"title":"Leave {{ref}} {{status}}","sms":"","workerSms":"Your {{type}} is {{status}}. Please contact your manager for details.","workerWa":"fwm_worker_leave_update"},"proof_overdue":{"label":"Emergency proof still pending","group":"Emergency leave","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"Proof pending for {{ref}} ({{worker}})","sms":"Emergency leave {{ref}} proof documents overdue. Please upload in FW Manager app.","wa":"fwm_proof_pending"},"ticket_uploaded":{"label":"Flight ticket uploaded","group":"Tickets","critical":true,"enabled":true,"recipients":["outlet_manager","requester"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{"whatsapp":true},"title":"✈️ Ticket booked for {{worker}} — download","sms":"Flight ticket for worker {{workerNo}} booked (request {{ref}}). Download in FW Manager app.","workerSms":"Your flight ticket is ready. Please collect it from your manager.","wa":"fwm_ticket_ready","workerWa":"fwm_worker_ticket_ready"},"passport_consent_pending":{"label":"Passport consent pending signature","group":"Passport","critical":false,"enabled":true,"recipients":["outlet_manager","hr_manager"],"channels":{"in_app":true,"email":true,"whatsapp":true},"worker":{},"title":"{{count}} passport consent form(s) pending signature","sms":"Passport safekeeping consent pending for worker {{workerNo}}. Please open FW Manager app.","wa":"fwm_passport_consent_pending"},"passport_consent_uploaded":{"label":"Signed consent uploaded (verify)","group":"Passport","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"Verify passport consent: {{worker}}","sms":"Signed passport consent for worker {{workerNo}} uploaded. Please verify in FW Manager app.","wa":"fwm_passport_consent_uploaded"},"passport_consent_signed":{"label":"Consent verified","group":"Passport","critical":false,"enabled":true,"recipients":["outlet_manager"],"channels":{"in_app":true},"worker":{},"title":"Passport consent verified: {{worker}}","sms":"Passport consent for worker {{workerNo}} verified."},"passport_release_ready":{"label":"Passport ready for collection","group":"Passport","critical":true,"enabled":true,"recipients":["requester","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{"whatsapp":true},"title":"Passport of {{worker}} ready for collection","sms":"Passport of worker {{workerNo}} ready for collection (request {{ref}}).","workerSms":"Your passport is ready for collection from HR.","wa":"fwm_passport_ready","workerWa":"fwm_worker_passport_ready"},"passport_overdue":{"label":"Passport out of safe past return date","group":"Passport","critical":false,"enabled":true,"recipients":["hr_manager","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"Passport of {{worker}} not returned ({{days}} days late)","sms":"Passport of worker {{workerNo}} is {{days}} day(s) past expected return. Please open FW Manager app.","wa":"fwm_passport_overdue"},"doc_expiring":{"label":"Document expiring","group":"Documents","critical":false,"enabled":true,"recipients":["hr_manager","outlet_manager"],"channels":{"in_app":true,"email":true,"whatsapp":true},"worker":{},"title":"{{doc}} of {{worker}} expires in {{days}} days","sms":"{{doc}} of worker {{workerNo}} expires in {{days}} days. Please open FW Manager app.","wa":"fwm_document_expiring"},"doc_expired":{"label":"Document expired","group":"Documents","critical":true,"enabled":true,"recipients":["hr_manager","hr_admin","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"❗ {{doc}} of {{worker}} EXPIRED","sms":"{{doc}} of worker {{workerNo}} EXPIRED on {{date}}. Please act in FW Manager app.","wa":"fwm_document_expired"},"remark_added":{"label":"Remark added by outlet manager","group":"Workers","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"whatsapp":true},"worker":{},"title":"New remark on {{worker}}","sms":"New remark on worker {{workerNo}}. Please open FW Manager app.","wa":"fwm_remark_added"},"user_awaiting_approval":{"label":"New user awaiting approval","group":"Users","critical":false,"enabled":true,"recipients":["user_admins"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{title}} is waiting for access","sms":"A new user is waiting for access. Please open FW Manager app.","wa":"fwm_user_waiting"},"daily_digest":{"label":"Daily digest","group":"Digest","critical":false,"enabled":true,"recipients":[],"channels":{"email":true},"worker":{},"title":"{{company}} daily summary","sms":"","wa":"fwm_daily_digest"}}}'::jsonb where key = 'notifications' and not (value ? 'enabled');
insert into public.app_config (key, value) values ('notifications', '{"enabled":{"in_app":true,"push":true,"email":false,"sms":false,"whatsapp":false},"appUrl":"https://moulisankar999.github.io/foreign-worker-manager/","smsSender":"FWM","email":{"fromName":"FW Manager","fromEmail":""},"quietHours":{"enabled":true,"start":"22:00","end":"07:00"},"digest":{"enabled":true,"time":"08:00"},"rateLimitPerHour":{"sms":6,"email":30,"whatsapp":6},"costs":{"sms":0.115,"email":0.002,"whatsapp":0.0564},"whatsapp":{"language":"en","workerLanguage":"en","requireOptIn":true},"fallback":{"enabled":true,"onFailed":true,"onNoWhatsApp":true,"undeliveredMinutes":60,"criticalOnly":true},"events":{"request_submitted":{"label":"Request submitted","group":"Requests","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} for {{worker}}","sms":"New {{type}} request {{ref}} for worker {{workerNo}}. Please open FW Manager app.","wa":"fwm_request_submitted"},"request_returned":{"label":"Returned for more info","group":"Requests","critical":false,"enabled":true,"recipients":["requester"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} returned: more info needed","sms":"Request {{ref}} returned for more info. Please open FW Manager app.","wa":"fwm_request_needs_info"},"request_recommended":{"label":"Recommended (waiting HR Admin)","group":"Requests","critical":false,"enabled":true,"recipients":["hr_admin"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} waiting for your approval","sms":"Request {{ref}} ({{type}}) waiting for your approval. Please open FW Manager app.","wa":"fwm_approval_pending"},"request_escalated":{"label":"Escalated to Super Admin","group":"Requests","critical":false,"enabled":true,"recipients":["super_admin"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} escalated to you","sms":"Request {{ref}} ({{type}}) escalated for your approval. Please open FW Manager app.","wa":"fwm_approval_pending"},"request_approved":{"label":"Approved","group":"Requests","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} approved","sms":"Request {{ref}} ({{type}}) approved. Please open FW Manager app.","wa":"fwm_request_approved"},"request_rejected":{"label":"Rejected","group":"Requests","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} rejected","sms":"Request {{ref}} ({{type}}) rejected. Please open FW Manager app.","wa":"fwm_request_rejected"},"request_completed":{"label":"Applied / closed","group":"Requests","critical":false,"enabled":true,"recipients":["requester"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{ref}} {{type}} completed","sms":"Request {{ref}} ({{type}}) completed. Please open FW Manager app.","wa":"fwm_request_completed"},"request_cancelled":{"label":"Cancelled by requester","group":"Requests","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true},"worker":{},"title":"{{ref}} {{type}} cancelled","sms":"Request {{ref}} cancelled."},"comment_added":{"label":"Comment on a request","group":"Requests","critical":false,"enabled":true,"recipients":["participants"],"channels":{"in_app":true,"push":true,"whatsapp":true},"worker":{},"title":"New comment on {{ref}}","sms":"New comment on request {{ref}}. Please open FW Manager app.","wa":"fwm_new_comment"},"approval_overdue":{"label":"Approval waiting > 24 h","group":"Requests","critical":true,"enabled":true,"recipients":["approver"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"⏰ {{ref}} {{type}} waiting over 24 h","sms":"Request {{ref}} ({{type}}) waiting over 24h for your approval. Please open FW Manager app.","wa":"fwm_approval_pending"},"emergency_submitted":{"label":"Emergency leave submitted","group":"Emergency leave","critical":true,"enabled":true,"recipients":["hr_manager","hr_admin"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"🚨 Emergency leave {{ref}}: {{worker}}","sms":"URGENT emergency leave {{ref}} for worker {{workerNo}}. Please review in FW Manager app.","wa":"fwm_emergency_leave"},"emergency_decided":{"label":"Emergency leave decided","group":"Emergency leave","critical":true,"enabled":true,"recipients":["requester","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{"whatsapp":true},"title":"Emergency leave {{ref}} {{status}}","sms":"Emergency leave {{ref}} for worker {{workerNo}} {{status}}. Please open FW Manager app.","workerSms":"Your emergency leave is {{status}}. Please contact your manager.","wa":"fwm_emergency_decided","workerWa":"fwm_worker_leave_update"},"leave_decided":{"label":"Leave decided (message to worker)","group":"Leave","critical":false,"enabled":true,"recipients":[],"channels":{},"worker":{"whatsapp":true},"title":"Leave {{ref}} {{status}}","sms":"","workerSms":"Your {{type}} is {{status}}. Please contact your manager for details.","workerWa":"fwm_worker_leave_update"},"proof_overdue":{"label":"Emergency proof still pending","group":"Emergency leave","critical":false,"enabled":true,"recipients":["requester","hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"Proof pending for {{ref}} ({{worker}})","sms":"Emergency leave {{ref}} proof documents overdue. Please upload in FW Manager app.","wa":"fwm_proof_pending"},"ticket_uploaded":{"label":"Flight ticket uploaded","group":"Tickets","critical":true,"enabled":true,"recipients":["outlet_manager","requester"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{"whatsapp":true},"title":"✈️ Ticket booked for {{worker}} — download","sms":"Flight ticket for worker {{workerNo}} booked (request {{ref}}). Download in FW Manager app.","workerSms":"Your flight ticket is ready. Please collect it from your manager.","wa":"fwm_ticket_ready","workerWa":"fwm_worker_ticket_ready"},"passport_consent_pending":{"label":"Passport consent pending signature","group":"Passport","critical":false,"enabled":true,"recipients":["outlet_manager","hr_manager"],"channels":{"in_app":true,"email":true,"whatsapp":true},"worker":{},"title":"{{count}} passport consent form(s) pending signature","sms":"Passport safekeeping consent pending for worker {{workerNo}}. Please open FW Manager app.","wa":"fwm_passport_consent_pending"},"passport_consent_uploaded":{"label":"Signed consent uploaded (verify)","group":"Passport","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"Verify passport consent: {{worker}}","sms":"Signed passport consent for worker {{workerNo}} uploaded. Please verify in FW Manager app.","wa":"fwm_passport_consent_uploaded"},"passport_consent_signed":{"label":"Consent verified","group":"Passport","critical":false,"enabled":true,"recipients":["outlet_manager"],"channels":{"in_app":true},"worker":{},"title":"Passport consent verified: {{worker}}","sms":"Passport consent for worker {{workerNo}} verified."},"passport_release_ready":{"label":"Passport ready for collection","group":"Passport","critical":true,"enabled":true,"recipients":["requester","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{"whatsapp":true},"title":"Passport of {{worker}} ready for collection","sms":"Passport of worker {{workerNo}} ready for collection (request {{ref}}).","workerSms":"Your passport is ready for collection from HR.","wa":"fwm_passport_ready","workerWa":"fwm_worker_passport_ready"},"passport_overdue":{"label":"Passport out of safe past return date","group":"Passport","critical":false,"enabled":true,"recipients":["hr_manager","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"Passport of {{worker}} not returned ({{days}} days late)","sms":"Passport of worker {{workerNo}} is {{days}} day(s) past expected return. Please open FW Manager app.","wa":"fwm_passport_overdue"},"doc_expiring":{"label":"Document expiring","group":"Documents","critical":false,"enabled":true,"recipients":["hr_manager","outlet_manager"],"channels":{"in_app":true,"email":true,"whatsapp":true},"worker":{},"title":"{{doc}} of {{worker}} expires in {{days}} days","sms":"{{doc}} of worker {{workerNo}} expires in {{days}} days. Please open FW Manager app.","wa":"fwm_document_expiring"},"doc_expired":{"label":"Document expired","group":"Documents","critical":true,"enabled":true,"recipients":["hr_manager","hr_admin","outlet_manager"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"❗ {{doc}} of {{worker}} EXPIRED","sms":"{{doc}} of worker {{workerNo}} EXPIRED on {{date}}. Please act in FW Manager app.","wa":"fwm_document_expired"},"remark_added":{"label":"Remark added by outlet manager","group":"Workers","critical":false,"enabled":true,"recipients":["hr_manager"],"channels":{"in_app":true,"whatsapp":true},"worker":{},"title":"New remark on {{worker}}","sms":"New remark on worker {{workerNo}}. Please open FW Manager app.","wa":"fwm_remark_added"},"user_awaiting_approval":{"label":"New user awaiting approval","group":"Users","critical":false,"enabled":true,"recipients":["user_admins"],"channels":{"in_app":true,"push":true,"email":true,"whatsapp":true},"worker":{},"title":"{{title}} is waiting for access","sms":"A new user is waiting for access. Please open FW Manager app.","wa":"fwm_user_waiting"},"daily_digest":{"label":"Daily digest","group":"Digest","critical":false,"enabled":true,"recipients":[],"channels":{"email":true},"worker":{},"title":"{{company}} daily summary","sms":"","wa":"fwm_daily_digest"}}}'::jsonb) on conflict (key) do nothing;

create or replace function public.notify_chan_on(c jsonb, ch text) returns boolean language sql immutable as $$
  select coalesce((c->'enabled'->>ch)::boolean, ch in ('in_app','push'))
$$;

/** SMS fallback for a WhatsApp delivery (failed / undelivered / no WhatsApp). Returns the new SMS delivery id or null. */
create or replace function public.notify_fallback(p_id bigint, p_reason text) returns bigint language plpgsql security definer set search_path = public as $$
declare d public.notification_deliveries; c jsonb := public.cfg('notifications'); f jsonb; nid bigint;
begin
  select * into d from public.notification_deliveries where id = p_id;
  if d.id is null or d.channel <> 'whatsapp' or coalesce(d.fallback_body, '') = '' or d.address is null then return null; end if;
  f := coalesce(c->'fallback', '{}'::jsonb);
  if not public.notify_chan_on(c, 'sms') or not coalesce((f->>'enabled')::boolean, true) then return null; end if;
  if p_reason = 'no_whatsapp' and not coalesce((f->>'onNoWhatsApp')::boolean, true) then return null; end if;
  if p_reason in ('failed','undelivered') and not coalesce((f->>'onFailed')::boolean, true) then return null; end if;
  if coalesce((f->>'criticalOnly')::boolean, true) and not d.critical then return null; end if;
  if d.event_id is not null and exists (select 1 from public.notification_deliveries x where x.event_id = d.event_id and x.channel = 'sms' and x.address = d.address) then return null; end if;
  insert into public.notification_deliveries (event_id, event, user_id, recipient, channel, address, title, body, link, critical, status, fallback_of, dedupe_key)
  values (d.event_id, d.event, d.user_id, d.recipient, 'sms', d.address, d.title, d.fallback_body, d.link, d.critical, 'queued', d.id, 'fb|' || d.id)
  on conflict (dedupe_key) do nothing returning id into nid;
  if nid is not null then
    update public.notification_deliveries set last_error = trim(coalesce(last_error, '') || ' → SMS fallback queued') where id = d.id;
  end if;
  return nid;
end $$;
revoke execute on function public.notify_fallback(bigint, text) from public, anon, authenticated;

/** Queue one event (v2: WhatsApp templates + opt-in + per-channel master switch). */
create or replace function public.notify(p_event text, p_worker text, p_request uuid, p_vars jsonb default '{}'::jsonb, p_dedupe text default null, p_users uuid[] default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  c jsonb := public.cfg('notifications'); ev jsonb; v jsonb; ev_id bigint; w jsonb; q public.requests; outlet text;
  rec record; ch text; addr text; st text; err text; crit boolean; n int := 0; tokens text[]; app text; link text;
  sender text; wphone text; did bigint; reqopt boolean; lang text; wlang text;
begin
  ev := c->'events'->p_event;
  if ev is null or coalesce((ev->>'enabled')::boolean, true) = false then return null; end if;
  crit := coalesce((ev->>'critical')::boolean, false);
  reqopt := coalesce((c->'whatsapp'->>'requireOptIn')::boolean, true);
  lang := coalesce(nullif(c->'whatsapp'->>'language', ''), 'en');
  if p_worker is not null then select data into w from public.records where entity = 'workers' and id = p_worker; end if;
  if p_request is not null then select * into q from public.requests where id = p_request; end if;
  outlet := coalesce(q.outlet_id, w->>'outletId');
  app := coalesce(nullif(c->>'appUrl', ''), 'https://moulisankar999.github.io/foreign-worker-manager/');
  link := app || case when p_request is not null then '#/requests/' || p_request
                      when p_worker is not null then '#/workers/' || p_worker else '#/' end;
  sender := coalesce(nullif(c->>'smsSender', ''), 'FWM');
  v := jsonb_build_object(
    'worker', coalesce(w->>'fullName', ''), 'workerNo', coalesce(w->>'workerNo', ''),
    'outlet', coalesce((select data->>'name' from public.records where entity = 'outlets' and id = outlet), ''),
    'company', coalesce((select data->>'companyName' from public.records where entity = 'settings' and id = 'app'), 'FW Manager'),
    'by', coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()), ''),
    'link', link, 'go', case when p_request is not null then 'requests/' || p_request when p_worker is not null then 'workers/' || p_worker else '' end,
    'date', to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'))
    || case when q.id is not null then jsonb_build_object('ref', 'R-' || q.ref_no, 'type', public.request_type_label(q.type), 'status', q.status, 'title', q.title,
         'since', to_char(q.updated_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon YYYY'),
         'status_ms', case q.status when 'approved' then 'diluluskan' when 'rejected' then 'ditolak' when 'completed' then 'selesai' when 'cancelled' then 'dibatalkan' else q.status end,
         'reason', coalesce((select e->>'label' from jsonb_array_elements(coalesce(public.cfg('emergency_reasons'), '[]'::jsonb)) e where e->>'key' = q.data->>'reasonKey' limit 1), q.data->>'reasonKey', ''))
       else '{}'::jsonb end
    || coalesce(p_vars, '{}'::jsonb);
  begin
    insert into public.notification_events (event, worker_id, request_id, vars, actor, dedupe_key)
    values (p_event, p_worker, p_request, v, auth.uid(), p_dedupe) returning id into ev_id;
  exception when unique_violation then return null; -- already queued (dedupe)
  end;

  select array(select jsonb_array_elements_text(coalesce(ev->'recipients', '[]'::jsonb))) into tokens;
  for rec in
    select distinct p.id, coalesce(nullif(p.full_name, ''), p.email) as name, p.email, p.phone, p.notify_optout, p.wa_optin
    from public.profiles p
    where p.status = 'active' and (p.id is distinct from auth.uid() or p_users is not null)
      and (case when p_users is not null then p.id = any(p_users) else (
           (p.role = any(tokens) and p.role <> 'outlet_manager')
        or ('outlet_manager' = any(tokens) and p.role = 'outlet_manager' and outlet is not null and outlet = any(p.outlet_ids))
        or ('requester' = any(tokens) and q.created_by = p.id)
        or ('participants' = any(tokens) and q.id is not null and (q.created_by = p.id or p.role = 'hr_manager'
              or exists (select 1 from public.request_events e where e.request_id = q.id and e.by = p.id)))
        or ('user_admins' = any(tokens) and (p.role = 'super_admin' or (p.role = 'hr_admin' and public.hr_flag('manageUsers'))))
        or ('approver' = any(tokens) and q.id is not null and p.role = case q.status when 'submitted' then 'hr_manager' when 'recommended' then 'hr_admin' when 'escalated' then 'super_admin' end)
      ) end)
      and (p.role <> 'outlet_manager' or outlet is null or outlet = any(p.outlet_ids) or q.created_by = p.id)
  loop
    foreach ch in array array['in_app','push','email','sms','whatsapp'] loop
      if not coalesce((ev->'channels'->>ch)::boolean, false) or not public.notify_chan_on(c, ch) then continue; end if;
      if ch = 'whatsapp' and coalesce(ev->>'wa', '') = '' then continue; end if;
      st := 'queued'; err := null; addr := null;
      if not crit and (p_event || ':' || ch = any(rec.notify_optout) or '*:' || ch = any(rec.notify_optout) or p_event || ':*' = any(rec.notify_optout)) then
        continue; -- personal opt-out (non-critical only)
      end if;
      if ch = 'email' then addr := rec.email; elsif ch in ('sms','whatsapp') then addr := public.e164_my(rec.phone); end if;
      if ch in ('email','sms','whatsapp') and addr is null then st := 'skipped'; err := 'no ' || case when ch = 'email' then 'email' else 'mobile number' end || ' on profile';
      elsif ch = 'whatsapp' and reqopt and not rec.wa_optin then st := 'skipped'; err := 'no WhatsApp opt-in';
      end if;
      if ch = 'in_app' then st := 'sent'; end if;
      did := null;
      insert into public.notification_deliveries (event_id, event, user_id, recipient, channel, address, title, body, link, critical, status, last_error, sent_at, dedupe_key,
        wa_template, wa_lang, vars, fallback_body)
      values (ev_id, p_event, rec.id, rec.name, ch, addr,
        public.notify_render(ev->>'title', v),
        case when ch in ('sms','whatsapp') then public.notify_sms_text(ev->>'sms', v, sender)
             when ch = 'email' then coalesce(nullif(public.notify_render(ev->>'email', v), ''), public.notify_render(ev->>'title', v))
             else public.notify_render(coalesce(nullif(ev->>'body', ''), ev->>'title'), v) end,
        link, crit, st, err, case when st = 'sent' then now() end,
        case when p_dedupe is not null then p_dedupe || '|' || rec.id || '|' || ch end,
        case when ch = 'whatsapp' then ev->>'wa' end, case when ch = 'whatsapp' then lang end, case when ch = 'whatsapp' then v end,
        case when ch = 'whatsapp' and coalesce(ev->>'sms', '') <> '' then public.notify_sms_text(ev->>'sms', v, sender) end)
      on conflict (dedupe_key) do nothing returning id into did;
      if did is not null and ch = 'whatsapp' and err = 'no WhatsApp opt-in' then perform public.notify_fallback(did, 'no_whatsapp'); end if;
      n := n + 1;
    end loop;
  end loop;

  -- the worker himself (phone in the worker record): WhatsApp template if opted in, else SMS fallback / SMS if enabled
  if p_worker is not null then
    wphone := public.e164_my(w->>'phoneMY');
    if coalesce((ev->'worker'->>'whatsapp')::boolean, false) and coalesce(ev->>'workerWa', '') <> '' and public.notify_chan_on(c, 'whatsapp') then
      wlang := coalesce(nullif(w->>'waLang', ''), nullif(c->'whatsapp'->>'workerLanguage', ''), 'en');
      st := case when wphone is null or (reqopt and not coalesce((w->>'waOptIn')::boolean, false)) then 'skipped' else 'queued' end;
      did := null;
      insert into public.notification_deliveries (event_id, event, recipient, channel, address, title, body, critical, status, last_error, dedupe_key, wa_template, wa_lang, vars, fallback_body)
      values (ev_id, p_event, 'Worker ' || coalesce(w->>'workerNo', ''), 'whatsapp', wphone, public.notify_render(ev->>'title', v),
        public.notify_sms_text(ev->>'workerSms', v, sender), crit, st,
        case when wphone is null then 'no mobile number on worker record' when st = 'skipped' then 'no WhatsApp opt-in' end,
        case when p_dedupe is not null then p_dedupe || '|worker|whatsapp' end, ev->>'workerWa', wlang, v,
        case when coalesce(ev->>'workerSms', '') <> '' then public.notify_sms_text(ev->>'workerSms', v, sender) end)
      on conflict (dedupe_key) do nothing returning id into did;
      if did is not null and st = 'skipped' and wphone is not null then perform public.notify_fallback(did, 'no_whatsapp'); end if;
      n := n + 1;
    end if;
    if coalesce((ev->'worker'->>'sms')::boolean, false) and coalesce(ev->>'workerSms', '') <> '' and public.notify_chan_on(c, 'sms') then
      insert into public.notification_deliveries (event_id, event, recipient, channel, address, title, body, critical, status, last_error, dedupe_key)
      values (ev_id, p_event, 'Worker ' || coalesce(w->>'workerNo', ''), 'sms', wphone, public.notify_render(ev->>'title', v),
        public.notify_sms_text(ev->>'workerSms', v, sender), crit,
        case when wphone is null then 'skipped' else 'queued' end, case when wphone is null then 'no mobile number on worker record' end,
        case when p_dedupe is not null then p_dedupe || '|worker|sms' end)
      on conflict (dedupe_key) do nothing;
      n := n + 1;
    end if;
  end if;
  update public.notification_events set recipients = n where id = ev_id;
  return ev_id;
end $$;
revoke execute on function public.notify(text, text, uuid, jsonb, text, uuid[]) from public, anon, authenticated;

/** WhatsApp delivery receipt (from the whatsapp-webhook function). Never downgrades read → delivered. */
create or replace function public.wa_status_update(p_wamid text, p_status text, p_error text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare d public.notification_deliveries; rk int; cur int;
begin
  select * into d from public.notification_deliveries where provider_id = p_wamid and channel = 'whatsapp' order by id desc limit 1;
  if d.id is null then return null; end if;
  rk := case p_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end;
  cur := case d.wa_status when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end;
  if rk = 0 or (rk <= cur and rk <> 4) then return d.id; end if;
  update public.notification_deliveries set wa_status = p_status, status_at = now(),
    status = case p_status when 'delivered' then 'delivered' when 'read' then 'read' when 'failed' then 'failed' else status end,
    delivered_at = case when p_status in ('delivered','read') then coalesce(delivered_at, now()) else delivered_at end,
    last_error = case when p_status = 'failed' then left(coalesce(p_error, 'WhatsApp: not delivered'), 300) else last_error end,
    cost = case when p_status = 'failed' then 0 else cost end
  where id = d.id;
  if p_status = 'failed' then perform public.notify_fallback(d.id, 'failed'); end if;
  return d.id;
end $$;
revoke execute on function public.wa_status_update(text, text, text) from public, anon, authenticated;

/** Inbound WhatsApp message: log it, link to user/worker; STOP / BERHENTI withdraws the WhatsApp opt-in. */
create or replace function public.wa_inbound_log(p_wamid text, p_from text, p_name text, p_type text, p_text text, p_context text, p_payload jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare num text := public.e164_my(p_from); uid uuid; wid text; act text;
begin
  select id into uid from public.profiles where public.e164_my(phone) = num limit 1;
  select id into wid from public.records where entity = 'workers' and not deleted and public.e164_my(data->>'phoneMY') = num limit 1;
  if upper(trim(coalesce(p_text, ''))) in ('STOP','BERHENTI','UNSUBSCRIBE','STOP ALL') then
    act := 'opt_out';
    if uid is not null then update public.profiles set wa_optin = false, wa_optin_at = now() where id = uid; end if;
    if wid is not null then
      update public.records set data = data || jsonb_build_object('waOptIn', false, 'waOptInAt', to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD'), 'waOptOutVia', 'WhatsApp STOP'),
        client_ts = greatest(client_ts, now()) where entity = 'workers' and id = wid;
    end if;
  end if;
  insert into public.whatsapp_inbound (wamid, from_number, profile_name, user_id, worker_id, type, text, context_id, payload, action)
  values (p_wamid, num, p_name, uid, wid, p_type, left(p_text, 4000), p_context, p_payload, act)
  on conflict (wamid) do nothing;
  return coalesce(act, 'logged');
end $$;
revoke execute on function public.wa_inbound_log(text, text, text, text, text, text, jsonb) from public, anon, authenticated;

/** WhatsApp accepted but not delivered after N minutes → SMS fallback (called from notify_sweep). */
create or replace function public.notify_wa_undelivered() returns int language plpgsql security definer set search_path = public as $$
declare c jsonb := public.cfg('notifications'); mins int; r record; n int := 0;
begin
  mins := coalesce((c->'fallback'->>'undeliveredMinutes')::int, 60);
  for r in select id from public.notification_deliveries where channel = 'whatsapp' and status = 'sent'
           and sent_at < now() - make_interval(mins => mins) and sent_at > now() - interval '2 days'
           and not exists (select 1 from public.notification_deliveries x where x.fallback_of = notification_deliveries.id)
  loop
    if public.notify_fallback(r.id, 'undelivered') is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.notify_wa_undelivered() from public, anon, authenticated;

-- v2 sweep / digest (passport return date var, WhatsApp undelivered fallback, WhatsApp digest)
create or replace function public.notify_sweep() returns jsonb language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  wk text := to_char(today, 'IYYY-IW');
  lead int[]; r record; n int := 0; c jsonb := public.cfg('notifications'); dt text; t time;
begin
  select coalesce(array(select jsonb_array_elements_text(data->'leadTimes')::int), array[90,60,30,7])
    into lead from public.records where entity = 'settings' and id = 'app';
  lead := coalesce(lead, array[90,60,30,7]);
  -- worker documents (passport, permit, FOMEMA, insurance …) of active workers
  for r in
    select w.id, d->>'type' as doc, (d->>'expiryDate')::date as exp, d->>'id' as did
    from public.records w cross join lateral jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) d
    where w.entity = 'workers' and not w.deleted
      and coalesce(w.data->>'status', '') not in ('Absconded','Resigned','Terminated','Contract Ended','Repatriated')
      and coalesce(d->>'expiryDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
  loop
    if r.exp < today then
      if public.notify('doc_expired', r.id, null, jsonb_build_object('doc', r.doc, 'date', r.exp::text), 'expired:' || r.id || ':' || r.did || ':' || wk) is not null then n := n + 1; end if;
    elsif (r.exp - today) = any(lead) then
      if public.notify('doc_expiring', r.id, null, jsonb_build_object('doc', r.doc, 'date', r.exp::text, 'days', (r.exp - today)::text), 'expiring:' || r.id || ':' || r.did || ':' || (r.exp - today)) is not null then n := n + 1; end if;
    end if;
  end loop;
  -- vault documents with expiry
  for r in select id, worker_id, category, expiry_date from public.documents where is_current and not deleted and expiry_date is not null loop
    if r.expiry_date < today then
      perform public.notify('doc_expired', r.worker_id, null, jsonb_build_object('doc', r.category, 'date', r.expiry_date::text), 'vexpired:' || r.id || ':' || wk);
    elsif (r.expiry_date - today) = any(lead) then
      perform public.notify('doc_expiring', r.worker_id, null, jsonb_build_object('doc', r.category, 'date', r.expiry_date::text, 'days', (r.expiry_date - today)::text), 'vexpiring:' || r.id || ':' || (r.expiry_date - today));
    end if;
  end loop;
  -- approvals waiting > 24 h (one reminder per stage per day)
  for r in select id, worker_id, status from public.requests where status in ('submitted','recommended','escalated') and updated_at < now() - interval '24 hours' loop
    if public.notify('approval_overdue', r.worker_id, r.id, '{}'::jsonb, 'overdue:' || r.id || ':' || r.status || ':' || today) is not null then n := n + 1; end if;
  end loop;
  -- emergency leave proof still missing after the grace period (weekly reminder)
  for r in
    select q.id, q.worker_id from public.requests q
    left join lateral (select e from jsonb_array_elements(coalesce(public.cfg('emergency_reasons'), '[]'::jsonb)) e where e->>'key' = q.data->>'reasonKey' limit 1) er on true
    where q.type = 'emergency_leave' and q.status in ('approved','completed')
      and coalesce(q.data->>'from', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and (q.data->>'from')::date + coalesce((er.e->>'proofDays')::int, 14) < today
      and not exists (select 1 from public.documents d where d.request_id = q.id and d.category = 'Emergency leave proof' and not d.deleted)
  loop
    perform public.notify('proof_overdue', r.worker_id, r.id, '{}'::jsonb, 'proof:' || r.id || ':' || wk);
  end loop;
  -- passport out of the safe past expected return (daily)
  for r in
    select id, (data->'passportSafe'->>'expectedReturn')::date as er from public.records
    where entity = 'workers' and not deleted and data->'passportSafe'->>'custody' = 'released'
      and coalesce(data->'passportSafe'->>'expectedReturn', '') ~ '^\d{4}-\d{2}-\d{2}$' and (data->'passportSafe'->>'expectedReturn')::date < today
  loop
    perform public.notify('passport_overdue', r.id, null, jsonb_build_object('days', (today - r.er)::text, 'date', to_char(r.er, 'DD Mon YYYY')), 'ppoverdue:' || r.id || ':' || today);
  end loop;
  -- consent forms issued > 3 days ago and still unsigned (weekly)
  for r in
    select id from public.records where entity = 'workers' and not deleted and data->'passportSafe'->>'consent' = 'pending'
      and coalesce(data->'passportSafe'->>'issuedAt', '') <> '' and (data->'passportSafe'->>'issuedAt')::timestamptz < now() - interval '3 days'
  loop
    perform public.notify('passport_consent_pending', r.id, null, '{"count":"1"}'::jsonb, 'consent:' || r.id || ':' || wk);
  end loop;
  -- WhatsApp accepted but never delivered → SMS fallback
  perform public.notify_wa_undelivered();
  -- daily digest at the configured Malaysia time
  t := coalesce(nullif(c->'digest'->>'time', ''), '08:00')::time;
  if coalesce((c->'digest'->>'enabled')::boolean, true) and (now() at time zone 'Asia/Kuala_Lumpur')::time >= t then
    perform public.notify_digest(today);
  end if;
  return jsonb_build_object('queued', n);
end $$;
revoke execute on function public.notify_sweep() from public, anon, authenticated;

create or replace function public.notify_digest(p_day date) returns void language plpgsql security definer set search_path = public as $$
declare p record; body text; ev jsonb := public.cfg('notifications')->'events'->'daily_digest'; mine int; exp int; soon int; cons int; outp int; outs text[]; staff boolean;
begin
  if ev is null or not coalesce((ev->>'enabled')::boolean, true) or not (coalesce((ev->'channels'->>'email')::boolean, false) or coalesce((ev->'channels'->>'whatsapp')::boolean, false)) then return; end if;
  for p in select * from public.profiles where status = 'active' and (email is not null or phone is not null) loop
    staff := p.role in ('super_admin','hr_admin','hr_manager','viewer');
    outs := p.outlet_ids;
    select count(*) into mine from public.requests q where
      (p.role = 'hr_manager' and q.status = 'submitted') or (p.role = 'hr_admin' and q.status = 'recommended')
      or (p.role = 'super_admin' and q.status = 'escalated') or (q.created_by = p.id and q.status = 'returned')
      or (p.role = 'hr_manager' and q.status = 'approved');
    select count(*) filter (where (d->>'expiryDate')::date < p_day), count(*) filter (where (d->>'expiryDate')::date between p_day and p_day + 30)
      into exp, soon
    from public.records w cross join lateral jsonb_array_elements(coalesce(w.data->'documents', '[]'::jsonb)) d
    where w.entity = 'workers' and not w.deleted and coalesce(d->>'expiryDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and coalesce(w.data->>'status', '') not in ('Absconded','Resigned','Terminated','Contract Ended','Repatriated')
      and (staff or (w.data->>'outletId') = any(outs));
    select count(*) filter (where data->'passportSafe'->>'consent' in ('pending','uploaded')),
           count(*) filter (where data->'passportSafe'->>'custody' = 'released')
      into cons, outp from public.records w
      where entity = 'workers' and not deleted and (staff or (w.data->>'outletId') = any(outs));
    if mine + exp + soon + cons + outp = 0 then continue; end if;
    body := 'Requests needing your action: ' || mine || E'\n' || 'Documents expired: ' || exp || E'\n' || 'Documents expiring in 30 days: ' || soon
      || E'\n' || 'Passport consents pending: ' || cons || E'\n' || 'Passports out of the safe: ' || outp;
    perform public.notify('daily_digest', null, null, jsonb_build_object('count', mine::text, 'soon', soon::text, 'expired', exp::text, 'date', to_char(p_day, 'DD Mon YYYY'), 'digest', body), 'digest:' || p_day || ':' || p.id, array[p.id]);
  end loop;
end $$;
revoke execute on function public.notify_digest(date) from public, anon, authenticated;

-- the signed-in user's own contact details, personal opt-outs and WhatsApp opt-in
drop function if exists public.update_my_contact(text, text[]);
create or replace function public.update_my_contact(p_phone text, p_optout text[], p_wa_optin boolean default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_phone), '') <> '' and coalesce(public.e164_my(p_phone), '') !~ '^\+\d{9,15}$' then raise exception 'Enter a valid mobile number, e.g. +60123456789'; end if;
  update public.profiles set phone = nullif(public.e164_my(p_phone), ''), notify_optout = coalesce(p_optout, '{}'),
    wa_optin = coalesce(p_wa_optin, wa_optin),
    wa_optin_at = case when p_wa_optin is not null and p_wa_optin is distinct from wa_optin then now() else wa_optin_at end
  where id = auth.uid();
end $$;
revoke execute on function public.update_my_contact(text, text[], boolean) from public, anon;
grant execute on function public.update_my_contact(text, text[], boolean) to authenticated;

-- "Send test": WhatsApp uses Meta's pre-approved 'hello_world' template (works before our templates are approved)
create or replace function public.notify_test(p_channel text) returns bigint language plpgsql security definer set search_path = public as $$
declare me public.profiles; addr text; v_id bigint; c jsonb := public.cfg('notifications'); st text; err text;
begin
  if not public.is_super() then raise exception 'Super Admin only'; end if;
  if p_channel not in ('push','email','sms','whatsapp') then raise exception 'Unknown channel'; end if;
  select * into me from public.profiles p where p.id = auth.uid();
  addr := case p_channel when 'email' then me.email when 'push' then null else public.e164_my(me.phone) end;
  st := 'queued';
  if p_channel in ('email','sms','whatsapp') and addr is null then st := 'skipped'; err := 'no ' || case when p_channel = 'email' then 'email' else 'mobile number' end || ' on your profile'; end if;
  insert into public.notification_deliveries (event, user_id, recipient, channel, address, title, body, link, critical, status, last_error, wa_template, wa_lang, vars)
  values ('test', me.id, coalesce(nullif(me.full_name, ''), me.email), p_channel, addr, 'FW Manager test message',
    case when p_channel in ('sms','whatsapp') then 'RM0 ' || coalesce(nullif(c->>'smsSender', ''), 'FWM') || ': Test message. Notifications are working.'
         else 'Test message from FW Manager. Notifications are working.' end,
    coalesce(nullif(c->>'appUrl', ''), '') || '#/settings', true, st, err,
    case when p_channel = 'whatsapp' then 'hello_world' end, case when p_channel = 'whatsapp' then 'en_US' end, '{}'::jsonb)
  returning notification_deliveries.id into v_id;
  return v_id;
end $$;
revoke execute on function public.notify_test(text) from public, anon;
grant execute on function public.notify_test(text) to authenticated;

commit;
