# Phase 2 · Module 1 · Central Idempotency Table + Helper

**Parent plan:** docs/refactor/plan.md (Phase 2 · Stripe Webhook Hardening)
**Audit ref:** P0-2
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5 h AI + 0.5 h Jeff review

## Goal
Create `stripeWebhookEvents` Drizzle table + a single up-front dedupe helper used by `handleStripeWebhook`, then remove the six per-handler idempotency `if (existing) return` checks. This module is the sequential gate for modules 2–5.

## Pre-requisites
- Phase 0 complete (clean `git status`)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0)
- Jeff approves the migration SQL before it runs against staging
- This module MUST land in its own commit before modules 2–5 sub-agents start (they import the helper)

## Inputs (read these before executing)
- `server/_core/stripeWebhook.ts` — the only consumer
  - Top of file lines 1–22: imports + lazy `getStripe()`
  - Dispatch table lines 24–121 (`handleStripeWebhook` body)
  - Six per-handler idempotency checks to remove:
    - line 176–188 (`handleCheckoutSessionCompleted` — checks `getPaymentByIntentId`)
    - line 227–228 (comment-only; the real check at 180; just clean up comment)
    - line 260–273 (`awardReferralOnFirstBooking` idempotency — leave inside helper; do NOT touch)
    - line 484–489 (`handleChargeRefunded` — checks `payment.paymentStatus === "refunded"`)
    - line 747–748 (subscription handler comment — actual check is implicit via stripeSubscriptionId match)
    - line 929–933 (`handleTrialWillEnd` — checks `trial.reminderSentAt`)
  - **IMPORTANT:** Of the six checks, only lines 180–188, 486–489, 930–933 are duplicate-event guards (replace with central helper). Lines 260–273 are domain-level idempotency (referral first-booking; KEEP). Line 747 is just a comment. Line 227 is a comment.
- `drizzle/schema.ts` — alphabetic placement: insert `stripeWebhookEvents` between `subscriptionEvents`-adjacent tables; search for `stripe` first to find canonical neighbors. Suggested position: near `payments` table (line 744) since they share the money domain. Final location decided by supervisor after viewing existing table order.
- `drizzle/0075_crm_ops_membership.sql` — most recent migration, use as style template (each `CREATE TABLE` / `ALTER` as its own statement, TiDB-safe).
- `server/db.ts` lines 1007–1015 (existing `db.transaction` usage pattern) for helper consistency.

## Procedure

1. **Read `drizzle/schema.ts` around line 744–778** (payments table) to confirm canonical column conventions (camelCase, `createdAt`/`updatedAt` defaults, `mysqlEnum` syntax).

2. **Add the table to `drizzle/schema.ts`.** Insert immediately after the `payments` table block (around line 778). Schema:
   ```ts
   /**
    * Central Stripe webhook idempotency table (Phase 2 of refactor 2026-05).
    *
    * Stripe retries webhook delivery on transient failures (timeout, 5xx).
    * Without a central dedupe key, every handler had to implement its own
    * "have I seen this event?" check (lines 180/486/930 of stripeWebhook.ts).
    * This table is the single source of truth: handleStripeWebhook inserts
    * a row at the top of dispatch (status=processing) and updates to
    * status=succeeded|failed when the handler returns. A second delivery
    * of the same event.id short-circuits at the insert (UNIQUE collision).
    */
   export const stripeWebhookEvents = mysqlTable("stripeWebhookEvents", {
     id: int("id").autoincrement().primaryKey(),
     /** Stripe event.id (evt_…) — the dedupe key. */
     eventId: varchar("eventId", { length: 255 }).notNull(),
     /** event.type, useful for analytics and replay scoping. */
     eventType: varchar("eventType", { length: 128 }).notNull(),
     status: mysqlEnum("status", ["processing", "succeeded", "failed"]).notNull(),
     /** Free-form failure detail (truncate to 1024 chars on write). */
     errorMessage: text("errorMessage"),
     receivedAt: timestamp("receivedAt").notNull().defaultNow(),
     processedAt: timestamp("processedAt"),
   }, (t) => ({
     uniqEventId: unique("uniq_stripeWebhookEvents_eventId").on(t.eventId),
   }));

   export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
   export type InsertStripeWebhookEvent = typeof stripeWebhookEvents.$inferInsert;
   ```

