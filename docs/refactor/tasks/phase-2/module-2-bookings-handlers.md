# Phase 2 · Module 2 · Booking Handlers — Transactions + Tests

**Parent plan:** docs/refactor/plan.md (Phase 2 · Stripe Webhook Hardening)
**Audit ref:** P0-2
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2.5 h AI + 0.5 h Jeff review

## Goal
Wrap the three booking-path handlers (`handleCheckoutSessionCompleted`, `handlePaymentIntentSucceeded`, `handlePaymentIntentFailed`) in `db.transaction(...)` so the multi-write sequence (payment row + booking status + packpoint + accounting) is atomic — then add rigorous Vitest (happy + failure + idempotent-retry per Q6).

## Pre-requisites
- **Module 1 (idempotency table) MUST land first** (sequential gate — this module imports `stripeMocks.ts` factories + relies on central dedupe at handler entry)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0)
- Phase 0 complete (clean working tree)
- Runs in parallel with modules 3, 4, 5 once module 1 lands

## Inputs (read these before executing)
- `server/_core/stripeWebhook.ts`:
  - **`handleCheckoutSessionCompleted`** (lines 123–422). Multi-write sequence:
    - line 190: `db.createPayment(...)` — insert payments row
    - line 218: `db.updateBooking(...)` — flip `paymentStatus` + `bookingStatus`
    - line 239: `awardBookingPackpoint(...)` (already has its own `db.transaction` inside; keep call but ensure it joins ours)
    - line 264: `awardReferralOnFirstBooking(...)` (idempotent via `users.referralBonusAwarded` flag)
    - line 281: `cancelAbandonmentRecovery(...)` (queue cancel — not a DB write, leave outside tx)
    - line 291: `createAccountingEntry(...)` — accounting income row
    - lines 311 / 350 / 393 / 405: email sends + notifyOwner + notifyAgentMessage (side effects — leave OUTSIDE the transaction; they run after commit)
  - **`handlePaymentIntentSucceeded`** (lines 424–430). Single write: `db.updatePaymentStatus(paymentIntent.id, "completed", new Date())`. Wrap in tx for symmetry + future-proofing if more writes get added.
  - **`handlePaymentIntentFailed`** (lines 432–438). Single write: `db.updatePaymentStatus(paymentIntent.id, "failed")`. Same treatment.
- `server/db.ts`:
  - Line 940: `updateBooking` signature
  - Line 1040: `createPayment` signature
  - Line 1077: `updatePaymentStatus` signature
  - Line 3245: `createAccountingEntry` signature
  - Line 1007: existing `db.transaction` usage pattern — copy this style
  - **CHECK**: Do these helpers accept a `tx` parameter override, or do they always use `getDb()`? If they always use `getDb()`, you need to (a) extend each helper signature to accept an optional `tx` and (b) plumb it through. Suggested signature: `updateBooking(id, updates, tx?: DrizzleTx)`.
- `server/_core/packpoint.ts` lines 113, 180 — `awardBookingPackpoint` already opens its own `db.transaction`. Decision: either (a) accept an `outerTx` so we nest, or (b) call it AFTER the outer transaction commits. **Recommended:** call AFTER commit, because nested transactions in MySQL are tricky (SAVEPOINT semantics). Rationale: packpoint already has its own idempotency check on `pointsTransactions.referenceId`, so post-commit call is safe — if the outer tx rolls back, the booking is unchanged so packpoint shouldn't have been awarded anyway.
- `server/_core/stripeMocks.ts` — created by module 1, factories used by tests here.
- `server/_core/stripeWebhookIdempotency.test.ts` — created by module 1, used as test-fixture style template.

## Procedure

1. **Read the three handler functions end-to-end** to understand which lines are DB writes (need to be inside tx) vs. external side effects (queue cancel, emails, notifyOwner — must be outside tx). Document the split in a comment block at the top of the modified handler.

