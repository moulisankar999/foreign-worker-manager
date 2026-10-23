# Foreign Worker Manager

A mobile-first web app (PWA) **and Android app** for managing **foreign workers in Malaysia**: passports, PLKS work permits, FOMEMA, insurance, leave, return flight tickets, pay increments, loans, prorated exit penalties and printable checkout memos. It covers multiple business units: restaurants, convenience shops, central store, accounting, management, hotels and jewellery shops.

**Live app:** https://moulisankar999.github.io/foreign-worker-manager/

> **First time:** open the link and tap **Create account**. The **first person to create an account becomes the Admin**. Everyone after that waits until the Admin approves them in **Settings → Users**.

## Cloud, logins & team sync (Supabase)
- Data lives in a **Supabase** project (`gnepquxtwkyffjmoydnv`, region **ap-southeast-1 / Singapore**). Each phone keeps an offline copy in IndexedDB, so the app opens and works without internet. Changes upload automatically once you're back online.
- **Live sync**: an edit on one phone shows up on everyone else's within a few seconds (Supabase Realtime). The coloured dot in the top bar shows the status: green = synced, amber = syncing, grey = offline (with the number of changes waiting), red = error.
- **Conflicts**: last write wins, per record (a whole worker, outlet, job category or the settings).
- **Attachments** (document scans/PDFs, up to 5 MB) go to a **private** Storage bucket. They open through short-lived signed links, and only signed-in active users can open them.
- **Moving old data across**: a phone that already had data from the earlier local-only version shows a banner on the Dashboard and in Settings: **"Upload this device's data to the cloud"**. Records keep their IDs, so nothing gets duplicated. Job categories that already exist in the cloud are merged.

### Roles
| Role | Can do |
|---|---|
| **Admin** | Everything, plus **Settings → Users**: approve people, change roles, deactivate accounts |
| **Manager** | Add and edit workers, documents, leave, pay, loans, memos, outlets, categories and policy |
| **Viewer** | Read only |

- New sign-ups are **Waiting** until an Admin approves them. Database row-level security makes sure only *active* users can read anything, only Admin/Manager can write, and only Admin can manage users. There must always be at least one active Admin.
- Adding staff: they open the link, tap **Create account** and enter name, email and password. The Admin then opens **Settings → Users**, picks their access (Manager or Viewer) and taps **Approve**. Email confirmation is switched off, so no email is needed.

### Phone alerts (background push)
- Each user turns them on per device in **Settings → Phone alerts → Turn on phone alerts**.
- **iPhone/iPad** (iOS 16.4 or newer): first open the link in Safari, tap **Share → Add to Home Screen**, open the app from the Home Screen icon and sign in, then turn alerts on. Apple only allows web push for Home Screen apps.
- A Supabase Edge Function (`daily-alerts`) runs **every day at 08:00 Malaysia time** (pg_cron at 00:00 UTC, called through pg_net). It reuses the app's own alert rules: document expiries (90/60/30/7 days and expired), contract end, overdue return from leave, pending leave approvals, flight-ticket eligibility, missing checkout memo / ticket for upcoming home leave, and so on. Each subscribed active user then gets **one summary push** of the urgent (critical + high) items.
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
- **Account & cloud sync**, **Users** (Admin only), **Phone alerts**
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
npm run preview   # serve the build on http://localhost:4180/foreign-worker-manager/
```

Stack: Vite + React + TypeScript (strict), Dexie (IndexedDB, offline copy), Supabase (Postgres + RLS, Auth, Realtime, Storage, Edge Functions, pg_cron), HashRouter, and a hand-written service worker (offline cache + push) that respects the `/foreign-worker-manager/` base path.

### Backend layout (`supabase/`)
- `migrations/001_init.sql`: `profiles` (roles), `records` (one row per worker/outlet/job/settings: `entity`, `id`, `data jsonb`, `deleted`, `client_ts`, `server_ts`), a last-write-wins trigger, RLS policies, `push_subscriptions`, `alert_log`, and the private `attachments` bucket and its policies
- `migrations/002_cron.sql`: the daily 08:00 MYT schedule. The shared cron secret is kept in Supabase **Vault** (`fwm_cron_secret`) and never in git.
- `functions/daily-alerts/`: the push sender. `lib/` is copied from `src/lib` by `scripts/prepare-function.sh`, so the alert rules stay identical to the app's.

Apply SQL with the Supabase SQL editor (or the Management API). Deploy the function with:
```bash
./scripts/prepare-function.sh
npx supabase functions deploy daily-alerts --project-ref gnepquxtwkyffjmoydnv --use-api --no-verify-jwt
```
Function secrets (set in the Supabase dashboard → Edge Functions → Secrets, never committed): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`. The browser only uses the public project URL, the anon key and the VAPID **public** key (`src/lib/supabase.ts`).

## Deploy (GitHub Pages)
The production build is published to the `gh-pages` branch:
```bash
npm run build
cd dist && touch .nojekyll && git init -b gh-pages && git add -A && git commit -m deploy \
  && git push -f https://github.com/moulisankar999/foreign-worker-manager.git gh-pages
```

## Notes
- The penalty and leave rules are generic defaults. Check them against your employment contracts and the Malaysian Employment Act.
- The checklist reminds staff that the **passport stays with the worker**. Employers holding workers' passports is an offence under Malaysian law.
