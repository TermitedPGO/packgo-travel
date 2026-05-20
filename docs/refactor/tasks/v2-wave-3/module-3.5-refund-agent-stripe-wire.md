# v2 · Wave 3 · Module 3.5 — Wire RefundAgent into stripeWebhook.charge.refunded

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.6 line 306)
**Audit ref:** v2-audit-2026-05-19.md §A line 33 ("RefundAgent currently invoked only via admin manual button") + Domain A gap table
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4h AI + 0min Jeff

## Goal

`refundAgent.ts` (173 LOC) exists but never fires autonomously today — it only runs when an admin clicks a button in `agentRouter`. The Stripe `charge.refunded` webhook handler at `server/_core/stripeWebhook.ts:498-695` updates the DB, claws back packpoint, and notifies Jeff, but it does NOT generate a draft customer email.

Wire RefundAgent into the existing `handleChargeRefunded` flow so:
1. After the existing notifyOwner + notifyAgentMessage block (lines 666-694), call `runRefundAgent` with the refunded charge + booking context
2. Persist the triage as a `agentMessages` row (priority based on severity)
3. Per **draft-first lock**: never auto-send the customer email. RefundAgent's `DEFAULT_REFUND_POLICY.alwaysEscalate = true` is already correct; this module just adds the autonomous trigger.

The audit calls this "the most-conspicuous gap" because refunds are explicit `alwaysEscalate` in `inquiryAgent.ts:113` but there is no autonomous handler that triggers RefundAgent when Stripe fires.

## Pre-requisites

- **Phase 2 atomicity rules** must be preserved. `stripeWebhook.ts` Phase 2 hardened the handler with stripeWebhookEvents idempotency + per-handler tx wrapper. This module's RefundAgent invocation must NOT roll back Stripe state on failure.
- No Wave 1/2/3 module dependencies — this is a self-contained patch to stripeWebhook.
- (Soft) Wave 2.1 `db.ts` split: `stripeWebhook.ts:4` does `import * as db from "../db"`. If Wave 2.1 keeps the shim, this module is unaffected.

## Inputs (read these before executing)

