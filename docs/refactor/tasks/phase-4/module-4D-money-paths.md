# Phase 4D · Money Paths (Sub-PR 4 of 5) — **SOLO REVIEW**

> **Manual intervention: Jeff solo PR review** (per plan.md Q2 decision). AI does NOT auto-merge. Jeff personally reviews every diff, approves staging deploy, watches Stripe dashboard 1 hour post-deploy.

**Parent plan:** docs/refactor/plan.md (Phase 4 · routers.ts Split)
**Audit ref:** P0-1, P0-2
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 3-4 h AI + 1 h Jeff review
**Risk tier:** HIGHEST — real money movement. Refunds, voucher consume, packpoint redeem, accounting writes.
**Deploy window:** Tue/Wed/Thu morning ONLY, with Jeff available for 1-hour post-deploy watch on Stripe dashboard.

## Goal
Extract the remaining money-path domains from `server/routers.ts`: `bookings` payment slice (4 procedures left over from 4C), `vouchers`, `packpoint`, `accounting`. Each becomes its own `server/routers/<domain>.ts` with **rigorous Vitest coverage (happy + failure + idempotent-retry per CLAUDE.md §七 and plan.md Q6)**. Phase 2's transactional + idempotent Stripe webhook is the foundation — this PR's routers call into the same transaction helpers.

## Pre-requisites
- **CRITICAL:** Phase 2 (Stripe webhook hardening) FULLY MERGED AND DEPLOYED TO PRODUCTION for ≥48 hours with no incidents. The central `stripeWebhookEvents` idempotency table and `db.transaction(...)` wrapping must be live. The 4D money-router code calls into those primitives; if Phase 2 isn't stable yet, 4D MUST be postponed.
- Phases 0/1/3 complete
- Modules 4A, 4B, 4C all merged and stable for ≥24 hours
- Module 4F NOT YET STARTED — Module 4F finalizes composition after 4D and 4E both land
- This module lands as one squash-merge commit on a feature branch named `refactor/phase-4d-money-paths`
- **Jeff personally reviews this PR. AI does NOT auto-merge.**

## Inputs (read these before executing)

- `server/routers.ts` per-domain ranges (post-4C state — line numbers will have shifted; values below are pre-shift baselines from the original 10,122 LOC file):
  - **`bookings` payment slice** (4 procedures left after 4C): originally L4412-4569 + L4570-4622 + L4630-4710 + L4711-4850 = ~432 LOC. **Post-4C, these procedures live in routers.ts at shifted line numbers; sub-agent must re-locate them by procedure-name grep, NOT by absolute line number.**
  - **`vouchers`**: L917-1088 (172 LOC) — pre-4A baseline
  - **`packpoint`**: L675-916 (242 LOC)
  - **`accounting`**: L8339-8484 (146 LOC)

- `bookings` payment-procedure detail (from 4C inventory):

| Procedure | LOC | Access | Money operation |
|---|---|---|---|
| `bookings.createCheckoutSession` | 158 | protected | Creates Stripe Checkout Session, initiates charge flow |
| `bookings.cancel` | 53 | protected | May trigger refund if booking already paid |
| `bookings.adminUpdateStatus` | 81 | admin | Status flip can trigger payout/refund |
| `bookings.adminRefund` | 140 | admin | Direct refund issue via Stripe API |

- **Phase 2 Stripe artifacts** that 4D relies on:
  - `server/_core/stripeWebhookIdempotency.ts` — `claimStripeEvent`, `markStripeEventSucceeded`, `markStripeEventFailed`
  - `drizzle/schema.ts` — `stripeWebhookEvents` table
  - `server/_core/stripeMocks.ts` — `makeStripeEvent`, `makeCheckoutSession`, etc. (4D test files import these)
  - `db.transaction(...)` patterns established in Phase 2 modules 2-5

- **Open Question Q5** from plan.md: Does `accounting` domain depend on internal helpers still in routers.ts? Resolved at 4D start by dependency analysis. **Sub-agent D (accounting) MUST grep for helper calls inside L8339-8484 against the rest of routers.ts; if found, escalate.**

## Domain Inventory (this PR only)

