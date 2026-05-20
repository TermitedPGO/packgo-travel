# v2 · Wave 3 · Module 3.4 — Wire skill auto-dispatch in gmailPipeline

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.3 line 283)
**Audit ref:** v2-audit-2026-05-19.md §A lines 41–58 + §B P0 line 127
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 12h AI + 30min Jeff (auto-send-vs-draft confirmation)

## Goal

Wire the classifier→registry→orchestrator→draft pipeline. After `runInquiryAgent` returns with `classification = quote_request | flight_inquiry | tour_comparison_request | visa_inquiry | deposit_inquiry`, `gmailPipeline.ts` should:

1. Look up the skill via `lookupSkill(classification)` (module 3.2)
2. If found and confidence ≥ `AGENT_CONFIDENCE_THRESHOLD` (module 3.12), call `entry.orchestrator.run(ctx)` (module 3.3)
3. On `result.ok = true`, persist the skill output as a **draft** (per **draft-first lock** in user prompt — auto-send is v3) attached to an `agentMessages` row Jeff sees in the office inbox
4. On `result.ok = false`, escalate normally — Jeff handles it manually
5. Record `skillRunId` (FK to a new `skillRuns` audit table) on the inquiry record for traceability

**This module IS where the "autonomy thesis" goes from 46% → ~80% wired.** It's the highest-blast-radius module in Wave 3.

## Decision lock 2026-05-19 — Auto-send mode

Jeff approved **high-confidence auto-send** (NOT draft-only as initial Stage 3 spec assumed). The flow:
- classifier returns intent + confidence
- registry lookup → orchestrator runs
- IF `confidence >= AGENT_AUTO_SEND_THRESHOLD` (default 90) AND skill is on per-skill allow-list AND daily quota not exceeded AND `FEATURE_AUTO_SEND` env flag is `true` → auto-send to customer + log + Sentry.captureMessage + notifyOwner
- ELSE → admin draft only (legacy behavior)

