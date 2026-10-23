/* General Manager powers: the CEO decides which of the CEO's powers a General Manager may use.
 * Default: all on. Enforced by the database (has_power / gm_can) and the Edge Functions; the app only hides buttons. */
export interface PowerGroup { key: string; label: string; icon: string; powers: { key: string; label: string; help?: string }[] }
export const POWER_GROUPS: PowerGroup[] = [
  { key: 'users', label: 'Users & approvals', icon: '👥', powers: [
    { key: 'users.approve', label: 'Approve or reject new sign-ups' },
    { key: 'users.create', label: 'Add users directly (HR Admin, HR Manager, Outlet Manager)', help: 'Never a General Manager or the CEO' },
    { key: 'users.roles', label: 'Change roles, companies and outlets of users', help: 'Never the CEO or another General Manager' },
    { key: 'users.manage', label: 'Pause, resume or delete users', help: 'Never the CEO or another General Manager' },
    { key: 'users.reset', label: 'Reset passwords of users' },
    { key: 'users.audit', label: 'See the audit log' },
  ] },
  { key: 'hr', label: 'HR Admin permissions', icon: '🧑‍💼', powers: [
    { key: 'hr.flags', label: 'Change what HR Admins may do' },
    { key: 'hr.approvers', label: 'Choose which HR Admins may approve sign-ups' },
  ] },
  { key: 'org', label: 'Companies, outlets & logos', icon: '🏢', powers: [
    { key: 'org.companies', label: 'Add / edit companies and move outlets between companies' },
    { key: 'org.outlets', label: 'Add / edit outlets' },
    { key: 'org.logos', label: 'Change company and outlet logos' },
  ] },
  { key: 'workers', label: 'Workers & documents', icon: '🧾', powers: [
    { key: 'workers.edit', label: 'Add and edit workers' },
    { key: 'workers.delete', label: 'Delete workers' },
    { key: 'workers.salary', label: 'See salary and remittance details' },
    { key: 'workers.vault', label: 'Document vault settings (sizes, restricted categories)' },
  ] },
  { key: 'requests', label: 'Requests & approvals', icon: '✅', powers: [
    { key: 'requests.final', label: 'Final approval of requests', help: 'Off → the CEO gives final approval' },
    { key: 'requests.loans', label: 'Final approval of loans and salary advances' },
    { key: 'requests.increments', label: 'Final approval of salary increments' },
    { key: 'requests.cancel', label: 'Cancel other people’s requests' },
    { key: 'requests.rules', label: 'Change approval rules and limits' },
    { key: 'requests.emergency', label: 'Edit emergency-leave reasons' },
  ] },
  { key: 'passport', label: 'Passport & consent', icon: '🛂', powers: [
    { key: 'passport.settings', label: 'Passport safekeeping settings' },
    { key: 'passport.consent', label: 'Edit consent-form translations' },
  ] },
  { key: 'notifications', label: 'Notifications', icon: '🔔', powers: [
    { key: 'notifications.settings', label: 'Notification settings, delivery log and WhatsApp' },
    { key: 'notifications.test', label: 'Send test notifications and retry failed ones' },
  ] },
  { key: 'agencies', label: 'Agencies & integrations', icon: '🔗', powers: [
    { key: 'agencies.edit', label: 'Edit agency links and integrations' },
  ] },
  { key: 'data', label: 'Data & backup', icon: '💾', powers: [
    { key: 'data.export', label: 'Export / back up data' },
    { key: 'data.import', label: 'Import data' },
    { key: 'data.demo', label: 'Remove sample (DEMO) data' },
  ] },
  { key: 'compliance', label: 'Compliance settings & rates', icon: '📏', powers: [
    { key: 'compliance.settings', label: 'Compliance settings' },
    { key: 'compliance.rates', label: 'Statutory rates (EPF, SOCSO, levy…)' },
  ] },
]
export const ALL_POWERS = POWER_GROUPS.flatMap((g) => g.powers.map((p) => p.key))
export type PowerMap = Record<string, boolean>
/** effective checklist: missing keys are ON */
export const withDefaults = (m: PowerMap | null | undefined): PowerMap => Object.fromEntries(ALL_POWERS.map((k) => [k, m?.[k] !== false]))