1. `server/_core/stripeWebhook.ts` **lines 483–700** in full (the entire `handleChargeRefunded` flow).
2. `server/agents/autonomous/refundAgent.ts` — confirm `runRefundAgent(input: RefundAgentInput): Promise<RefundAgentOutput>` signature; `input.rawMessage` is currently the customer email. For Stripe-triggered runs, synthesize a "rawMessage" from charge metadata + booking context.
3. `server/_core/agentNotify.ts` — the `notifyAgentMessage` helper used at stripeWebhook line 678.
4. `drizzle/schema.ts` lines 2570–2615 — `agentMessages` table (the destination for RefundAgent's triage).
5. `server/_core/stripeWebhookEvents.ts` Phase 2 idempotency — confirm that RefundAgent invocation lives in the POST-COMMIT region (lines 615+) so a RefundAgent throw doesn't rollback the Stripe state.

## Scope (what this module owns)

- Modified: `server/_core/stripeWebhook.ts` (~30 LOC insertion after line 694)
- Modified: `server/agents/autonomous/refundAgent.ts` — extend `RefundAgentInput` to accept a structured `stripeContext` field (optional; doesn't break existing callers)
- New helper: `synthesizeStripeRawMessage(charge, payment, booking)` to build an LLM-readable summary for RefundAgent
- Vitest: `server/agents/autonomous/refundAgent.test.ts` — module 3.10 also touches this file; coordinate
- (Optional) Add `stripeChargeRefunded` source attribution on the `agentMessages` row

Does NOT:
- Modify the Stripe DB writes (those are inside the tx)
- Change `runRefundAgent`'s core LLM flow
- Auto-send any customer email

## Coordination with module 3.10

Module 3.10 creates `refundAgent.test.ts` as one of the 10 batch tests. This module 3.5 contributes 2 specific cases for the Stripe-triggered path. Coordination: **3.5 lands first** (creates test file with 1-2 Stripe wire cases); **3.10 extends** with the generic happy + failure cases.

## Procedure

1. **Read inputs in full.** Find the exact insertion point — after the `notifyAgentMessage` for the refund "observation" (line 692) and BEFORE the closing `}` of `handleChargeRefunded` (line 695).

2. **Extend `RefundAgentInput`** in `refundAgent.ts`:
   ```ts
   export type RefundAgentInput = {
     rawMessage: string;
     customerProfile?: { ... };
     policyRules?: string | null;
     // v2 Wave 3 module 3.5 — Stripe webhook trigger source
     source?: "manual_admin" | "stripe_webhook";
     stripeContext?: {
       chargeId: string;
       paymentIntentId: string;
       refundedAmountUsd: number;
       bookingId?: number | null;
       currency: string;
     };
   };
   ```
   Existing callers (admin manual button) pass no `source` → defaults to `manual_admin` semantics. Stripe-triggered calls set `source: "stripe_webhook"` + `stripeContext`.

3. **Add `synthesizeStripeRawMessage`** helper in `refundAgent.ts` (or new `server/agents/autonomous/refundAgent.helpers.ts` if Jeff prefers — same module either way):
   ```ts
   export function synthesizeStripeRawMessage(args: {
     charge: { id: string; amount: number; amount_refunded: number; currency: string };
     paymentIntentId: string;
     bookingId?: number | null;
     bookingSnapshot?: { customerEmail?: string; customerName?: string; departureDate?: Date };
   }): string {
     const usd = (args.charge.amount_refunded / 100).toFixed(2);
     return [
       `[STRIPE_REFUND_AUTOMATED_TRIGGER]`,
       `Booking ID: ${args.bookingId ?? "(unknown)"}`,
       `Customer email: ${args.bookingSnapshot?.customerEmail ?? "(unknown)"}`,
       `Customer name: ${args.bookingSnapshot?.customerName ?? "(unknown)"}`,
       `Refund amount: $${usd} ${args.charge.currency.toUpperCase()}`,
       `Original amount: $${(args.charge.amount / 100).toFixed(2)}`,
       `Stripe charge: ${args.charge.id}`,
       `Stripe payment intent: ${args.paymentIntentId}`,
       `Triggered by: Stripe charge.refunded webhook (not customer email).`,
       `Note: Customer did NOT email about this refund. Generate a triage`,
       `summary for Jeff to use when drafting the customer notification.`,
     ].join("\n");
   }
   ```
   This synthetic "rawMessage" tells the LLM clearly: this is a backend-triggered refund, not a customer email, so the triage should help Jeff draft a proactive notification rather than reply to a complaint.

4. **Insert the RefundAgent call** in `stripeWebhook.ts` after line 694. Place INSIDE a `try/catch` that swallows errors with `console.error + notifyOwner` (NOT inside the existing transaction):
   ```ts
   // v2 Wave 3 module 3.5 — autonomous RefundAgent triage on every refund.
   // Runs in POST-COMMIT region; if RefundAgent throws, log + notify but
   // DO NOT rollback the Stripe state (the refund is real regardless).
   try {
     const { runRefundAgent, synthesizeStripeRawMessage } = await import(
       "../agents/autonomous/refundAgent"
     );
     const { getDb: _getDb } = await import("../db");
     const _db = await _getDb();

     // Fetch agent policy (the same row inquiryAgent reads)
     const { agentPolicies } = await import("../../drizzle/schema");
     const { and: _and, eq: _eq } = await import("drizzle-orm");
     const [refundPolicyRow] = (_db
       ? await _db
           .select()
           .from(agentPolicies)
           .where(
             _and(
               _eq(agentPolicies.agentName, "refund"),
               _eq(agentPolicies.isActive, 1)
             )
           )
           .limit(1)
       : []) as any[];

     const rawMessage = synthesizeStripeRawMessage({
       charge: {
         id: charge.id,
         amount: charge.amount,
         amount_refunded: charge.amount_refunded,
         currency: charge.currency ?? "usd",
       },
       paymentIntentId,
       bookingId: payment.bookingId,
       bookingSnapshot: bookingSnap
         ? {
             customerEmail: (bookingSnap as any).customerEmail,
             customerName: (bookingSnap as any).customerName,
             departureDate: (bookingSnap as any).departureDate,
           }
         : undefined,
     });

     const triage = await runRefundAgent({
       rawMessage,
       customerProfile: undefined,
       policyRules: refundPolicyRow?.rules ?? null,
       source: "stripe_webhook",
       stripeContext: {
         chargeId: charge.id,
         paymentIntentId,
         refundedAmountUsd: charge.amount_refunded / 100,
         bookingId: payment.bookingId,
         currency: charge.currency ?? "usd",
       },
     });

     // Persist triage to agentMessages so Jeff sees it in office inbox.
     const { notifyAgentMessage } = await import("./agentNotify");
     await notifyAgentMessage({
       agentName: "refund",
       messageType: "proposal",
       title: `💰 退款 triage · Booking #${payment.bookingId ?? "?"} · severity=${triage.severity}`,
       body:
         `**Severity:** ${triage.severity}\n` +
         `**Reason category:** ${triage.reasonCategory}\n` +
         `**Customer emotional state:** ${triage.customerEmotionalState}\n\n` +
         `**Jeff briefing:**\n${triage.jeffInternalBriefing}\n\n` +
         `**Suggested actions:**\n` +
         triage.suggestedJeffActions.map((a) => `- ${a}`).join("\n") +
         `\n\n_Confidence: ${triage.confidence} · Auto-triggered by Stripe charge.refunded_`,
       priority:
         triage.severity === "critical"
           ? "critical"
           : triage.severity === "high"
           ? "high"
           : "normal",
       context: {
         chargeId: charge.id,
         paymentIntentId,
         bookingId: payment.bookingId,
         source: "stripe_webhook",
         triage,
       },
     });
   } catch (err) {
     // Per safety rule: RefundAgent failure must NOT prevent the refund
     // from completing. Log + notify Jeff via a separate channel so he
     // knows to triage manually.
     console.error(
       `[Stripe Webhook] RefundAgent autonomous triage failed for charge ${charge.id}:`,
       (err as Error).message
     );
     try {
       const { notifyOwner } = await import("./notification");
       await notifyOwner({
         title: `⚠️ RefundAgent triage 失敗 — Booking #${payment.bookingId ?? "?"}`,
         content:
           `Stripe refund processed successfully BUT the autonomous triage agent failed.\n\n` +
           `Charge: ${charge.id}\n` +
           `Error: ${(err as Error).message}\n\n` +
           `→ Please review the refund + draft customer email manually.`,
       });
     } catch (_e) {
       // notifyOwner failure is logged elsewhere; don't bubble.
     }
   }
   ```

5. **Update `agentPolicies` seed** if no `refund` policy exists yet:
   - Check via `SELECT * FROM agentPolicies WHERE agentName = 'refund'` on prod-mirror.
   - If empty: write a one-off SQL `INSERT INTO agentPolicies (...) VALUES ('refund', JSON_STRINGIFY(DEFAULT_REFUND_POLICY), 1)`.
   - **If exists**, skip.

6. **Write Vitest cases** in `server/agents/autonomous/refundAgent.test.ts` (creates file; module 3.10 will extend):
   - Case 1: `runRefundAgent({ source: "stripe_webhook", stripeContext: {...} })` with mocked LLM → returns triage shape; `agentMessages` insert called once.
   - Case 2: `runRefundAgent` throws → caller (mocked stripeWebhook flow) catches + calls `notifyOwner` (mocked); Stripe state NOT rolled back.
   - Case 3: `synthesizeStripeRawMessage` snapshot — fixed input produces expected multi-line string.

## Acceptance Criteria

- [ ] `refundAgent.ts` `RefundAgentInput` extended with optional `source` + `stripeContext` (back-compat: existing admin caller unchanged)
- [ ] `synthesizeStripeRawMessage` helper exported
- [ ] `stripeWebhook.ts` `handleChargeRefunded` calls RefundAgent after line 694, INSIDE try/catch in POST-COMMIT region
- [ ] RefundAgent failure does NOT roll back Stripe state — verified by code inspection (try/catch outside any `db.transaction` block)
- [ ] RefundAgent failure DOES call `notifyOwner` (consistency with module 3.11 expectations)
- [ ] `agentMessages` row inserted with `messageType: 'proposal'`, severity-based priority
- [ ] **Draft-first invariant**: no `sendReplyInThread` or any email transmission to customer
- [ ] `refundAgent.test.ts` has 3+ passing Vitest cases — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test refundAgent` passes
- [ ] Existing 31 stripeWebhook tests still pass (Phase 2 idempotency unchanged)

