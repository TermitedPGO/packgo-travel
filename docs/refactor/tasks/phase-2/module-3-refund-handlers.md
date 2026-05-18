# Phase 2 · Module 3 · Refund Handler — Transaction + Tests

**Parent plan:** docs/refactor/plan.md (Phase 2 · Stripe Webhook Hardening)
**Audit ref:** P0-2
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2 h AI + 0.5 h Jeff review

## Goal
Wrap the refund handler (`handleChargeRefunded`) in `db.transaction(...)` so the multi-write sequence (payment status + booking status + seat release + packpoint clawback) is atomic — then add rigorous Vitest (happy + failure + idempotent-retry per Q6, plus voucher-restore and packpoint-clawback assertions).

## Pre-requisites
- **Module 1 (idempotency table) MUST land first** (sequential gate)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0)
- Phase 0 complete (clean working tree)
- Runs in parallel with modules 2, 4, 5 once module 1 lands
- Module 2 may run concurrently; coordinate on `server/db.ts` helper-signature changes (both modules extend money-path helpers to accept `tx?`) — supervisor merges in dependency order

## Inputs (read these before executing)
- `server/_core/stripeWebhook.ts`:
  - **`handleChargeRefunded`** (lines 456–659). Multi-write sequence in order:
    - line 478: `db.getPaymentByIntentId(...)` — READ
    - line 492: `db.updatePaymentStatus(intentId, "refunded", new Date())` — WRITE 1
    - lines 522–533: conditional `drizzle.update(bookings).set({...}).where(... ne(bookingStatus, 'cancelled'))` — WRITE 2 (atomic UPDATE … WHERE; this is the "won the race" check)
    - lines 548–551: unconditional `drizzle.update(bookings).set({ paymentStatus: 'refunded' })` if step 2 didn't transition — WRITE 2b
    - line 568: `db.releaseDepartureSlots(...)` — WRITE 3 (only if step 2 won the race)
    - lines 593–614: `pointsTransactions` lookup + `deductPackpoint(...)` — WRITE 4 (packpoint clawback; `deductPackpoint` has its own internal tx in `server/_core/packpoint.ts` line 180)
    - lines 632–656: `notifyOwner` + `notifyAgentMessage` — side effects (OUTSIDE tx)
  - Idempotency short-circuit at line 486–489 — already REMOVED by module 1.
  - **Key complexity:** the existing handler uses a conditional UPDATE … WHERE … ne(bookingStatus, 'cancelled') as a race guard. The transaction wrapper must preserve this — the conditional update remains a single atomic statement inside the tx; the `affectedRows` check still works. Do NOT split this into separate SELECT + UPDATE.
- `server/_core/packpoint.ts` line 180 (`deductPackpoint`) — already opens its own `db.transaction`. Same decision as module 2: **call AFTER the outer tx commits**. Packpoint clawback runs post-commit, has its own idempotency via `pointsTransactions` lookup.
- `server/db.ts`:
  - `getPaymentByIntentId` (line 1063) — needs `tx?` parameter
  - `updatePaymentStatus` (line 1077) — module 2 already extends this; coordinate
  - `releaseDepartureSlots` (find via `grep -n "releaseDepartureSlots" server/db.ts`) — needs `tx?`
  - `getBookingById` — needs `tx?` (for reading inside the tx to get current state)
- `server/_core/stripeMocks.ts` — module 1's `makeCharge` factory.
- Vouchers: the audit mentions "voucher restore" in the refund flow, but reviewing handler lines 456–659 there is NO direct voucher logic — vouchers are only consumed at booking creation (in `bookings` router), not in the webhook. **The test plan should still assert that voucher restoration is NOT (yet) triggered here**, and flag a follow-up if Jeff wants voucher restore on refund (that would be a separate behavior change, OUT OF SCOPE for this module).

## Procedure

1. **Read `handleChargeRefunded` (lines 456–659) end-to-end** and split lines into three groups in a comment block at the top:
   - PRE-CHECK (no writes): lines 460–489 (intent lookup, full-refund check, payment lookup, idempotency-was-here)
   - INSIDE TX (atomic writes): lines 492 (payment status) + 522–552 (conditional booking update + fallback paymentStatus-only) + 568 (releaseDepartureSlots, conditional on `transitionedToCancelled`)
   - POST-COMMIT (side effects + own-tx helpers): packpoint clawback (lines 593–614), notifyOwner / notifyAgentMessage (lines 632–656)

