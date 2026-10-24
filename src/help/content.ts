/* Help content for FW Manager (staff roles). One source for the in-app Help page (FAQ / User manual)
 * and the printed PDF manuals (scripts/manuals/build.mjs). Plain data only — no imports — so the PDF
 * builder can bundle it on its own. Step numbers match the red numbered markers on the screenshots. */

export type HelpRole = 'ceo' | 'gm' | 'hra' | 'hrm' | 'om' | 'viewer'
export const ALL: HelpRole[] = ['ceo', 'gm', 'hra', 'hrm', 'om', 'viewer']
const STAFF_WRITE: HelpRole[] = ['ceo', 'gm', 'hra', 'hrm']
const HR: HelpRole[] = ['ceo', 'gm', 'hra', 'hrm']

/** app role key (profiles.role) → help role */
export function helpRoleOf(role?: string | null): HelpRole {
  switch (role) {
    case 'super_admin': case 'admin': return 'ceo'
    case 'general_manager': return 'gm'
    case 'hr_admin': return 'hra'
    case 'hr_manager': case 'manager': return 'hrm'
    case 'outlet_manager': return 'om'
    default: return 'viewer'
  }
}

/** file name of each role's PDF in the private "manuals" storage bucket (all lower-case: no case-only clashes) */
export const MANUAL_FILE: Record<HelpRole, string | null> = {
  ceo: 'fwm-manual-ceo.pdf', gm: 'fwm-manual-general-manager.pdf', hra: 'fwm-manual-hr-admin.pdf',
  hrm: 'fwm-manual-hr-manager.pdf', om: 'fwm-manual-outlet-manager.pdf', viewer: null,
}
export const WORKER_MANUAL_FILE = 'fw-worker-manual.pdf'

export const ROLE_TITLE: Record<HelpRole, string> = {
  ceo: 'CEO', gm: 'General Manager', hra: 'HR Admin', hrm: 'HR Manager', om: 'Outlet Manager', viewer: 'Viewer (read only)',
}

export interface RoleInfo {
  purpose: string
  sees: string[]
  can: string[]
  cannot: string[]
  reportsTo: string
  approvals: string
  daily: string[]
}

export const CHAIN = ['Worker (FW Worker app)', 'Outlet Manager', 'HR Manager', 'HR Admin', 'General Manager', 'CEO']

