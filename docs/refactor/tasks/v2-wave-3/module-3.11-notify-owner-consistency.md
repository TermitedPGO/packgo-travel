# v2 · Wave 3 · Module 3.11 — Unify notifyOwner failure-mode handling across autonomous agents

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.9 line 330)
**Audit ref:** v2-audit-2026-05-19.md §A line 71 ("failure-mode coverage is inconsistent — `refundAgent`, `reviewAgent`, `followupAgent` do not call `notifyOwner`")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 6h AI + 0min Jeff

## Goal

Every autonomous agent's top-level catch path must call `notifyOwner` so Jeff knows when an autonomous loop fails silently. Today (per audit):

- ✅ `gmailPollWorker.ts:88` calls `notifyOwner` on pipeline-level failures (so `inquiryAgent` and `gmailPipeline` are covered transitively)
- ✅ `retrospectiveWorker.ts:187` covers `selfRetrospective` transitively
- ✅ `tripReminderWorker.ts:93` covers post-trip workflows
- ❌ `refundAgent.ts` — has its own throws (module 3.5 added notifyOwner ON THE STRIPE WIRE PATH only; admin manual path still uncovered)
- ❌ `reviewAgent.ts` — `catch {}` swallows errors (line 179)
- ❌ `followupAgent.ts` — no notifyOwner
- ❌ `marketingAgent.ts` — partial
- ❌ `accountingAgent.ts` — partial
- ❌ `opsAgent.ts` / `opsActions.ts` — these are admin-chat-triggered, not autonomous; lower priority