2. **Extend money-path db helpers to accept optional `tx`** (if module 2 hasn't already done this):
   - `db.getPaymentByIntentId(intentId, tx?)`
   - `db.releaseDepartureSlots(departureId, count, tx?)`
   - `db.getBookingById(id, tx?)`
   - Module 2's signature changes for `updatePaymentStatus` apply here too — coordinate via supervisor.

3. **Wrap the write block in `db.transaction`:**
   ```ts
   async function handleChargeRefunded(charge: Stripe.Charge) {
     // ... pre-check (lines 460–489) unchanged ...

     let transitionedToCancelled = false;
     let seatsToRelease = 0;
     let departureIdForRelease: number | null = null;

     await db.transaction(async (tx) => {
       // WRITE 1: payment row
       await db.updatePaymentStatus(paymentIntentId, "refunded", new Date(), tx);

       if (payment.bookingId) {
         // Snapshot booking inside tx for seat count
         const bookingSnap = await db.getBookingById(payment.bookingId, tx);

         // WRITE 2: conditional booking transition
         const result = await tx
           .update(bookingsTable)
           .set({ paymentStatus: "refunded", bookingStatus: "cancelled" })
           .where(and(eq(bookingsTable.id, payment.bookingId),
                      ne(bookingsTable.bookingStatus, "cancelled")));
         const affected = (result?.[0]?.affectedRows ?? result?.affectedRows ?? 0) | 0;
         transitionedToCancelled = affected > 0;

         // WRITE 2b: fallback paymentStatus-only if we didn't win the race
         if (!transitionedToCancelled) {
           await tx.update(bookingsTable)
             .set({ paymentStatus: "refunded" })
             .where(eq(bookingsTable.id, payment.bookingId));
         }

         // WRITE 3: seat release (only if we owned the transition)
         if (transitionedToCancelled && bookingSnap?.departureId) {
           const seatCount =
             (bookingSnap.numberOfAdults || 0) +
             (bookingSnap.numberOfChildrenWithBed || 0) +
             (bookingSnap.numberOfChildrenNoBed || 0);
           if (seatCount > 0) {
             await db.releaseDepartureSlots(bookingSnap.departureId, seatCount, tx);
             seatsToRelease = seatCount;
             departureIdForRelease = bookingSnap.departureId;
           }
         }
       }
     });

     // POST-COMMIT: packpoint clawback (has its own tx + own idempotency)
     if (payment.bookingId) {
       try {
         // ... existing lines 585–622 packpoint clawback unchanged ...
       } catch (err) { console.error(...); }
     }

     // POST-COMMIT: notifyOwner + notifyAgentMessage (lines 630–658 unchanged)
   }
   ```

4. **Preserve `transitionedToCancelled` semantics carefully** — this is the load-bearing race guard. The atomic UPDATE … WHERE … ne(bookingStatus, 'cancelled') stays a single statement inside the tx; the affectedRows check stays after. The behavior is identical to the pre-transaction code; the tx wrapper just makes WRITE 1 + WRITE 2 + WRITE 2b + WRITE 3 atomic together.

5. **Create test file `server/_core/stripeWebhook.refunds.test.ts`** (≤400 LOC). Use the same fixture style as modules 1 + 2. Mock `packpoint` (specifically `deductPackpoint`), `notification`, `agentNotify`.

6. **Write 5 Vitest cases:**

   **Case 1 — charge.refunded full-refund happy path:**
   - Given: booking confirmed + paid, payments row exists, packpoint earned for this booking.
   - When: full-refund event.
   - Then: payments row → `refunded`, bookings → `paymentStatus=refunded` + `bookingStatus=cancelled`, `releaseDepartureSlots` called with the seat count, `deductPackpoint` called with the earned-points amount + reason `clawback`, notifyOwner + notifyAgentMessage called.

   **Case 2 — charge.refunded partial-refund short-circuit:**
   - Given: `charge.amount_refunded < charge.amount` (e.g., 50/100).
   - Then: NO writes happen; handler logs the partial and returns. `transitionedToCancelled` stays false.

   **Case 3 — charge.refunded mid-handler DB failure rolls back:**
   - Given: `releaseDepartureSlots` throws inside the tx.
   - Then: payments row NOT changed, bookings row NOT changed, packpoint clawback NOT called (post-commit skipped because tx threw), idempotency row marked `failed`.

   **Case 4 — charge.refunded idempotent retry:**
   - Given: same event.id delivered twice.
   - Then: first call performs the full refund flow; second call short-circuits at `claimStripeEvent`. No double seat release, no double packpoint clawback, no double notification.

   **Case 5 — charge.refunded race-loss case (booking already cancelled):**
   - Given: another path (manual admin cancel) already flipped booking to `bookingStatus=cancelled` between the snapshot and the conditional update.
   - When: refund event arrives.
   - Then: conditional UPDATE returns `affectedRows=0`, `transitionedToCancelled=false`, fallback paymentStatus-only update DOES run, `releaseDepartureSlots` is NOT called (avoid double-release), packpoint clawback still runs post-commit (it's idempotent via its own internal check).

7. **Voucher-restore explicit non-test note:** add a top-of-file comment in `stripeWebhook.refunds.test.ts`:
   ```ts
   // Voucher restoration on refund is intentionally NOT tested here — the
   // current webhook does not restore vouchers. If the policy changes
   // (refunded booking → voucher returned to user's wallet), add a Vitest
   // case + handler logic in a separate PR. Tracked as v2 backlog item.
   ```

## Acceptance Criteria
- [ ] `handleChargeRefunded` wraps payment-status + booking-update + seat-release in a single `db.transaction`
- [ ] `transitionedToCancelled` race-guard semantics preserved bit-for-bit (atomic UPDATE … WHERE … ne())
- [ ] Packpoint clawback runs POST-COMMIT only
- [ ] Side effects (notifyOwner, notifyAgentMessage) run POST-COMMIT only
- [ ] `getPaymentByIntentId`, `getBookingById`, `releaseDepartureSlots` accept optional `tx`
- [ ] `server/_core/stripeWebhook.refunds.test.ts` has 5 named cases, all pass
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor count unchanged

## Deliverable
- Modified: `server/_core/stripeWebhook.ts`, `server/db.ts` (helper signatures, only if module 2 hasn't already extended them)
- New: `server/_core/stripeWebhook.refunds.test.ts`
- Single commit:
  ```
  feat(stripe-webhook): Phase 2 module 3 — refund handler in db.transaction

  - handleChargeRefunded now wraps payment-status flip + booking
    transition (atomic UPDATE … WHERE … ne(cancelled) preserved) + seat
    release in a single db.transaction.
  - Packpoint clawback + notifyOwner run post-commit; their own
    idempotency guards (pointsTransactions referenceId lookup) prevent
    double-deduct on Stripe retries.
  - Helper signatures extended: getPaymentByIntentId, getBookingById,
    releaseDepartureSlots accept optional tx.
  - Vitest: 5 cases in stripeWebhook.refunds.test.ts covering happy /
    partial / DB-rollback / idempotent / race-loss.
  ```

## Rollback
- `git revert <commit-SHA>` restores pre-transaction behavior. The conditional UPDATE race guard worked before transactions and will work after revert.
- The packpoint clawback was already post-handler-success in the original code (via try/catch isolation), so reverting doesn't change clawback semantics.
- If post-deploy a customer reports "I got refunded but my seat wasn't released" or "my points got deducted twice", inspect Stripe webhook logs for the event.id, check the stripeWebhookEvents row, and check the bookings/pointsTransactions tables. Revert this module only — modules 1, 2, 4, 5 stay landed.

## Manual intervention
- None routine.
- If a test reveals that `releaseDepartureSlots` has hidden state that doesn't compose well with the outer tx (e.g., it locks a row in a way that deadlocks with the conditional booking update), escalate to supervisor — may need to split the seat release out of the tx.

## Test plan
- `pnpm test server/_core/stripeWebhook.refunds.test.ts` — 5 cases:
  1. **Full-refund happy path** — payments + booking + seats + packpoint clawback all run
  2. **Partial-refund short-circuit** — no writes, early return
  3. **Mid-tx DB failure rolls back** — payments/booking unchanged, packpoint NOT called
  4. **Idempotent retry** — second delivery short-circuits at claimStripeEvent
  5. **Race-loss (booking already cancelled)** — fallback paymentStatus-only update runs, seats NOT released
- Mock `deductPackpoint`, `notifyOwner`, `notifyAgentMessage` — assert call counts (zero on rollback, one on retry).
- Full suite `pnpm test` regression-anchor count unchanged.