export const ROLE_INFO: Record<HelpRole, RoleInfo> = {
  ceo: {
    purpose: 'The CEO is the owner of FW Manager. You see everything, set the rules every other role works by, and have the final word on any decision. Only one person should hold this role.',
    sees: ['Every company, outlet and worker, including salary, loans and confidential requests', 'Every request at every step, with its full history', 'CEO review: every General Manager decision and every rejection', 'The audit log, Control Center (health, errors, system map) and all reports', 'The Apple-review demo company — only when you switch "Show demo data" on'],
    can: ['Do anything any other role can do', 'Overrule, amend, recall or mark reviewed any decided request (CEO review)', 'Assign or escalate a request to any person at any level', 'Add, pause, resume, reset and delete any user and set each role\'s powers (General Manager powers, HR Admin limits)', 'Set approval rules, request types, required printed submissions, notifications and backups', 'Give the final approval on signed-off printed submissions', 'Switch the demo data on or off and run the Control Center checks'],
    cannot: ['The audit history is permanent — every action, including yours, is recorded', 'Worker app PINs are shown once and never stored in readable form', 'Deleting a user is permanent, so use Pause when someone may return; workers are set to Exited, never deleted'],
    reportsTo: 'No one in the app. You review the General Manager\'s decisions.',
    approvals: 'Requests reach you only when you pull them (Recall), when someone assigns them to you, or when your approval rules send them to the CEO. Every General Manager decision and every rejection appears in CEO review for you to check.',
    daily: ['Open CEO review and clear the badge (mark reviewed, or overrule)', 'Look at the Dashboard red/amber cards and the Alerts badge', 'Check Required submissions for anything waiting for your final approval', 'Once a week: Control Center health and the latest backup'],
  },
  gm: {
    purpose: 'The General Manager runs day-to-day administration and makes the final decision on requests after HR Admin. You lead the HR team, keep requests moving and own the admin areas set out in "General Manager powers".',
    sees: ['All companies, outlets and workers', 'All requests and their history', 'Salary details and the audit log, as set in General Manager powers', 'Reports, alerts and compliance for every outlet'],
    can: ['Make the final decision (approve or reject) on requests escalated by HR Admin', 'Assign or escalate a request to any person at any level', 'Return a request for more information', 'Add, edit and manage workers and their documents', 'Manage users and settings through your General Manager powers', 'Review printed submissions after HR Admin has verified them'],
    cannot: [],
    reportsTo: 'CEO.',
    approvals: 'Requests come to you after HR Admin escalates them. Your decision is final.',
    daily: ['Requests → "Needs my action": approve, reject or return', 'Assign stuck requests to the right person', 'Check the Dashboard and Alerts', 'Review printed submissions waiting for you'],
  },
  hra: {
    purpose: 'HR Admin checks what HR Manager has recommended and approves requests within the approval limits. You keep HR running smoothly and send larger or unusual requests to the General Manager.',
    sees: ['All workers of your companies/outlets', 'All requests at HR Admin level and below', 'Salary and the audit log, as set in the HR Admin settings', 'Alerts, compliance and reports'],
    can: ['Approve, reject, return, or escalate requests to the General Manager', 'Add and edit workers, upload documents, renew permits', 'Generate, reset, revoke and unlock workers\' app PINs', 'Manage users (add, reset, pause/resume) when user management is part of your HR Admin settings', 'Verify printed submissions prepared by HR Manager'],
    cannot: ['Requests above your limit go to the General Manager with one tap (Escalate)'],
    reportsTo: 'General Manager.',
    approvals: 'Requests come to you after HR Manager recommends them. You approve within your limit or escalate to the General Manager.',
    daily: ['Requests → "Needs my action"', 'Alerts: permits, passports and medicals expiring', 'Verify printed submissions', 'Help HR Manager with stuck worker records'],
  },
  hrm: {
    purpose: 'HR Manager keeps the worker records correct and complete, reviews every request first, and applies approved requests to the worker\'s record.',
    sees: ['All workers of your companies/outlets, their documents and history', 'Requests at HR Manager level and below', 'Alerts, compliance and reports (salary as set for your role)'],
    can: ['Add, edit and update workers using the step-by-step form', 'Upload, scan and renew documents (passport, PLKS, FOMEMA, insurance…)', 'Recommend & send up, return for info, or reject requests', 'Apply approved requests to the worker record and close them', 'Generate, reset, revoke and unlock workers\' app PINs', 'Prepare printed submissions and start the sign-off'],
    cannot: ['Final approvals are made by HR Admin and the General Manager, after your recommendation'],
    reportsTo: 'HR Admin.',
    approvals: 'Requests come to you from outlet managers and from workers (after the outlet manager approves, or automatically if the outlet manager does not answer in time). You recommend them up to HR Admin.',
    daily: ['Requests → "Needs my action" (including "Approved – to apply")', 'Alerts: what expires soon, renewals to start', 'Keep new workers\' records and documents complete', 'Prepare the printed submissions that are due'],
  },
  om: {
    purpose: 'The Outlet Manager leads the workers of his own outlet(s): checks their documents, adds remarks, raises requests for them and is the first to decide on what workers ask in the FW Worker app.',
    sees: ['The workers of your outlet(s)', 'Requests for your outlet(s) (confidential ones are handled by HR)', 'Alerts and reports for your outlet(s)'],
    can: ['Raise requests for your workers (leave, advance, transfer…)', 'Approve → send to HR, or reject, requests that workers raise in the app', 'Add remarks and upload documents/photos for your workers', 'Print reports for your outlet'],
    cannot: ['Salary details and other outlets are handled by HR', 'HR keeps each worker\'s master record up to date from your remarks and documents', 'After your approval, HR and management make the final decision', 'Worker PIN resets are handled by HR'],
    reportsTo: 'HR Manager.',
    approvals: 'Requests from your workers come to you first. Approve → it goes to HR Manager. If you do not answer in time, it goes to HR automatically.',
    daily: ['Requests → "Needs my action" (worker requests)', 'Alerts for your outlet', 'Add remarks when something happens with a worker', 'Upload any paper the worker gives you'],
  },
  viewer: {
    purpose: 'Viewer is a read-only role, for example for an auditor or an owner\'s representative.',
    sees: ['Workers, documents, alerts and reports (no salary details)'],
    can: ['Search and open workers', 'Read alerts and print reports'],
    cannot: ['Viewer is a read-only role: changes and requests are made by the other roles'],
    reportsTo: 'CEO.',
    approvals: 'None — viewers do not approve.',
    daily: ['Look up workers and print reports when needed'],
  },
}

export interface Guide {
  id: string
  group: string
  title: string
  roles: HelpRole[]
  intro?: string
  steps: string[]
  /** screenshot id(s) in /manuals/shots (PDF only) */
  shots?: string[]
  tip?: string
  important?: string
}