Safeguards REQUIRED (add to this module's Scope + Procedure):
1. **Env kill-switch:** `FEATURE_AUTO_SEND=false` disables ALL auto-sends regardless of confidence (default false; Jeff flips to true post-soak).
2. **Per-skill allow-list:** new table `skillAutoSendPolicy` (migration in this module's scope) with columns `{skillId, autoSendEnabled, dailyQuota, lastResetAt}`. Default seed: all skills `autoSendEnabled=false`.
3. **Daily quota:** per-skill daily quota check before send. Quota resets at 00:00 UTC.
4. **Every auto-send logs:**
   - `agentAutoSends` table (NEW; columns: `{id, skillId, intent, confidence, customerEmail, subject, bodyHash, sentAt, sentryEventId}`).
   - `Sentry.captureMessage("auto-send fired", "info", {tags: {skillId, intent, confidence}})` so Jeff can audit in Sentry.
   - `notifyOwner` summary email to Jeff every auto-send (initially; can dial down after soak).
5. **Brand-damage circuit-breaker:** if 3+ auto-sends in 24h get a customer complaint reply (detected by `inquiryAgent` re-running on response thread), auto-disable that skill (`autoSendEnabled=false`) + emergency Slack/email to Jeff.

Acceptance criteria additions:
- [ ] Vitest case: confidence < threshold → draft only, no auto-send
- [ ] Vitest case: confidence >= threshold AND quota exceeded → draft only
- [ ] Vitest case: confidence >= threshold AND FEATURE_AUTO_SEND=false → draft only
- [ ] Vitest case: happy auto-send → all 4 logs fire (DB row + Sentry + notifyOwner + customer)
- [ ] Migration adds `skillAutoSendPolicy` + `agentAutoSends` tables

Decisions still needed for Stage 4 executor (Jeff):
- Initial `AGENT_AUTO_SEND_THRESHOLD` value: 90 (recommended), 85, or stricter 95?
- Per-skill day-1 allow-list: which of the 5 ported skills (packgo-tour-comparison, packgo-quote, packgo-flight-ticket, packgo-china-visa, packgo-tour-confirmation) start with `autoSendEnabled=true`? Recommend: ALL start false; Jeff flips one at a time after manual review of draft quality.
- Daily quota per skill: 10/day? 5/day? Per audit, Jeff handles ~3 inquiries/day average, so 5/day per skill = ample headroom; 10/day catches an inquiry spike.

## Pre-requisites

- **Module 3.1** (5 new intents in classifier) — landed
- **Module 3.2** (registry) — landed
- **Module 3.3** (SkillOrchestrator interface + tourComparison conform) — landed
- **Module 3.12** (`AGENT_CONFIDENCE_THRESHOLD` env) — landed (or use hard-coded 80 default if 3.12 lands after; refactor later)
- **Wave 2 DEPENDENCY (soft):** `db.ts` split (Wave 2 Module 2.1) doesn't gate this module if the shim preserves exports. Verify after Wave 2.1 lands: `grep -n "from \"../../db\"" server/agents/autonomous/gmailPipeline.ts` should still resolve. If Wave 2.1 hasn't landed yet, this module proceeds against monolith `db.ts`.

## Inputs (read these before executing)

1. `server/agents/autonomous/gmailPipeline.ts` **in full** (567 LOC). The dispatch insertion point is **after line 222** (`decision = await runInquiryAgent(...)`) and **before line 245** (`db.insert(customerInteractions)`). Specifically: after the prompt-injection shield force-escalate at line 236, BEFORE the interaction log so `skillRunId` can be persisted on it.
2. `server/agents/skills/registry.ts` (module 3.2 output)
3. `server/agents/skills/orchestrator.ts` (module 3.3 output)
4. `drizzle/schema.ts` — confirm latest migration number (currently 0076 per `ls drizzle/*.sql | tail -1`). New migration for this module: **0079_skill_runs.sql** (0077/0078 reserved for Wave 1 modules 1.6 + 1.8).
5. `server/agents/_helpers/AgentMonitor` — daily caps. Confirm shape so dispatch can record skill runs against the agent's daily quota.

## Scope (what this module owns)

- New DB table: `skillRuns` (audit + idempotency for skill executions)
- Migration: `drizzle/0079_skill_runs.sql`
- Modified: `gmailPipeline.ts` (~60 LOC insertion after line 236)
- Modified: `inquiryAgent.ts` output type (add optional `skillRunId` field — or leave on pipeline result)
- New: `server/agents/skills/dispatcher.ts` — the encapsulated dispatch helper called from gmailPipeline
- Vitest: `server/agents/skills/dispatcher.test.ts`

Does NOT:
- Implement any skill orchestrator (modules 3.6, 3.7)
- Modify the classifier (module 3.1)
- Wire Stripe webhook → RefundAgent (module 3.5)

## Procedure

1. **Read all inputs.** Confirm gmailPipeline insertion point (post-injection-shield, pre-interaction-log).

2. **Create `drizzle/0079_skill_runs.sql`**:
   ```sql
   CREATE TABLE skillRuns (
     id INT AUTO_INCREMENT PRIMARY KEY,
     skillId VARCHAR(60) NOT NULL,
     intent VARCHAR(50) NOT NULL,
     interactionId INT,                 -- FK customerInteractions.id (nullable)
     customerProfileId INT,             -- FK customerProfiles.id (nullable)
     agentMessageId INT,                -- FK agentMessages.id when draft persisted
     status ENUM('running','succeeded','failed','escalated') NOT NULL DEFAULT 'running',
     pdfStoragePath VARCHAR(500),       -- S3 path if a PDF was generated
     draftBody TEXT,                    -- Markdown body of the draft email
     meta JSON,                         -- skill-specific output metadata
     errorMessage VARCHAR(1024),
     llmTokensIn INT DEFAULT 0,
     llmTokensOut INT DEFAULT 0,
     llmCostCents INT DEFAULT 0,        -- for AgentMonitor budget tracking
     durationMs INT,
     createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
     completedAt TIMESTAMP,
     INDEX idx_skillRuns_interactionId (interactionId),
     INDEX idx_skillRuns_status_createdAt (status, createdAt),
     INDEX idx_skillRuns_skillId_createdAt (skillId, createdAt)
   );
   ```
   Also add to `drizzle/schema.ts`:
   ```ts
   export const skillRuns = mysqlTable("skillRuns", { ... });
   ```

3. **Create `server/agents/skills/dispatcher.ts`** — the encapsulating helper:
   ```ts
   import { lookupSkill } from "./registry";
   import type { SkillContext, SkillResult } from "./orchestrator";
   import type { InquiryAgentOutput } from "../autonomous/inquiryAgent";
   import { getDb } from "../../db";
   import { skillRuns } from "../../../drizzle/schema";
   import { storagePut } from "../../storage";

   export type DispatchOutput = {
     skillRunId: number;
     status: "succeeded" | "failed" | "escalated";
     pdfStoragePath?: string;
     draftBody?: string;
     escalationReason?: string;
   };

   /**
    * Look up the skill for an intent and execute it.
    * Returns null if no skill is registered (caller should proceed with
    * inquiryAgent's own draftReply).
    *
    * Per draft-first lock (CLAUDE.md / user prompt): never auto-sends.
    * Output is persisted to skillRuns + linked to an agentMessages row
    * so Jeff reviews in office inbox before forwarding to customer.
    */
   export async function dispatchSkillFromInquiry(args: {
     inquiry: InquiryAgentOutput;
     rawMessage: string;
     senderEmail?: string;
     customerProfileId?: number;
     interactionId?: number;
     confidenceThreshold: number;
   }): Promise<DispatchOutput | null> {
     const entry = lookupSkill(args.inquiry.classification);
     if (!entry) return null;
     if (args.inquiry.confidence < args.confidenceThreshold) return null;
     if (args.inquiry.shouldEscalate) return null;

     const db = await getDb();
     const startedAt = Date.now();

     // Insert skillRuns row with status='running' (claim)
     const ins = await db!.insert(skillRuns).values({
       skillId: entry.skillId,
       intent: args.inquiry.classification,
       interactionId: args.interactionId,
       customerProfileId: args.customerProfileId,
       status: "running",
     });
     const skillRunId = Number((ins as any)[0]?.insertId ?? 0);

     const ctx: SkillContext = {
       inquiry: args.inquiry,
       rawMessage: args.rawMessage,
       senderEmail: args.senderEmail,
       customerProfileId: args.customerProfileId,
       language: args.inquiry.draftLanguage,
       correlationId: `skillRun-${skillRunId}`,
     };

     let result: SkillResult;
     try {
       result = await Promise.race([
         entry.orchestrator.run(ctx),
         new Promise<SkillResult>((_, reject) =>
           setTimeout(() => reject(new Error("skill-timeout-90s")), 90_000)
         ),
       ]);
     } catch (err) {
       result = {
         ok: false,
         reason: err instanceof Error ? err.message : String(err),
         needsJeff: true,
       };
     }

     const durationMs = Date.now() - startedAt;

     if (!result.ok) {
       await db!.update(skillRuns)
         .set({
           status: "escalated",
           errorMessage: result.reason.slice(0, 1024),
           durationMs,
           completedAt: new Date(),
         })
         .where(eq(skillRuns.id, skillRunId));
       return {
         skillRunId,
         status: "escalated",
         escalationReason: result.reason,
       };
     }

     // Upload PDF to S3 if present
     let pdfStoragePath: string | undefined;
     if (result.pdf) {
       pdfStoragePath = `skill-runs/${skillRunId}/${entry.skillId}.pdf`;
       await storagePut(pdfStoragePath, result.pdf, "application/pdf");
     }

     await db!.update(skillRuns)
       .set({
         status: "succeeded",
         pdfStoragePath,
         draftBody: result.draftBody,
         meta: JSON.stringify(result.meta ?? {}),
         durationMs,
         completedAt: new Date(),
       })
       .where(eq(skillRuns.id, skillRunId));

     return {
       skillRunId,
       status: "succeeded",
       pdfStoragePath,
       draftBody: result.draftBody,
     };
   }
   ```

4. **Modify `gmailPipeline.ts`** — after line 236 (post-injection-shield escalation handling) and **after the customerInteractions insert** (line 245-254 — we need `interactionId`), add the dispatch call:
   ```ts
   // v2 Wave 3 module 3.4 — skill auto-dispatch
   const { dispatchSkillFromInquiry } = await import("../skills/dispatcher");
   const dispatchOut = await dispatchSkillFromInquiry({
     inquiry: decision,
     rawMessage,
     senderEmail: senderEmail ?? undefined,
     customerProfileId: profileId ?? undefined,
     interactionId,
     confidenceThreshold:
       Number(process.env.AGENT_CONFIDENCE_THRESHOLD ?? 80),
   });

   if (dispatchOut?.status === "succeeded") {
     // Post an "observation" agentMessage so Jeff sees the draft in office inbox
     const { notifyAgentMessage } = await import("../../_core/agentNotify");
     await notifyAgentMessage({
       agentName: "inquiry",
       messageType: "proposal",          // proposals are draft-ready actions
       title: `📋 ${decision.classification} skill draft ready · ${senderEmail}`,
       body:
         `${dispatchOut.draftBody ?? decision.draftReply}\n\n` +
         (dispatchOut.pdfStoragePath
           ? `📎 PDF: ${dispatchOut.pdfStoragePath}\n`
           : "") +
         `\n_skillRunId: ${dispatchOut.skillRunId}_`,
       priority: decision.urgency === "high" ? "high" : "normal",
       context: {
         skillRunId: dispatchOut.skillRunId,
         classification: decision.classification,
         confidence: decision.confidence,
         pdfStoragePath: dispatchOut.pdfStoragePath,
       },
       relatedInteractionId: interactionId,
       relatedCustomerProfileId: profileId ?? undefined,
     });
   } else if (dispatchOut?.status === "escalated") {
     // Force-escalate downstream so Jeff sees + intervenes
     decision.shouldEscalate = true;
     decision.escalationReason =
       (decision.escalationReason ?? "") +
       ` | skill dispatch escalation: ${dispatchOut.escalationReason}`;
   }
   // dispatchOut === null → no skill registered, proceed with normal draft flow
   ```

5. **Write `dispatcher.test.ts`** with these cases (mocked LLM + mocked DB):
   - `quote_request` + confidence 85 + ported skill → returns `succeeded` with `skillRunId > 0`
   - `flight_inquiry` + skill returns `isPorted=false` → returns `null` (no dispatch)
   - `refund_request` → `lookupSkill` returns null → dispatcher returns null
   - `quote_request` + confidence 60 (below threshold 80) → returns null
   - `quote_request` + orchestrator throws → `escalated` with `errorMessage` truncated
   - `quote_request` + 91-second hang → timeout → escalated
   - `quote_request` + `shouldEscalate=true` (e.g., from prompt-injection guard) → returns null

6. **Update CLAUDE.md §六** file map to include `server/agents/skills/registry.ts` + `dispatcher.ts` after this module lands.

## Acceptance Criteria

- [ ] `drizzle/0079_skill_runs.sql` exists; migration applies cleanly on local DB
- [ ] `drizzle/schema.ts` has `skillRuns` table export
- [ ] `server/agents/skills/dispatcher.ts` exists with `dispatchSkillFromInquiry`
- [ ] `gmailPipeline.ts` calls the dispatcher after interactionId is known
- [ ] **Draft-first invariant**: dispatcher never calls `sendReplyInThread` — only persists `agentMessages` with `messageType: 'proposal'`
- [ ] Skill output PDF (if any) uploaded to S3 via `storagePut`
- [ ] Skill timeout = 90s; throws caught and converted to `{ok: false}`
- [ ] `dispatchOut.status === 'escalated'` flows through to `decision.shouldEscalate = true` so existing escalation path is reused
- [ ] `server/agents/skills/dispatcher.test.ts` exists with 7+ passing Vitest cases — **§九 hard requirement**
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test dispatcher` passes
- [ ] `AgentMonitor` daily caps respected (insertion of `skillRuns` row counts as 1 unit against quota — verify by reading `AgentMonitor` interface)

## Deliverable

- New: `drizzle/0079_skill_runs.sql` (~30 LOC)
- Modified: `drizzle/schema.ts` (add skillRuns table; ~20 LOC)
- New: `server/agents/skills/dispatcher.ts` (~120 LOC)
- New: `server/agents/skills/dispatcher.test.ts` (~150 LOC, 7+ cases)
- Modified: `server/agents/autonomous/gmailPipeline.ts` (~60 LOC insertion)
- Modified: `CLAUDE.md` §六 (1-line addition)

Commit message:
```
feat(agents): Wave 3 Module 3.4 — wire skill auto-dispatch from gmailPipeline

After InquiryAgent classifies a sub-intent, look up the skill via the
registry (module 3.2), execute via SkillOrchestrator (module 3.3), and
persist the result to skillRuns (new audit table). Skill output becomes
an agentMessages 'proposal' row Jeff reviews in office inbox.

DRAFT-FIRST: dispatcher never auto-sends. Per CLAUDE.md / Wave 3 lock,
auto-send is a v3 milestone gated on Jeff seeing N successful drafts.

Confidence threshold (module 3.12) gates eligibility. Skill orchestrator
timeout 90s. Escalation path reused via decision.shouldEscalate so
downstream Gmail-pipeline behavior (chatbox post, etc) is unchanged.

Migration 0079 adds skillRuns audit table with LLM token + cost columns
for AgentMonitor budget tracking.

7+ Vitest cases per CLAUDE.md §九.

Refs: docs/refactor/tasks/v2-wave-3/module-3.4-inquiry-auto-dispatch.md
```

## Rollback

- **2-step revert** because of the migration:
  1. `git revert <SHA>` — restores code
  2. `drizzle/0079_skill_runs.down.sql` (write at land time): `DROP TABLE IF EXISTS skillRuns;`
- Existing inquiry flow continues to work — dispatch is purely additive. Without the registry lookup, every email falls through to the existing `agentMessages` escalation path that already exists.
- Worst-case prod regression: a skill orchestrator hangs longer than 90s and pipeline gets slow. Mitigation: the `Promise.race` timeout ensures this can't happen.

## Manual intervention

- **None** for code-only changes.
- **YES escalate** if Stage 4 dispatch hits AgentMonitor's daily cap calibration — Jeff must approve per-skill budget (e.g., quote skill is ~$0.05/run, tour-comparison ~$0.30/run). Document costs once observed.

## Test plan

- 7+ Vitest cases (dispatcher level, mocked LLM + mocked DB).
- Wave 3 verification gate (per v2-plan line 366) includes a staging E2E: send a real `quote_request` email → dispatcher fires → Jeff sees draft in office inbox. That's NOT this module's test scope (gate-level).

## Decisions needed (Jeff)

(See "Decision lock 2026-05-19" section near top for already-locked decisions.)

1. **Auto-send-vs-draft confirmation** — v2 LOCK is **draft-only** (per user prompt). Confirm Jeff has not changed his mind. If he wants auto-send for high-confidence (≥95) cases, that's a flag on `SkillRegistryEntry` and a separate kill-switch env. Default this module: **strict draft-only, ignore confidence ≥95 special case for v2**.
2. **`skillRuns.draftBody` storage location** — inline TEXT column (proposed) vs S3-only path. Inline is faster for Jeff's UI render. Default: inline TEXT, capped at 64KB. If a skill emits longer than 64KB, truncate + log warning.
3. **Daily quota per skill** — `AgentMonitor` cap. Default proposed: 50 dispatches/day total (catches runaway loops). Per-skill caps can come in v3.

(Module proceeds with proposed defaults if Jeff defers; #1 is the only one that strictly blocks dispatch from working.)
