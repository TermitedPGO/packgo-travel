# Phase 2 · Module 5 · Visa Payment Handler — Transaction + Tests

**Parent plan:** docs/refactor/plan.md (Phase 2 · Stripe Webhook Hardening)
**Audit ref:** P0-2
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 1.5 h AI + 0.5 h Jeff review

## Goal
Wrap the visa-payment handler (`handleVisaPaymentCompleted`) in `db.transaction(...)` so the multi-write sequence (visa payment info + visa application status + accounting entry) is atomic — then add rigorous Vitest (happy + failure + idempotent-retry per Q6).

## Pre-requisites
- **Module 1 (idempotency table) MUST land first** (sequential gate)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0)
- Phase 0 complete (clean working tree)
- Runs in parallel with modules 2, 3, 4 once module 1 lands

## Inputs (read these before executing)
- `server/_core/stripeWebhook.ts`:
  - **`handleVisaPaymentCompleted`** (lines 661–735). Invoked from `handleCheckoutSessionCompleted` line 156 when `session.metadata.visa_application_id` is set.
  - Multi-write sequence:
    - line 667: `db.getVisaApplicationById(...)` — READ
    - line 674: `db.updateVisaPaymentInfo(applicationId, {paymentStatus, stripePaymentIntentId, stripeCheckoutSessionId, paidAt})` — WRITE 1
    - line 682: `db.updateVisaApplicationStatus(applicationId, "paid", undefined, "Stripe 付款完成")` — WRITE 2
    - line 687: `db.createAccountingEntry({...})` — WRITE 3 (inside try/catch — but the try/catch swallowing should be REMOVED so transaction can roll back)
    - line 707: `sendVisaApplicationConfirmation(...)` — SIDE EFFECT (email, outside tx)
    - line 723: `notifyOwner(...)` — SIDE EFFECT (outside tx)
  - **DOES NOT** have a per-handler idempotency guard (the existing code at line 929 is for trial_will_end, not visa). Module 1's central idempotency handles dedupe. No removal needed here.
- `server/db.ts`:
  - `getVisaApplicationById` (search via `grep -n getVisaApplicationById server/db.ts`) — needs `tx?` parameter
  - `updateVisaPaymentInfo` (line 3015) — needs `tx?`
  - `updateVisaApplicationStatus` (line 2987) — needs `tx?`
  - `createAccountingEntry` (line 3245) — module 2 may already have extended this with `tx?`; coordinate via supervisor
- `server/services/visaEmailService.ts` — `sendVisaApplicationConfirmation` is mocked in tests.
- `server/_core/stripeMocks.ts` — module 1's factories; reuse `makeCheckoutSession({ metadata: { visa_application_id: "42" } })` for the visa branch.

## Procedure

1. **Read `handleVisaPaymentCompleted` end-to-end (lines 661–735)** and document inside-tx vs. post-commit split.

2. **Extend visa db helpers to accept optional `tx`:**
   - `db.getVisaApplicationById(id, tx?)`
   - `db.updateVisaPaymentInfo(id, info, tx?)`
   - `db.updateVisaApplicationStatus(id, status, ...args, tx?)` — be careful with the existing signature; the function already takes positional args (status, reviewerNote, internalNote). Add `tx?` as a trailing optional. Verify the existing signature first.
   - `db.createAccountingEntry(entry, tx?)` — module 2 likely already extended; reuse.