export const GROUPS = ['Getting started', 'Workers', 'Documents', 'Requests', 'Alerts & compliance', 'Reports & submissions', 'Users & access', 'Worker app access', 'Settings & system']

export const GUIDES: Guide[] = [
  /* ---------------- Getting started ---------------- */
  { id: 'install', group: 'Getting started', title: 'Install FW Manager (Android, iPhone, web)', roles: ALL,
    intro: 'FW Manager works in a web browser and as an app on Android phones and iPhones/iPads. Your data is the same everywhere.',
    steps: ['Android: open Settings → About in FW Manager on the web (HR can also send you the link) and tap "Download Android app". Open the downloaded file and allow "Install unknown apps" for your browser when asked.',
      'iPhone / iPad: install FW Manager from the App Store (or the TestFlight invitation sent by the CEO). Open it once and allow notifications.',
      'Web: open the FW Manager address in Chrome, Edge or Safari. On a phone use "Add to Home screen" to get an app icon.',
      'Sign in with the email and password the CEO or HR Admin gave you.'],
    shots: ['about'],
    tip: 'After an update, Android shows a small "New version" note on the About tab. Install it the same way — your data stays.' },
  { id: 'signin', group: 'Getting started', title: 'Sign in', roles: ALL,
    steps: ['Type your work email.', 'Type your password.', 'Tap "Sign in". The first time, the app copies your workers to this device — wait until the dashboard appears.'],
    shots: ['login'],
    important: 'Never share your password. Each person must have their own account — every action is recorded under your name.' },
  { id: 'signout', group: 'Getting started', title: 'Sign out or switch user', roles: ALL,
    steps: ['Tap your initials (the round avatar) at the top right.', 'Tap "Switch user / Sign out" and confirm.'],
    shots: ['usermenu-signout'],
    tip: 'If the app warns that changes are not uploaded yet, connect to the internet and wait a moment before signing out, or those changes are lost.' },
  { id: 'password', group: 'Getting started', title: 'Change your password', roles: ALL,
    steps: ['Tap your initials at the top right.', 'Tap "Change password".', 'Type your current password and the new one twice, then tap Save.'],
    shots: ['usermenu-password', 'changepw'],
    tip: 'Forgot your password? The CEO or HR Admin resets it for you in Settings → Users & access.' },
  { id: 'dashboard', group: 'Getting started', title: 'Read the Dashboard', roles: ALL,
    steps: ['The cards at the top show headcount and what needs attention. Red means overdue or expired, amber means soon.', 'Tap any card or bar to open the matching list.', 'Use the menu (left on a computer, bottom bar on a phone) to move between Workers, Requests, Alerts and More.'],
    shots: ['dashboard'] },
  { id: 'help', group: 'Getting started', title: 'Find help in the app', roles: ALL,
    steps: ['Open Help (left menu on a computer, More → Help on a phone).', 'My role shows what you are responsible for. FAQ answers common questions — use the search box.', 'User manual lists every task step by step. Tap "Download PDF manual" for the illustrated manual for your role.'],
    shots: ['help'] },

  /* ---------------- Workers ---------------- */
  { id: 'find-worker', group: 'Workers', title: 'Find a worker', roles: ALL,
    steps: ['Open Workers.', 'Type a name, passport number or worker number in the search box.', 'Use the filters (outlet, status, nationality) to narrow the list.', 'Tap a worker to open the worker page.'],
    shots: ['workers'] },
  { id: 'add-worker', group: 'Workers', title: 'Add a new worker (step-by-step form)', roles: STAFF_WRITE,
    intro: 'The form has steps. A green tick shows a finished step; you can save as a draft and come back.',
    steps: ['Workers → "Add worker".', 'Personal: worker ID, name, nationality, date of birth, phone. Tap "Take photo" for the worker\'s photo.', 'Job: company, outlet, job and join date.', 'Documents: passport, PLKS / visa, FOMEMA, insurance numbers and expiry dates.', 'Contract & pay: contract dates and pay. Tap "Next →" to move on — a red note shows anything that must be fixed.', 'Family, address & remittance: next of kin, home address and remittance account (can be filled later).', 'Review & submit: check the summary and tap "Submit" (or "Save as draft" if something is still missing).'],
    shots: ['worker-add'],
    tip: 'The app warns you if the passport number already exists, so you do not add the same worker twice.' },
  { id: 'edit-worker', group: 'Workers', title: 'Edit a worker', roles: STAFF_WRITE,
    steps: ['Open the worker.', 'Tap "Edit" at the top.', 'Change what you need in any step and tap "Save".'],
    shots: ['worker-edit'],
    tip: 'Every change is kept in the worker\'s Timeline tab with who changed it and when.' },
  { id: 'remove-worker', group: 'Workers', title: 'Remove a worker (exit or delete)', roles: STAFF_WRITE,
    intro: 'When a worker leaves, set their status — do not delete. Exited workers keep their history for audits.',
    steps: ['Open the worker → "Check status" tab (or Contract & exit).', 'Choose the new status (Exited, Absconded, Transferred…) and the effective date, add a remark and save.', 'Workers are never deleted from the app, so their history stays for audits. For a record added by mistake, set the status to Exited, add the remark "added by mistake" and tell the CEO.'],
    shots: ['worker-status'],
    important: 'Setting a worker to Exited also stops his FW Worker app access.' },
  { id: 'remarks', group: 'Workers', title: 'Add a remark about a worker', roles: ['ceo', 'gm', 'hra', 'hrm', 'om'],
    steps: ['Open the worker → Remarks tab.', 'Type what happened (late, warning, good work, injury…) and tap Add.'],
    shots: ['worker-remarks'],
    tip: 'Outlet managers use remarks to tell HR about anything important. HR sees them straight away.' },

  /* ---------------- Documents ---------------- */
  { id: 'upload', group: 'Documents', title: 'Upload a document or take a photo', roles: ['ceo', 'gm', 'hra', 'hrm', 'om'],
    steps: ['Open the worker → Vault tab.', 'Tap "Add / scan".', 'Tap "📷 Scan page" to use the camera (one photo per page), or choose a file.', 'Choose the category (Passport, PLKS / Visa, FOMEMA / Medical, MC…), add a title and expiry date if it has one, and tap "Save to vault". Large photos are made smaller automatically.'],
    shots: ['vault', 'vault-add'],
    tip: 'Several pages are joined into one PDF. Uploading again into the same document keeps the old copy as an earlier version.' },
  { id: 'renew', group: 'Documents', title: 'Renew a document (PLKS, passport, FOMEMA, insurance)', roles: STAFF_WRITE,
    steps: ['Alerts (or the Dashboard expiry card) shows what expires soon.', 'Open the worker → Expiry docs tab.', 'Enter the new number and expiry date and upload the new copy.', 'Save. The alert clears once the new date is beyond the warning period.'],
    shots: ['alerts', 'worker-expiry'] },
  { id: 'passport-custody', group: 'Documents', title: 'Passport custody (release and return)', roles: STAFF_WRITE,
    steps: ['A worker\'s passport may be kept only with his signed consent (Passport tab).', 'To release it, approve a "Passport release" request; the app prints a release slip.', 'When it comes back, mark it returned. Overdue passports appear in Alerts.'],
    shots: ['worker-passport'] },

  /* ---------------- Requests ---------------- */
  { id: 'chain', group: 'Requests', title: 'How a request travels (approval chain)', roles: ALL,
    intro: 'Worker → Outlet Manager → HR Manager → HR Admin → General Manager. Each step approves, rejects or returns the request, and the timeline shows every step.',
    steps: ['A worker raises a request in FW Worker, or a manager raises one in FW Manager.', 'Outlet Manager approves worker requests (→ HR) or rejects them.', 'HR Manager checks and recommends (→ HR Admin), returns for information, or rejects.', 'HR Admin approves within limit, or escalates to the General Manager.', 'General Manager gives the final decision.', 'HR Manager applies the approved request to the worker record and closes it.'],
    shots: ['requests'] },
  { id: 'raise', group: 'Requests', title: 'Raise a request', roles: ['ceo', 'gm', 'hra', 'hrm', 'om'],
    steps: ['Requests → "New request".', 'Choose the type (Annual leave, Advance, Transfer…).', 'Choose the worker and fill the details (dates, amount, reason).', 'Attach a document if needed.', 'Tap "Submit request". It goes to the next person in the chain.'],
    shots: ['request-new'] },
  { id: 'om-decide', group: 'Requests', title: 'Approve or reject a worker\'s app request (Outlet Manager)', roles: ['om', 'hrm', 'hra', 'gm', 'ceo'],
    steps: ['Requests → "Needs my action" and open the request marked 📱 worker / "Raised by worker (app)".', 'Read the details and the worker\'s note.', 'Tap "Approve → send to HR" or "Reject" and write a short reason.'],
    shots: ['request-om-list', 'request-om'],
    tip: 'If you do not answer in time, the request goes to HR automatically so the worker is not left waiting.' },
  { id: 'decide', group: 'Requests', title: 'Approve, reject or return a request', roles: ['hrm', 'hra', 'gm', 'ceo'],
    steps: ['Requests → "Needs my action" and open the request.', 'Check the details, attachments and history.', 'Choose: "Recommend & send up" (HR Manager), "Approve" (HR Admin / GM), "Return for info" or "Reject".', 'Write a comment (required for return and reject) and confirm.'],
    shots: ['request-detail'] },
  { id: 'apply', group: 'Requests', title: 'Apply an approved request to the worker record', roles: ['hrm', 'hra', 'gm', 'ceo'],
    steps: ['Requests → "Needs my action" shows requests marked "Approved – to apply".', 'Open the request and tap "Apply to worker record & close".', 'Check the changes the app will make (leave balance, pay, outlet…) and tap "Apply & close".'],
    shots: ['request-apply'] },
  { id: 'assign', group: 'Requests', title: 'Assign or escalate a request (CEO / General Manager)', roles: ['ceo', 'gm'],
    intro: 'Use Assign to move a request to a specific person at any level — for example when someone is on leave or the request needs a different decision-maker.',
    steps: ['Open the request.', 'Under Actions, tap "Assign…".', 'Choose the Role, then the Person (the list shows the people who can see this request), and add a note if you like — staff only, the worker never sees it.', 'Tap "Assign". The person is notified and the request moves to their queue; the request shows "Assigned to: <name>" at the top, and while assigned, that person makes the decision.'],
    shots: ['request-assign', 'request-assign-modal'],
    tip: 'Skipped steps are recorded in the timeline.' },
  { id: 'ceo-review', group: 'Requests', title: 'CEO review: overrule, amend, recall, mark reviewed', roles: ['ceo'],
    steps: ['Open CEO review (left menu, or More on a phone). "To review" shows the decisions waiting for you; "Any request (recall)" lets you pick any request.', 'Open a decision and read its history.', 'Mark reviewed — you agree with the decision; it moves to "Reviewed".', 'Overrule… — choose Your decision (Approve, Amend, Reject, Cancel, Recall to me or Keep — mark reviewed), write the reason and tap "Confirm — final decision". The request is then locked: only you can change it.', 'Amend — change the amount, dates or details with a change note; the original stays in the history. Tick "Amend details only — keep it moving" to leave it at its current step instead of deciding it.', 'Recall — take the request back for your own decision. On any request page you can also use "Overrule / amend / recall / review…".'],
    shots: ['ceo-review', 'ceo-overrule'] },
  { id: 'cancel', group: 'Requests', title: 'Cancel or resubmit a request', roles: ['ceo', 'gm', 'hra', 'hrm', 'om'],
    steps: ['Open your request.', 'Tap "Cancel request" while it is still open, or "Resubmit" after it was returned to you with the missing information added.'],
    shots: ['request-cancel'] },

  /* ---------------- Alerts & compliance ---------------- */
  { id: 'alerts', group: 'Alerts & compliance', title: 'Alerts and expiries', roles: ALL,
    steps: ['Open Alerts (the bell). Red = expired/overdue, amber = due soon.', 'Use the filters to see one outlet or one document type.', 'Tap an alert to open the worker and fix it.'],
    shots: ['alerts'],
    tip: 'Phone alerts (push and WhatsApp) can be set in Settings → Notifications.' },
  { id: 'compliance', group: 'Alerts & compliance', title: 'Compliance (outlet risk, hostels, hiring, PDPA)', roles: STAFF_WRITE,
    steps: ['Open Compliance.', 'Outlet risk ranks outlets by open problems.', 'Hostels: add each hostel with its certificate and capacity; record inspections.', 'Hiring: track each hiring batch step by step.', 'PDPA: record any personal-data incident and what was done.'],
    shots: ['compliance'] },

  /* ---------------- Reports & submissions ---------------- */
  { id: 'reports', group: 'Reports & submissions', title: 'Print or export a report', roles: ALL,
    steps: ['Open Reports.', 'Choose a report from the library (headcount, expiries, leave, passport register…).', 'Set the filters (company, outlet, dates).', 'Tap Print for an A4 page, or Export for Excel.'],
    shots: ['reports'] },
  { id: 'submissions', group: 'Reports & submissions', title: 'Required printed submissions and sign-off', roles: HR,
    intro: 'Some reports must be printed and signed regularly. Sign-off order: HR Manager prepares → HR Admin verifies → General Manager reviews → final approval.',
    steps: ['Reports → "Required submissions" shows what is due or overdue.', 'Open the task, check the report and tap your sign-off step.', 'Print it, sign the paper, and upload the signed copy if asked.', 'The next person is notified automatically.'],
    shots: ['submissions'],
    tip: 'Settings → Requests & submissions lists which reports are required and how often.' },

  /* ---------------- Users & access ---------------- */
  { id: 'add-user', group: 'Users & access', title: 'Add a user', roles: ['ceo', 'gm', 'hra'],
    intro: 'Add and manage users in Settings → Users & access.',
    steps: ['Settings → Users & access → "Add user".', 'Type the name and email and choose the role.', 'For HR and Outlet Managers choose their companies / outlets.', 'Save. Give the person the temporary password shown, or let them set one from the email.'],
    shots: ['users'] },
  { id: 'manage-user', group: 'Users & access', title: 'Reset password, pause, resume or delete a user', roles: ['ceo', 'gm', 'hra'],
    steps: ['Settings → Users & access and find the person.', 'Reset password — gives a new temporary password.', 'Pause — the person cannot sign in until resumed (use for leave or suspension).', 'Resume — allows sign-in again.', 'Delete — removes the account permanently (their history stays).'],
    shots: ['users-manage'],
    important: 'Pause instead of delete when someone may come back.' },
  { id: 'approve-signup', group: 'Users & access', title: 'Approve a new sign-up', roles: ['ceo', 'gm', 'hra'],
    steps: ['Settings → Users & access lists people who signed up and are pending (the tab shows a badge).', 'Choose the role and outlets and approve, or reject.'],
    shots: ['users-approve'] },
  { id: 'gm-powers', group: 'Users & access', title: 'Set General Manager and HR Admin powers', roles: ['ceo'],
    steps: ['Settings → Users & access → "General Manager powers" card.', 'Switch each power on or off (manage users, see salary, delete workers, settings…).', 'For HR Admin use the "HR Admin" permissions card on the same tab (manage users, see salary, see audit).', 'Changes apply immediately.'],
    shots: ['users-gm', 'users-hra'] },

  /* ---------------- Worker app access ---------------- */
  { id: 'pin-generate', group: 'Worker app access', title: 'Give a worker access to FW Worker (generate PIN)', roles: HR,
    intro: 'Workers sign in to FW Worker with their passport number and a 6-digit PIN.',
    steps: ['Open the worker → "📱 App access" tab.', 'Tap "Generate PIN".', 'The PIN is shown only once. Give it to the worker privately (or print the slip).', 'Tap "I have given it to the worker". The worker should change it after first sign-in.'],
    shots: ['app-access'],
    important: 'The PIN is never shown again. If it is lost, use Reset PIN.' },
  { id: 'pin-manage', group: 'Worker app access', title: 'Reset, unlock, revoke or restore a worker PIN', roles: HR,
    steps: ['Open the worker → "📱 App access".', 'Reset PIN — makes a new PIN and signs the worker out on all phones.', 'Unlock — after too many wrong PINs the account locks; unlock it once you have spoken to the worker.', 'Revoke — stops all access (e.g. the worker left). Restore turns it back on.'],
    shots: ['app-access-manage'] },

  /* ---------------- Settings & system ---------------- */
  { id: 'settings', group: 'Settings & system', title: 'Settings tabs', roles: ALL,
    steps: ['Account — your name, theme, password.', 'Users & access — people and their roles (for user managers).', 'Agencies, Organisation, Workers, Pay, Passport — company lists and rules.', 'Requests — request types, approval limits, required submissions.', 'Notifications — push and WhatsApp alerts.', 'Data & backup — export, backups, offline copy. About — version and app downloads.'],
    shots: ['settings'] },
  { id: 'notifications', group: 'Settings & system', title: 'Phone alerts (push / WhatsApp)', roles: ALL,
    steps: ['Settings → Notifications.', 'Under "Phone alerts" tap "Turn on phone alerts" and allow notifications when your phone or browser asks.', 'Under "My alerts" add your mobile number for WhatsApp / SMS and untick the events you do not want.'],
    tip: 'On iPhone, first add FW Manager to the Home Screen (Safari → Share → Add to Home Screen), then turn on phone alerts.',
    shots: ['notifications'] },
  { id: 'backup', group: 'Settings & system', title: 'Backups and export', roles: ['ceo', 'gm', 'hra'],
    steps: ['Settings → Data & backup.', '"Last backup" shows when this device last made a backup copy. The cloud database is also backed up automatically every day.', 'Tap "Download backup (JSON)" for an extra safety copy before big changes.', '"Restore / import backup" brings a backup back (replace or merge). "Sync now" uploads waiting changes.'],
    shots: ['backup'],
    tip: 'Backups contain personal data. Keep any downloaded file private.' },
  { id: 'demo', group: 'Settings & system', title: 'Demo data switch (Apple review company)', roles: ['ceo'],
    steps: ['Tap your initials at the top right.', 'Tick "Show demo data" to include the demo company in totals, alerts and reports. Untick it to hide it again.'],
    shots: ['usermenu-demo'],
    tip: 'The demo company exists only for Apple\'s app review. Keep it hidden for daily work.' },
  { id: 'control', group: 'Settings & system', title: 'Control Center (health, errors, system map)', roles: ['ceo'],
    steps: ['Open Software Control (left menu or More).', 'Control Center shows the health checks (sync, backups, storage, renewals). Red needs action.', 'Errors lists app errors from all devices with how often they happened.', 'Know-how / System Map explains how the parts fit together.'],
    shots: ['control'] },
]