## Deliverable

- Modified: `server/_core/stripeWebhook.ts` (~80 LOC insertion at line 694)
- Modified: `server/agents/autonomous/refundAgent.ts` (~30 LOC type extension + helper)
- New: `server/agents/autonomous/refundAgent.test.ts` (~120 LOC, 3+ cases)

Commit message:
```
feat(agents): Wave 3 Module 3.5 — wire RefundAgent into stripe charge.refunded

Closes "most conspicuous autonomy gap" from v2 audit §A: RefundAgent
existed but never fired autonomously. Now every Stripe refund triggers a
triage agent that drafts a structured briefing for Jeff (severity,
emotional state, reason category, suggested actions).

Architecture:
- RefundAgent call lives in POST-COMMIT region; failure does NOT rollback
  Stripe state (the refund is real regardless).
- Per draft-first lock: never auto-sends customer email. RefundAgent's
  alwaysEscalate=true is preserved; triage becomes agentMessages 'proposal'
  row Jeff reviews in office inbox.
- synthesizeStripeRawMessage builds an LLM-readable summary so RefundAgent
  understands this is a backend-triggered refund (proactive notification),
  not a complaint email.

Existing 31 stripeWebhook Phase 2 idempotency tests unchanged. 3+ new
Vitest cases on refundAgent.test.ts per CLAUDE.md §九.

Refs: docs/refactor/tasks/v2-wave-3/module-3.5-refund-agent-stripe-wire.md
```