3. **Wrap the write block in `db.transaction`:**
   ```ts
   async function handleVisaPaymentCompleted(
     session: Stripe.Checkout.Session,
     applicationId: number
   ) {
     console.log(`[Stripe Webhook] Processing visa payment for application ${applicationId}`);

     // READ (outside tx is fine — we re-check inside if needed)
     const application = await db.getVisaApplicationById(applicationId);
     if (!application) {
       console.error(`[Stripe Webhook] Visa application ${applicationId} not found`);
       return;
     }

     const visaAmount = session.amount_total ? session.amount_total / 100 : 0;
     const currency = (session.currency ?? "usd").toUpperCase();

     await db.transaction(async (tx) => {
       // WRITE 1: payment info
       await db.updateVisaPaymentInfo(applicationId, {
         paymentStatus: "paid",
         stripePaymentIntentId: session.payment_intent as string,
         stripeCheckoutSessionId: session.id,
         paidAt: new Date(),
       }, tx);

       // WRITE 2: application status
       await db.updateVisaApplicationStatus(
         applicationId, "paid", undefined, "Stripe 付款完成", tx
       );

       // WRITE 3: accounting entry — was wrapped in try/catch that swallowed
       // errors. Remove the try/catch so an accounting failure rolls back
       // the visa status flip (otherwise the customer is "paid" with no
       // accounting record, breaking reconciliation).
       await db.createAccountingEntry({
         entryType: "income",
         category: "visa_service",
         amount: String(visaAmount),
         currency,
         description: `中國簽證代辦 #${applicationId}（${application.firstName} ${application.lastName}）`,
         visaApplicationId: applicationId,
         entryDate: new Date(),
         isTaxDeductible: 0,
         createdBy: 1,
       }, tx);
     });

     console.log(`[Stripe Webhook] Visa application ${applicationId} payment confirmed`);

     // POST-COMMIT: email + owner notification
     try {
       await sendVisaApplicationConfirmation({
         toEmail: application.email,
         applicantName: `${application.firstName} ${application.lastName}`,
         applicationId,
         totalAmount: Number(application.totalAmount),
         passportNumber: application.passportNumber,
         travelDate: application.travelDate ?? undefined,
       });
       console.log(`[Stripe Webhook] Visa confirmation email sent to ${redactEmail(application.email)}`);
     } catch (error) {
       console.error('[Stripe Webhook] Failed to send visa confirmation email:', error);
     }

     try {
       const usd = session.amount_total ? (session.amount_total / 100).toFixed(2) : "?";
       await notifyOwner({
         title: `中國簽證付款 $${usd} — Application #${applicationId}`,
         content:
           `申請人: ${application.firstName} ${application.lastName}\n` +
           `護照: ${application.passportNumber}\n` +
           `Email: ${application.email}\n` +
           `金額: $${usd}\n` +
           `Travel date: ${application.travelDate ?? "未填"}`,
       });
     } catch (err) {
       console.error("[Stripe Webhook] notifyOwner (visa) failed:", err);
     }
   }
   ```

4. **Behavioral change to document:** the original code SWALLOWED accounting errors (lines 699–701) — visa would flip to "paid" but accounting silently failed. Under the new design, accounting failure rolls back the visa status; Stripe retries the webhook, and on retry either (a) the transient accounting error is gone and everything succeeds, or (b) it persists and `markStripeEventFailed` records it for Jeff to investigate. This is **strictly better** for reconciliation but technically a behavior change — note it in the handler comment block.

5. **Create test file `server/_core/stripeWebhook.visa.test.ts`** (≤350 LOC). Use the established fixture style. Mock `sendVisaApplicationConfirmation`, `notifyOwner`, `db.getVisaApplicationById`, etc.

6. **Write 4 Vitest cases:**

   **Case 1 — visa payment happy path:**
   - Given: visa application exists in `pending` status; session has `visa_application_id: "42"` and `amount_total: 18000` (USD $180).
   - When: `handleStripeWebhook` invoked with `checkout.session.completed` event.
   - Then: `updateVisaPaymentInfo` called with `paymentStatus="paid"` + intent/session IDs + paidAt; `updateVisaApplicationStatus` called with `"paid"` + reviewerNote; `createAccountingEntry` called with `category="visa_service"` and `amount="180"`; `sendVisaApplicationConfirmation` called with correct applicant info; `notifyOwner` called.

   **Case 2 — visa payment with missing application — early return:**
   - Given: `getVisaApplicationById(applicationId)` returns null.
   - Then: no writes performed; handler logs and returns without crashing.

   **Case 3 — visa payment mid-tx DB failure rolls back:**
   - Given: `createAccountingEntry` throws inside the tx.
   - Then: visa payment info NOT updated, visa application status NOT flipped to "paid", `sendVisaApplicationConfirmation` NOT called (post-commit skipped), idempotency row marked `failed`. **This is the new safety — under the old code visa would be "paid" with no accounting row.**

   **Case 4 — visa payment idempotent retry:**
   - Given: same event delivered twice.
   - Then: first call performs all writes + sends email; second call short-circuits at `claimStripeEvent`. No double accounting entry, no double email.

## Acceptance Criteria
- [ ] `handleVisaPaymentCompleted` wraps `updateVisaPaymentInfo` + `updateVisaApplicationStatus` + `createAccountingEntry` in a SINGLE `db.transaction`
- [ ] The accounting `try/catch` swallow REMOVED (failure now rolls back, by design)
- [ ] `getVisaApplicationById`, `updateVisaPaymentInfo`, `updateVisaApplicationStatus`, `createAccountingEntry` accept optional `tx`
- [ ] Post-commit side effects: `sendVisaApplicationConfirmation`, `notifyOwner` keep their existing `try/catch` (don't block on email failure)
- [ ] Handler comment block documents the behavior change (accounting failures now roll back)
- [ ] `server/_core/stripeWebhook.visa.test.ts` has 4 named cases, all pass
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor count unchanged

## Deliverable
- Modified: `server/_core/stripeWebhook.ts`, `server/db.ts` (only visa-helper signatures if not already extended)
- New: `server/_core/stripeWebhook.visa.test.ts`
- Single commit:
  ```
  feat(stripe-webhook): Phase 2 module 5 — visa handler in db.transaction

  - handleVisaPaymentCompleted now wraps updateVisaPaymentInfo +
    updateVisaApplicationStatus + createAccountingEntry in a single
    db.transaction.
  - Behavior change documented: accounting failures NOW roll back the
    visa status flip (was silently swallowed). Strictly better for
    reconciliation; Stripe retry recovers transient failures, persistent
    failures land in stripeWebhookEvents with status=failed for Jeff.
  - Helper signatures extended with optional tx.
  - Vitest: 4 cases covering happy / missing-application / mid-tx-rollback /
    idempotent-retry.
  ```

## Rollback
- `git revert <commit-SHA>` restores pre-transaction behavior, including the accounting-error swallow.
- The deliberate behavior change (accounting failure rolls back) is the only post-revert difference. After revert, if accounting fails the visa would again flip to "paid" with no accounting row — Jeff would have to manually reconcile.

## Manual intervention
- None routine.
- If a test reveals that `updateVisaApplicationStatus` has a non-trivial side effect (e.g., writes to `visaStatusHistory` separately), confirm whether that auxiliary write should also be inside the tx. Default: yes, include it. Escalate to supervisor only if its semantics make tx inclusion impossible.

## Test plan
- `pnpm test server/_core/stripeWebhook.visa.test.ts` — 4 cases:
  1. **Visa happy path** — payment info + application status + accounting all written; email + notify fired
  2. **Missing application** — early return, no writes
  3. **Mid-tx DB rollback** — accounting throw rolls back visa status + payment info; email NOT sent
  4. **Idempotent retry** — second delivery short-circuits; no double writes; no double email
- Mock `getVisaApplicationById`, `sendVisaApplicationConfirmation`, `notifyOwner`, all visa-write helpers. Assert call counts.
- Full suite `pnpm test` regression-anchor count unchanged.