Build a thin wrapper helper `withAutonomousSafety(agentName, fn)` that:
1. Wraps the agent's top-level entry function
2. On success: returns the result transparently
3. On throw: calls `notifyOwner` with structured payload + the error, then re-throws OR returns `{ok: false}` (depending on caller's preference)

Refactor 4-6 agents to use it (the autonomous-trigger ones first: `refundAgent`, `reviewAgent`, `followupAgent`, `marketingAgent`, `accountingAgent`).

## Pre-requisites

- **Module 3.10** (Vitest smokes) — landed; tests verify before/after behavior
- **Module 3.5** (Stripe wire) — landed; refundAgent's autonomous trigger exists
- No Wave 2 dependencies

## Inputs (read these before executing)

1. `server/_core/notification.ts` — `notifyOwner` signature. Confirm fields: `title`, `content`.
2. `server/agents/_helpers/` directory — confirm where to land the new wrapper. Existing helpers: `RetryManager`, `AgentMonitor`, `FallbackManager`. New: `withAutonomousSafety` in `server/agents/_helpers/safety.ts` (new file).
3. `server/agents/autonomous/refundAgent.ts` — top-level entry function is `runRefundAgent`. Wrap it.
4. `server/agents/autonomous/reviewAgent.ts` line 179 — the `catch {}` to fix.
5. `server/agents/autonomous/followupAgent.ts` — entry function.
6. `server/agents/autonomous/marketingAgent.ts` — entry function.
7. `server/agents/autonomous/accountingAgent.ts` — entry function.

## Scope (what this module owns)

- New: `server/agents/_helpers/safety.ts` — exports `withAutonomousSafety`
- Modified: 5 agent files to use the wrapper (refundAgent, reviewAgent, followupAgent, marketingAgent, accountingAgent)
- Vitest: `server/agents/_helpers/safety.test.ts`

Does NOT:
- Modify `inquiryAgent` (already covered by gmailPollWorker)
- Modify `selfRetrospective` (already covered by retrospectiveWorker)
- Modify admin-chat agents (opsAgent, agentChat — not autonomous)

## Procedure

1. **Create `server/agents/_helpers/safety.ts`**:
   ```ts
   import { notifyOwner } from "../../_core/notification";

   export type SafetyOptions = {
     agentName: string;
     /** Whether to re-throw after notifying (default: true) */
     rethrow?: boolean;
     /** Extra context fields to include in the notification */
     context?: Record<string, unknown>;
   };

   /**
    * Wrap an autonomous-agent entry function so any throw is reported to
    * Jeff via notifyOwner before propagating (or swallowing, if rethrow=false).
    *
    * Usage:
    *   export const runRefundAgent = withAutonomousSafety(
    *     { agentName: "refund" },
    *     async (input: RefundAgentInput): Promise<RefundAgentOutput> => {
    *       // ... existing body ...
    *     }
    *   );
    *
    * Safety guarantees:
    * - notifyOwner failure does NOT shadow the original error (we catch it).
    * - Re-throws by default so callers (e.g., workers) see the same error
    *   shape as before — back-compat for existing code.
    */
   export function withAutonomousSafety<TArgs extends unknown[], TReturn>(
     options: SafetyOptions,
     fn: (...args: TArgs) => Promise<TReturn>
   ): (...args: TArgs) => Promise<TReturn> {
     return async (...args: TArgs): Promise<TReturn> => {
       try {
         return await fn(...args);
       } catch (err) {
         const message = err instanceof Error ? err.message : String(err);
         const stack = err instanceof Error ? err.stack : undefined;
         try {
           await notifyOwner({
             title: `⚠️ ${options.agentName} 自動代理人失敗`,
             content:
               `Agent: ${options.agentName}\n` +
               `Error: ${message}\n` +
               (options.context
                 ? `Context: ${JSON.stringify(options.context, null, 2)}\n`
                 : "") +
               (stack ? `\nStack:\n${stack.slice(0, 2000)}` : ""),
           });
         } catch (notifyErr) {
           // Don't shadow the original error
           console.error(
             `[withAutonomousSafety] notifyOwner also failed for ${options.agentName}:`,
             notifyErr
           );
         }
         if (options.rethrow !== false) throw err;
         // Fallthrough: return value depends on caller; without throw,
         // sub-agent must wrap inside the body to return {ok: false} shape.
         throw err; // safer default; force rethrow=false to be explicit
       }
     };
   }
   ```

2. **Refactor `refundAgent.ts`**:
   ```ts
   import { withAutonomousSafety } from "../_helpers/safety";

   // … existing body extracted into _runRefundAgentInner …

   export const runRefundAgent = withAutonomousSafety(
     { agentName: "refund" },
     _runRefundAgentInner
   );
   ```
   Existing callers (`gmailPipeline.ts`, `stripeWebhook.ts` post-module-3.5, admin `agentRouter`) call `runRefundAgent` exactly as before; behavior is identical except notifyOwner now fires on throws.

3. **Same pattern for** `reviewAgent.ts`, `followupAgent.ts`, `marketingAgent.ts`, `accountingAgent.ts`.

4. **Fix the `catch {}` at `reviewAgent.ts:179`** — replace with explicit catch + propagate to the wrapper:
   ```ts
   } catch (err) {
     // v2 module 3.11 — was silent swallow; now propagates to safety wrapper
     // which calls notifyOwner and re-throws.
     throw err;
   }
   ```

5. **Write `server/agents/_helpers/safety.test.ts`** — 4 cases:
   - Wrapped fn succeeds → result passes through; `notifyOwner` NOT called.
   - Wrapped fn throws → `notifyOwner` called with `title.includes(agentName)`; throw propagates.
   - Wrapped fn throws + `notifyOwner` also throws → original error propagates; console.error called with notify error.
   - Wrapped fn throws + `context` provided → notification body contains context JSON.

## Acceptance Criteria

- [ ] `server/agents/_helpers/safety.ts` exists with `withAutonomousSafety` + types
- [ ] `refundAgent.ts` uses the wrapper (top-level export)
- [ ] `reviewAgent.ts` uses the wrapper + line 179 `catch {}` fixed
- [ ] `followupAgent.ts` uses the wrapper
- [ ] `marketingAgent.ts` uses the wrapper
- [ ] `accountingAgent.ts` uses the wrapper
- [ ] All callers of these agents work without code change (back-compat)
- [ ] `server/agents/_helpers/safety.test.ts` exists with 4 passing cases — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] All existing `pnpm test` suites still pass (including post-module-3.10's batch)
- [ ] `notifyOwner` is awaited inside the wrapper (not fire-and-forget) — caller blocks until Jeff is notified

## Deliverable

- New: `server/agents/_helpers/safety.ts` (~60 LOC)
- New: `server/agents/_helpers/safety.test.ts` (~120 LOC, 4 cases)
- Modified: 5 agent files (~10 LOC change each — just wrap the export)

Commit message:
```
refactor(agents): Wave 3 Module 3.11 — unify notifyOwner failure-mode handling

Adds withAutonomousSafety helper that wraps an agent's top-level entry
function. On throw: notifyOwner is called with agent name + error + optional
context, then the throw propagates so existing worker-level catches see
the same shape.

Refactors 5 agents to use it: refundAgent, reviewAgent, followupAgent,
marketingAgent, accountingAgent. Also fixes silent catch {} at
reviewAgent.ts:179 (per audit §A line 71).

notifyOwner is awaited inside the wrapper (not fire-and-forget); Jeff is
guaranteed to see autonomous-agent failures before the worker retries.

inquiryAgent + selfRetrospective unchanged — their workers already call
notifyOwner on pipeline-level failures. Admin-chat agents (opsAgent,
agentChat) untouched — not autonomous.

4 Vitest cases per CLAUDE.md §九.

Refs: docs/refactor/tasks/v2-wave-3/module-3.11-notify-owner-consistency.md
```

## Rollback

- Single revert. The wrapper is a thin pass-through on success; refactor is back-compat.
- Worst case: notifyOwner spam on a flaky agent → rollback restores silent-failure status quo.

## Manual intervention

- **None.** Fully autonomous.

## Test plan

- 4 Vitest cases on `safety.ts`.
- Regression: existing module 3.10 batch tests still pass (verify each refactored agent's wrapper doesn't break its happy-path test).

## Decisions needed (Jeff)

1. **Default rethrow behavior** — `true` proposed (callers see error same as before). Alternative: `false` so wrapper returns `{ok: false}` and worker treats it as soft-fail. Recommend: **stick with rethrow=true** — keeps Jeff's worker-level retry logic intact. Per-agent override via options.
2. **notifyOwner channel** — email? Or also Slack/SMS? `notifyOwner` is the existing email-based helper. If Jeff wants SMS escalation for critical autonomous failures (refund agent down at 2am), separate v3 module. Default: email only.

(Module proceeds with proposed defaults if Jeff defers.)
