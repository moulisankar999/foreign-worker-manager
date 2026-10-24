# Foreign Worker Manager

A mobile-first web app (PWA) **and Android app** for managing **foreign workers in Malaysia**: passports, PLKS work permits, FOMEMA, insurance, leave, return flight tickets, pay increments, loans, prorated exit penalties and printable checkout memos. It covers multiple business units: restaurants, convenience shops, central store, accounting, management, hotels and jewellery shops.

**Live app:** https://fw.sunrisebayumas.com/ (the old address https://moulisankar999.github.io/foreign-worker-manager/ redirects here)

> **First time:** open the link and tap **Create account**. The **first person to create an account becomes the Super Admin**. Everyone after that waits until a Super Admin approves them in **Settings → Users**.

## Cloud, logins & team sync (Supabase)
- Data lives in a **Supabase** project (`gnepquxtwkyffjmoydnv`, region **ap-southeast-1 / Singapore**). Each phone keeps an offline copy in IndexedDB, so the app opens and works without internet. Changes upload automatically once you're back online.
- **Live sync**: an edit on one phone shows up on everyone else's within a few seconds (Supabase Realtime). The coloured dot in the top bar shows the status: green = synced, amber = syncing, grey = offline (with the number of changes waiting), red = error.
- **Conflicts**: last write wins, per record (a whole worker, outlet, job category or the settings).
- **Attachments** (document scans/PDFs, up to 5 MB) go to a **private** Storage bucket. They open through short-lived signed links, and only signed-in active users can open them.
- **Moving old data across**: a phone that already had data from the earlier local-only version shows a banner on the Dashboard and in Settings: **"Upload this device's data to the cloud"**. Records keep their IDs, so nothing gets duplicated. Job categories that already exist in the cloud are merged.

### Roles and outlets (v1.1)
| Role | Can do |
|---|---|
| **Super Admin** | Everything, including Settings → **Users**, **Approval rules**, **HR Admin permissions**, **Notifications**, emergency-leave reasons, vault categories and passport settings. Final approver for loans, salary increments, terminations and any amount above the RM limits. |
| **HR Admin** | Approves requests within their limits (anything above escalates to Super Admin). Can edit all master data. Super Admin decides whether HR Admin may also manage users, delete workers, see salary and read the audit log. |
| **HR Manager** | Reviews outlet requests (**return / reject / recommend**), applies approved requests to the worker record, verifies signed passport consent, and keeps the passport custody register. Releases a passport **without** Super Admin approval. |
| **Outlet Manager** | Sees **only the workers, documents and requests of his own outlets**. Can raise requests and add remarks but cannot edit master data. Payslip and bank documents are hidden from him. |
| **Viewer** | Read only. |

- When v1.1 was installed, the existing **Admin** became **Super Admin** and each **Manager** became **HR Manager**.
- **Settings → Users** is where you set each person's role and, for outlet managers, their outlet(s).
- These rules are enforced by row-level security in the database (outlet scoping, salary hiding, no direct writes), not just hidden in the app.
- New sign-ups stay **Waiting** until a Super Admin approves them. At least one active Super Admin must always exist.
- Offline sync works as before for workers, outlets, jobs, settings and remarks. Requests and the document vault need a connection.

### Companies, new-user approvals and logos (v1.1.1)
- **Companies:** the Super Admin manages companies (Settings → Companies & Outlets). Each outlet belongs to one company; existing outlets were put in **Main company**, which you can rename. HR Admin, HR Manager and Outlet Manager accounts can be limited to companies and/or outlets. Accounts with no limits still see everything.
- **New sign-ups:** a sign-up can pick a company/outlet (optional). Pending users show under **Needs my action** with a badge and notification: **Approve** (role + scope) or **Reject**. The Super Admin sees all pending users. Sign-ups with no company are shown to the Super Admin only.
- **HR Admin approvals:** per HR Admin, the Super Admin can switch on *Allow HR Admin to approve new users*, then choose which companies he may manage and which roles he may grant (default Outlet Manager and Viewer). HR Admin can be granted only if the Super Admin enables it; Super Admin never can. Approvals are recorded ("Approved by <name> (HR Admin)"), audited and reported to the Super Admin. The server enforces all of this.
- **Logos:** each company and outlet can have a logo. PNG, JPEG or SVG files are resized in the browser to 512 px or less and saved as PNG/JPEG of about 200 KB at most. Super Admin, HR Admin and HR Manager can upload logos, within their scope. Logos are stored in a private bucket that only signed-in users of that company/outlet can read. They are cached for offline use and the Android app. They appear in the app header, lists, worker profile, memos and PDFs (passport consent form, slips). The login page stays generic.