export interface Faq { q: string; a: string; roles: HelpRole[] }

export const FAQS: Faq[] = [
  { roles: ALL, q: 'I forgot my password. What do I do?', a: 'The CEO or HR Admin resets it in Settings → Users & access. You get a temporary password; change it after you sign in (your initials → Change password).' },
  { roles: ALL, q: 'Does the app work without internet?', a: 'Yes. Your workers are copied to the device so you can look things up offline. Changes are saved and uploaded automatically when you are back online. Do not sign out while changes are waiting to upload.' },
  { roles: ALL, q: 'Why does a colleague have a button I do not?', a: 'Each role has the buttons for its own work — for example, HR roles have "App access". Help → My role lists yours.' },
  { roles: ALL, q: 'How do I switch between light and dark mode?', a: 'Tap your initials at the top right and choose Light, Dark or Auto.' },
  { roles: ALL, q: 'Can two people share one account?', a: 'No. Every action is recorded under the signed-in person, so everyone gets their own account.' },
  { roles: ALL, q: 'Where do I get the PDF manual?', a: 'Help → User manual → "Download PDF manual". You get the manual for your own role.' },
  { roles: ALL, q: 'How do I install the app on a new phone?', a: 'Android: Settings → About → "Download Android app". iPhone: App Store (or the TestFlight invitation). Then sign in with your email — your data comes down automatically.' },
  { roles: ALL, q: 'What do the red and amber colours mean?', a: 'Red means expired or overdue — act now. Amber means due soon. Green is fine.' },

  { roles: ['om'], q: 'Which workers do I see?', a: 'You see the workers of your own outlet(s). If a worker is missing, tell HR and they will correct the worker\'s outlet.' },
  { roles: ['om'], q: 'A worker sent a request from the app. What do I do?', a: 'Open it from Requests ("Raised by worker (app)"). Tap "Approve → send to HR" or "Reject" with a reason. If you do not answer in time it goes to HR automatically.' },
  { roles: ['om'], q: 'How do I get a worker\'s details changed?', a: 'Add a remark or upload the document; HR updates the master record from it.' },
  { roles: ['om'], q: 'The worker forgot his app PIN.', a: 'HR Manager or HR Admin resets the PIN from the worker\'s App access tab — let them know.' },
  { roles: ['om'], q: 'Where are salary details?', a: 'Salary is handled by HR and management, so it does not appear in the Outlet Manager screens.' },
  { roles: ['om'], q: 'Can I raise a leave request for a worker without a phone?', a: 'Yes. Requests → New request, choose the worker and fill the dates. It goes to HR Manager.' },
  { roles: ['om'], q: 'How do I report something about a worker?', a: 'Open the worker → Remarks and write what happened. HR sees it immediately.' },

  { roles: ['hrm'], q: 'What is the difference between "Return for info" and "Reject"?', a: 'Return sends the request back to the person who raised it to add missing information; it can be resubmitted. Reject ends it. Both need a comment.' },
  { roles: ['hrm'], q: 'A request is approved. Is the worker record updated automatically?', a: 'No. Open it from Requests → "Needs my action" (status "Approved – to apply") and tap "Apply to worker record & close" so leave balances, pay or outlet are updated.' },
  { roles: ['hrm', 'hra'], q: 'How do I give a worker the FW Worker app?', a: 'Worker → "📱 App access" → Generate PIN. The worker signs in with his passport number and that PIN. The PIN is shown only once.' },
  { roles: ['hrm', 'hra'], q: 'The worker\'s app says "locked".', a: 'After too many wrong PINs the account locks. Speak to the worker, then App access → Unlock (or Reset PIN if he forgot it).' },
  { roles: ['hrm', 'hra', 'gm', 'ceo'], q: 'I added the same worker twice.', a: 'The app blocks a duplicate worker ID and warns about a repeated passport. If it still happened, set the extra record to Exited with the remark "duplicate" and tell the CEO.' },
  { roles: ['hrm', 'hra', 'gm', 'ceo'], q: 'A worker left. Should I delete him?', a: 'No — set the status to Exited with the date (Check status tab). His history stays for audits and the app access is stopped.' },
  { roles: ['hrm', 'hra', 'gm', 'ceo'], q: 'How do I scan a passport or document with the camera?', a: 'Open the worker → Vault → "Add / scan", choose Passport and scan the pages with the camera. Hold the page flat in good light.' },
  { roles: ['hrm'], q: 'What do I do with a required printed submission?', a: 'Reports → Required submissions → open the task, check and prepare the report, then sign off your step. HR Admin is notified to verify it.' },
  { roles: ['hrm', 'hra'], q: 'Which document photos are best?', a: 'Flat, bright, no shadow, all four corners visible. The app shrinks large photos automatically.' },

  { roles: ['hra'], q: 'When do I escalate instead of approving?', a: 'When the amount or type is above your limit (the app shows it), or when management should decide. Escalate sends it to the General Manager.' },
  { roles: ['hra'], q: 'How do I add users?', a: 'When user management is part of your HR Admin settings, use Settings → Users & access → Add user.' },
  { roles: ['hra'], q: 'How do I move a request to someone else?', a: 'Tap Escalate to send it to the General Manager.' },
  { roles: ['hra'], q: 'What does "verify" mean on a submission?', a: 'You check the report HR Manager prepared is complete and correct, then sign off. It then goes to the General Manager.' },

  { roles: ['gm'], q: 'Is my approval final?', a: 'Yes. Your decision is final and the request moves on to be applied to the worker record.' },
  { roles: ['gm', 'ceo'], q: 'When should I use Assign…?', a: 'When a request is stuck (someone is on leave) or needs a particular person. Under Actions tap \"Assign…\", choose the Role and Person and add a note; they are notified and make the decision at that step. Steps in between are marked as skipped in the timeline.' },
  { roles: ['gm'], q: 'Which settings do I manage?', a: 'The ones in your General Manager powers (Settings → Users & access shows them).' },
  { roles: ['gm'], q: 'Do I approve printed submissions?', a: 'You review them after HR Admin has verified them; they then move on for final approval.' },
  { roles: ['gm', 'hra'], q: 'Where is the audit log?', a: 'Settings → Users & access → Audit log, when audit access is part of your role settings.' },

  { roles: ['ceo'], q: 'What is CEO review?', a: 'A list of every General Manager decision and every rejection. Mark each reviewed, or overrule, amend or recall it. The badge shows how many are waiting.' },
  { roles: ['ceo'], q: 'What is the difference between Overrule, Amend and Recall?', a: 'Overrule flips the decision (approve ↔ reject) with your reason. Amend corrects details and keeps the original values in history. Recall pulls the request back to you, open, to decide later.' },
  { roles: ['ceo'], q: 'How do I give the General Manager more powers?', a: 'Settings → Users & access → "General Manager powers". Switch each power on or off; it applies immediately.' },
  { roles: ['ceo'], q: 'What is the "Show demo data" switch?', a: 'The demo company exists only for Apple\'s app review. It is hidden from totals, alerts and reports unless you tick "Show demo data" in your account menu.' },
  { roles: ['ceo'], q: 'How do I know the system is healthy?', a: 'Software Control → Control Center. Green checks are fine; red needs action. The Errors tab lists app errors from every device.' },
  { roles: ['ceo'], q: 'How are backups made?', a: 'The cloud database is backed up automatically every day (the Control Center shows its status). Settings → Data & backup lets you download an extra JSON copy or restore one.' },
  { roles: ['ceo'], q: 'Someone left the company. Pause or delete?', a: 'Pause first. Delete only when you are sure; their history stays in the audit log either way.' },
  { roles: ['ceo'], q: 'Can I see what a worker sees in FW Worker?', a: 'Workers see their own documents, requests and simple status only (e.g. "With HR Admin") — never internal notes or managers\' names.' },
  { roles: ['viewer'], q: 'What is the Viewer role for?', a: 'Viewer is a read-only role for looking things up and printing reports.' },
]

export const guidesFor = (r: HelpRole) => GUIDES.filter((g) => g.roles.includes(r))
export const faqsFor = (r: HelpRole) => FAQS.filter((f) => f.roles.includes(r))
