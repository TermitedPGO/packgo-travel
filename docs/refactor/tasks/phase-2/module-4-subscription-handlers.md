# Phase 2 · Module 4 · Subscription Handlers — Transactions + Tests

**Parent plan:** docs/refactor/plan.md (Phase 2 · Stripe Webhook Hardening)
**Audit ref:** P0-2
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2 h AI + 0.5 h Jeff review

## Goal
Wrap the three subscription-lifecycle handlers (`handleSubscriptionUpserted`, `handleTrialWillEnd`, `handleSubscriptionDeleted`) in `db.transaction(...)` so the user-tier flip + membershipTrials write + (for `trial_will_end`) reminderSentAt flag are atomic — then add rigorous Vitest (happy + failure + idempotent-retry, with AB 390 trial-start / trial→active / trial-will-end as separate paths).

## Pre-requisites
- **Module 1 (idempotency table) MUST land first** (sequential gate)
- Phase 1 complete (`pnpm tsc --noEmit` exit 0)
- Phase 0 complete (clean working tree)
- Runs in parallel with modules 2, 3, 5 once module 1 lands

## Inputs (read these before executing)
- `server/_core/stripeWebhook.ts`:
  - **`handleSubscriptionUpserted`** (lines 755–897). Dispatched from `customer.subscription.created` / `customer.subscription.updated` (lines 88–93) AND fallback from `checkout.session.completed` (line 141 when `session.mode === "subscription"`).
    - Multi-write paths (3 branches):
      - **Branch A — active subscription (lines 803–815):** `users.update(tier, tierExpiresAt, stripeSubscriptionId, stripeCustomerId)`
      - **Branch A-sub — trial start (lines 838–852):** `INSERT membershipTrials` + `UPDATE users.{plus|concierge}TrialUsedAt`
      - **Branch A-sub — trial → active conversion (lines 856–876):** `UPDATE membershipTrials.converted=true`
      - **Branch B — non-active subscription (lines 884–892):** `users.update(tier='free', tierExpiresAt=null, stripeSubscriptionId, stripeCustomerId)`
    - **Key complexity:** the trial-start INSERT + the `users.{tier}TrialUsedAt` UPDATE must be atomic — otherwise a crash between them leaves an orphan trial row with no flag on the user (would let the user re-trial the same tier).
  - **`handleTrialWillEnd`** (lines 910–1004). Sequence:
    - lines 917–921: READ `membershipTrials` by `stripeSubscriptionId`
    - lines 930–933: idempotency check on `reminderSentAt` — REMOVE (module 1 handles centrally)
    - lines 936–945: READ user
    - line 958: `sendTrialEndingReminder(...)` — SIDE EFFECT (email, outside tx)
    - lines 969–972: `UPDATE membershipTrials.reminderSentAt = now()` — WRITE
    - lines 978–982 + 986–998: notifyOwner + notifyAgentMessage — SIDE EFFECTS (outside tx)
    - **Subtle:** the current code sends email BEFORE flipping `reminderSentAt`, which means a successful email send followed by a DB failure causes the email to be re-sent on Stripe retry. The fix is to either (a) keep current order and rely on Stripe retry being idempotent at the SMTP layer (unsafe — SES/Gmail will happily send 2 emails) or (b) flip `reminderSentAt` first INSIDE the tx, then send email AFTER commit. **Recommended:** option (b) — set `reminderSentAt` in the tx; if email fails post-commit, log + alert Jeff but do NOT re-throw (otherwise Stripe replays and we double-send because the central idempotency lets through a `failed` event with no flag distinction). AB 390 compliance is the law: better to flip the DB flag and on email failure manually re-send than to risk double-sending.
    - **DECISION POINT FOR SUPERVISOR:** before sub-agent dispatch, supervisor must decide email-vs-flag ordering. Default: option (b) flag-first. Document the decision in a comment block in the handler.
  - **`handleSubscriptionDeleted`** (lines 1006–1018). Single write: `UPDATE users SET tier='free', tierExpiresAt=null, stripeSubscriptionId=null WHERE stripeSubscriptionId = sub.id`. Wrap in tx for symmetry.
- `drizzle/schema.ts` lines 2488–2508: `membershipTrials` table shape.
- `server/db.ts`: there is NO domain helper for membership writes — `handleSubscriptionUpserted` uses raw `drizzle.update(users)...` calls directly (line 804, 884). The simplest fix is to pass `tx` directly to the existing drizzle calls (replace `db.update(users)` with `tx.update(users)`). DO NOT introduce new `db.ts` helpers for this.
- `server/email.ts` — `sendTrialEndingReminder` is the AB 390 email function (line 958 of stripeWebhook.ts). Mock in tests.

## Procedure

1. **Read all three handler functions end-to-end** (755–897, 910–1004, 1006–1018). Document inside-tx vs. post-commit split in a comment block at the top of each function.