| Domain | Current LOC in routers.ts (post-4C) | Source proc names | Target file | Target LOC after split |
|---|---|---|---|---|
| bookings (payment slice) | ~432 | createCheckoutSession, cancel, adminUpdateStatus, adminRefund | `server/routers/bookingsPayment.ts` | ≤450 (documented exception) |
| vouchers | 172 | (full domain) | `server/routers/vouchers.ts` | ≤200 |
| packpoint | 242 | (full domain) | `server/routers/packpoint.ts` | ≤280 |
| accounting | 146 | (full domain) | `server/routers/accounting.ts` | ≤180 |

**Final bookings composition (after 4F runs):**

```ts
// Module 4F will rewrite this — for 4D's purposes, hybrid spread continues:
bookings: router({
  ...bookingsNonPaymentRouter._def.procedures,
  ...bookingsPaymentRouter._def.procedures,
}),
```

Client continues to call `trpc.bookings.createCheckoutSession`, `trpc.bookings.adminRefund`, etc. — zero path change.

**bookingsPayment.ts size exception:** ~432 LOC for 4 procedures (one of which is `adminRefund` at 140 LOC and `createCheckoutSession` at 158 LOC — both money-handling, single coherent flows). Splitting further would fragment refund logic. **Document the exception in the file header; v2 backlog gets an entry for refund-flow extraction.**

## Sub-Agent Strategy

**Sub-agent count for this PR: 4 (parallel) + 1 supervisor pass.**

- **Sub-agent A — bookingsPayment**: locate 4 procedures by name-grep in current routers.ts (post-4C) → `server/routers/bookingsPayment.ts` + `.test.ts`. ~432 LOC. **Test depth: happy + failure + idempotent-retry per procedure (12-16 test cases total).**
- **Sub-agent B — vouchers**: extract domain → `server/routers/vouchers.ts` + `.test.ts`. **Test depth: voucher consume happy + double-consume rejection + race idempotency.**
- **Sub-agent C — packpoint**: extract domain → `server/routers/packpoint.ts` + `.test.ts`. **Test depth: redeem happy + insufficient-balance reject + idempotent retry on Stripe webhook replay.**
- **Sub-agent D — accounting**: extract domain → `server/routers/accounting.ts` + `.test.ts`. **Test depth: ledger write happy + concurrent-write transaction safety.**

**Supervisor coordination (Jeff approves each gate):**

1. **Pre-flight (sub-agent D specifically):** Run dependency-helper grep before extraction (resolves Open Question Q5):
   ```bash
   sed -n '<accounting-range-post-4C>p' server/routers.ts | grep -E "^\s*(const|function|async function) " > /tmp/4d-accounting-helpers.txt
   # If helpers found, sub-agent escalates → supervisor extracts to server/_core/accountingHelpers.ts first
   ```
2. Sub-agents A-D run in parallel, each producing a diff + a test file.
3. Supervisor stitches into single squash-merge commit.
4. **`pnpm tsc --noEmit` + `pnpm test` MUST be green; full money-path tests (estimated 25-30 new cases) MUST all pass.**
5. **Jeff personally reads every diff.**

**Sub-agent constraints:**
- Sub-agents do NOT modify `server/_core/stripeWebhook.ts` (Phase 2 owned).
- Sub-agents do NOT modify `server/db.ts` (out of scope per plan.md).
- Sub-agents MUST use `db.transaction(...)` wrappers established in Phase 2 wherever the procedure does ≥2 writes (e.g., `adminRefund` writes both a `payments` row update AND a `bookings` status flip; must be inside one transaction). If the original routers.ts code doesn't wrap, the sub-agent's extraction MUST add the wrapping. Document each transaction-add in commit body.
- Sub-agents import factory helpers from `server/_core/stripeMocks.ts` (Phase 2 artifact) for their tests.
- Sub-agents import `claimStripeEvent` if the procedure receives webhook-style retry (rare; only `createCheckoutSession` if it deduplicates session reuse).

## Client tRPC Call Audit

Verified by `grep -rohE "trpc\.(bookings|vouchers|packpoint|accounting)\.[a-zA-Z]+" client/src/`.

**bookings (4D SCOPE — payment paths):**
- `trpc.bookings.createCheckoutSession` — `client/src/pages/BookTour.tsx` (called when user clicks "Proceed to Payment")
- `trpc.bookings.cancel` — `client/src/pages/Account/Bookings.tsx`, customer-initiated cancel
- `trpc.bookings.adminUpdateStatus` — admin bookings tab (status dropdown)
- `trpc.bookings.adminRefund` — admin bookings tab (refund button)

