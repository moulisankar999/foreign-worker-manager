/* Notification events: who gets what, on which channel. Super Admin edits this in Settings → Notifications
 * (stored in app_config 'notifications'). The server (SQL) resolves recipients and queues deliveries;
 * the 'notify-dispatch' Edge Function sends them through the configured providers. */
export type Channel = 'in_app' | 'push' | 'email' | 'sms' | 'whatsapp'
export const CHANNELS: Channel[] = ['in_app', 'push', 'email', 'sms', 'whatsapp']
export const CHANNEL_LABEL: Record<Channel, string> = { in_app: 'In-app', push: 'Push', email: 'Email', sms: 'SMS (fallback)', whatsapp: 'WhatsApp' }
export const CHANNEL_ENABLED: Record<Channel, boolean> = { in_app: true, push: true, email: true, sms: true, whatsapp: true }
/** recipient tokens: roles (scoped by the worker's outlet for outlet_manager), the requester, the next approver, user admins */
export type Recipient = 'super_admin' | 'hr_admin' | 'hr_manager' | 'outlet_manager' | 'requester' | 'approver' | 'user_admins' | 'participants'
export const RECIPIENT_LABEL: Record<Recipient, string> = {
  super_admin: 'Super Admin', hr_admin: 'HR Admins', hr_manager: 'HR Managers', outlet_manager: "Worker's outlet manager",
  requester: 'Requester', approver: 'Next approver', user_admins: 'User admins', participants: 'Everyone on the request',
}
export interface EventRule {
  label: string; group: string
  critical: boolean // ignores quiet hours and personal opt-out
  enabled: boolean
  recipients: Recipient[]
  channels: Partial<Record<Channel, boolean>>
  worker: Partial<Record<'sms' | 'whatsapp' | 'email', boolean>> // message the worker himself (his phone/email in the worker record)
  title: string // push / in-app / email subject
  sms: string // sent as 'RM0 <sender>: <text>'; no links, phone numbers, names or ID numbers (blocked by MY carriers since 1 Sep 2024)
  workerSms?: string
  email?: string
  wa?: string // approved WhatsApp template name (see supabase/functions/_shared/wa-templates.json)
  workerWa?: string // template for the worker himself
}
export interface NotifyConfig {
  /** master switch per channel (Super Admin). Outbound providers stay OFF until their keys are set. */
  enabled: Record<Channel, boolean>
  appUrl: string
  smsSender: string // short company name after the mandatory 'RM0 ' prefix (Malaysian carrier rule)
  email: { fromName: string; fromEmail: string }
  quietHours: { enabled: boolean; start: string; end: string } // Malaysia time; non-critical push/SMS/email wait until the end
  digest: { enabled: boolean; time: string }
  rateLimitPerHour: { sms: number; email: number; whatsapp: number }
  costs: { sms: number; email: number; whatsapp: number } // RM estimate per message
  whatsapp: { language: 'en' | 'ms'; workerLanguage: 'en' | 'ms'; requireOptIn: boolean }
  /** SMS (OneWaySMS) is only a fallback: when WhatsApp fails / is not delivered in time / the person has no WhatsApp opt-in */
  fallback: { enabled: boolean; onFailed: boolean; onNoWhatsApp: boolean; undeliveredMinutes: number; criticalOnly: boolean }
  events: Record<string, EventRule>
}
// WhatsApp is the primary outbound channel; email carries full details; SMS is off (fallback only)
const ia = { in_app: true, push: true }
const iaw = { in_app: true, push: true, whatsapp: true }
const iae = { in_app: true, push: true, email: true, whatsapp: true }
const all = iae
const R = (label: string, group: string, recipients: Recipient[], channels: EventRule['channels'], title: string, sms: string, extra: Partial<EventRule> = {}): EventRule =>
  ({ label, group, critical: false, enabled: true, recipients, channels, worker: {}, title, sms, ...extra })