### CEO, General Manager, advice dashboard and agencies (v1.2.0)
- **CEO:** the role shown as *Super Admin* is now called **CEO** (the internal key `super_admin` is unchanged; existing users kept their roles). The CEO role can't be granted from the app.
- **General Manager (GM):** a new role between the CEO and HR Admin. The CEO sets the GM's powers in **Settings → Users & Access → General Manager powers** (grouped checklist with Select all / Clear all; all on by default; every change is audited; the server enforces each power). A GM can never see, edit, reset or remove the CEO or another GM, and can't change his own powers.
- **Approvals:** OM → HR Manager → HR Admin → **General Manager (final)**. If no active GM has the matching power, the request goes to the CEO. GM decisions read "Approved by General Manager <name>".
- **CEO review** (CEO only, *Requests → CEO review*, with a badge): every GM final decision is listed with filters. The CEO can **Overrule** (approve or reject/cancel), **Amend then approve**, **Mark reviewed**, or **Recall** any request. A CEO decision is final and locks the request (server-enforced; only comments and HR follow-up notes are allowed after it). The history shows "Overruled by CEO <name>: <old> → <new>"; the GM sees a neutral "Updated by CEO" note. If the decision affects something already done (ticket booked, money paid, salary changed, record updated), the CEO sees a warning and **HR follow-up tasks** are created (Requests → Follow-ups). In-app and push notifications go to the CEO (with *Overrule* / *View* actions) and to the people in the chain.
- **Users & Access:** each row has **Update** (enabled only after a change) and **Cancel**, a confirmation toast, and a warning if you leave with unsaved changes. **Add user** creates an active account straight away (name, email, mobile with country code, role, companies, outlets) within the hierarchy: CEO → any role below CEO; GM → HR Admin / HR Manager / OM (if allowed); HR Admin → HR Manager / OM in his companies; HR Manager → OM for outlets in his companies. Login details can be sent by email invite, a WhatsApp message or SMS (if set up). The temporary password is shown **once** and must be changed at first sign-in. For security, passwords can't be viewed; **Reset password** gives a new temporary one.
- **Dashboard** (v1.2.3: in tabs — Overview, Expiries, Requests, Pay, Risk & checks, Workforce; deep links like `#/dashboard/expiries`; the last tab is remembered on the device; outlet managers get Overview / Requests / My workers): greeting with your logo, **Today's priorities** (3–5 one-tap actions), a **health score** (0–100) per company and outlet with a "why" breakdown, worker status at a glance, an expiries timeline (expired / 30 / 60 / 90 days), a Malaysian *tip of the day*, the latest agency checks, and light / dark / auto theme (account menu).
- **Agencies & Integrations** (Settings; CEO, HR Admin, and GM if allowed): 11 official portals (Immigration FOMEMA status, application status and ePass check; FWCMS; FOMEMA (fomema2u); ePPAx; Act 446 housing; MYFutureJobs; PERKESO ASSIST; EPF i-Akaun Employer; SPIKPA) with on/off, link and notes. There is **no public API** for these portals, so the API field is disabled. On each worker, **Check status** opens the portal, copies the passport/permit number, and lets you record the result (status, date, by, reference, note, optional screenshot saved to the vault). The latest check shows on the dashboard and in alerts. Tips and rules are general guidance — **check with JTKSM or your agent**.

### Languages, worker form, user management and Settings tabs (v1.1.2)
- **Worker languages:** every worker has a **primary language** (Tamil near the top, then the other Indian and regional languages; 24 in the list) plus other languages with Speak / Read / Write ticks. It is *soft-required*: it counts towards profile completeness and drafts can still be saved. A **Language missing** filter and prompts help fill old records.
- **Consent form in the worker's language:** the passport-safekeeping consent PDF prints **English + the primary language**. Built-in translations: Tamil, Hindi, Telugu, Malayalam, Kannada, Bengali, Punjabi, Gujarati, Marathi, Odia, Urdu (right-to-left), Nepali, Burmese, Indonesian, Sinhala, Vietnamese, Thai, Khmer, Lao, Tagalog and Chinese. If a language has no translation it falls back to English + Bahasa Malaysia with a notice. Fonts (Noto) load only when needed. Super Admin and HR Admin can correct any translation in **Settings → Passport & Consent**. **The built-in translations still need a native speaker check.**
- **Worker form:** a 6-step stepper (Personal → Job → Documents → Contract & Pay → Family/Remittance → Review & Submit), numbered document cards, Draft/Complete status with a progress bar, field checks (RM amounts, passport number, dates, age warning, phone in E.164, email), local autosave and **Incomplete profiles** in *Needs my action*. Partial saves are never blocked.
- **Photos:** photo and attachment pickers offer **Take photo** or **Choose from device**, also in the Android app.
- **Remittance details** (HR roles and Super Admin only): providers, masked account numbers and an *Open provider* link. There is no payment API; the app does not send money.
- **User management** (Settings → Users & Access): **Pause/Resume** (blocks sign-in and data access immediately), **Reset password** (temporary password shown once, must be changed at next sign-in, optional reset email), **Delete** (removes the login; history is kept as "deleted user <name>"; business data is never deleted), and **Reject/Delete** for pending sign-ups. Super Admin can act on anyone except another Super Admin's password; HR Admin only within scope and only if allowed. The last Super Admin can't be paused or deleted. **Forgot password?** on the sign-in page and **Change password** in the account menu. Note: the built-in Supabase mailer is rate-limited (a few emails per hour); add custom SMTP for heavier use.
- **Settings tabs:** Account · Users & Access · Companies & Outlets · Workers & Documents · Passport & Consent · Requests & Approvals · Notifications · Data & Backup · About. Each role sees only the tabs it can use. Tabs are deep-linkable (e.g. `#/settings/users`), show a badge for pending sign-ups, and a search box jumps to any setting.

### Requests and approvals
- Outlet managers raise **27 request types** from the **Requests** tab or the shortcut tiles on their **My outlet** dashboard. The types are grouped as:
  - **Leave:** annual, MC, emergency, home leave, checkout memo
  - **Pay:** increment, advance, loan, deduction, OT/allowance
  - **Discipline:** penalty, warning letter, absconding
  - **Medical and welfare:** medical/FOMEMA visit, accident/SOCSO, insurance, accommodation, complaint, uniform
  - **Documents and permits:** passport release/return/copy, PLKS renewal, document copy, update details
  - **Movement and exit:** transfer, resignation, termination
  - **Other**
- **Workflow:** Outlet Manager → **HR Manager** (return for changes / reject / recommend) → **HR Admin** approves, or the request escalates to **Super Admin** → **HR Manager applies** it to the worker record → **Closed**. Every step is recorded on a timeline with who, when and the comment, and triggers badges, in-app alerts and push.
- **Approval rules** (Settings → Approval rules; only Super Admin can edit):
  - each type can be switched on or off, with an approval level and an RM limit;
  - **loans and salary increments always need Super Admin**;
  - advances, deductions, penalties and OT above their RM limit escalate to Super Admin.

  The database checks these rules on every action, so the app cannot bypass them. Every change is written to the **audit log**.

### Flight tickets
- **Home leave:** HR books the ticket and uploads it to the vault (category *Flight ticket*). This updates the ticket entitlement and history. The outlet manager sees **"Ticket booked — download"**.
- **Emergency leave:** the outlet manager or worker books the ticket, and a ticket upload is **mandatory**. HR then marks it **reimburse** (company pays) or **deduct from entitlement**.

