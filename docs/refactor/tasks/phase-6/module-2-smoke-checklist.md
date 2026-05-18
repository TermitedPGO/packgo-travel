# Phase 6 · Module 2 · Manual Production Smoke Checklist

**Parent plan:** docs/refactor/plan.md (Phase 6 · Final Verification + Smoke + Docs)
**Audit ref:** N/A (verification gate)
**Owner:** Jeff (this is a Jeff-driven module — AI cannot substitute)
**Status:** TODO
**Est. effort:** 1.5 h Jeff (no AI execution)
**Schedule slot:** Day 13 afternoon (after Module 1 PASS) or Day 14 morning

## Goal
Prove every customer-facing and admin-facing flow behaves identically to pre-Phase-0. Each item below is a checkbox with a concrete URL, action, and expected screen state. **Jeff personally runs every step against PRODUCTION** (`https://www.packgoplay.com` or `https://packgo09.manus.space`, whichever is the active production host on Day 13). Staging replay only when a step explicitly says STAGING.

## Pre-requisites
- Module 1 (full regression) PASS with verdict written in `docs/refactor/phase-6-regression-report.md`
- All Phase 0-5 commits deployed to production
- Stripe test mode keys are NOT in production — production runs LIVE Stripe. For the booking flow (item 3 below), use a real test booking on a low-cost product and immediately refund via admin to clear the books.
- Jeff has admin login for production admin panel
- Stripe Dashboard open in a tab for monitoring webhook deliveries: https://dashboard.stripe.com/webhooks
- Jeff's phone + email accessible for confirmation/email receipt verification

## Inputs (read before starting)
- Production URLs:
  - Primary: `https://www.packgoplay.com`
  - Legacy: `https://packgo09.manus.space` (still live during DNS overlap per `server/_core/index.ts:79`)
  - Admin panel: append `/admin` to either host
- Stripe Dashboard:
  - Webhook endpoints page: https://dashboard.stripe.com/webhooks
  - Events page: https://dashboard.stripe.com/events
- Stripe **production** test card behavior — since we're running LIVE Stripe in production, you have two options for item 3 (Booking flow):
  - **Option A (recommended):** Make a real $1 voucher / lowest-cost departure booking against a real card, then immediately full-refund via admin within 60 seconds. Net cost: ~$0.30 in Stripe fees.
  - **Option B (riskier):** If a staging environment with Stripe test keys exists at the time of Phase 6, run item 3 against staging instead. The card `4242 4242 4242 4242` (any future expiry, any CVC, any postal) succeeds; `4000 0000 0000 9995` declines.
- The deployed commit SHA should match `docs/refactor/phase-6-regression-report.md` SHA. Verify with: open browser devtools → Network → look at any JS bundle URL hash, or check `<meta name="build-commit">` in page source if present.