## Rollback

- Single revert. The RefundAgent invocation is in a try/catch — if anything goes wrong, refund processing continues uninterrupted.
- If the rollback happens AFTER agentMessages rows have been inserted, those rows remain (audit trail) — they're not harmful, just orphaned.

## Manual intervention

- **None** for code-only changes.
- **YES escalate** if `agentPolicies` table is missing a `refund` row — that's a one-shot SQL Jeff approves before deploy.

## Test plan

- 3+ Vitest cases on refundAgent (synthesize helper, stripe-source happy path, error containment).
- Wave 3 gate: deploy to staging, trigger a real `charge.refunded` event via Stripe CLI test-mode → confirm RefundAgent fires + agentMessages row appears + no customer email sent. (Gate-level, not module-level.)

## Decisions needed (Jeff)

1. **`refund` policy `agentPolicies` row** — does it already exist? If not, this module ships a one-shot SQL seed. If Jeff prefers a Drizzle migration, supervisor escalates. Default: SQL seed via `drizzle/0079b_refund_policy_seed.sql` (or wire into module 3.4's `0079_skill_runs.sql` if not yet landed).
2. **Synthetic rawMessage format** — proposed multi-line `[STRIPE_REFUND_AUTOMATED_TRIGGER]` block. If Jeff has preference (e.g., wants Spanish-only customers' rawMessage in Spanish), tune. Default: zh-TW key labels + English values.

(Module proceeds with proposed defaults if Jeff defers.)
