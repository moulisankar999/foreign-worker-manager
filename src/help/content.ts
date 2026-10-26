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
/** the approval chain as one role sees it: up to their own step and the next step they send to (nothing higher) */
export const chainFor = (r: HelpRole): string[] => {
  if (r === 'ceo') return CHAIN
  const me = CHAIN.findIndex((c) => c.startsWith(ROLE_TITLE[r]))
  return me < 0 ? [] : CHAIN.slice(0, Math.min(me + 2, CHAIN.length - 1))
}

export const ROLE_INFO: Record<HelpRole, RoleInfo> = {
  ceo: {
    purpose: 'The CEO is the owner of FW Manager. You see everything, set the rules every other role works by. Only one person should hold this role.',
    sees: ['Every company, outlet and worker, including salary, loans and confidential requests', 'Every request at every step, with its full history', 'CEO review: every General Manager decision and every rejection', 'The audit log, Control Center (health, errors, system map) and all reports', 'SAMPLE companies and the app-review demo company — only when you switch "Show sample & demo data" on'],
    can: ['Do anything any other role can do', 'Overrule, amend, recall or mark reviewed any decided request (CEO review)', 'Assign or escalate a request to any person at any level', 'Add, pause, resume, reset and delete any user and set each role\'s powers (General Manager powers, HR Admin limits)', 'Set approval rules, request types, required printed submissions, notifications and backups', 'Approve signed-off printed submissions', 'Switch the demo data on or off and run the Control Center checks'],
    cannot: ['The audit history is permanent — every action, including yours, is recorded', 'Worker app PINs are shown once and never stored in readable form', 'Deleting a user is permanent, so use Pause when someone may return; workers are set to Exited, never deleted'],
    reportsTo: 'No one in the app. You review the General Manager\'s decisions.',
    approvals: 'Requests reach you only when you pull them (Recall), when someone assigns them to you, or when your approval rules send them to the CEO. Every General Manager decision and every rejection appears in CEO review for you to check.',
    daily: ['Open CEO review and clear the badge (mark reviewed, or overrule)', 'Look at the Dashboard red/amber cards and the Alerts badge', 'Check Required submissions for anything waiting for your approval', 'Once a week: Control Center health and the latest backup'],
  },
  gm: {
    purpose: 'The General Manager runs day-to-day administration and decides requests after HR Admin. You lead the HR team, keep requests moving and own the admin areas set out in "General Manager powers".',
    sees: ['All companies, outlets and workers', 'All requests and their history', 'Salary details and the audit log, as set in General Manager powers', 'Reports, alerts and compliance for every outlet'],
    can: ['Approve or reject requests escalated by HR Admin', 'Assign a request to anyone at your level or below, or send it on to the next approval step', 'Return a request for more information', 'Add, edit and manage workers and their documents', 'Manage users and settings through your General Manager powers', 'Review printed submissions after HR Admin has verified them'],
    cannot: [],
    reportsTo: 'Your admin.',
    approvals: 'Requests come to you after HR Admin escalates them.',
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
    cannot: ['After your recommendation, a request moves on to the next approval step'],
    reportsTo: 'HR Admin.',
    approvals: 'Requests come to you from outlet managers and from workers (after the outlet manager approves, or automatically if the outlet manager does not answer in time). You recommend them up to HR Admin.',
    daily: ['Requests → "Needs my action" (including "Approved – to apply")', 'Alerts: what expires soon, renewals to start', 'Keep new workers\' records and documents complete', 'Prepare the printed submissions that are due'],
  },
  om: {
    purpose: 'The Outlet Manager leads the workers of his own outlet(s): checks their documents, adds remarks, raises requests for them and is the first to decide on what workers ask in the FW Worker app.',
    sees: ['The workers of your outlet(s)', 'Requests for your outlet(s) (confidential ones are handled by HR)', 'Alerts and reports for your outlet(s)'],
    can: ['Raise requests for your workers (leave, advance, transfer…)', 'Approve → send to HR, or reject, requests that workers raise in the app', 'Add remarks and upload documents/photos for your workers', 'Print reports for your outlet'],
    cannot: ['Salary details and other outlets are handled by HR', 'HR keeps each worker\'s master record up to date from your remarks and documents', 'After your approval, the request moves on to HR', 'Worker PIN resets are handled by HR'],
    reportsTo: 'HR Manager.',
    approvals: 'Requests from your workers come to you first. Approve → it goes to HR Manager. If you do not answer in time, it goes to HR automatically.',
    daily: ['Requests → "Needs my action" (worker requests)', 'Alerts for your outlet', 'Add remarks when something happens with a worker', 'Upload any paper the worker gives you'],
  },
  viewer: {
    purpose: 'Viewer is a read-only role, for example for an auditor or an owner\'s representative.',
    sees: ['Workers, documents, alerts and reports (no salary details)'],
    can: ['Search and open workers', 'Read alerts and print reports'],
    cannot: ['Viewer is a read-only role: changes and requests are made by the other roles'],
    reportsTo: 'Your admin.',
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

export const GROUPS = ['Getting started', 'Workers', 'Documents', 'Requests', 'Alerts & compliance', 'Reports & submissions', 'Approval & Recruitment', 'Users & access', 'Worker app access', 'Settings & system']

export const GUIDES: Guide[] = [
  /* ---------------- Getting started ---------------- */
  { id: 'install', group: 'Getting started', title: 'Install FW Manager (Android, iPhone, web)', roles: ALL,
    intro: 'FW Manager works in a web browser and as an app on Android phones and iPhones/iPads. Your data is the same everywhere.',
    steps: ['Android: open Settings → About in FW Manager on the web (HR can also send you the link) and tap "Download Android app". Open the downloaded file and allow "Install unknown apps" for your browser when asked.',
      'iPhone / iPad: install FW Manager from the App Store (or the TestFlight invitation you received). Open it once and allow notifications.',
      'Web: open the FW Manager address in Chrome, Edge or Safari. On a phone use "Add to Home screen" to get an app icon.',
      'Sign in with the email and password your admin gave you.'],
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
    tip: 'Forgot your password? Your admin resets it for you in Settings → Users & access.' },
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
    steps: ['Open the worker → "Check status" tab (or Contract & exit).', 'Choose the new status (Exited, Absconded, Transferred…) and the effective date, add a remark and save.', 'Workers are never deleted from the app, so their history stays for audits. For a record added by mistake, set the status to Exited, add the remark "added by mistake" and tell your admin.'],
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
  { id: 'chain', group: 'Requests', title: 'How a request travels (approval chain)', roles: ['ceo', 'gm'],
    intro: 'Worker → Outlet Manager → HR Manager → HR Admin → General Manager. Each step approves, rejects or returns the request, and the timeline shows every step.',
    steps: ['A worker raises a request in FW Worker, or a manager raises one in FW Manager.', 'Outlet Manager approves worker requests (→ HR) or rejects them.', 'HR Manager checks and recommends (→ HR Admin), returns for information, or rejects.', 'HR Admin approves within limit, or escalates to the General Manager.', 'General Manager decides.', 'HR Manager applies the approved request to the worker record and closes it.'],
    shots: ['requests'] },
  { id: 'chain-hra', group: 'Requests', title: 'How a request travels (approval chain)', roles: ['hra'],
    intro: 'Worker → Outlet Manager → HR Manager → HR Admin → General Manager. Each step approves, rejects or returns the request, and the timeline shows every step.',
    steps: ['A worker raises a request in FW Worker, or a manager raises one in FW Manager.', 'Outlet Manager approves worker requests (→ HR) or rejects them.', 'HR Manager checks and recommends (→ HR Admin), returns for information, or rejects.', 'You approve within your limit, or escalate to the General Manager for the decision.', 'HR Manager applies the approved request to the worker record and closes it.'],
    shots: ['requests'] },
  { id: 'chain-hrm', group: 'Requests', title: 'How a request travels (approval chain)', roles: ['hrm'],
    intro: 'Worker → Outlet Manager → HR Manager → HR Admin, then the higher approval steps. Each step approves, rejects or returns the request, and the timeline shows every step.',
    steps: ['A worker raises a request in FW Worker, or a manager raises one in FW Manager.', 'Outlet Manager approves worker requests (→ HR) or rejects them.', 'You check and recommend (→ HR Admin), return for information, or reject.', 'The approval steps above you decide; the timeline shows when it is decided.', 'You apply the approved request to the worker record and close it.'],
    shots: ['requests'] },
  { id: 'chain-om', group: 'Requests', title: 'How a request travels (approval chain)', roles: ['om', 'viewer'],
    intro: 'Worker → Outlet Manager → HR. Each step approves, rejects or returns the request, and the timeline shows every step.',
    steps: ['A worker raises a request in FW Worker, or a manager raises one in FW Manager.', 'Outlet Manager approves worker requests (→ HR) or rejects them.', 'HR checks it and it goes through the approval steps; the timeline shows when it is decided.', 'HR applies the approved request to the worker record and closes it.'],
    shots: ['requests'] },
  { id: 'raise', group: 'Requests', title: 'Raise a request', roles: ['ceo', 'gm', 'hra', 'hrm', 'om'],
    steps: ['Requests → "New request".', 'Choose the type (Annual leave, Advance, Transfer…).', 'Choose the worker and fill the details (dates, amount, reason).', 'Attach a document if needed.', 'Tap "Submit request". It goes to the next person in the chain.'],
    shots: ['request-new'] },
  { id: 'om-decide', group: 'Requests', title: 'Approve or reject a worker\'s app request (Outlet Manager)', roles: ['om', 'hrm', 'hra', 'gm', 'ceo'],
    steps: ['Requests → "Needs my action" and open the request marked 📱 worker / "Raised by worker (app)".', 'Read the details and the worker\'s note.', 'Tap "Approve → send to HR" or "Reject" and write a short reason.'],
    shots: ['request-om-list', 'request-om'],
    tip: 'If you do not answer in time, the request goes to HR automatically so the worker is not left waiting.' },
  { id: 'decide', group: 'Requests', title: 'Approve, reject or return a request', roles: ['hrm', 'hra', 'gm', 'ceo'],
    steps: ['Requests → "Needs my action" and open the request.', 'Check the details, attachments and history.', 'Choose: "Recommend & send up" (HR Manager), "Approve" (when your role approves), "Return for info" or "Reject".', 'Write a comment (required for return and reject) and confirm.'],
    shots: ['request-detail'] },
  { id: 'apply', group: 'Requests', title: 'Apply an approved request to the worker record', roles: ['hrm', 'hra', 'gm', 'ceo'],
    steps: ['Requests → "Needs my action" shows requests marked "Approved – to apply".', 'Open the request and tap "Apply to worker record & close".', 'Check the changes the app will make (leave balance, pay, outlet…) and tap "Apply & close".'],
    shots: ['request-apply'] },
  { id: 'assign', group: 'Requests', title: 'Assign or escalate a request', roles: ['ceo', 'gm'],
    intro: 'Use Assign to move a request to a specific person at any level — for example when someone is on leave or the request needs a different decision-maker.',
    steps: ['Open the request.', 'Under Actions, tap "Assign…".', 'Choose the Role, then the Person (the list shows the people who can see this request; anyone above your level shows as “Next approval step”), and add a note if you like — staff only, the worker never sees it.', 'Tap "Assign". The person is notified and the request moves to their queue; the request shows "Assigned to: <name>" at the top, and while assigned, that person makes the decision.'],
    shots: ['request-assign', 'request-assign-modal'],
    tip: 'Skipped steps are recorded in the timeline.' },
  { id: 'ceo-review', group: 'Requests', title: 'CEO review: overrule, amend, recall, mark reviewed', roles: ['ceo'],
    steps: ['Open CEO review (left menu, or More on a phone). "To review" shows the decisions waiting for you; "Any request (recall)" lets you pick any request.', 'Tap a row to open it and read its history. The icons on each row are Mark reviewed, Overrule and Recall: point at one, or press and hold on a tablet, to see its name.', 'Mark reviewed — you agree with the decision; it moves to "Reviewed".', 'Overrule… — choose Your decision (Approve, Amend, Reject, Cancel, Recall to me or Keep — mark reviewed), write the reason and tap "Confirm — final decision". The request is then locked: only you can change it.', 'Amend — change the amount, dates or details with a change note; the original stays in the history. Tick "Amend details only — keep it moving" to leave it at its current step instead of deciding it.', 'Recall — take the request back for your own decision. On any request page you can also use "Overrule / amend / recall / review…".'],
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
    intro: 'Some reports must be printed and signed regularly. Sign-off order: HR Manager prepares → HR Admin verifies → then the next steps review and approve. Each step is notified in turn.',
    steps: ['Reports → "Required submissions" shows what is due or overdue.', 'Open the task, check the report and tap your sign-off step.', 'Print it, sign the paper, and upload the signed copy if asked.', 'The next person is notified automatically.'],
    shots: ['submissions'],
    tip: 'Settings → Requests & submissions lists which reports are required and how often.' },

  /* ---------------- Users & access ---------------- */
  { id: 'add-user', group: 'Users & access', title: 'Add a user', roles: ['ceo', 'gm', 'hra'],
    intro: 'Add and manage users in Settings → Users & access.',
    steps: ['Settings → Users & access → "Add user".', 'Type the name and email and choose the role.', 'For HR and Outlet Managers choose their companies / outlets.', 'Save. Give the person the temporary password shown, or let them set one from the email.'],
    shots: ['users'] },
  { id: 'manage-user', group: 'Users & access', title: 'Reset password, pause, resume or delete a user', roles: ['ceo', 'gm', 'hra'],
    steps: ['Settings → Users & access and find the person (use the search box on long lists). Each action is an icon on their row: point at it, or press and hold on a tablet, to see its name. On a phone, tap the row to open it and the buttons show their names.', 'Reset password — gives a new temporary password.', 'Pause — the person cannot sign in until resumed (use for leave or suspension).', 'Resume — allows sign-in again.', 'Delete — removes the account permanently (their history stays).'],
    shots: ['users-manage'],
    important: 'Pause instead of delete when someone may come back.' },
  { id: 'approve-signup', group: 'Users & access', title: 'Approve a new sign-up', roles: ['ceo', 'gm', 'hra'],
    steps: ['Settings → Users & access lists people who signed up and are pending (the tab shows a badge).', 'Tap the ✓ icon on their row (or tap the row) to open it, choose the role and outlets and tap Approve. The ✕ icon rejects the sign-up.'],
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
  { id: 'companies', group: 'Settings & system', title: 'Companies: add one, SSM copies and directors', roles: ['ceo', 'gm', 'hra'],
    steps: ['Settings → Companies & Outlets → "Add company", or "+ Add company…" in the company list of a new approval letter.', 'A side panel opens. Name and sector are enough; open the other sections for the SSM numbers (new 12-digit and old format), incorporation date, addresses, phone and email.', 'SSM documents: choose the type (Form 9 / 24 / 49, e-Info, profile), an optional expiry date, then attach the PDF or photo.', 'Directors & shareholders: name, MyKad IC (YYMMDD-PB-###G) or passport with nationality, designation, email, mobile (+60) and an optional ID copy.', 'Save. The new company is selected in the letter form straight away.', 'Open a company (eye icon) for its page with three tabs: Details, SSM documents and Directors. Tap a row to see everything.'],
    tip: 'Files are stored privately per company. Every change is in the audit log. "HR Admin & HR Manager permissions" in Settings decides whether HR may add companies.' },
  { id: 'companies-hrm', group: 'Settings & system', title: 'Companies: add one and view its details', roles: ['hrm'],
    steps: ['"+ Add company…" in the company list of a new approval letter, or Settings → Companies & Outlets → "Add company".', 'Fill in the name, sector and any SSM details, documents and directors you have, then Save. The new company is selected straight away.', 'Open a company (eye icon) to view its details and SSM copies. Directors\' IC / passport numbers show the last 4 digits only.', 'You can update the name, sector and the company details (SSM numbers, addresses, phone, email).'] },
  { id: 'demo', group: 'Settings & system', title: 'Sample & demo data switch', roles: ['ceo'],
    steps: ['Tap your initials at the top right.', 'Tick "Show sample & demo data" to include the SAMPLE and DEMO companies (and their workers) in lists, totals, alerts and reports. Untick it to hide them again. The Workers page also has a one-tap button while they are hidden.'],
    shots: ['usermenu-demo'],
    tip: 'The demo company exists only for Apple\'s app review. Keep it hidden for daily work.' },
  { id: 'control', group: 'Settings & system', title: 'Control Center (health, errors, system map)', roles: ['ceo'],
    steps: ['Open Software Control (left menu or More).', 'Control Center shows the health checks (sync, backups, storage, renewals). Red needs action.', 'Errors lists app errors from all devices with how often they happened.', 'Know-how / System Map explains how the parts fit together.'],
    shots: ['control'] },
  /* ---------------- AI Assistant ---------------- */
  { id: 'assistant', group: 'Getting started', title: 'Ask the AI Assistant', roles: ALL,
    intro: 'Assistant (left menu, or More on a phone) answers questions about your workers, expiries, requests, quota and the rules — using only what your role can already see.',
    steps: ['Open Assistant and tap a suggestion, or type a question in plain words (e.g. "Whose permits expire in the next 60 days?").', 'Answers come with tables you can expand and links that open the worker, request or recruit in the app.', 'Pick your reply language at the top. The counter shows how many questions you have left today.', 'For work, the Assistant only prepares a draft (request, remark or reminder). Nothing happens until you tap Confirm, which runs the normal app step — or Open form to check it first.', 'New chat clears the conversation on this device.'],
    tip: 'Passport numbers are shown to the Assistant as the last 4 digits only, and salaries only if your role can see them.',
    important: 'The Assistant never approves, rejects, deletes or overrides anything. Check important figures in the app before acting.' },
  { id: 'assistant-switch', group: 'Settings & system', title: 'Switch on the AI Assistant and set the daily limit', roles: ['ceo'],
    steps: ['The Assistant stays off until an AI key is added as a Supabase secret: AI_API_KEY (required), AI_PROVIDER (gemini, openai or anthropic; default gemini) and AI_MODEL (optional).', 'The key lives only on the server — never in the app or the code. After adding it, open Assistant and tap Check again.', 'Limit (in the Assistant header) sets how many questions each user can ask per day. Every chat and confirmed draft is in the audit log.'] },
  /* ---------------- Approval & Recruitment ---------------- */
  { id: 'quota-letter', group: 'Approval & Recruitment', title: 'Record a quota approval letter', roles: ['ceo', 'gm'],
    intro: 'Approval & Recruitment (menu) keeps every approval letter as a ledger with a running balance, like a bank account.',
    steps: ['Open Approval & Recruitment → Letters & ledger → Add letter.', 'Enter the reference, dates and the approved slots per country, and attach the scanned letter.', 'An approver checks it against the original and opens the letter. Only then do its slots count.', 'Every later change (extension, adjustment, transfer, expiry) is a ledger movement with a note; mistakes are reversed, never deleted.'] },
  { id: 'quota-letter-hr', group: 'Approval & Recruitment', title: 'Record a quota approval letter', roles: ['hra', 'hrm'],
    intro: 'Approval & Recruitment (menu) keeps every approval letter as a ledger with a running balance, like a bank account.',
    steps: ['Open Approval & Recruitment → Letters & ledger → Add letter.', 'Enter the reference, dates and the approved slots per country, and attach the scanned letter.', 'An approver checks it against the original and opens the letter. Only then do its slots count.', 'Every later change (extension, adjustment, transfer, expiry) is a ledger movement with a note; mistakes are reversed, never deleted.'] },
  { id: 'quota-use', group: 'Approval & Recruitment', title: 'Use quota slots (approval before the calling visa)', roles: ['ceo'],
    steps: ['Approvals → Request quota use: pick the letter, country and number of slots, and the recruits. The slots are reserved at once.', 'Approvals and the request timeline show where it is.', 'Only after approval can the calling visa (VDR) be applied for — the step is locked until then.', 'A rejected or cancelled request gives the reserved slots back.'] },
  { id: 'quota-use-gm', group: 'Approval & Recruitment', title: 'Use quota slots (approval before the calling visa)', roles: ['gm'],
    steps: ['Approvals → Request quota use: pick the letter, country and number of slots, and the recruits. The slots are reserved at once.', 'Approvals and the request timeline show where it is.', 'Only after approval can the calling visa (VDR) be applied for — the step is locked until then.', 'A rejected or cancelled request gives the reserved slots back.'] },
  { id: 'quota-use-hr', group: 'Approval & Recruitment', title: 'Use quota slots (approval before the calling visa)', roles: ['hra', 'hrm'],
    steps: ['Approvals → Request quota use: pick the letter, country and number of slots, and the recruits. The slots are reserved at once.', 'Approvals and the request timeline show where it is.', 'Only after full approval can the calling visa (VDR) be applied for — the step is locked until then.', 'A rejected or cancelled request gives the reserved slots back.'] },
  { id: 'quota-recruit', group: 'Approval & Recruitment', title: 'Take a recruit from selection to arrival (16 stages)', roles: ['ceo'],
    intro: 'The stages come from the country\'s pipeline in Rules & regulations; a recruit keeps the pipeline that applied the day he was added.',
    steps: ['Pipeline → add a batch, then add recruits (for India, choose ECR or ECNR — ECNR shows eMigrate as "Not required (ECNR)").', 'Open a recruit and complete each step in order with its date, reference and copy. A stage cannot start while an earlier one is incomplete.', 'The slot is Reserved from the request and becomes Used only when the VDR approval copy is uploaded. A recruit dropped before that releases the slot with a reason.', 'After arrival record the accommodation address, Immigration clearance (within 6 hours) and FOMEMA (within 30 days), then PLKS, then Convert to worker.', 'Cards show days in the current stage, the next step and any rule flag (e.g. age or ECR limits).'] },
  { id: 'quota-recruit-staff', group: 'Approval & Recruitment', title: 'Take a recruit from selection to arrival (16 stages)', roles: ['gm', 'hra', 'hrm'],
    intro: 'The stages come from the country\'s pipeline in Rules & regulations; a recruit keeps the pipeline that applied the day he was added.',
    steps: ['Pipeline → add a batch, then add recruits (for India, choose ECR or ECNR — ECNR shows eMigrate as "Not required (ECNR)").', 'Open a recruit and complete each step in order with its date, reference and copy. A stage cannot start while an earlier one is incomplete.', 'The slot is Reserved from the request and becomes Used only when the VDR approval copy is uploaded. A recruit dropped before that releases the slot with a reason.', 'After arrival record the accommodation address, Immigration clearance (within 6 hours) and FOMEMA (within 30 days), then PLKS, then Convert to worker.', 'Cards show days in the current stage, the next step and any rule flag (e.g. age or ECR limits).'] },
  { id: 'quota-repl', group: 'Approval & Recruitment', title: 'Replacement through Immigration (FOMEMA fail / did not arrive)', roles: ['ceo', 'gm'],
    steps: ['Only two cases qualify: FOMEMA fail after arrival, or VDR approved but the recruit did not arrive. Deaths, transfers and runaways never qualify.', 'Check Out Memo (COM) & runaways → Replacement (Immigration) → Open application. The slot shows Pending cancellation meanwhile.', 'Record the Immigration application, then upload Immigration\'s approval letter.', 'A different HR Admin verifies it; the slot is restored as "Replacement approved by Immigration".', 'The GM and CEO see late tasks in Overview → HR follow-ups and can nudge, reassign or escalate.'] },
  { id: 'quota-repl-hr', group: 'Approval & Recruitment', title: 'Replacement through Immigration (FOMEMA fail / did not arrive)', roles: ['hra', 'hrm'],
    steps: ['Only two cases qualify: FOMEMA fail after arrival, or VDR approved but the recruit did not arrive. Deaths, transfers and runaways never qualify.', 'Check Out Memo (COM) & runaways → Replacement (Immigration) → Open application. The slot shows Pending cancellation meanwhile.', 'Record the Immigration application, then upload Immigration\'s approval letter.', 'A different HR Admin verifies it; the slot is restored as "Replacement approved by Immigration".', 'Late tasks show in Overview → HR follow-ups, where they can be nudged, reassigned or escalated — keep yours on time.'] },
  { id: 'quota-rules', group: 'Approval & Recruitment', title: 'Change a rule or regulation', roles: ['ceo'],
    intro: 'Nothing regulatory is hard-coded: deadlines, levy and fees, sector rules, country pipelines and the replacement rules live in Rules & regulations.',
    steps: ['Rules & regulations → pick the group → edit a row. The side panel shows the current value, its source and effective date.', 'Enter the new value, the date it takes effect, the source (circular / gazette) and attach the PDF. Check the impact preview before saving.', 'A change applies on its effective date once it is approved.', 'Older values stay in the history; recruits already in progress keep the pipeline they started with.'] },
  { id: 'quota-rules-hra', group: 'Approval & Recruitment', title: 'Change a rule or regulation', roles: ['hra'],
    intro: 'Nothing regulatory is hard-coded: deadlines, levy and fees, sector rules, country pipelines and the replacement rules live in Rules & regulations.',
    steps: ['Rules & regulations → pick the group → edit a row. The side panel shows the current value, its source and effective date.', 'Enter the new value, the date it takes effect, the source (circular / gazette) and attach the PDF. Check the impact preview before saving.', 'Your change waits for approval; once approved it applies on its effective date.', 'Older values stay in the history; recruits already in progress keep the pipeline they started with.'] },
  { id: 'quota-master', group: 'Approval & Recruitment', title: 'Read the master table', roles: ['ceo', 'gm', 'hra', 'hrm'],
    steps: ['Overview → Master table groups every letter by company, with company totals, a per-sector summary and the grand total.', 'Click a column header to sort; search by letter or sector. Expiring letters show days left in amber (90 d) or red (30 d).', 'Print gives an A4 landscape copy with sign-off lines.', 'Letters & ledger → open a letter for its application checklist (advert, interview form, PERKESO, FWCMS, levy) and record the levy payment.'] },
  { id: 'quota-cmo', group: 'Approval & Recruitment', title: 'Record a Check Out Memo (COM) or a runaway', roles: ['ceo', 'gm', 'hra', 'hrm'],
    steps: ['COM & runaways → Record COM: pick the worker, enter the COM reference and attach the scan. The copy is kept for good with a fingerprint.', 'A worker who left without a COM is a runaway: open a runaway case, report to the police and Immigration (eRUNAWAY), and attach the copies.', 'Reconciliation shows any letter whose numbers do not add up, in red.'] },
  { id: 'quota-claim', group: 'Approval & Recruitment', title: 'Claim replacement quota (gantian)', roles: ['ceo', 'gm', 'hra', 'hrm'],
    steps: ['Record the government window under COM & runaways → Government windows. Then Replacement claims → New claim and pick the eligible COMs.', 'Print the merged claim pack (cover + every COM copy) and submit it.', 'Record the result: approved COMs become a new replacement letter in the ledger. A COM cannot be claimed twice.'] },
]

export interface Faq { q: string; a: string; roles: HelpRole[] }

export const FAQS: Faq[] = [
  { roles: ALL, q: 'I forgot my password. What do I do?', a: 'Your admin resets it in Settings → Users & access. You get a temporary password; change it after you sign in (your initials → Change password).' },
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
  { roles: ['om'], q: 'The worker forgot his app PIN.', a: 'HR resets the PIN from the worker\'s App access tab — let them know.' },
  { roles: ['om'], q: 'Where are salary details?', a: 'Salary is handled by HR and management, so it does not appear in the Outlet Manager screens.' },
  { roles: ['om'], q: 'Can I raise a leave request for a worker without a phone?', a: 'Yes. Requests → New request, choose the worker and fill the dates. It goes to HR Manager.' },
  { roles: ['om'], q: 'How do I report something about a worker?', a: 'Open the worker → Remarks and write what happened. HR sees it immediately.' },

  { roles: ['hrm'], q: 'What is the difference between "Return for info" and "Reject"?', a: 'Return sends the request back to the person who raised it to add missing information; it can be resubmitted. Reject ends it. Both need a comment.' },
  { roles: ['hrm'], q: 'A request is approved. Is the worker record updated automatically?', a: 'No. Open it from Requests → "Needs my action" (status "Approved – to apply") and tap "Apply to worker record & close" so leave balances, pay or outlet are updated.' },
  { roles: ['hrm', 'hra'], q: 'How do I give a worker the FW Worker app?', a: 'Worker → "📱 App access" → Generate PIN. The worker signs in with his passport number and that PIN. The PIN is shown only once.' },
  { roles: ['hrm', 'hra'], q: 'The worker\'s app says "locked".', a: 'After too many wrong PINs the account locks. Speak to the worker, then App access → Unlock (or Reset PIN if he forgot it).' },
  { roles: ['hrm', 'hra', 'gm', 'ceo'], q: 'I added the same worker twice.', a: 'The app blocks a duplicate worker ID and warns about a repeated passport. If it still happened, set the extra record to Exited with the remark "duplicate" and tell your admin.' },
  { roles: ['hrm', 'hra', 'gm', 'ceo'], q: 'A worker left. Should I delete him?', a: 'No — set the status to Exited with the date (Check status tab). His history stays for audits and the app access is stopped.' },
  { roles: ['hrm', 'hra', 'gm', 'ceo'], q: 'How do I scan a passport or document with the camera?', a: 'Open the worker → Vault → "Add / scan", choose Passport and scan the pages with the camera. Hold the page flat in good light.' },
  { roles: ['hrm'], q: 'What do I do with a required printed submission?', a: 'Reports → Required submissions → open the task, check and prepare the report, then sign off your step. HR Admin is notified to verify it.' },
  { roles: ['hrm', 'hra'], q: 'Which document photos are best?', a: 'Flat, bright, no shadow, all four corners visible. The app shrinks large photos automatically.' },

  { roles: ['hra'], q: 'When do I escalate instead of approving?', a: 'When the amount or type is above your limit (the app shows it), or when management should decide. Escalate sends it to the General Manager.' },
  { roles: ['hra'], q: 'How do I add users?', a: 'When user management is part of your HR Admin settings, use Settings → Users & access → Add user.' },
  { roles: ['hra'], q: 'How do I move a request to someone else?', a: 'Tap Escalate to send it to the General Manager.' },
  { roles: ['hra'], q: 'What does "verify" mean on a submission?', a: 'You check the report HR Manager prepared is complete and correct, then sign off. It then goes to the General Manager.' },

  { roles: ['gm'], q: 'What happens after I approve?', a: 'The request moves on to be applied to the worker record.' },
  { roles: ['gm', 'ceo'], q: 'When should I use Assign…?', a: 'When a request is stuck (someone is on leave) or needs a particular person. Under Actions tap \"Assign…\", choose the Role and Person and add a note; they are notified and make the decision at that step. Steps in between are marked as skipped in the timeline.' },
  { roles: ['gm'], q: 'Which settings do I manage?', a: 'The ones in your General Manager powers (Settings → Users & access shows them).' },
  { roles: ['gm'], q: 'Do I approve printed submissions?', a: 'You review them after HR Admin has verified them.' },
  { roles: ['gm', 'hra'], q: 'Where is the audit log?', a: 'Settings → Users & access → Audit log, when audit access is part of your role settings.' },

  { roles: ['ceo'], q: 'What is CEO review?', a: 'A list of every General Manager decision and every rejection. Mark each reviewed, or overrule, amend or recall it. The badge shows how many are waiting.' },
  { roles: ['ceo'], q: 'What is the difference between Overrule, Amend and Recall?', a: 'Overrule flips the decision (approve ↔ reject) with your reason. Amend corrects details and keeps the original values in history. Recall pulls the request back to you, open, to decide later.' },
  { roles: ['ceo'], q: 'How do I give the General Manager more powers?', a: 'Settings → Users & access → "General Manager powers". Switch each power on or off; it applies immediately.' },
  { roles: ['ceo', 'gm', 'hra', 'hrm'], q: 'Where do I keep a company\'s SSM copies and directors?', a: 'Open the company (Settings → Companies & Outlets → eye icon). The SSM documents and Directors tabs hold them; files are stored privately for that company only.' },
  { roles: ['ceo'], q: 'What is the "Show sample & demo data" switch?', a: 'SAMPLE companies hold example data, and the DEMO company exists for the app review. Both are hidden from worker lists, totals, alerts and reports unless you tick "Show sample & demo data" in your account menu (or tap the button on the Workers page).' },
  { roles: ['ceo'], q: 'How do I know the system is healthy?', a: 'Software Control → Control Center. Green checks are fine; red needs action. The Errors tab lists app errors from every device.' },
  { roles: ['ceo'], q: 'How are backups made?', a: 'The cloud database is backed up automatically every day (the Control Center shows its status). Settings → Data & backup lets you download an extra JSON copy or restore one.' },
  { roles: ['ceo'], q: 'Someone left the company. Pause or delete?', a: 'Pause first. Delete only when you are sure; their history stays in the audit log either way.' },
  { roles: ['ceo'], q: 'Can I see what a worker sees in FW Worker?', a: 'Workers see their own documents, requests and simple status only (e.g. "With HR Admin") — never internal notes or managers\' names.' },
  { roles: ['viewer'], q: 'What is the Viewer role for?', a: 'Viewer is a read-only role for looking things up and printing reports.' },
  { roles: ['ceo', 'gm'], q: 'Who sees Approval & Recruitment?', a: 'Only the CEO, General Manager, HR Admin and HR Manager. Outlet Managers, Viewers and workers have no access — the database enforces it.' },
  { roles: ['hra', 'hrm'], q: 'Who sees Approval & Recruitment?', a: 'Only the quota team (HR and management). Outlet Managers, Viewers and workers have no access — the database enforces it.' },
  { roles: ['hra', 'hrm'], q: 'Where is my quota use request?', a: 'Approvals and the request timeline show where it is; you are notified when it is approved, returned or rejected.' },
  { roles: ['ceo'], q: 'Why can I not apply for the calling visa?', a: 'The quota use request for that recruit is not approved by the CEO yet. Approvals shows where it is waiting.' },
  { roles: ['gm', 'hra', 'hrm'], q: 'Why can I not apply for the calling visa?', a: 'The quota use request for that recruit is not fully approved yet. Approvals shows where it is waiting.' },
  { roles: ['ceo', 'gm', 'hra', 'hrm'], q: 'What is a runaway in this app?', a: 'A worker who left without a Check Out Memo. His status stays Absconded; the runaway case tracks the police and Immigration reports, the permit, bond and follow-ups.' },
  { roles: ['ceo', 'gm', 'hra', 'hrm'], q: 'When does a reserved slot become Used?', a: 'When the VDR approval copy is uploaded on the recruit. Before that, dropping the recruit releases the slot (with a reason).' },
  { roles: ['ceo'], q: 'Who can change Rules & regulations?', a: 'The CEO and HR Admins. Every change keeps its source, effective date and who made it.' },
  { roles: ['gm', 'hra', 'hrm'], q: 'Who can change Rules & regulations?', a: 'HR Admins propose changes. Every change keeps its source, effective date and who made it.' },
  { roles: ['ceo', 'gm', 'hra', 'hrm'], q: 'Is a runaway or a death replaceable?', a: 'No. Only a FOMEMA fail after arrival, or a VDR-approved recruit who did not arrive, can be replaced through Immigration.' },
  { roles: ['ceo'], q: 'Can a ledger entry be deleted?', a: 'No. Like a bank, a wrong entry is reversed by a GM or the CEO with a note, and both lines stay on the record.' },
  { roles: ['gm', 'hra', 'hrm'], q: 'Can a ledger entry be deleted?', a: 'No. Like a bank, a wrong entry is reversed by another approver with a note, and both lines stay on the record.' },
  { roles: ALL, q: 'Can the AI Assistant see everything?', a: 'No. It looks things up with your own sign-in, so it sees exactly what you can see — and nothing about people above you. Passport numbers are masked to the last 4 digits.' },
  { roles: ALL, q: 'Can the Assistant approve or delete things?', a: 'No. It only prepares drafts. You tap Confirm, and the normal app step runs under your name.' },
  { roles: ['ceo'], q: 'Why does the Assistant say it is not switched on?', a: 'No AI key has been added yet. Add AI_API_KEY as a Supabase secret (see "Switch on the AI Assistant"); no app update is needed.' },
]

export const guidesFor = (r: HelpRole) => GUIDES.filter((g) => g.roles.includes(r))
export const faqsFor = (r: HelpRole) => FAQS.filter((f) => f.roles.includes(r))