**bookings (4C SCOPE — already extracted, do not touch):**
- `trpc.bookings.create`, `trpc.bookings.list`, `trpc.bookings.listParticipants`, `trpc.bookings.saveParticipants`, `trpc.bookings.getById`, `trpc.bookings.adminList`

**vouchers:**
- `trpc.vouchers.list`, `trpc.vouchers.validate`, `trpc.vouchers.redeem` — checkout flow
- `trpc.vouchers.adminCreate`, `trpc.vouchers.adminList`, `trpc.vouchers.adminVoid` — admin

**packpoint:**
- `trpc.packpoint.getStatus`, `trpc.packpoint.getHistory`, `trpc.packpoint.estimateRedemption` — customer dashboard
- `trpc.packpoint.redeem` — checkout flow

**accounting:**
- `trpc.accounting.<reports>`, `trpc.accounting.<ledger>` — admin reports tab

**ZERO-BREAK CONSTRAINT:** All above paths resolve identically post-merge. Sub-agents exhaustively grep before declaring done.

## Procedure

1. **Supervisor + Jeff (gate 1): confirm Phase 2 has been live in production for ≥48 hours with zero Stripe webhook anomalies.** If not, postpone 4D. Check Stripe dashboard for the period; verify the `stripeWebhookEvents` table has been receiving traffic and `status = "succeeded"` rate is ≥99%.

2. **Supervisor (pre-fan-out): re-locate procedures in post-4C routers.ts.** Compute current line ranges for the 4 bookings payment procedures + the 3 other domains. Document the actual line ranges in a `/tmp/4d-line-map.txt` cache (sub-agents read this).

3. **Supervisor dispatches sub-agents A-D in parallel.** Each receives:
   - The current line range for its domain (post-4C-adjusted)
   - The list of procedures it owns
   - Phase 2 artifact imports it can use
   - Test depth requirement: **happy + failure + idempotent-retry** per money procedure (Q6 rule)

4. **Per-sub-agent extraction recipe — bookingsPayment example:**
   ```ts
   // server/routers/bookingsPayment.ts
   // PHASE 4D — MONEY PATH. Test coverage: happy + failure + idempotent-retry
   // per CLAUDE.md §七 and refactor plan Q6.
   // Size exception: 432 LOC for 4 procedures (createCheckoutSession 158,
   // cancel 53, adminUpdateStatus 81, adminRefund 140). Splitting would
   // fragment refund flow. v2 backlog: refund-flow further extraction.
   import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
   import { TRPCError } from "@trpc/server";
   import { z } from "zod";
   import { shortStr, mediumStr } from "../_core/inputSchemas";
   import * as db from "../db";
   import Stripe from "stripe";
   import { ENV } from "../_core/env";

   let _stripeClient: Stripe | null = null;
   function getStripeClient(): Stripe { /* same lazy pattern as routers.ts L60 */ }

   export const bookingsPaymentRouter = router({
     createCheckoutSession: protectedProcedure...,
     cancel: protectedProcedure...,
     adminUpdateStatus: adminProcedure...,
     adminRefund: adminProcedure...,
   });
   ```

5. **Per-sub-agent transaction-wrapping audit:** for each procedure, sub-agent inspects the body. Any sequence of ≥2 `db.update`/`db.insert`/`db.delete` calls MUST be wrapped in `db.transaction(async (tx) => { ... })`. The current routers.ts code may not wrap; this PR fixes that.