## Pre-flight (5 min before opening item 1)
- [ ] Stripe Dashboard webhooks page open in tab
- [ ] Stripe events page open in tab
- [ ] Admin panel logged in (https://www.packgoplay.com/admin)
- [ ] Customer-facing site open in incognito/private window (to verify anonymous flow without admin cookies leaking)
- [ ] Email inbox open (for booking confirmation, refund email, etc.)
- [ ] Open `docs/refactor/phase-6-smoke-log.md` in editor — record outcome per item. Template provided in step 9.

---

## Item 1 · Anonymous user flow (15 min)

### 1.1 Browse homepage
- [ ] Open https://www.packgoplay.com in **incognito** window
- [ ] **Expected:** Homepage loads in <3s; hero image visible; featured tour cards render with rounded corners (`rounded-xl` per CLAUDE.md §2.1); no console errors (devtools open)
- [ ] **Rollback trigger:** Hero or tour cards don't render → revert Phase 4A (safe domains: tours read paths) commit
- [ ] **Rollback trigger:** Console error mentioning `trpc.tours` or `trpc.homepage` → revert Phase 4A or 4C

### 1.2 View tour detail
- [ ] Click any featured tour card
- [ ] **Expected:** Tour detail page loads; itinerary section renders with day cards; price visible; "Book Now" button visible
- [ ] **Rollback trigger:** Tour detail returns 404 or blank → revert Phase 4A (tours-read) commit
- [ ] **Rollback trigger:** Daily itinerary missing → check `client/src/pages/TourDetailPeony.tsx` — note this file was NOT split in v1 (deferred to v2 per plan.md line 385); should behave identically

### 1.3 Search tours
- [ ] Return to homepage; use search bar (three inputs: 出發地 / 關鍵字 / 出發時間)
- [ ] Enter a known destination (e.g., "東京" or "Japan")
- [ ] **Expected:** Search returns ≥1 result card; URL changes to `/search?q=...`; all three input fields have `rounded-lg` (per CLAUDE.md §2.1) — visual check
- [ ] **Rollback trigger:** Search returns server error → revert Phase 4A (tours-read) or check `server/routers/tours.ts` exists
- [ ] **Rollback trigger:** Inputs show square corners → not a money-path issue but flag to fix in follow-up; do NOT block on this

### 1.4 Switch language
- [ ] Click language switcher (top-right of header) → switch to English
- [ ] **Expected:** UI text changes to English; URL may add `?lang=en` or change locale prefix; homepage re-renders with English content
- [ ] **Rollback trigger:** Some strings stay in Chinese (esp. on cards/hero) → known issue per plan.md line 387 (116 hard-coded Chinese strings deferred to v2); document in smoke log as "expected per v1 scope" — do NOT block
- [ ] **Rollback trigger:** Page crashes on language switch → revert latest Phase 4 commit (likely Phase 4E translation router)

---

## Item 2 · Logged-in member flow (15 min)

Login as a regular user (use Jeff's personal test account, not admin).

### 2.1 Add favorite
- [ ] Visit https://www.packgoplay.com (logged in)
- [ ] Open any tour detail page; click heart icon to add favorite
- [ ] **Expected:** Heart icon fills; small toast confirmation; refresh page — heart stays filled
- [ ] **Rollback trigger:** Favorite doesn't persist after refresh → revert Phase 4A (favorites router) commit

### 2.2 View booking history
- [ ] Navigate to member dashboard / My Bookings page
- [ ] **Expected:** Past bookings list renders (if Jeff has any test bookings); if none, "no bookings yet" empty state shows; no console errors
- [ ] **Rollback trigger:** 500 error on the page → revert Phase 4C (bookings non-pay) commit

### 2.3 Edit profile
- [ ] Open profile / settings page; change display name to "Jeff Smoke Test 2026-05-18"; save
- [ ] **Expected:** Save succeeds; refresh — new name persists; revert name back to original
- [ ] **Rollback trigger:** Save fails or returns server error → check `server/routers/auth.ts` (Phase 4A or 4E depending on placement); revert that router's commit

---

## Item 3 · Customer booking flow (END-TO-END, MONEY PATH, 25 min)

**This is the highest-stakes smoke item. Run it once on production with a real card OR on staging with Stripe test card. Document every step in the smoke log.**

### 3.1 Browse and pick a low-cost product
- [ ] In incognito, browse to a low-cost (under $50) departure or voucher product
- [ ] Click "Book Now" or equivalent
- [ ] **Expected:** Booking form loads; price displays with correct currency; passenger fields visible

### 3.2 Fill booking form
- [ ] Enter test contact info: name "Phase 6 Smoke 2026-05-18", email = Jeff's email, phone = Jeff's phone
- [ ] Adults: 1; Children: 0
- [ ] Submit → proceeds to Stripe Checkout

### 3.3 Pay with card
- [ ] **If staging:** Card `4242 4242 4242 4242`, any future expiry (e.g., 12/30), CVC `123`, postal `94560` (Newark CA, Jeff's HQ)
- [ ] **If production:** Use a real personal card (you'll refund within 60 seconds)
- [ ] **Expected:** Stripe Checkout completes in <10s; redirects back to https://www.packgoplay.com/booking/<id>/confirmation (or similar)

### 3.4 Verify confirmation screen
- [ ] **Expected:** Confirmation page shows booking ID, dollar amount, passenger name; "Print" or "Email me" button visible
- [ ] Open admin panel in another tab → Bookings tab → find this booking by passenger name
- [ ] **Expected:** Booking exists with status `confirmed` or `paid`; Stripe payment ID present

### 3.5 Verify webhook fired (Stripe Dashboard)
- [ ] Switch to Stripe Dashboard → Events
- [ ] **Expected:** `charge.succeeded` and/or `payment_intent.succeeded` event for this amount, status = "Succeeded" (200 OK from our endpoint)
- [ ] Click the event → look at endpoint deliveries; webhook returned 200
- [ ] **Rollback trigger:** Webhook returned 5xx → revert Phase 2 commit (idempotency table or transaction wrap) AND Phase 4D money paths

### 3.6 Verify confirmation email received
- [ ] Check Jeff's inbox (may take up to 60s)
- [ ] **Expected:** Email with booking summary; correct dollar amount; correct passenger name; PDF receipt attached (if that's the current behavior)
- [ ] **Rollback trigger:** No email within 5 minutes → check admin email queue / SendGrid logs; likely a Phase 4 routers split missed the email side-effect wiring — revert the responsible Phase 4C/4D commit

### 3.7 Verify packpoint awarded
- [ ] In admin panel, look up the user → check packpoint balance
- [ ] **Expected:** Balance increased by the amount the product was configured to award (consult Bookings table → look at `packpointsAwarded` column)
- [ ] **Rollback trigger:** Packpoint NOT awarded → revert Phase 4D (packpoint router) AND check Phase 2's transaction wrapping didn't drop the second write

### 3.8 Refund via admin
- [ ] In admin → Bookings → open this booking → click Refund (or equivalent action)
- [ ] **Expected:** Refund processes in <30s; booking status changes to `refunded`; admin sees confirmation
- [ ] **Rollback trigger:** Refund fails → revert Phase 4D money paths commit

### 3.9 Verify refund webhook + email + packpoint clawback
- [ ] Stripe Dashboard → Events → look for `charge.refunded` event from this charge → status 200 OK
- [ ] Jeff's inbox → refund-confirmation email received
- [ ] Admin panel → check user packpoint balance → should be decreased back to pre-booking level
- [ ] **Rollback trigger:** Any of the three (webhook 200, email, packpoint clawback) fails → revert Phase 2 (refund handler tx wrap) and/or Phase 4D (packpoint clawback)

---

## Item 4 · Admin tab walkthrough (15 min)

Logged in as admin at https://www.packgoplay.com/admin.

For each admin tab below, click in, wait for load, verify no console errors, click back out.

- [ ] Dashboard (default landing)
- [ ] Tours tab — list loads (this tab was structurally extracted in Phase 5B; should look identical to pre-Phase-5)
- [ ] Tour Edit dialog — open one tour for edit, close without saving
- [ ] Departures management — list loads
- [ ] Bookings tab — list loads
- [ ] Inquiries tab — list loads
- [ ] Reviews tab — list loads
- [ ] Newsletter tab — list loads
- [ ] Image Library — thumbnails load
- [ ] Members tab — list loads
- [ ] Packpoint admin — balance summary loads
- [ ] Vouchers admin — list loads
- [ ] Accounting tab — current month summary loads
- [ ] Marketing admin — campaigns list loads
- [ ] Visa admin — applications list loads
- [ ] Translation admin — string keys list loads
- [ ] Exchange rate admin — current rates load
- [ ] Affiliate admin — list loads
- [ ] WeChat Assist — settings load
- [ ] Skills admin — registered skills list loads
- [ ] Autonomous Agents tab — agents list loads (this tab was structurally extracted in Phase 5B)
- [ ] Calibration tools — page loads
- [ ] Monitor Dashboard — metrics load
- [ ] Audit log — recent events list loads
- [ ] Analytics — chart renders

**Rollback trigger (any tab):** Tab fails to load OR shows a console error mentioning `trpc.<key>` not found → identify the missing router; the responsible Phase 4 sub-PR (4B, 4C, 4D, or 4E) needs revert. Specifically:
- analytics, audit, monitor, stats → Phase 4B
- bookings, inquiries, departures, imageLibrary, homepage → Phase 4C
- vouchers, packpoint, accounting → Phase 4D
- adminAutonomous, calibration, marketing, translation, exchangeRate, competitor, affiliate, wechatAssist, visa-admin, skills-admin → Phase 4E

---

## Item 5 · Webhook idempotency replay (10 min) — STAGING preferred, or production with caution

This verifies the Phase 2 idempotency win.

### 5.1 Replay a known event
- [ ] In Stripe Dashboard → Events → pick the `charge.succeeded` event from Item 3 (or any past successful event from last 7 days)
- [ ] Click "..." → "Resend event" (or use Stripe CLI: `stripe events resend evt_xxx --webhook-endpoint we_xxx`)

### 5.2 Verify idempotent behavior
- [ ] **Expected (webhook side):** Endpoint returns 200 within 1s; the response body should include `"idempotent": true` if Phase 2 Module 1 wired it correctly
- [ ] **Expected (database side):** No duplicate booking, no double-packpoint-award, no double-email. Verify by checking the original booking's `updatedAt` did NOT change.
- [ ] **Rollback trigger:** Duplicate booking created OR duplicate packpoint awarded OR duplicate email sent → revert Phase 2 Module 1 (central idempotency table) immediately. This is a money-safety regression and must be fixed before any production traffic resumes.
- [ ] **Rollback trigger:** Webhook returns 5xx on replay → revert Phase 2 Module 1; the central idempotency table is misbehaving on dup-key.

---

## Item 6 · Post-smoke production health watch (passive, 30 min)

After all items above pass, leave the smoke log open and:
- [ ] Watch Stripe Dashboard webhooks page for 30 min — confirm no 5xx errors on incoming events
- [ ] Watch admin error log (or Sentry-equivalent if configured) for 30 min — confirm no unexpected exceptions
- [ ] **Rollback trigger:** Any 5xx on Stripe webhook in this 30-min window AND it's not a known intermittent issue → revert Phase 2 last commit and re-deploy prior version

---

## Smoke log template

Maintain this in `docs/refactor/phase-6-smoke-log.md` (one file, append-only during the run):

```markdown
# Phase 6 · Module 2 · Smoke Log

**Date/time started:** <YYYY-MM-DD HH:MM PT>
**Run by:** Jeff
**Environment:** PRODUCTION | STAGING
**Deployed commit SHA:** <from regression report>

## Outcomes

| Item | Sub-step | Outcome | Notes |
|---|---|---|---|
| 1.1 | Browse homepage | PASS / FAIL | <free text> |
| 1.2 | View tour detail | PASS / FAIL | |
| 1.3 | Search tours | PASS / FAIL | |
| 1.4 | Switch language | PASS / FAIL | |
| 2.1 | Add favorite | PASS / FAIL | |
| 2.2 | Booking history | PASS / FAIL | |
| 2.3 | Edit profile | PASS / FAIL | |
| 3.1-3.9 | Booking end-to-end | PASS / FAIL | Booking ID: <id>; refunded at: <time> |
| 4.1-4.25 | Admin tabs | PASS (<N>/<25>) / FAIL | List any failed tabs |
| 5.1-5.2 | Webhook replay | PASS / FAIL | Event ID: <evt_xxx>; idempotent: true/false |
| 6 | 30-min health watch | PASS / FAIL | <count of 5xx in window> |

## Verdict
**<ALL-PASS — proceed to Module 3 (docs update + tag) | FAIL — see Blockers below>**

## Blockers (if FAIL)
- Item <N.M>: <description> — rollback action: <git revert SHA + redeploy>
```

## Acceptance Criteria
- [ ] Module 1 PASS verdict in `docs/refactor/phase-6-regression-report.md` (gate)
- [ ] Smoke log file `docs/refactor/phase-6-smoke-log.md` created and filled
- [ ] All Item 1-5 sub-steps marked PASS (Item 1.4 language-switch may be partial — Chinese-strings-deferred per plan v2 backlog; document but do not block)
- [ ] Item 4 admin tabs: all 25 marked PASS (or exact list of failures documented)
- [ ] Item 6: 30-min health watch shows zero 5xx on Stripe webhook
- [ ] Verdict line at bottom of smoke log: ALL-PASS or FAIL with blockers
- [ ] Zero refunds left un-cleared (the Item 3 test booking IS refunded and reconciled before signing off)

## Deliverable
- New: `docs/refactor/phase-6-smoke-log.md` (filled by Jeff during the run)
- Modified: `docs/refactor/progress.md` (Phase 6 / Module 2 row → ALL-PASS or FAIL)
- Single commit by AI (after Jeff hands off the filled log):
  ```
  docs(refactor): Phase 6 module 2 — production smoke log

  Jeff ran the full smoke checklist against production on <date>.
  - Anonymous + member flows: <PASS/FAIL>
  - Booking end-to-end (real $X.XX charge refunded within 60s): <PASS/FAIL>
  - 25 admin tabs: <N/25 PASS>
  - Webhook idempotent replay: <PASS/FAIL>

  Verdict: <ALL-PASS — Module 3 (docs + tag) unblocked | FAIL — see blockers>
  ```

## Rollback

Per-item revert targets are defined inline in each Item above (search the file for "Rollback trigger:"). The highest-priority reverts:
- Item 3.5 / Item 5 (webhook idempotency failure) → revert Phase 2 Module 1 immediately (money-safety regression)
- Item 3.7 / Item 3.9 (packpoint award or clawback failure) → revert Phase 4D money paths
- Item 6 (sustained 5xx in 30-min watch) → revert the most recently deployed Phase 2 or 4D commit

**Catastrophic rollback (multiple items fail):** revert the entire Phase 4 merge sequence in reverse order (4E → 4D → 4C → 4B → 4A) until smoke passes again; v2 picks up from the last-green commit.

## Manual intervention
- **Jeff (mandatory, this whole module):** every checkbox in this file is a Jeff click. AI cannot certify production behavioral identity from logs alone — per plan.md line 375.
- **AI (supervisor) after Jeff hands off filled log:** verify smoke log is well-formed; commit the smoke log file; update `progress.md`; gate Module 3 on Module 2 verdict.

## Test plan
- This module IS the production behavioral test. No further automated tests.
- If Jeff catches a regression that the automated suite (Module 1) missed: add a Vitest case for that scenario as part of the rollback fix, so v2 starts with one more anchor.