export const NOTIFY_VARS = ['worker', 'workerNo', 'outlet', 'type', 'ref', 'status', 'by', 'comment', 'title', 'days', 'doc', 'date', 'link', 'company', 'count']
export const DEFAULT_NOTIFY: NotifyConfig = {
  enabled: { in_app: true, push: true, email: false, sms: false, whatsapp: false },
  appUrl: 'https://moulisankar999.github.io/foreign-worker-manager/',
  smsSender: 'FWM',
  email: { fromName: 'FW Manager', fromEmail: '' },
  quietHours: { enabled: true, start: '22:00', end: '07:00' },
  digest: { enabled: true, time: '08:00' },
  rateLimitPerHour: { sms: 6, email: 30, whatsapp: 6 },
  costs: { sms: 0.115, email: 0.002, whatsapp: 0.0564 }, // WhatsApp utility template, Malaysia
  whatsapp: { language: 'en', workerLanguage: 'en', requireOptIn: true },
  fallback: { enabled: true, onFailed: true, onNoWhatsApp: true, undeliveredMinutes: 60, criticalOnly: true },
  events: {
    request_submitted: R('Request submitted', 'Requests', ['hr_manager'], iae, '{{ref}} {{type}} for {{worker}}', 'New {{type}} request {{ref}} for worker {{workerNo}}. Please open FW Manager app.', { wa: 'fwm_request_submitted' }),
    request_returned: R('Returned for more info', 'Requests', ['requester'], iae, '{{ref}} returned: more info needed', 'Request {{ref}} returned for more info. Please open FW Manager app.', { wa: 'fwm_request_needs_info' }),
    request_recommended: R('Recommended (waiting HR Admin)', 'Requests', ['hr_admin'], iae, '{{ref}} {{type}} waiting for your approval', 'Request {{ref}} ({{type}}) waiting for your approval. Please open FW Manager app.', { wa: 'fwm_approval_pending' }),
    request_escalated: R('Escalated to Super Admin', 'Requests', ['super_admin'], iae, '{{ref}} {{type}} escalated to you', 'Request {{ref}} ({{type}}) escalated for your approval. Please open FW Manager app.', { wa: 'fwm_approval_pending' }),
    request_approved: R('Approved', 'Requests', ['requester', 'hr_manager'], iae, '{{ref}} {{type}} approved', 'Request {{ref}} ({{type}}) approved. Please open FW Manager app.', { wa: 'fwm_request_approved' }),
    request_rejected: R('Rejected', 'Requests', ['requester', 'hr_manager'], iae, '{{ref}} {{type}} rejected', 'Request {{ref}} ({{type}}) rejected. Please open FW Manager app.', { wa: 'fwm_request_rejected' }),
    request_completed: R('Applied / closed', 'Requests', ['requester'], iae, '{{ref}} {{type}} completed', 'Request {{ref}} ({{type}}) completed. Please open FW Manager app.', { wa: 'fwm_request_completed' }),
    request_cancelled: R('Cancelled by requester', 'Requests', ['hr_manager'], ia, '{{ref}} {{type}} cancelled', 'Request {{ref}} cancelled.'),
    comment_added: R('Comment on a request', 'Requests', ['participants'], iaw, 'New comment on {{ref}}', 'New comment on request {{ref}}. Please open FW Manager app.', { wa: 'fwm_new_comment' }),
    approval_overdue: R('Approval waiting > 24 h', 'Requests', ['approver'], all, '⏰ {{ref}} {{type}} waiting over 24 h', 'Request {{ref}} ({{type}}) waiting over 24h for your approval. Please open FW Manager app.', { critical: true , wa: 'fwm_approval_pending' }),
    emergency_submitted: R('Emergency leave submitted', 'Emergency leave', ['hr_manager', 'hr_admin'], all, '🚨 Emergency leave {{ref}}: {{worker}}', 'URGENT emergency leave {{ref}} for worker {{workerNo}}. Please review in FW Manager app.', { critical: true , wa: 'fwm_emergency_leave' }),
    emergency_decided: R('Emergency leave decided', 'Emergency leave', ['requester', 'outlet_manager'], all, 'Emergency leave {{ref}} {{status}}', 'Emergency leave {{ref}} for worker {{workerNo}} {{status}}. Please open FW Manager app.', { critical: true, worker: { whatsapp: true }, workerSms: 'Your emergency leave is {{status}}. Please contact your manager.' , wa: 'fwm_emergency_decided', workerWa: 'fwm_worker_leave_update' }),
    leave_decided: R('Leave decided (message to worker)', 'Leave', [], {}, 'Leave {{ref}} {{status}}', '', { worker: { whatsapp: true }, workerSms: 'Your {{type}} is {{status}}. Please contact your manager for details.' , workerWa: 'fwm_worker_leave_update' }),
    proof_overdue: R('Emergency proof still pending', 'Emergency leave', ['requester', 'hr_manager'], iae, 'Proof pending for {{ref}} ({{worker}})', 'Emergency leave {{ref}} proof documents overdue. Please upload in FW Manager app.', { wa: 'fwm_proof_pending' }),
    ticket_uploaded: R('Flight ticket uploaded', 'Tickets', ['outlet_manager', 'requester'], all, '✈️ Ticket booked for {{worker}} — download', 'Flight ticket for worker {{workerNo}} booked (request {{ref}}). Download in FW Manager app.', { critical: true, worker: { whatsapp: true }, workerSms: 'Your flight ticket is ready. Please collect it from your manager.' , wa: 'fwm_ticket_ready', workerWa: 'fwm_worker_ticket_ready' }),
    passport_consent_pending: R('Passport consent pending signature', 'Passport', ['outlet_manager', 'hr_manager'], { in_app: true, email: true, whatsapp: true }, '{{count}} passport consent form(s) pending signature', 'Passport safekeeping consent pending for worker {{workerNo}}. Please open FW Manager app.', { wa: 'fwm_passport_consent_pending' }),
    passport_consent_uploaded: R('Signed consent uploaded (verify)', 'Passport', ['hr_manager'], iae, 'Verify passport consent: {{worker}}', 'Signed passport consent for worker {{workerNo}} uploaded. Please verify in FW Manager app.', { wa: 'fwm_passport_consent_uploaded' }),
    passport_consent_signed: R('Consent verified', 'Passport', ['outlet_manager'], { in_app: true }, 'Passport consent verified: {{worker}}', 'Passport consent for worker {{workerNo}} verified.'),
    passport_release_ready: R('Passport ready for collection', 'Passport', ['requester', 'outlet_manager'], all, 'Passport of {{worker}} ready for collection', 'Passport of worker {{workerNo}} ready for collection (request {{ref}}).', { critical: true, worker: { whatsapp: true }, workerSms: 'Your passport is ready for collection from HR.' , wa: 'fwm_passport_ready', workerWa: 'fwm_worker_passport_ready' }),
    passport_overdue: R('Passport out of safe past return date', 'Passport', ['hr_manager', 'outlet_manager'], iae, 'Passport of {{worker}} not returned ({{days}} days late)', 'Passport of worker {{workerNo}} is {{days}} day(s) past expected return. Please open FW Manager app.', { wa: 'fwm_passport_overdue' }),
    doc_expiring: R('Document expiring', 'Documents', ['hr_manager', 'outlet_manager'], { in_app: true, email: true, whatsapp: true }, '{{doc}} of {{worker}} expires in {{days}} days', '{{doc}} of worker {{workerNo}} expires in {{days}} days. Please open FW Manager app.', { wa: 'fwm_document_expiring' }),
    doc_expired: R('Document expired', 'Documents', ['hr_manager', 'hr_admin', 'outlet_manager'], all, '❗ {{doc}} of {{worker}} EXPIRED', '{{doc}} of worker {{workerNo}} EXPIRED on {{date}}. Please act in FW Manager app.', { critical: true , wa: 'fwm_document_expired' }),
    remark_added: R('Remark added by outlet manager', 'Workers', ['hr_manager'], { in_app: true, whatsapp: true }, 'New remark on {{worker}}', 'New remark on worker {{workerNo}}. Please open FW Manager app.', { wa: 'fwm_remark_added' }),
    user_awaiting_approval: R('New user awaiting approval', 'Users', ['user_admins'], iae, '{{title}} is waiting for access', 'A new user is waiting for access. Please open FW Manager app.', { wa: 'fwm_user_waiting' }),
    daily_digest: R('Daily digest', 'Digest', [], { email: true }, '{{company}} daily summary', '', { wa: 'fwm_daily_digest' }),
  },
}