2. **Wrap `handleSubscriptionUpserted` (lines 755–897)** in `db.transaction`:
   - Move all `db.update(users)…` and `db.insert(membershipTrials)…` and `db.update(membershipTrials)…` INSIDE one tx.
   - The pre-lookup (`db.select … from(users).where(stripeCustomerId)`) at line 767–773 — keep INSIDE the tx so reads see the same snapshot as writes.
   - The `tierFlag` read (lines 833–836) — INSIDE the tx (read-then-write same user row).
   - Branch B (non-active subscription, lines 884–892) — INSIDE the tx (single write but symmetric).
   - **Trial-start sub-block (lines 838–852):** the INSERT + the `users.{flag}TrialUsedAt` UPDATE must be in the same tx (this is the atomicity that was missing).
   - **Trial → active sub-block (lines 856–876):** the SELECT pendingTrial + UPDATE converted both inside.
   - Skeleton:
     ```ts
     await db.transaction(async (tx) => {
       // user lookup
       // priceId / tier resolution (pure compute, no DB)
       if (isActive) {
         await tx.update(users).set({...}).where(eq(users.id, userId));
         if (tier !== "free") {
           // trial start
           if (isTrialing && trialEnd) { … tx.insert + tx.update(users) … }
           // trial → active
           if (sub.status === "active") { … tx.select + tx.update(membershipTrials) … }
         }
       } else {
         await tx.update(users).set({tier: "free", …}).where(eq(users.id, userId));
       }
     });
     ```
   - Existing try/catch on the trial-table block (lines 878–881) — REMOVE (let the tx surface the error so the whole subscription update rolls back; partial trial writes are exactly the bug we're fixing).

3. **Wrap `handleTrialWillEnd` (lines 910–1004)** with flag-first ordering (per the supervisor decision above):
   ```ts
   await db.transaction(async (tx) => {
     // READS inside tx for snapshot consistency
     const trialRows = await tx.select().from(membershipTrials)
       .where(eq(membershipTrials.stripeSubscriptionId, sub.id)).limit(1);
     // ... no row, log + early return INSIDE tx with break-by-return ...
     // WRITE: mark reminderSentAt now (before sending email) — central
     // idempotency already prevents re-entry, this is belt-and-suspenders
     // against double email if our central row gets evicted somehow.
     await tx.update(membershipTrials)
       .set({ reminderSentAt: new Date() })
       .where(eq(membershipTrials.id, trial.id));
   });
   // POST-COMMIT: send email + notify
   await sendTrialEndingReminder({...});
   await notifyOwner({...}).catch(() => {});
   await notifyAgentMessage({...});
   ```
   - **Remove** the existing `reminderSentAt` short-circuit at lines 930–933 (module 1's central dedupe replaces it).
   - **Keep** the `throw err` at line 1002 (Stripe retries the webhook if AB 390 email fails) — but the post-commit email failure now means the DB flag was already set, so the retry will short-circuit at `claimStripeEvent`. **THIS IS A BEHAVIOR CHANGE** — under the new design, an email failure followed by Stripe retry will short-circuit. To stay AB-390-compliant, the email failure path must trigger a Jeff alert (`notifyOwner` priority=urgent + a queued retry via existing email retry infrastructure if any). Document this trade-off explicitly in the handler comment block.
   - **Alternative considered + rejected:** keep email-first ordering, but rely on email-system idempotency. Rejected because Gmail SMTP has no native idempotency.

4. **Wrap `handleSubscriptionDeleted` (lines 1006–1018)** in `db.transaction` (single write but symmetric for the test fixture):
   ```ts
   async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
     await db.transaction(async (tx) => {
       await tx.update(users)
         .set({ tier: "free", tierExpiresAt: null, stripeSubscriptionId: null })
         .where(eq(users.stripeSubscriptionId, sub.id));
     });
   }
   ```

5. **Create test file `server/_core/stripeWebhook.subscriptions.test.ts`** (≤450 LOC). Use the established fixture style. Mock `email` (specifically `sendTrialEndingReminder`), `notification`, `agentNotify`, `membershipPricing.tierFromPriceId`.

6. **Write 7 Vitest cases:**

   **Case 1 — customer.subscription.created (paid, no trial) happy path:**
   - Given: user exists, priceId maps to "plus" tier, subscription status=active, no trial_end.
   - Then: `users.tier=plus`, `tierExpiresAt` set from `current_period_end`, `stripeSubscriptionId` + `stripeCustomerId` populated. NO `membershipTrials` row inserted.

   **Case 2 — customer.subscription.created (trial start) happy path:**
   - Given: user has never trialed "plus" before (`plusTrialUsedAt` is null), subscription status=trialing, trial_end populated.
   - Then: `users.tier=plus`, `users.plusTrialUsedAt` set to now, `membershipTrials` row inserted with `converted=false`. All writes in one tx — assert atomicity by checking that if any one fails, none persist (use case 4).

   **Case 3 — customer.subscription.updated (trial → active conversion):**
   - Given: existing `membershipTrials` row with `converted=false`, subscription status flips from trialing to active.
   - Then: `users.tier=plus`, `membershipTrials.converted=true`, `convertedAt` set.

   **Case 4 — customer.subscription.* mid-tx DB failure rolls back:**
   - Given: trial-start path, but the second write (the `users.plusTrialUsedAt` flag update) throws.
   - Then: `membershipTrials` row NOT present (rolled back), `users.tier` unchanged, `users.plusTrialUsedAt` still null, idempotency row marked `failed`. Stripe will retry — and the retry will land cleanly.

   **Case 5 — customer.subscription.deleted happy path:**
   - Given: user has `tier=plus`, `stripeSubscriptionId=sub_xxx`.
   - When: `customer.subscription.deleted` event for `sub_xxx`.
   - Then: `users.tier=free`, `tierExpiresAt=null`, `stripeSubscriptionId=null`.

   **Case 6 — customer.subscription.trial_will_end (AB 390 reminder) happy path:**
   - Given: `membershipTrials` row exists with `reminderSentAt=null`.
   - When: `customer.subscription.trial_will_end` event.
   - Then: `membershipTrials.reminderSentAt` set, `sendTrialEndingReminder` called with the right args (user email, formatted amount, cancelUrl), `notifyOwner` + `notifyAgentMessage` called. Tx committed BEFORE email send.

   **Case 7 — customer.subscription.* idempotent retry:**
   - Given: any of the above events delivered twice.
   - Then: second delivery short-circuits at `claimStripeEvent`. For trial_will_end specifically: the flag was already set in the first call, so even if central idempotency somehow failed, the new flag-first ordering means the second call would still only fire one email (because the email send is post-commit on the SECOND call's tx, which short-circuits before reaching the email).

7. **Document the email-vs-flag ordering trade-off** in a comment block at the top of `handleTrialWillEnd` so future reviewers understand the AB 390 compliance trade-off explicitly.

## Acceptance Criteria
- [ ] `handleSubscriptionUpserted` wraps user-tier-flip + trial-start writes + trial-conversion writes in a SINGLE `db.transaction`
- [ ] Trial-start INSERT + `users.{tier}TrialUsedAt` UPDATE are atomic (no orphan trial rows on crash)
- [ ] `handleTrialWillEnd` flips `reminderSentAt` INSIDE tx, sends email POST-COMMIT (flag-first ordering documented in comment)
- [ ] `handleSubscriptionDeleted` wraps its single write in `db.transaction` (symmetric)
- [ ] Existing `try/catch` swallowing on the trial-table block (lines 878–881) REMOVED
- [ ] `reminderSentAt` short-circuit at lines 930–933 REMOVED (module 1 handles centrally)
- [ ] `server/_core/stripeWebhook.subscriptions.test.ts` has 7 named cases, all pass
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression-anchor count unchanged

## Deliverable
- Modified: `server/_core/stripeWebhook.ts`
- New: `server/_core/stripeWebhook.subscriptions.test.ts`
- Single commit:
  ```
  feat(stripe-webhook): Phase 2 module 4 — subscription handlers in db.transaction

  - handleSubscriptionUpserted: user-tier flip + membershipTrials
    insert/update now atomic. Fixes the partial-write bug where a crash
    between trial INSERT and users.{tier}TrialUsedAt UPDATE could leave
    an orphan trial row.
  - handleTrialWillEnd: reminderSentAt flag flipped INSIDE tx; AB 390
    email sent POST-COMMIT. Trade-off documented inline — email failure
    triggers notifyOwner alert rather than risking re-send via Stripe
    retry (Gmail SMTP has no native idempotency).
  - handleSubscriptionDeleted: wrapped in tx for symmetry.
  - Removed try/catch swallowing on trial-table block.
  - Removed reminderSentAt short-circuit (module 1's central idempotency
    replaces it).
  - Vitest: 7 cases covering paid-no-trial / trial-start / trial→active
    conversion / mid-tx-rollback / subscription-deleted / trial-will-end /
    idempotent-retry.
  ```

## Rollback
- `git revert <commit-SHA>` restores pre-transaction behavior.
- Behavior caveat: AFTER revert, the email-vs-flag ordering goes back to email-first, which means a webhook retry after a flag-write failure could re-send the AB 390 email. Stripe normally won't retry a webhook that returned 200, so this risk only materializes if the webhook itself crashed mid-response.

## Manual intervention
- **Supervisor:** decide email-vs-flag ordering BEFORE sub-agent dispatch. Default is flag-first per this module's recommendation; Jeff approval if a different stance is taken.
- If a test uncovers that `tierFromPriceId` does network I/O (it shouldn't — it's a lookup), escalate; we'd need to extract it from the tx-bound code.

## Test plan
- `pnpm test server/_core/stripeWebhook.subscriptions.test.ts` — 7 cases:
  1. **paid-no-trial happy path** — users.tier set, no trial row
  2. **trial start happy path** — trial row + users flag set, both atomic
  3. **trial → active conversion** — trial row marked converted
  4. **mid-tx DB failure rollback** — partial trial writes do NOT persist
  5. **subscription deleted** — users.tier reverts to free
  6. **trial_will_end** — flag flipped, email sent, notifyOwner fired
  7. **idempotent retry** — second delivery short-circuits at claimStripeEvent
- Mock `sendTrialEndingReminder`, `notifyOwner`, `notifyAgentMessage`, `tierFromPriceId`. Assert call counts and arg snapshots.
- Full suite `pnpm test` regression-anchor count unchanged.
