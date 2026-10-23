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

Sample data: **Settings → Load sample data** adds fake `DEMO` workers (the whole team sees them).

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