6. **Per-sub-agent Vitest recipe — bookingsPayment example:**
   ```ts
   // server/routers/bookingsPayment.test.ts
   import { describe, it, expect, vi, beforeEach } from "vitest";
   import { bookingsPaymentRouter } from "./bookingsPayment";
   import * as db from "../db";
   import { makeCheckoutSession, makeStripeEvent } from "../_core/stripeMocks";

   describe("bookingsPayment.adminRefund", () => {
     beforeEach(() => vi.restoreAllMocks());

     it("happy: refunds successfully, marks booking refunded, claws back packpoint", async () => { /* ... */ });
     it("failure: Stripe API returns error → transaction rolls back, no DB changes", async () => { /* ... */ });
     it("idempotent: replaying same refund call is a no-op", async () => { /* ... */ });
   });

   describe("bookingsPayment.createCheckoutSession", () => {
     it("happy: creates Stripe session, returns sessionId + url", async () => { /* ... */ });
     it("failure: Stripe error → no DB row inserted, error surfaces to client", async () => { /* ... */ });
     it("idempotent: same booking id calls twice → second returns the existing session", async () => { /* ... */ });
   });

   describe("bookingsPayment.cancel", () => {
     it("happy: pending booking cancels without refund", async () => { /* ... */ });
     it("happy: paid booking cancels and triggers refund flow", async () => { /* ... */ });
     it("failure: already-cancelled booking → BAD_REQUEST", async () => { /* ... */ });
     it("idempotent: cancelling twice → second call no-op", async () => { /* ... */ });
   });

   describe("bookingsPayment.adminUpdateStatus", () => {
     it("happy: status flip records audit row", async () => { /* ... */ });
     it("failure: invalid status transition → BAD_REQUEST", async () => { /* ... */ });
     it("idempotent: setting same status → no-op", async () => { /* ... */ });
   });
   ```
   **Sub-agent B (vouchers) tests:** consume happy + already-consumed reject + expired reject + race-on-redeem.
   **Sub-agent C (packpoint) tests:** redeem happy + insufficient-balance reject + webhook-replay idempotent.
   **Sub-agent D (accounting) tests:** ledger write happy + transaction-rollback under failure + concurrent-write safety.

7. **Supervisor (post-fan-out): stitch into one commit, run full test suite, push to feature branch, open PR, mark for Jeff solo review.**

8. **JEFF SOLO REVIEW gate:**
   - Read every diff line in `bookingsPayment.ts`, `vouchers.ts`, `packpoint.ts`, `accounting.ts`
   - Verify every multi-write sequence is inside `db.transaction(...)`
   - Verify every money-path test exists (happy + failure + idempotent per procedure)
   - Run `pnpm test` locally; visually inspect output
   - Approve PR for staging deploy
   - Run end-to-end staging smoke (step 9)
   - Approve production deploy ONLY after staging smoke passes

9. **Staging smoke (Jeff personally executes):**
   - Full booking flow: browse → book → pay (Stripe test card) → confirm → packpoint awarded → email received
   - Refund flow: admin processes refund on a paid booking → customer receives email → packpoint clawback verified
   - Voucher flow: create voucher → consume at checkout → verify discount applied → verify status = "consumed"
   - Webhook replay (uses Phase 2 idempotency): trigger same `charge.succeeded` event twice via `stripe trigger`; verify second is no-op
   - Cancel flow: customer cancels pre-payment booking → status = "cancelled", no Stripe call
   - Cancel flow: customer cancels post-payment booking → refund triggered → packpoint clawback

10. **Production deploy (Tue/Wed/Thu morning ONLY):**
    - 9-11am PT window
    - Jeff watches Stripe dashboard for 1 hour post-deploy (longer than other phases)
    - Watch for: failed webhook deliveries, refund rejections, voucher-consume race errors, packpoint balance discrepancies
    - If ANY anomaly in the 1-hour window → `git revert <merge-SHA>` + redeploy prior version