### Emergency leave reasons
- A reason is **mandatory** and is picked from a list that Super Admin can edit. The defaults are: death of an immediate family member, critical illness or hospitalisation, serious accident, own medical emergency, spouse childbirth or complication, natural disaster, and a family legal or security matter.
- Each reason states the required proof and whether a relationship is needed.
- Proof can follow within *X* days. Until it arrives the request shows **proof pending**, and **overdue** once the deadline passes.
- Annual or home leave must not be filed as emergency leave; the form warns about this.
- **Reports → Emergency leave** lists the reason, family member, proof status, ticket, cost and decision.

### Passport safekeeping (Passports Act 1966, s.12(1)(f))
An employer may **not** hold a worker's passport unless the worker freely agrees in writing. Without that agreement the passport stays with the worker.
- **Consent status per worker:** *Not issued → Pending → Signed* (or *Withdrawn*). **PENDING** is shown in red on the dashboards and in alerts, and is listed first in **Reports → Passport safekeeping**.
- **Consent form:** a bilingual **English + Bahasa Malaysia** PDF, pre-filled with the worker's details and the company name and logo. Print it per worker, or use **Bulk consent forms** in the passport report.
- The signed form is scanned into the vault. When the **HR Manager verifies** it, the status becomes **Signed**.
- **Custody register:** *In safe → Released → Returned*, with PDF release and return slips. A passport released for longer than the turnaround raises an **overdue** alert. Withdrawing consent means the passport must be returned.
- Checklists use the wording *"worker or company safe (with consent)"*.

### Document vault
- Each worker has a **Documents** tab, and there is a global **Document library**. Super Admin can add categories and restrict some categories (Payslip and Bank are hidden from outlet managers).
- **Camera scan:** multi-page, resized to about 1600 px at JPEG quality 0.7, optionally merged into one PDF. Limits are **1 MB per image** and **5 MB per PDF**, and the app explains what to do if a file is too large.
- Files are kept in **private storage** and opened through short-lived signed links. The vault supports versions, expiry alerts, preview, download and share.
- Memos saved in the memo editor are also stored in the vault as PDFs.

