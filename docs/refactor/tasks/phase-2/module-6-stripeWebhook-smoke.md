# Phase 2 · Module 6 · Jeff Manual Staging Replay Smoke

**Parent plan:** docs/refactor/plan.md (Phase 2 · Stripe Webhook Hardening)
**Audit ref:** P0-2
**Owner agent:** N/A — this is a Jeff-driven verification gate
**Status:** TODO
**Est. effort:** 0 h AI + 1 h Jeff hands-on

## Goal
Jeff personally verifies on staging that all five handler families (booking, refund, subscription, trial-will-end, visa) behave correctly end-to-end — both on first delivery and on a manual replay (idempotent no-op). This is the human gate that signs off Phase 2 before production deploy.

## Pre-requisites
- Modules 1–5 ALL landed on staging
- Migration 0076_stripe_webhook_idempotency applied to staging DB (`DESCRIBE stripeWebhookEvents;` returns the expected columns)
- `pnpm tsc --noEmit` exit 0 on staging branch
- Full Vitest suite (including all module 1–5 new test files) green
- Stripe CLI installed locally (`stripe --version`) and authenticated to the PACK&GO staging account
- Staging environment variables set: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` pointing to staging Stripe project
- A known-good test booking exists on staging (or Jeff creates one via the staging UI before running the replays)

## Inputs (read these before executing)
- This file (module 6) is the runbook — Jeff follows the procedure top-to-bottom
- `docs/refactor/plan.md` Phase 2 verification gate section (lines ~138–155)
- `server/_core/stripeWebhook.ts` (post-Phase 2) — Jeff doesn't read code, but the supervisor confirms the file's current state matches expectations before the smoke

## Procedure

### Setup (5 min)

1. **Open three tabs side-by-side on staging:**
   - Stripe Dashboard → staging account → Developers → Events
   - Staging admin panel → Bookings tab + Accounting tab (separate tabs)
   - Staging database client (TablePlus / Sequel Pro / `mysql` CLI) connected to staging DB

2. **Snapshot baseline:**
   ```sql
   SELECT COUNT(*) FROM stripeWebhookEvents;
   SELECT COUNT(*) FROM payments;
   SELECT COUNT(*) FROM pointsTransactions;
   SELECT COUNT(*) FROM accountingEntries;
   ```
   Note the numbers somewhere — they're the baseline for "did rows actually get created/skipped" assertions.

3. **Confirm a test booking is available.** Either:
   - Use an existing pending booking on staging (find via `SELECT id, customerEmail, paymentStatus FROM bookings WHERE paymentStatus='unpaid' LIMIT 5;`), OR
   - Create a fresh test booking through staging UI as a logged-in test user

### Test 1 — Booking happy path (10 min)

4. Trigger a Stripe test payment via Stripe CLI:
   ```bash
   stripe trigger checkout.session.completed \
     --add checkout_session:metadata.booking_id=<TEST_BOOKING_ID> \
     --add checkout_session:metadata.payment_type=full
   ```

5. **Verify on staging within 30 seconds:**
   - Stripe Dashboard → Events → newest event has `200 OK` response (not 500)
   - DB: `SELECT * FROM stripeWebhookEvents ORDER BY id DESC LIMIT 1;` → status `succeeded`, processedAt populated
   - DB: `SELECT * FROM payments WHERE bookingId=<TEST_BOOKING_ID> ORDER BY id DESC LIMIT 1;` → new row, status `completed`
   - DB: `SELECT paymentStatus, bookingStatus FROM bookings WHERE id=<TEST_BOOKING_ID>;` → `paid` + `confirmed`
   - DB: `SELECT * FROM accountingEntries WHERE bookingId=<TEST_BOOKING_ID> ORDER BY id DESC LIMIT 1;` → new entry, `category='tour_booking'`
   - DB: `SELECT * FROM pointsTransactions WHERE referenceId=<TEST_BOOKING_ID> AND reason='booking_earn';` → new earn row (if test booking had a userId)
   - Admin panel → Bookings tab → the test booking shows as paid/confirmed
   - Admin panel → Accounting tab → the new income entry appears
   - Jeff's email inbox → payment confirmation email arrived

### Test 2 — Booking idempotent replay (5 min)

6. Re-trigger the SAME event from Stripe Dashboard:
   - Stripe Dashboard → Events → the just-fired event → click "Resend"

7. **Verify the idempotent no-op:**
   - Stripe Dashboard → the resend returned `200 OK` (response body should contain `"idempotent": true`)
   - DB: `SELECT COUNT(*) FROM payments WHERE bookingId=<TEST_BOOKING_ID>;` → SAME count as Test 1 (no new payment row)
   - DB: `SELECT COUNT(*) FROM accountingEntries WHERE bookingId=<TEST_BOOKING_ID>;` → SAME count as Test 1 (no new accounting row)
   - DB: `SELECT COUNT(*) FROM pointsTransactions WHERE referenceId=<TEST_BOOKING_ID>;` → SAME count as Test 1 (no double points)
   - Jeff's inbox → NO second copy of the payment confirmation email

### Test 3 — Refund happy path (5 min)

8. From Stripe Dashboard, locate the test charge from Test 1 and issue a full refund (Dashboard UI → charge detail → Refund button).

9. **Verify within 30 seconds:**
   - Stripe Dashboard → Events → `charge.refunded` event with `200 OK`
   - DB: `SELECT paymentStatus, bookingStatus FROM bookings WHERE id=<TEST_BOOKING_ID>;` → `refunded` + `cancelled`
   - DB: `SELECT paymentStatus FROM payments WHERE bookingId=<TEST_BOOKING_ID>;` → `refunded`
   - DB: `SELECT delta, reason FROM pointsTransactions WHERE referenceId=<TEST_BOOKING_ID> ORDER BY id DESC LIMIT 1;` → negative delta with `reason='clawback'`
   - DB: `SELECT remainingSlots FROM tourDepartures WHERE id=<DEPARTURE_ID>;` → seat count INCREASED by the booking's seat count (departure ID from the booking row)

### Test 4 — Refund idempotent replay (3 min)

10. Resend the `charge.refunded` event from Stripe Dashboard.

11. **Verify the no-op:**
    - Booking status unchanged
    - NO second clawback row in pointsTransactions
    - Seat count NOT released a second time

### Test 5 — Subscription create + trial flow (10 min)

12. Through staging UI, sign up a test user for the Plus tier with a 10-day trial.

13. **Verify subscription create:**
    - DB: `SELECT tier, tierExpiresAt, stripeSubscriptionId FROM users WHERE id=<TEST_USER>;` → `plus`, expiry set, subscription ID populated
    - DB: `SELECT * FROM membershipTrials WHERE userId=<TEST_USER>;` → one row, `converted=false`, `endsAt` populated, `reminderSentAt=null`
    - DB: `SELECT plusTrialUsedAt FROM users WHERE id=<TEST_USER>;` → populated (not null)

14. Trigger trial_will_end via Stripe CLI:
    ```bash
    stripe trigger customer.subscription.trial_will_end \
      --add subscription:id=<SUBSCRIPTION_ID>
    ```

15. **Verify trial_will_end:**
    - DB: `SELECT reminderSentAt FROM membershipTrials WHERE userId=<TEST_USER>;` → populated (not null)
    - Test user's inbox → AB 390 reminder email arrived with charge amount, trial end date, cancel URL

16. Resend the `trial_will_end` event from Stripe Dashboard.

17. **Verify idempotent no-op:**
    - `reminderSentAt` unchanged
    - NO second email arrived

### Test 6 — Visa payment (10 min)

18. Through staging UI, submit a China visa application as a test user and proceed to checkout (test card).

19. **Verify visa payment:**
    - Stripe Dashboard → `checkout.session.completed` event with `200 OK`
    - DB: `SELECT paymentStatus, stripePaymentIntentId, paidAt FROM visaApplications WHERE id=<APP_ID>;` → `paid`, intent populated, paidAt set
    - DB: `SELECT status FROM visaApplications WHERE id=<APP_ID>;` → `paid`
    - DB: `SELECT * FROM accountingEntries WHERE visaApplicationId=<APP_ID> ORDER BY id DESC LIMIT 1;` → new entry, `category='visa_service'`
    - Test user's inbox → visa confirmation email arrived

20. Resend the visa checkout event from Stripe Dashboard.

21. **Verify idempotent no-op:**
    - NO second accounting entry
    - NO second confirmation email

### Final verification + sign-off (5 min)

22. Final state check:
    ```sql
    SELECT eventType, status, COUNT(*) FROM stripeWebhookEvents
      WHERE receivedAt > <smoke-start-timestamp>
      GROUP BY eventType, status;
    ```
    Expected: each event type appears with `status=succeeded` count matching delivered-once counts; idempotent resends did NOT create extra rows (UNIQUE constraint on eventId prevented them).

23. **Sign-off:** Jeff updates `docs/refactor/progress.md` Phase 2 / Module 6 → DONE with smoke-pass timestamp.

24. **Green-light production deploy** — schedule for next Tue/Wed/Thu morning 9–11am PT window (per plan.md Q5).

## Acceptance Criteria
- [ ] Test 1 (booking happy path): all 7 DB+UI+email assertions pass
- [ ] Test 2 (booking idempotent replay): no second-write side effects (5 assertions)
- [ ] Test 3 (refund happy path): all 4 DB assertions pass + seat release verified
- [ ] Test 4 (refund idempotent replay): no double clawback / double release
- [ ] Test 5 (subscription + trial_will_end): users.tier set, trial row created, AB 390 email arrives, replay is idempotent
- [ ] Test 6 (visa payment): all 3 DB assertions pass + email arrives + replay is idempotent
- [ ] Final `stripeWebhookEvents` count matches expected per event type
- [ ] Jeff signs off in progress.md
- [ ] No 5xx responses observed in Stripe Dashboard for any test event
- [ ] No unexpected errors in server logs during the 1-hour smoke window

## Deliverable
- Filled-in smoke checklist results (Jeff types pass/fail next to each assertion in this file OR appends a results section)
- Updated `docs/refactor/progress.md` with Phase 2 Module 6 status
- Production-deploy go/no-go decision (in plan.md Phase 2 § "Deploy" section, this is the gating event)

## Rollback
- If ANY assertion fails: Jeff documents the failure, the supervisor (or Stage 4 agent dispatcher) creates a bug ticket against the failing module (2/3/4/5), and Phase 2 deploy is BLOCKED until the bug is fixed and the smoke re-run.
- If a specific handler fails but others pass: revert ONLY the failing module's commit on staging; the rest of Phase 2 can still proceed once the failing module is patched.
- DO NOT proceed to production until ALL six tests pass.

## Manual intervention
- ALL of this module is Jeff manual. The plan explicitly flags this as a "Manual intervention flag" — AI cannot certify production idempotency from logs alone; a human must replay the events and verify the side effects empirically.
- AI's role is limited to: (a) confirming pre-requisites pass before Jeff starts, (b) helping Jeff debug any failed assertion, (c) updating progress.md after sign-off.

## Test plan
- This module IS the test plan — six end-to-end scenarios against staging, executed in order by Jeff, results recorded inline.
- No new Vitest cases here (modules 1–5 own the unit/integration coverage; module 6 is system-level acceptance).