## Acceptance Criteria
- [ ] `server/routers/bookingsPayment.ts` exists; size exception documented in header; transactions audit complete (every multi-write inside `db.transaction`)
- [ ] `server/routers/vouchers.ts` ≤200 LOC
- [ ] `server/routers/packpoint.ts` ≤280 LOC
- [ ] `server/routers/accounting.ts` ≤180 LOC
- [ ] Four `*.test.ts` files exist; **each money procedure has happy + failure + idempotent-retry test cases** (Q6 compliance — estimated 25-30 new cases total)
- [ ] All new tests pass; `pnpm test` regression-anchor pass count UNCHANGED + new cases pass
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm build` succeeds
- [ ] `server/routers.ts` shrinks by ~990 LOC (172 vouchers + 242 packpoint + 432 bookings-payment + 146 accounting; running total ≤5,400)
- [ ] All client `trpc.{bookings.<pay>,vouchers,packpoint,accounting}.*` paths resolve
- [ ] Jeff personally reviewed every diff
- [ ] Staging smoke checklist (step 9) all-pass
- [ ] Production deploy gate: Jeff present for 1-hour watch; zero anomalies recorded

## Deliverable
- Modified: `server/routers.ts` (~990 LOC removed; 4 imports added; domain blocks rewritten)
- New:
  - `server/routers/bookingsPayment.ts` + `.test.ts`
  - `server/routers/vouchers.ts` + `.test.ts`
  - `server/routers/packpoint.ts` + `.test.ts`
  - `server/routers/accounting.ts` + `.test.ts`
  - Conditionally: `server/_core/accountingHelpers.ts` (if Q5 dependency analysis found shared helpers)
- Single squash-merge commit on `refactor/phase-4d-money-paths` branch:
  ```
  refactor(routers): Phase 4D — money paths (SOLO REVIEW)

  Extracts bookings payment slice + vouchers + packpoint + accounting from
  routers.ts. Money-path rigor per CLAUDE.md §七 and plan.md Q6:
  - Every multi-write sequence inside db.transaction(...)
  - Happy + failure + idempotent-retry tests per money procedure (~28 cases)
  - Builds on Phase 2 stripeWebhookEvents idempotency table

  - server/routers/bookingsPayment.ts (~432 LOC, exception documented)
  - server/routers/vouchers.ts (172 LOC)
  - server/routers/packpoint.ts (242 LOC)
  - server/routers/accounting.ts (146 LOC)

  Audit P0-1 + P0-2. SOLO REVIEW per plan Q2. Jeff personally reviewed every
  diff; staging smoke all-pass; production deployed Tue/Wed/Thu morning with
  1-hour Stripe dashboard watch. routers.ts shrinks ~990 LOC.
  ```

## Rollback
- **Pre-deploy:** if staging smoke fails any step, abandon the branch; rerun the failing sub-agent.
- **Production rollback:** `git revert <merge-SHA>` + immediate redeploy. The Phase 2 idempotency table + per-handler webhook guards are intact during the revert gap, so no double-charge / double-refund risk. Stripe will retry any in-flight webhooks; the pre-4D code handles them.
- **Database state:** No 4D-specific migrations. All Phase 2 artifacts remain.
- **If sub-agent D extracted `server/_core/accountingHelpers.ts`:** that file becomes orphan on revert (no callers). Either revert the prep commit too OR leave the orphan (no harm; next cleanup removes it).

## Manual intervention
- **Jeff (gate 1):** Confirm Phase 2 has been stable in production for ≥48 hours BEFORE 4D starts.
- **Jeff (gate 8):** Solo review every diff line.
- **Jeff (gate 9):** Personally execute the staging smoke checklist.
- **Jeff (gate 10):** Present during production deploy + 1-hour post-deploy Stripe dashboard watch.
- **Supervisor:** does NOT auto-merge. Opens PR; pauses until Jeff approves.

## Test plan

**Test coverage requirement (Q6 — money path 100%):**

| Procedure | Happy | Failure | Idempotent | Total |
|---|---|---|---|---|
| `bookings.createCheckoutSession` | ✓ | ✓ | ✓ | 3 |
| `bookings.cancel` | ✓ pending + ✓ paid | ✓ already-cancelled | ✓ duplicate cancel | 4 |
| `bookings.adminUpdateStatus` | ✓ | ✓ invalid transition | ✓ same-status no-op | 3 |
| `bookings.adminRefund` | ✓ | ✓ Stripe API error rollback | ✓ duplicate refund | 3 |
| `vouchers.redeem` | ✓ | ✓ expired + ✓ already-consumed | ✓ race | 4 |
| `vouchers.validate` | ✓ | ✓ invalid code | — | 2 |
| `packpoint.redeem` | ✓ | ✓ insufficient balance | ✓ webhook replay | 3 |
| `packpoint.<query procs>` | ✓ each | — | — | ~3 |
| `accounting.<write procs>` | ✓ | ✓ rollback under failure | ✓ concurrent | per-proc 3 |

**Estimated total new test cases: 25-30.** Each must use Phase 2's `stripeMocks.ts` factories where applicable.

After all new tests pass, full `pnpm test` + `pnpm tsc --noEmit` + `pnpm build` MUST be green before opening the PR.

**Post-deploy verification (Jeff, 1 hour):**
- Stripe dashboard: zero failed deliveries, zero unhandled events
- Sentry / admin error log: zero exceptions from money procedures
- Customer support inbox: zero tickets about failed bookings / refund issues
- One real test booking end-to-end with a real Stripe test card on production (Jeff's own account)

If any signal triggers, immediate revert.