3. **Create the migration file `drizzle/0076_stripe_webhook_idempotency.sql`:**
   ```sql
   -- Phase 2 of 2026-05 refactor — central Stripe webhook idempotency.
   --
   -- Replaces six per-handler `if (existing) return` checks in
   -- server/_core/stripeWebhook.ts (lines 180/486/930) with a single
   -- UNIQUE-key insert at the top of handleStripeWebhook.
   --
   -- TiDB-safe: each statement standalone (see migration 0073 precedent).

   CREATE TABLE `stripeWebhookEvents` (
     `id` INT NOT NULL AUTO_INCREMENT,
     `eventId` VARCHAR(255) NOT NULL,
     `eventType` VARCHAR(128) NOT NULL,
     `status` ENUM('processing','succeeded','failed') NOT NULL,
     `errorMessage` TEXT,
     `receivedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     `processedAt` TIMESTAMP NULL,
     PRIMARY KEY (`id`),
     UNIQUE KEY `uniq_stripeWebhookEvents_eventId` (`eventId`)
   );
   ```

4. **Create down-migration `drizzle/0076_stripe_webhook_idempotency.down.sql`** (Drizzle doesn't auto-generate but Phase 2 needs prod rollback capability):
   ```sql
   -- Rollback for 0076. Drops the idempotency table.
   -- WARNING: running this in production reverts Stripe webhook to per-handler
   -- idempotency; Stripe will replay events received during the gap.
   DROP TABLE IF EXISTS `stripeWebhookEvents`;
   ```

5. **Create the helper file `server/_core/stripeWebhookIdempotency.ts` (≤120 LOC):**
   ```ts
   /**
    * Central Stripe webhook idempotency helper.
    *
    * One pattern, used at the top of handleStripeWebhook:
    *
    *   const claim = await claimStripeEvent(event);
    *   if (claim.alreadyProcessed) return res.json({ received: true });
    *   try {
    *     // ...existing dispatch switch...
    *     await markStripeEventSucceeded(claim.rowId);
    *   } catch (err) {
    *     await markStripeEventFailed(claim.rowId, err);
    *     throw err;  // surface to outer 500 handler so Stripe retries
    *   }
    */

   import * as db from "../db";
   import { stripeWebhookEvents } from "../../drizzle/schema";
   import { eq } from "drizzle-orm";

   export type ClaimResult =
     | { alreadyProcessed: true; existingStatus: "processing" | "succeeded" | "failed" }
     | { alreadyProcessed: false; rowId: number };

   /**
    * Attempt to insert a `processing` row for this event.id.
    * On UNIQUE collision the event was already received — return alreadyProcessed.
    */
   export async function claimStripeEvent(
     event: { id: string; type: string }
   ): Promise<ClaimResult> { … }

   export async function markStripeEventSucceeded(rowId: number): Promise<void> { … }

   export async function markStripeEventFailed(rowId: number, err: unknown): Promise<void> { … }

   // Test-only helper: clear the table (used by Vitest fixtures).
   export async function _clearStripeWebhookEvents_forTests(): Promise<void> { … }
   ```
   Implementation notes:
   - Use `getDb()` from `server/db.ts` (same lazy pattern as the file).
   - On INSERT, catch MySQL error code `ER_DUP_ENTRY` (1062) and return `alreadyProcessed: true` after looking up the existing row's `status`.
   - `errorMessage` truncated to 1024 chars before write.
   - `markStripeEventSucceeded` sets `status=succeeded` and `processedAt=NOW()`.
   - `markStripeEventFailed` sets `status=failed`, `errorMessage`, and `processedAt=NOW()`.

6. **Wire the helper into `server/_core/stripeWebhook.ts`:**
   - Import: add `import { claimStripeEvent, markStripeEventSucceeded, markStripeEventFailed } from "./stripeWebhookIdempotency";` near line 9.
   - In `handleStripeWebhook` (line 24), after the test-event short-circuit (line 51) and before the `try { switch ... }` (line 55):
     ```ts
     const claim = await claimStripeEvent(event);
     if (claim.alreadyProcessed) {
       console.log(`[Stripe Webhook] Idempotent skip: event ${event.id} already ${claim.existingStatus}`);
       return res.json({ received: true, idempotent: true });
     }
     ```
   - Wrap the existing `try { switch ... } catch` to call `markStripeEventSucceeded(claim.rowId)` on success and `markStripeEventFailed(claim.rowId, error)` on catch.
   - **Remove the now-redundant per-handler checks:**
     - lines 180–188 in `handleCheckoutSessionCompleted` (the `getPaymentByIntentId` guard)
     - lines 486–489 in `handleChargeRefunded` (the `paymentStatus === "refunded"` guard)
     - lines 930–933 in `handleTrialWillEnd` (the `reminderSentAt` guard)
   - **DO NOT remove** lines 260–273 (referral first-booking) — that's domain-level idempotency on `users.referralBonusAwarded`, unrelated to webhook replay.
   - **DO NOT remove** the existing `getPaymentByIntentId` lookup *itself*, only the redundant short-circuit. The payment row may still need to be referenced.

7. **Create Vitest stub `server/_core/stripeMocks.ts` (≤200 LOC)** — modules 2–5 import factories from this. Provide:
   - `makeStripeEvent({ type, id?, data })` — returns a typed `Stripe.Event` for any of the 6 dispatch types we cover.
   - `makeCheckoutSession({ bookingId, paymentType, paymentIntent, amount, currency })` — `Stripe.Checkout.Session`.
   - `makePaymentIntent({ id, status, metadata })` — `Stripe.PaymentIntent`.
   - `makeCharge({ paymentIntent, amount, amount_refunded })` — `Stripe.Charge`.
   - `makeSubscription({ id, customerId, status, priceId, currentPeriodEnd, trialEnd?, metadata })` — `Stripe.Subscription`.
   - Each factory accepts overrides; only the fields the handlers actually read need to be populated.

8. **Write Vitest for the helper: `server/_core/stripeWebhookIdempotency.test.ts`:**
   - Use a per-test transaction-rollback fixture, OR mock `getDb()` to return an in-memory Drizzle (preferred — modules 2–5 will share this).
   - Test cases (5):
     1. `claimStripeEvent` on a fresh event.id returns `alreadyProcessed: false` with a numeric `rowId`.
     2. `claimStripeEvent` on the same event.id twice — second call returns `alreadyProcessed: true` with `existingStatus: "processing"`.
     3. `markStripeEventSucceeded` flips status; subsequent `claimStripeEvent` returns `alreadyProcessed: true` with `existingStatus: "succeeded"`.
     4. `markStripeEventFailed` writes the error message truncated to 1024 chars; subsequent claim returns `existingStatus: "failed"`.
     5. UNIQUE-key behavior: two parallel `Promise.all([claim, claim])` — only one wins; the other sees `alreadyProcessed: true`.

## Acceptance Criteria
- [ ] `drizzle/schema.ts` has the `stripeWebhookEvents` table with `UNIQUE(eventId)`
- [ ] `drizzle/0076_stripe_webhook_idempotency.sql` + `.down.sql` exist
- [ ] `server/_core/stripeWebhookIdempotency.ts` exists and is ≤120 LOC
- [ ] `server/_core/stripeMocks.ts` exists with the five factories listed in step 7
- [ ] `server/_core/stripeWebhook.ts`: claim/succeed/fail wired around the dispatch switch
- [ ] Three per-handler `if (existing) return` blocks removed (lines 180–188, 486–489, 930–933)
- [ ] `server/_core/stripeWebhookIdempotency.test.ts` exists, 5 cases, all pass
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor pass count UNCHANGED + the 5 new cases pass
- [ ] `wc -l server/_core/stripeWebhook.ts` should drop by ~30 LOC (removed redundant checks)

## Deliverable
- Modified: `drizzle/schema.ts`, `server/_core/stripeWebhook.ts`
- New: `drizzle/0076_stripe_webhook_idempotency.sql`, `drizzle/0076_stripe_webhook_idempotency.down.sql`, `server/_core/stripeWebhookIdempotency.ts`, `server/_core/stripeMocks.ts`, `server/_core/stripeWebhookIdempotency.test.ts`
- Single commit with message:
  ```
  feat(stripe-webhook): Phase 2 module 1 — central idempotency table + helper

  - New stripeWebhookEvents table (UNIQUE on eventId) replaces six
    per-handler if (existing) checks.
  - claimStripeEvent / markSucceeded / markFailed wrapped around the
    handleStripeWebhook dispatch switch.
  - Removes lines 180-188 (checkout), 486-489 (refund), 930-933 (trial)
    per-handler idempotency guards.
  - Adds stripeMocks.ts factories used by modules 2-5 sub-agents.
  - Vitest: 5 cases in stripeWebhookIdempotency.test.ts.

  Sequential gate: modules 2-5 unblocked.
  ```

## Rollback
- Code rollback: `git revert <commit-SHA>` restores the per-handler checks. Stripe will retry recent events; previous per-handler guards still work against payments table (idempotency is preserved by design — the per-handler checks were redundant, not load-bearing alone).
- Migration rollback: `mysql -e "$(cat drizzle/0076_stripe_webhook_idempotency.down.sql)"` against the target environment. **DO NOT run automatically** — Jeff approval required.
- Data preservation: dropping the table loses dedupe history but Stripe's at-least-once delivery + per-handler idempotency that still exists (payments table UNIQUE on stripePaymentIntentId, etc.) means no double-write risk during the rollback window.

## Manual intervention
- **Jeff:** review the migration SQL diff before it lands on staging.
- **Jeff:** approve the migration SQL before it lands on production.
- **Supervisor (not Jeff):** apply the migration on staging via the usual Drizzle migrate command; verify the table exists with `DESCRIBE stripeWebhookEvents;`.

## Test plan
- `pnpm test server/_core/stripeWebhookIdempotency.test.ts` — 5 new cases:
  1. **Fresh event claim** — insert succeeds, returns `{ alreadyProcessed: false, rowId: N }`.
  2. **Duplicate event claim** — second call on same event.id returns `{ alreadyProcessed: true, existingStatus: "processing" }`.
  3. **Mark succeeded then re-claim** — after `markStripeEventSucceeded`, re-claim returns `existingStatus: "succeeded"`.
  4. **Mark failed truncates error** — error message >1024 chars truncated cleanly; re-claim returns `existingStatus: "failed"`.
  5. **Concurrent claim race** — `Promise.all` on two simultaneous claims; exactly one returns `alreadyProcessed: false`.
- Plus: re-run `pnpm test` and confirm pre-existing pass count unchanged (regression anchor).