### Notifications (Settings → Notifications, Super Admin)
- **In-app** and **push/phone** alerts are **ON**.
- **WhatsApp, Email and SMS are built but OFF**, and show **"Not configured"**. Nothing is sent or charged until you add provider keys and switch a channel on. Each tile has a short **Setup guide**:

  | Channel | Provider | Secrets to add (Supabase → Edge Functions → Secrets) |
  |---|---|---|
  | WhatsApp | Meta WhatsApp Cloud API (utility templates in `supabase/functions/_shared/wa-templates.json`) | `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_ACCOUNT_ID`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN` |
  | Email | Brevo (Resend as alternative) | `BREVO_API_KEY` (or `EMAIL_PROVIDER=resend` + `RESEND_API_KEY`), `EMAIL_FROM`, `EMAIL_FROM_NAME` |
  | SMS (urgent fallback) | OneWaySMS (generic HTTP / Twilio possible) | `ONEWAYSMS_USER`, `ONEWAYSMS_PASS`, `ONEWAYSMS_SENDER` |

- Without a key, a delivery is logged as *"skipped: provider not configured"*.
- The notifications engine has:
  - an outbox, retries, de-duplication and rate limits;
  - quiet hours and a daily digest;
  - an event × channel matrix, with personal opt-outs under **Settings → My alerts**;
  - a delivery log with **Retry**, and a monthly cost estimate (WhatsApp about RM0.0564 per message, SMS RM0.115).
- SMS messages start with "RM0 ", contain no links or phone numbers, and the app warns when one goes over 160 characters.

### Phone alerts (background push)
- Each user turns them on per device in **Settings → Phone alerts → Turn on phone alerts**.
- **iPhone/iPad** (iOS 16.4 or newer): first open the link in Safari, tap **Share → Add to Home Screen**, open the app from the Home Screen icon and sign in, then turn alerts on. Apple only allows web push for Home Screen apps.
- A Supabase Edge Function (`daily-alerts`) runs **every day at 08:00 Malaysia time** (pg_cron at 00:00 UTC, called through pg_net). It reuses the app's own alert rules: document expiries (90/60/30/7 days and expired), contract end, overdue return from leave, pending leave approvals, flight-ticket eligibility, missing checkout memo / ticket for upcoming home leave, and so on. Each subscribed active user then gets **one summary push** of the urgent (critical + high) items. The summary is scoped by role: outlet managers only hear about their own outlets' workers.
- If nothing is urgent, nobody gets a push. An identical summary is never sent twice on the same day. Dead subscriptions are removed automatically.
- **Send me a test alert** in Settings sends the summary immediately to your own devices.

Sample data: **Settings → Data & Backup → Load sample data** adds fake `DEMO` workers (the whole team sees them). Once real workers or outlets exist the button moves under **Advanced** with a warning.

**Remove sample (DEMO) data** (v1.1.3, Super Admin only, Settings → Data & Backup): shows a preview (DEMO workers, outlets, remarks, documents, requests; users assigned to DEMO outlets with a dropdown to move each to a real outlet or leave unassigned), then asks you to type `REMOVE`. It soft-deletes (synced to every device) only workers/outlets whose name starts with `DEMO ` plus their remarks and documents, cancels their open requests without notifications, and writes an audit entry (`demo.remove`). A DEMO outlet that still has a real worker is kept. Job categories are standard lists and are not removed. Server: `demo_data_preview()` / `remove_demo_data()` (migration 011).

## Pay & contribution compliance (v1.2.1)

Rules are a guide, not legal advice. Wherever a rule is uncertain the app says **"check with JTKSM or your agent"**.

- **Minimum wage**: dated list (RM1,700 from 1 Feb 2025). A worker's basic below the rate in force shows a warning and a dashboard priority. HR can record a per-worker exemption with a required reason.
- **Overtime**: calculator (×1.5 normal day, ×2 rest day, ×3 public holiday; ORP = monthly ÷ 26, hourly = ORP ÷ 8). Warns above 104 hours a month (Overtime Regulations 1980), amber when close.
- **Pay deadlines & deductions**: wages due within 7 days after the wage month (EA s.19), OT by the end of the next month (s.19(1A)); warns when paid late or not recorded as paid, and when total deductions pass 50% of wages (s.24).
- **Hostel deduction (Act 446)**: RM150/month cap from 1 Mar 2026 (RM100 before, P.U.(A) 49/2026), only with a valid Certificate for Accommodation, the worker's written request, DG approval and not above the contract. Peninsular Malaysia & Labuan; Sabah/Sarawak get a note.
- **Payslip helper** (worker → Pay → Payslips): earnings, OT, deductions, EPF 2% + 2% (foreign workers), PERKESO 1.75% employer / 0.5% worker (estimate — use PERKESO's contribution table for exact amounts), LINDUNG 24 Jam 0.75% worker; printable payslip.
- **All rates editable with effective dates** in Settings → Pay & Leave rules (CEO, HR Admin, or anyone with the `compliance.rates` power). Saved via the `set_pay_config` RPC with an audit entry.
- **Leave entitlements by service**: annual 8/12/16 days, sick 14/18/22 days, hospitalisation 60 days, maternity 98 days, paternity 7 days. The Leave tab shows the statutory minimum next to the worker's contract.
- **Public holidays by state**: editable list per year (2026 built-in), state and rest-day filters, replacement-day column (EA s.60D). Outlets now have a state and a rest day.
- **Dashboard**: pay rules feed the health score and Today's priorities. Users without salary access never see pay alerts or pay lines; the server strips payslips and hostel/exemption fields for them.

## Trackers & risk (v1.2.2)

Everything is under **Compliance** in the menu (HR, CEO and GM; outlet managers do not see it) and in each worker's **Compliance** tab.

- **Outlet risk score** — one score per outlet (Low / Medium / High) built from passports held, late pay or missing payslips, overtime, deductions, hostel problems, complaints and expiring documents. The top 5 outlets are on the dashboard. Pay parts are only counted for people who may see pay.
- **Hostel register (Act 446)** — hostels, Certificate for Accommodation number and expiry, capacity, workers assigned, inspections and alerts. Hostel deductions are capped at RM150 a month from 1 March 2026 (check with JTKSM or your agent).
- **Expiry rules** — FOMEMA yearly, PLKS renewal reminder 3 months ahead, passport warning at 15 months, SPIKPA insurance and security bond, and the 10-year total stay limit with warnings at 9 and 9.5 years.
- **Job-permit match** — soft warnings when a PLKS worker is in an office outlet (e.g. accounting, management), a front-of-house job (e.g. cashier), or the employer on the permit is not the company. The lists can be changed under Compliance → Rules.
- **Exit and absconding checklists** — checkout memo, final pay, passport return, ticket, Check Out Memo (COM) from Immigration and PLKS cancellation; for absconding: contact attempts, police report, Immigration report (FWCMS eRUNAWAY or in person), cancellation, wages owed and the levy / bond note. Day targets are company targets — check with JTKSM or your agent.
- **Hiring tracker** — MYFutureJobs advert (14 days) and local interviews, quota approval in FWCMS (s.60K), VDR / calling visa, arrival, FOMEMA within 30 days, PLKS issued.
- **Cost tracker** per worker — levy (RM1,850 default, editable), FOMEMA, insurance, visa, ticket and more, plus employer EPF and PERKESO from payslips. Treated as pay data.
- **Zero-cost recruitment declaration** — printable per worker in English + the worker's language, using the same translation system as the passport consent form.
- **Grievance channel** — one public link and QR code per company. Workers can report without logging in, anonymously if they want, and check the status with a private code. Only HR, the GM and the CEO can read reports.
- **PDPA** — consent record per worker, FOMEMA / medical files hidden from outlet managers and viewers, and a data breach log (the CEO, HR Admin or a GM with the settings power). The 2024 amendments require notifying the Commissioner within 72 hours of a breach — check with the PDP Commissioner (JPDP) or your adviser.
- **Minimum wage** — the announced RM2,000 from 1 June 2027 is listed as "announced — confirm when gazetted". Companies marked as under RM50 million in sales stay on RM1,700 for now (Settings → Pay & Leave rules → business size).
- **Missing payslip alert** — active workers with no payslip for last month (only shown to people who may see pay).

## Software Control (v1.3.0, CEO only)

The CEO (Super Admin / Admin) sees **Software Control** in the sidebar (on phones: More → Software Control):

- **Health monitor** — green / amber / red tiles for the website, database, logins, storage, backups, notifications, cron jobs, edge-function secrets, the iOS/Android build pipelines, Apple certificate and profile, TestFlight, the domain and the HTTPS certificate. Each tile says when it was last checked, what it means and what to do. Checks run about every 30 minutes (database cron + a scheduled GitHub workflow) and can be run on demand. When a tile turns red or amber the CEO alone gets an in-app alert, a phone push and (when an email provider is configured) an email.
- **App errors** — crashes and failed requests from every user's app are collected (message, screen, version) so they can be fixed.
- **Know-how / system map** — how the system is built, where everything lives, a renewal checklist, and every secret listed by **name and location only** (with a present / missing status). The content is stored in a CEO-only database table, not in this repository or the app bundle. Passwords, keys and tokens are never stored or shown in the app or the repo.

Everyone can see **Settings → About** (app version, build, "Developed by Mouli Sankar").

### Demo company and scoped names (v1.3.0)
- **Demo company for App Review**: the company `demo-apple` (or any company marked `"demo": true`), with its outlet and workers, stays in the database. It is left out of CEO / GM / HR dashboard totals, compliance counts, alerts, daily push alerts and reports. The CEO can switch it back on with **Show demo data** (Dashboard, or the account menu). Only people scoped to that company or outlet (the reviewer login) see it normally. Server side: migration `019_demo_scope.sql` (`notify`, `notify_digest`) and the `daily-alerts` function.
- **Scoped users see only their own names**: Outlet Managers and staff limited to companies / outlets get only their own outlets (database row-level security plus sync) and their own companies (`my_company_list()`). Note: the public sign-up form still lists company and outlet names so new staff can pick where they work.

### Reports library and required printed reports (v1.3.1)
- **Reports** is a role-scoped A4 report library with print / PDF preview and CSV export. Each person only gets the data their role and scope allow (server-side), and Outlet Managers only see their own outlet and company names.
- **Required printed reports**: the CEO (or HR with compliance settings) schedules reports that HR must print, sign and file on a routine. The schedules table shows company names. Server side: migration `018_report_submissions.sql` (tables `report_schedules` / `report_submissions`, row-level security by company).
- The demo company is left out of reports (company filter, workers, outlets, users list, schedules) unless the CEO turns on **Show demo data**.

### Worker requests and app access (v1.3.2)
- **Requests** page: requests raised from the FW Worker app show chips for source (worker app), overdue and confidential. Outlet Managers approve or reject first (a reason is required to reject), then HR. Complaints marked confidential skip the outlet manager and go to HR only.
- **Worker → 📱 App access** (CEO / GM / HR): turn the worker's app login on or off and issue a new 6-digit PIN. The PIN is shown once and never stored in readable form. Server side: migration `030_worker_app.sql`.

### Quieter error list (v1.3.3)
- A request that fails with no answer at all ("Failed to fetch" / "Load failed") is usually the phone itself: offline, switching Wi-Fi and mobile data, or the app coming back from the background (iOS cancels requests that were in progress while the app was suspended). These are no longer logged as errors while the device is offline or in the background, or for 30 s after the app comes back or the network changes.
- Read-only calls (sync, permissions, approval route) are retried once, quietly. A failure is only logged if the same endpoint still has not answered after 75 s (more than one sync cycle). A burst of failures is grouped into one entry. HTTP errors (5xx / 400 / 403) and JavaScript errors are still logged right away.
- The platform shown in the error list now comes from the app itself. iPads were shown as "android" because iPadOS reports a Mac user agent.
- Unit test: `node tests/error-noise.test.mjs`.

### Assign / escalate and CEO actions on requests (v1.3.3, migration 031)
- **Who:** only the CEO and the General Manager can send a request to someone. The button is **Assign…** under the request's *Actions*. Nobody else can, and the server enforces this (`request_assign`, SECURITY DEFINER). Every assignment is recorded in the audit log as `request.assign` or `request.escalate`.
- **What:** pick a level (Outlet Manager, HR Manager, HR Admin, GM or CEO), then a person in the request's company/outlet, and add an optional note. This works at any stage, including staff self-requests and confidential complaints. A confidential complaint is never offered to, or routed to, an Outlet Manager.
- **Effects:** the request moves to that person's queue. Steps that were jumped over are shown as "<step> skipped by CEO/GM (name)". The new assignee is notified in-app and by push (`request_assigned`), and their timers start again. While a request is assigned, only that person (or the CEO) can decide it. The assignment clears as soon as they act.
- **GM:** when the GM assigns, the CEO is notified (`gm_assigned`) and the request appears in *CEO review*. The CEO can reassign anything the GM assigned. The GM can't change an assignment the CEO made. The GM still needs the matching GM power to approve a request type. Without it, he can only pass the request on, for example escalate it to the CEO.
- **Wording:** the request header shows "Assigned to: name (role)". Timeline entries read "Assigned by CEO (name) → GM: name, 24 Oct 10:55" plus the note. A GM sending a request up to the CEO reads "Escalated by GM (name) → CEO: name".
- **Worker app:** the worker sees only a simple status, such as "With HR Admin". Names and notes are never shown.
- **CEO actions** (*Overrule / amend / recall / review…*, via `ceo_decide`):
  - Overrule: final, and locks the request.
  - Amend: needs a change note. Before → after is kept in the timeline. "Keep it moving" leaves the request where it is.
  - Recall: assigns the request to the CEO.
  - Mark reviewed: adds "Reviewed by CEO" and clears it from the review list.
- **GM limits:** the GM gets Assign/Escalate plus the GM powers ticked in Settings. The GM gets no CEO-only actions.
- **Tests (TEST project only):** `tests/assign-test.sql` (40 server checks, all in one rolled-back transaction) and `tests/assign-ui.mjs` (Playwright, 14 checks, `UI_URL=<test build>`).


### Platform label and "Clear list" fix (v1.3.4, migration 032)
- Settings → About → Platform now comes from Capacitor (`platformLabel()` in `src/lib/platform.ts`), not the browser user-agent. iPadOS apps send a Mac user-agent, so earlier builds showed iPads as "Android app". In a browser on an iPad it shows "Web app (iPhone / iPad)".
- Software Control → Errors: older rows (app before 1.3.3) that say `android` but came from an Apple user-agent are shown as "unknown (old app)". Stored data is not changed.
- "Clear list" (`clear_client_errors()`, migration 032) now also resets the "App errors" health tile and writes an audit entry. The Errors tab badge and the Software Control sidebar badge update straight away.
- Tests: `UI_URL=<TEST build> node tests/platform-ui.mjs` (TEST only; mocks Capacitor ios/android via `window.CapacitorCustomPlatform`).

### Help, FAQ and user manuals (v1.3.5, FW Worker 1.0.2, migration 033)
- FW Manager: **Help** (sidebar / More, and the user menu) has *My role*, *FAQ* and *User manual* tabs. Each user sees only their own role's responsibilities, FAQs and how-to guides, and downloads only their own illustrated PDF manual (CEO, General Manager, HR Admin, HR Manager, Outlet Manager). HR roles can also download the FW Worker guide (Tamil / English) to give workers. The viewer role has no manual.
- FW Worker: the **?** button opens a paged Help sheet (FAQ + How to, no scrolling) in the worker's language (Tamil, Hindi, Malay, Nepali, Bengali, English; other languages show English) and a link to the PDF guide.
- PDFs live in the PRIVATE storage bucket `manuals` (migration 033: `manual_file_for_role()` + read policy); the app opens them with short-lived signed URLs.
- Rebuilding the manuals and screenshots (TEST project only): see `scripts/manuals/README.md`.
## Features

### Dashboard
- KPI cards: total, active, on leave, expired documents, expiring in ≤30/60/90 days, flight-ticket eligible, outstanding loans (RM), monthly basic payroll (RM)
- Charts: by nationality, business type, outlet and status, plus document expiries by month for the next 12 months
- A "needs attention" list and quick actions

### Workers
- Step-by-step **add-worker wizard** (Personal → Job → Documents → Contract & pay → Address & next of kin → Review)
- Profile: optional photo, worker ID, nationality, DOB, gender, religion, phones (MY and home), outlet, business type, job/skill category, skill level, join date, agent
- **Employment status** with history: Active-Working, On Leave, Home Leave, Medical Leave, Absconded, Resigned, Terminated, Contract Ended, Repatriated
- **Documents**: Passport, Work Permit / PLKS (VP(TE)), FOMEMA, Insurance (SPIKPA/Hospitalisation), SOCSO/PERKESO, Levy, and any other document you name. Each has number, issue and expiry dates, an optional attachment, and a Valid / Expiring soon / Expired chip. **Renew** keeps the history. **Add to calendar** exports an .ics file.
- **Family & next of kin**: wife, husband, children, parents and siblings with DOB, phone and address, plus next-of-kin and emergency-contact flags. Overseas and hostel addresses are stored too.
- **Contract**: start/end dates, renew/extend, minimum contract period and early-termination penalty
  - **Prorated penalty** = penalty × (remaining months of minimum period ÷ minimum period months), with a live calculator
  - **Process exit** sets the status and exit date, works out the penalty and outstanding loans, and creates an **Exit Clearance memo**
- **Pay**: basic pay with full **increment history** (date, old, new, RM and % change, reason), allowances and bank details
- **Loans & advances**: monthly deduction plan, deductions (loan repayment, advance, penalty, damage, other), auto balance, and a running-balance ledger
- **Leave**: applications (Annual, Home Leave, Medical, Emergency, Unpaid) with Pending/Approved/Rejected status, approver, remarks and return-ticket details (cost, who pays)
  - Yearly entitlement (policy default or per worker). The joining year is prorated, and unused leave **carries forward** (optional cap).
  - **Return flight ticket rule**: one ticket per 36 months of service by default (configurable). Unused tickets **accumulate**. The app shows tickets earned, used, balance and value, plus the next date a ticket is earned.
  - **Check out** to leave changes the status and opens the **Home Leave Checkout memo**. **Returned** sets the worker back to Active and opens a **Return from Leave memo**.
- **Memos**: editable checklists (uniforms, keys, tools, loan balance, final salary, penalty, passport with worker, flight ticket, permit/levy cancellation, FOMEMA/insurance, hostel, exit interview…), a financial summary and signature blocks for worker, manager and HR. They print cleanly or save as PDF.
- **Timeline**: notes, status changes, leave, increments and memos

### Alerts
- Passport, permit, FOMEMA, insurance, levy and other document expiries
- Contract end and minimum-contract completion
- Flight ticket eligibility (including accumulated tickets)
- Workers overdue back from leave, or due back soon
- Pending leave approvals
- Home leave with no ticket booked or no checkout memo
- Missing required documents and outstanding loans
- Severity is set by configurable lead times (default **90 / 60 / 30 / 7 days**). Filter by category, outlet, business type or severity.
- **Browser notifications** (on request): a daily summary when the app opens
- **.ics calendar export** for a single item, the filtered list, or every expiry (Settings)

### Reports (filter, sort, print, export CSV)
Expiry report · Worker master list · Leave balances · Leave applications · Flight ticket eligibility · Loans & advances · Deductions · Increment history · Payroll summary by outlet · Exits & penalties · Contracts · Family / next-of-kin directory

### Settings
- Company name, alert lead times, leave policy (days per year, carry-forward cap), ticket rule and value, default minimum contract and penalty, grace days for overdue returns
- Outlets / business units (name, type, manager, address)
- Job / skill categories, editable and grouped by business type (pre-seeded: Cook, Waiter, Cashier, Storekeeper, Housekeeping, Goldsmith…)
- **Account & cloud sync**, **Users** (Super Admin), **Phone alerts**
- **Backup**: download JSON, restore (replace or merge; restored records are uploaded for everyone), load sample data, re-download this device's copy from the cloud

## Data storage
- The cloud database (Supabase, Singapore) is the shared source of truth. Each signed-in device keeps an offline copy.
- **Signing out** removes the copy on that device. The data stays in the cloud.
- A JSON backup (Settings → Backup) is still a good extra safety copy. It contains personal data. Attachments that were never opened on that device are saved in the backup as cloud references, not file copies.

No real personal data is included in this repository. Sample data is fake and prefixed `DEMO`.

## Install on phone

### Android: FW Manager app (APK)
1. On the Android phone, open **https://github.com/moulisankar999/foreign-worker-manager/releases/latest/download/FW-Manager.apk** (the same link is under **Settings → Calendar** in the web app).
2. When the download finishes, tap it. If Android says it's blocked, tap **Settings → Allow from this source** (“Install unknown apps” for Chrome), go back and tap **Install**.
3. Open **FW Manager**, sign in with your usual email and password, then go to **Settings → Phone alerts → Turn on phone alerts** and allow notifications.
4. Updates: install a newer APK the same way. It updates in place and keeps your login, because every release is signed with the same key.

Google Play Protect may warn about an app “from an unknown developer”. That's normal for apps installed outside the Play Store. Tap **More details → Install anyway**.

### iPhone / iPad
**For now, use the web app:** open the live link in **Safari** → **Share** → **Add to Home Screen**, open it from the Home Screen icon and sign in. It works offline, and morning alerts work through web push (iOS 16.4 or newer).

A native iPhone app can be built from this repo (the `ios/` folder is ready), but Apple only allows that with a Mac and an Apple Developer account. See [Building the iPhone app](#building-the-iphone-app).

v1.2.4 fixes touch scrolling in the Android and iPhone apps: every screen (Compliance, Dashboard tabs, workers, Settings, forms, pop-ups) now scrolls up and down with a swipe. On iPad, Android tablets and computers the green sidebar stays fixed and only the page content scrolls.

### Android / iOS app vs. web app
| | Android app | Web app / Home Screen (iPhone, any browser) |
|---|---|---|
| Login, live team sync, offline use | ✅ same cloud account | ✅ |
| 8:00 AM alerts | **On-phone reminders** (no internet needed at 8 AM) | Web push from the server |
| Export CSV / backup / calendar (.ics), document attachments | Opens the phone's **share sheet** (save to Files/Drive, WhatsApp, email) | Browser download / new tab |
| Print memo / report | Android print dialog (printer or **Save as PDF**) | Browser print |

#### How alerts work in the Android/iOS app
- Every time data changes (after each sync, or when you open the app), the app plans reminders **on the phone** for 08:00 Malaysia time:
  - a **daily summary** of urgent items for the next 30 days (14 on iPhone), worked out for each day
  - a reminder **90 / 60 / 30 / 7 days before and on the day** that each passport, permit, medical, insurance or other dated document **expires**, and that each **contract ends**
  - the day a worker **becomes eligible for a flight ticket**, **completes the minimum contract**, or is **due back from leave**, plus a reminder the day after the grace period if they haven't returned
- Tapping a notification opens **Alerts**. **Settings → Phone alerts** shows how many reminders are planned and has a **test alert** button.
- Limits:
  - Reminders reflect the data as of the last time the app synced. Changes made by other users only reach a phone after it opens the app. Open it at least every couple of weeks.
  - Android may deliver a few minutes late in battery-saver mode.
  - iPhone allows at most 64 waiting reminders, so the app keeps the soonest ones.
- **Server push to the native app (optional, later):** the web-push server can't reach the native app. Adding true server push needs:
  - **Android:** a free Firebase project and its `google-services.json`, plus a Firebase service-account key stored as a Supabase function secret
  - **iPhone:** an Apple Developer account and an APNs key
  - the `@capacitor/push-notifications` plugin and an FCM sender in the `daily-alerts` function

## Building the apps (Capacitor)
The Android and iOS apps wrap the same React app using [Capacitor](https://capacitorjs.com) (app id `com.moulisankar.fwmanager`, name **FW Manager**). The web files are bundled inside the app, so it starts offline.

```bash
npm run build:native   # web build with relative paths -> dist-native/ (GitHub Pages build is unchanged: npm run build -> dist/)
npx cap sync           # copy dist-native/ + plugins into android/ and ios/  (Capacitor CLI needs Node 22+)
```

### Android (Linux, Mac or Windows)
Needs JDK 21 and the Android SDK (platform 36, build-tools 36). The release signing key and its passwords are **not in git**:
- `android-keystore/fw-manager-release.jks`
- `FWM_KEYSTORE`, `FWM_KEYSTORE_PASSWORD`, `FWM_KEY_ALIAS` and `FWM_KEY_PASSWORD` in `.secrets.env`

**Back both up somewhere safe.** If the key is lost, phones can't update the app. They'd have to uninstall it and install it again.
```bash
npm run android:apk    # build:native + cap sync + signed release -> release/FW-Manager.apk and release/FW-Manager-<version>.aab
```
Before each new release, bump `version` in `package.json` and `versionCode` / `versionName` in `android/app/build.gradle`.

**Google Play Store (optional):** create a Google Play Console developer account (**US$25 one-time**, needs ID verification). Then create the app and upload `release/FW-Manager-<version>.aab`. Use Play App Signing and keep this keystore as the *upload key*. You'll also need a privacy policy URL and the Data safety form (the app stores personal data of workers in Supabase), and new personal developer accounts must run a closed test with testers before going public.

### Building the iPhone app
Apple requires **macOS + Xcode** to build, and an **Apple Developer Program** membership (**US$99/year**) to install the app on iPhones through TestFlight or the App Store. The `ios/` folder is already set up. Pick one route:

**Route A: your own Mac**
1. Install **Xcode** (Mac App Store) and **Node 22**. Join the Apple Developer Program with your Apple ID at developer.apple.com (US$99/yr).
2. `git clone https://github.com/moulisankar999/foreign-worker-manager && cd foreign-worker-manager && npm install && npm run build:native && npx cap sync ios && npx cap open ios`
3. In Xcode, select **App** → **Signing & Capabilities** → tick *Automatically manage signing* and pick your **Team**. The bundle id is `com.moulisankar.fwmanager`.
4. To test on your own iPhone: plug it in, select it as the run target and press ▶.
5. For TestFlight or the App Store: **Product → Archive → Distribute App → App Store Connect → Upload**. In [App Store Connect](https://appstoreconnect.apple.com), create the app (same bundle id), add yourself and your staff as **TestFlight** testers (they install the **TestFlight** app), or fill in the store listing, privacy details and screenshots and submit for review.

**Route B: no Mac, using a cloud Mac build service (e.g. Codemagic, Ionic Appflow)**
1. Join the Apple Developer Program (US$99/yr). In App Store Connect, create the app with bundle id `com.moulisankar.fwmanager`.
2. Create an **App Store Connect API key**: Users and Access → Integrations → Keys, role *App Manager*. Download the `.p8` and note the Key ID and Issuer ID.
3. Sign up at codemagic.io with GitHub and add this repository. Under **Teams → Integrations → Developer Portal**, add the API key. Under **Code signing identities**, let Codemagic create an iOS distribution certificate and an App Store provisioning profile for `com.moulisankar.fwmanager`.
4. Create an iOS workflow (Capacitor/Ionic template) with these build steps: `npm ci`, `npm run build:native`, `npx cap sync ios`, then build `ios/App/App.xcodeproj` (scheme **App**) with automatic App Store signing and publish to **App Store Connect / TestFlight**.
5. Start the build. The finished app appears in TestFlight. Install the **TestFlight** app on the iPhone to get it, and submit for App Store review when you're ready.

Notifications on iPhone use the same on-phone reminders as Android, so no extra setup is needed. Printing from the iPhone app isn't supported yet; use **Share** or the web app.

## Run locally
```bash
npm install
npm run dev       # development
npm run build     # production build in dist/
npm run preview   # serve the build on http://localhost:4180/
```

Stack: Vite + React + TypeScript (strict), Dexie (IndexedDB, offline copy), Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions, pg_cron), HashRouter, and a hand-written service worker (offline cache + push) that works relative to the base path (`/` on the custom domain).