2. **Extend money-path db helpers to accept optional `tx` (if not already):**
   - `db.createPayment(payment, tx?)` — body uses `tx ?? getDb()`
   - `db.updateBooking(id, updates, tx?)` — same
   - `db.updatePaymentStatus(intentId, status, paidAt?, tx?)` — same
   - `db.createAccountingEntry(entry, tx?)` — same
   - **DO NOT** change the signature of `awardBookingPackpoint` — call it post-commit instead.
   - Add a `DrizzleTx` type export from `server/db.ts` (derive from existing `db.transaction` callback parameter type).

3. **Wrap `handleCheckoutSessionCompleted` (lines 123–422)** in `db.transaction`:
   ```ts
   await db.transaction(async (tx) => {
     await db.createPayment({...}, tx);              // was line 190
     await db.updateBooking(parseInt(bookingId), {   // was line 218
       paymentStatus: newPaymentStatus,
       bookingStatus: newBookingStatus,
     }, tx);
     await db.createAccountingEntry({...}, tx);      // was line 291
   });
   // OUTSIDE the transaction (only run if tx committed):
   if (newPaymentStatus === "paid" && (booking as any).userId) {
     await awardBookingPackpoint({...});             // was line 239
     await awardReferralOnFirstBooking({...});       // was line 264
   }
   await cancelAbandonmentRecovery(parseInt(bookingId));
   await sendPaymentSuccessEmail({...});             // was line 311
   await sendSupplierNotificationEmail({...});       // was line 350
   await notifyOwner({...});                         // was line 393
   await notifyAgentMessage({...});                  // was line 405
   ```
   Notes:
   - Keep ALL existing try/catch behavior on the post-commit side effects (email + notify failures must NOT roll back the payment).
   - Visa branch (line 154–158) is module 5's concern — leave the `if (visaApplicationId)` short-circuit untouched.
   - Subscription branch (line 134–148) calls `handleSubscriptionUpserted` — module 4's concern; leave untouched.

4. **Wrap `handlePaymentIntentSucceeded` (lines 424–430)** in `db.transaction`:
   ```ts
   async function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent) {
     console.log("[Stripe Webhook] Processing payment_intent.succeeded");
     await db.transaction(async (tx) => {
       await db.updatePaymentStatus(paymentIntent.id, "completed", new Date(), tx);
     });
   }
   ```

5. **Wrap `handlePaymentIntentFailed` (lines 432–438)** in `db.transaction`:
   ```ts
   async function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent) {
     console.log("[Stripe Webhook] Processing payment_intent.payment_failed");
     await db.transaction(async (tx) => {
       await db.updatePaymentStatus(paymentIntent.id, "failed", undefined, tx);
     });
   }
   ```

6. **Create test file `server/_core/stripeWebhook.bookings.test.ts`** (≤450 LOC). Setup:
   - Per-test transaction-rollback fixture OR `vi.mock("../db")` to provide an in-memory Drizzle. Match the pattern used by `stripeWebhookIdempotency.test.ts` (module 1).
   - Mock `packpoint`, `email`, `notification`, `agentNotify`, `referral`, `abandonmentRecoveryQueue` — these are all side effects we assert WERE or WERE NOT called.
   - Use `makeStripeEvent` + `makeCheckoutSession` + `makePaymentIntent` from `stripeMocks.ts`.