/* ---------- SMS rules (Malaysia, since 1 Sep 2024): carriers block URLs, phone numbers and requests for personal details ---------- */
export const smsPrefix = (sender: string) => `RM0 ${(sender || 'FWM').trim().slice(0, 20)}: `
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|my|net|org|io|app|link|ly)\b|\{\{\s*link\s*\}\})/i
const PHONE_RE = /(\+?\d[\d\s-]{7,}\d)/
const PERSONAL_RE = /(\{\{\s*(worker|by|comment|title|outlet)\s*\}\}|\b(ic|mykad|passport no|bank account|ic no)\b)/i
export interface SmsCheck { ok: boolean; errors: string[]; warnings: string[]; length: number; preview: string }
export function checkSms(text: string, sender: string): SmsCheck {
  const errors: string[] = [], warnings: string[] = []
  const t = text.trim()
  if (t && URL_RE.test(t)) errors.push('No links/URLs in SMS (blocked by Malaysian carriers). Say "Please open FW Manager app" instead.')
  if (t && PHONE_RE.test(t.replace(/\{\{[^}]+\}\}/g, ''))) errors.push('No phone numbers in SMS.')
  if (t && PERSONAL_RE.test(t)) errors.push('Use {{workerNo}} (employee code) — no names, outlet names, comments, IC/passport or bank details in SMS.')
  if (/[^\x20-\x7E]/.test(t)) errors.push('English/Malay plain text only (no emoji or special characters).')
  const sample = t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => ({ ref: 'R-1042', workerNo: 'FW0001', type: 'Annual leave', status: 'approved', days: '30', doc: 'Passport', date: '2026-11-01', count: '3' } as Record<string, string>)[k] ?? k)
  const preview = t ? smsPrefix(sender) + sample : ''
  if (preview.length > 160) warnings.push(`About ${preview.length} characters — over 160 is sent as 2 SMS (double cost).`)
  return { ok: !errors.length, errors, warnings, length: preview.length, preview }
}