### Backend layout (`supabase/`)
- `migrations/001_init.sql`: `profiles` (roles), `records` (one row per worker/outlet/job/settings: `entity`, `id`, `data jsonb`, `deleted`, `client_ts`, `server_ts`), a last-write-wins trigger, RLS policies, `push_subscriptions`, `alert_log`, and the private `attachments` bucket and its policies
- `migrations/002_cron.sql`: the daily 08:00 MYT schedule. The shared cron secret is kept in Supabase **Vault** (`fwm_cron_secret`) and never in git.
- `migrations/003_roles_requests_vault.sql`: the five roles, outlet scoping (RLS), `requests` + `request_events` (workflow and approval rules enforced in SQL), `app_config`, `audit_log`, `documents` (vault, versions) and remarks
- `migrations/004–006`: notification outbox and deliveries, the 5-minute dispatch and sweep schedule (Vault secret `fwm_functions_url`), and WhatsApp opt-in and templates
- `functions/notify-dispatch`, `functions/whatsapp-webhook` (checks the verify token and `X-Hub-Signature-256`), `functions/wa-admin`
- `functions/daily-alerts/`: the push sender. `lib/` is copied from `src/lib` by `scripts/prepare-function.sh`, so the alert rules stay identical to the app's.

Apply SQL with the Supabase SQL editor (or the Management API). Deploy the function with:
```bash
./scripts/prepare-function.sh
npx supabase functions deploy daily-alerts --project-ref gnepquxtwkyffjmoydnv --use-api --no-verify-jwt
```
Function secrets (set in the Supabase dashboard → Edge Functions → Secrets, never committed): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, plus the optional provider keys listed under *Notifications*.