7. **Write 9 Vitest cases** (3 handlers × 3 cases: happy / failure / idempotent retry):

   **Case 1 — checkout.session.completed (booking) happy path:**
   - Given: a known booking row, a fresh Stripe event for `checkout.session.completed`.
   - When: `handleStripeWebhook` is invoked.
   - Then: `payments` row created, `bookings.paymentStatus=paid` + `bookingStatus=confirmed`, accounting entry inserted, `awardBookingPackpoint` called once with the expected args, email + notifyOwner both called.

   **Case 2 — checkout.session.completed mid-handler DB failure rolls back:**
   - Given: same as above but `createAccountingEntry` throws.
   - Then: `payments` row NOT present (transaction rolled back), `bookings` status unchanged, `awardBookingPackpoint` NOT called (post-commit skipped because tx threw), `markStripeEventFailed` was called with the error.

   **Case 3 — checkout.session.completed idempotent retry:**
   - Given: same event delivered twice.
   - Then: first call performs all writes; second call short-circuits at `claimStripeEvent` (alreadyProcessed=true), no extra payments row, packpoint NOT awarded a second time, no second accounting entry, response is `{ received: true, idempotent: true }`.

   **Case 4 — payment_intent.succeeded happy path:**
   - Given: a payments row in `pending` status for the intent.id.
   - When: handler invoked.
   - Then: payments row flipped to `completed` with `paidAt` set.

   **Case 5 — payment_intent.succeeded DB failure rolls back:**
   - Given: `updatePaymentStatus` throws (simulate connection drop).
   - Then: payments row unchanged, idempotency row marked `failed`, error surfaced so Stripe retries.

   **Case 6 — payment_intent.succeeded idempotent retry:**
   - Given: same event.id replayed.
   - Then: second call short-circuits, no extra writes.

   **Case 7 — payment_intent.payment_failed happy path:**
   - Given: a payments row in `pending`.
   - Then: status flipped to `failed`.

   **Case 8 — payment_intent.payment_failed DB failure rolls back:**
   - Symmetric to case 5.

   **Case 9 — payment_intent.payment_failed idempotent retry:**
   - Symmetric to case 6.

8. **Run the suite locally**, fix anything, then commit.

## Acceptance Criteria
- [ ] `handleCheckoutSessionCompleted` wraps `createPayment` + `updateBooking` + `createAccountingEntry` in `db.transaction`
- [ ] `handlePaymentIntentSucceeded` wraps `updatePaymentStatus` in `db.transaction`
- [ ] `handlePaymentIntentFailed` wraps `updatePaymentStatus` in `db.transaction`
- [ ] Post-commit side effects (packpoint, email, notify, queue) run OUTSIDE the transaction and only on success
- [ ] All money-path db helpers accept an optional `tx` parameter
- [ ] `server/_core/stripeWebhook.bookings.test.ts` has 9 named cases, all pass
- [ ] No reduction in existing test coverage (`pnpm test` regression-anchor count unchanged)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `wc -l server/_core/stripeWebhook.ts` ≤ 1019 (no growth — comments + tx wrappers should net out against removed redundant checks from module 1)

## Deliverable
- Modified: `server/_core/stripeWebhook.ts`, `server/db.ts` (helper signatures)
- New: `server/_core/stripeWebhook.bookings.test.ts`
- Single commit:
  ```
  feat(stripe-webhook): Phase 2 module 2 — booking handlers in db.transaction

  - handleCheckoutSessionCompleted now wraps createPayment + updateBooking +
    createAccountingEntry in a single db.transaction. Post-commit side
    effects (packpoint, email, notify, queue cancel) run only on success.
  - handlePaymentIntentSucceeded + handlePaymentIntentFailed also wrapped.
  - All money-path db helpers (createPayment, updateBooking,
    updatePaymentStatus, createAccountingEntry) now accept optional tx.
  - Vitest: 9 cases in stripeWebhook.bookings.test.ts covering happy /
    DB-failure-rollback / idempotent-retry for each of 3 handlers.
  ```

## Rollback
- `git revert <commit-SHA>` restores pre-transaction behavior. No data migration needed (the idempotency table from module 1 keeps working).
- If a regression appears AFTER deploy, the most likely failure mode is a side effect that depended on running BEFORE the DB write (e.g., reading the not-yet-committed booking). Inspect logs for the failing handler family + revert just this module's commit; module 1 + modules 3/4/5 stay landed.

## Manual intervention
- None routine.
- If Vitest fails on a non-obvious race condition, escalate to supervisor — do not patch over with sleep/retry.

## Test plan
- `pnpm test server/_core/stripeWebhook.bookings.test.ts` — 9 cases (enumerated above)
- All use `stripeMocks.ts` factories from module 1; no real Stripe network calls
- Mock `packpoint`, `email`, `notification`, `agentNotify`, `referral`, `abandonmentRecoveryQueue` to assert side-effect call counts
- Use in-memory Drizzle OR per-test transaction-rollback fixture (whatever module 1's test established as the project pattern)
- Full suite `pnpm test` regression-anchor count unchanged
