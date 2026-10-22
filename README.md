# Foreign Worker Manager

A mobile-first, installable web app (PWA) for managing **foreign workers in Malaysia**: passports, PLKS work permits, FOMEMA, insurance, leave, return flight tickets, pay increments, loans, prorated exit penalties and printable checkout memos. It covers multiple business units: restaurants, convenience shops, central store, accounting, management, hotels and jewellery shops.

**Live app:** https://moulisankar999.github.io/foreign-worker-manager/

> Open it, go to **Settings → Load sample data** to look around with fake `DEMO` workers. Use **Clear all data** when you're ready to enter real staff.

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
- **Backup**: download JSON, restore (replace or merge), load sample data, clear all data

## Data storage: please read
All data is stored **only in your browser on this device** (IndexedDB). Nothing is sent to a server. That means:
- Clearing browser data, or using another phone or PC, will **not** show your data.
- **Download a backup regularly** (Settings → Backup) and keep it somewhere safe. It contains personal data.
- To move to a new device, restore the backup file there.

No real personal data is included in this repository. Sample data is fake and prefixed `DEMO`.

## Install on phone
Open the live link in Chrome (Android) or Safari (iPhone), then Menu/Share → **Add to Home Screen**. The app works offline after the first load.

## Run locally
```bash
npm install
npm run dev       # development
npm run build     # production build in dist/
npm run preview   # serve the build on http://localhost:4180/foreign-worker-manager/
```

Stack: Vite + React + TypeScript (strict), Dexie (IndexedDB), HashRouter, and a hand-written service worker that respects the `/foreign-worker-manager/` base path.

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