### Tests (separate TEST project only)
Every automated test runs against a separate Supabase **test** project. Each script refuses to run against the live project or against any project that has non-`@example.com` users.
- `tests/server-rules.test.mjs`: roles, RLS outlet scoping, workflow and approval rules
- `tests/notifications.test.mjs`: outbox, dispatcher and webhook, using a mock provider endpoint (`tests/mock-provider`, deployed with `tests/deploy-test-functions.sh`)
- `tests/sms-rules.test.mjs`: the SMS message rules
- `tests/ui-smoke.test.mjs`: a browser smoke test of a build pointed at the test project with `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` The browser only uses the public project URL, the anon key and the VAPID **public** key (`src/lib/supabase.ts`).

## FW Worker app (worker self-service)
A separate, simple app for workers on the same backend: sign in with passport number + 6-digit PIN (issued by CEO/GM/HR in FW Manager → worker → 📱 App access), see their documents' expiry, pay and loan balance, and raise requests (leave, advance, loan, increment, renewal, passport return, complaint, resignation). Requests go to the outlet manager first, then HR; complaints about the manager go straight to HR (confidential). Tamil first, 10 languages, no scrolling on any screen.
- Web: **https://fw.sunrisebayumas.com/worker/** (published together with the manager by `bash scripts/deploy-web.sh`)
- Android: `bash scripts/release-android-worker.sh` → releases `worker-v<version>-android` and the rolling `worker-android-latest` (never the repo's "Latest", so FW Manager's latest/download link is unaffected). Stable link: `https://github.com/moulisankar999/foreign-worker-manager/releases/download/worker-android-latest/FW-Worker.apk`
- iPhone: `gh workflow run ios-worker-testflight.yml` (bundle `com.moulisankar.fwworker`, profile secret `IOS_WORKER_PROFILE_B64`)
- Code: `src/worker/`, `worker/` (HTML entry, PWA files, Capacitor shells), `vite.worker.config.ts`; version in `worker/package.json`
- Server: migration `030_worker_app.sql`, edge functions `worker-auth` and `worker-access` (secret `WORKER_PIN_PEPPER`; deploy with `--no-verify-jwt` for worker-auth)
- Tests (TEST project only): `tests/worker-app.test.mjs` (security, 99 checks), `tests/worker-ui.test.mjs` (UI + no-scroll at 6 screen sizes and 10 languages)

## Deploy (GitHub Pages, custom domain)
The app is served at **https://fw.sunrisebayumas.com/**. The domain is a DNS CNAME to `moulisankar999.github.io`, and HTTPS is enforced in the Pages settings. The production build is published to the `gh-pages` branch. `public/CNAME` is copied into every build, so redeploys keep the custom domain.
```bash
npm run build
cd dist && touch .nojekyll && git init -b gh-pages && git add -A && git commit -m deploy \
  && git push -f https://github.com/moulisankar999/foreign-worker-manager.git gh-pages
```
Build settings (all optional; the defaults are shown):
- `VITE_BASE=/`: the web path. Use `/foreign-worker-manager/` only if you ever go back to the github.io project address and remove `public/CNAME`.
- `VITE_APP_PUBLIC_URL=https://fw.sunrisebayumas.com/`: the default app link for messages.

Notes:
- The manifest, service worker, push links and icons are all relative to the base path.
- Links in email, SMS and WhatsApp messages use **Settings → Notifications → General → App link used in messages** (now `https://fw.sunrisebayumas.com/`). The `APP_PUBLIC_URL` function secret is an optional fallback.
- Supabase **Auth → URL configuration** uses the custom domain as the Site URL. The Redirect URLs list both the custom domain and the old github.io address.
- The Android/iOS apps bundle their own copy of the web app and are not affected by the domain.

## Notes
- The penalty and leave rules are generic defaults. Check them against your employment contracts and the Malaysian Employment Act.
- Passports: holding a worker's passport without the worker's free written consent is an offence (Passports Act 1966 s.12(1)(f)). Use the consent form and custody register described above, and return the passport on request.
- Users still on the v1.0 app see the new roles as read-only until they update to v1.1.
