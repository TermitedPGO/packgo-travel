# v2 · Wave 2 · Module 2.10 — Split `server/routers/agentRouter.ts` (2,804 → 8 files)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.4)
**Audit ref:** v2-audit-2026-05-19.md §C lines 148, 209 (agentRouter god-file); v2-plan.md lines 191-203
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (parallelize-safe with Module 2.8, 2.9 after Module 2.7)
**Est. effort:** 10-12 h AI + 30 min Jeff review
**Risk tier:** MEDIUM — admin-only blast radius (no customer-facing tRPC paths in agentRouter). Wrong export → admin agent dashboard tabs break.
**Deploy window:** any morning, admin-tab only.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.7 (db.ts split). May parallelize with Module 2.8, 2.9. MUST be committed before any module that touches `server/routers/agent*`.

## Goal

Split `server/routers/agentRouter.ts` (2,804 LOC, 50 procedures) into a composition shell + 7 sub-files under `server/routers/agent/`, following the v1 Phase 4F pattern. Client tRPC path `trpc.agent.<procedure>` unchanged.

## Pre-requisites

- Module 2.7 committed (db.ts split done)
- Working tree clean
- `pnpm tsc --noEmit` exit 0
- `docs/refactor/tasks/phase-4/module-4F-composition.md` — read for the **composition spread pattern** which this module replicates

## Inputs (read these before executing)

1. **`server/routers/agentRouter.ts`** — 2,804 LOC. Full structural read required.
2. **`docs/refactor/tasks/phase-4/module-4F-composition.md`** — composition shell pattern. Specifically the `...subRouter._def.procedures` spread approach that preserves the top-level router key.
3. **`docs/refactor/tasks/phase-5/module-5B-admintabs.md`** — Pass A/B/C split pattern (similar approach for sub-routing).
4. **Client tRPC consumer audit** — preflight:
   ```bash
   grep -rohE "trpc\.agent\.[a-zA-Z][a-zA-Z0-9]*" client/src --include="*.ts" --include="*.tsx" | sort -u
   ```
   Every procedure listed must resolve identically post-split.

## Scope (what this module owns)

### Procedure inventory (from grep on commit d133596)

**50 procedures total in `agentRouter.ts`**, grouped into 7 sub-router files by domain:

#### Group 1 — Profile + Customer (lookup + upsert) → `server/routers/agent/profile.ts`
- `findProfile` (L79)
- `upsertByIdentifier` (L115)
- `getProfileWithContext` (L186)
- `updateLearnedPreferences` (L210)
- `logInteraction` (L248)

#### Group 2 — Actions (record + outcome tracking) → `server/routers/agent/actions.ts`
- `recordAction` (L298)
- `updateOutcome` (L327)
- `recentOutcomes` (L369)
- `pendingForJeff` (L654)
- `recentActivity` (L716)
- `acknowledge` (L772)

#### Group 3 — Auto-send + Policy → `server/routers/agent/policy.ts`
- `getAutoSendSettings` (L405)
- `setAutoSendSettings` (L430)
- `getActivePolicy` (L489)
- `upsertPolicy` (L512)
- `rollbackPolicy` (L560)
- `recentMetrics` (L600)
- `snapshot` (L622)

#### Group 4 — Office + Overview (read-only admin) → `server/routers/agent/office.ts`
- `agentOffice` (L807)
- `officeOverview` (L911)

#### Group 5 — Demo Agents (admin-only test invocations) → `server/routers/agent/demos.ts`
- `demoInquiry` (L1300)
- `demoReview` (L1424)
- `demoMarketing` (L1484)
- `demoFollowup` (L1524)
- `demoRefund` (L1562)

#### Group 6 — Chat + Messaging → `server/routers/agent/chat.ts`
- `listMessages` (L1652)
- `unreadMessageCount` (L1680)
- `replyToMessage` (L1701)
- `askOps` (L1734)
- `executeOpsAction` (L1823)
- `runRetrospective` (L1891)
- `applyRetrospectiveProposal` (L1970)
- `listPolicyProposals` (L2040)
- `markProposal` (L2067)
- `postMessage` (L2103)
- `listGeneralChannel` (L2207)
- `postToGeneralChannel` (L2225)
- `generalChannelUnread` (L2280)
- `markGeneralChannelRead` (L2296)
- `markAgentChannelRead` (L2312)
- `listConversation` (L2330)
- `unreadPerAgent` (L2351)
- `sendToAgent` (L2555)

#### Group 7 — Gmail Integration + Reports → `server/routers/agent/integrations.ts`
- `gmailGetAuthUrl` (L2136)
- `gmailStatus` (L2148)
- `gmailVerify` (L2168)
- `gmailRunNow` (L2184)
- `gmailDisconnect` (L2736)
- `requestAgentReport` (L2373)
- `requestAllAgentReports` (L2461)

### Composition shell

```
server/routers/
├── agentRouter.ts                ≤80 LOC  — composition shell
└── agent/                                  (new directory)
    ├── profile.ts               ≤300 LOC
    ├── actions.ts               ≤500 LOC
    ├── policy.ts                ≤500 LOC
    ├── office.ts                ≤300 LOC
    ├── demos.ts                 ≤700 LOC (exception — demos are JSX-heavy)
    ├── chat.ts                  ≤900 LOC (exception — largest group)
    └── integrations.ts          ≤500 LOC
```

Each sub-file exports a router via:

```ts
// server/routers/agent/profile.ts
import { adminProcedure, router } from "../../_core/trpc";
import { z } from "zod";
// ...other imports as discovered

export const agentProfileRouter = router({
  findProfile: adminProcedure.input(...).query(async ({ ctx, input }) => { ... }),
  upsertByIdentifier: adminProcedure.input(...).mutation(async ({ ctx, input }) => { ... }),
  // ... 5 procedures
});
```

Composition shell:

```ts
// server/routers/agentRouter.ts (post-split)
import { router } from "../_core/trpc";
import { agentProfileRouter } from "./agent/profile";
import { agentActionsRouter } from "./agent/actions";
import { agentPolicyRouter } from "./agent/policy";
import { agentOfficeRouter } from "./agent/office";
import { agentDemosRouter } from "./agent/demos";
import { agentChatRouter } from "./agent/chat";
import { agentIntegrationsRouter } from "./agent/integrations";

// Spread pattern preserves trpc.agent.<procedure> top-level keys
export const agentRouter = router({
  ...agentProfileRouter._def.procedures,
  ...agentActionsRouter._def.procedures,
  ...agentPolicyRouter._def.procedures,
  ...agentOfficeRouter._def.procedures,
  ...agentDemosRouter._def.procedures,
  ...agentChatRouter._def.procedures,
  ...agentIntegrationsRouter._def.procedures,
});
```

### Out of scope

- Procedure-level refactoring (typing improvements, error handling cleanup) — preserve verbatim
- Demo agents internal `: any` typing (per Phase 5B precedent — leave for v3)
- Rate-limit middleware wrapping (Wave 1 Module 1.7 handles this at `adminProcedure` definition level)

## Procedure

### Step 1 — Pre-extraction inventory

```bash
cd /Users/jeff/Desktop/網站
wc -l server/routers/agentRouter.ts
grep -nE "^\s+[a-z][A-Za-z]+:\s+(public|protected|admin)Procedure" server/routers/agentRouter.ts > /tmp/2.10-procedures.txt
wc -l /tmp/2.10-procedures.txt  # expect 50
grep -rohE "trpc\.agent\.[a-zA-Z][a-zA-Z0-9]*" client/src --include="*.ts" --include="*.tsx" | sort -u > /tmp/2.10-client-paths.txt
wc -l /tmp/2.10-client-paths.txt  # save baseline; all must survive
```

### Step 2 — Identify shared helpers

Read the top of `agentRouter.ts` (L1-78) for:
- `AGENT_NAMES` const (L48) — used by multiple procedures
- `channelEnum` (L57) — z.enum used in chat procedures
- Other shared helpers / types

Decide:
- Tiny consts (≤20 LOC): inline duplicate into each sub-router that needs them (avoids cross-file import cycles)
- Larger helpers: extract to `server/routers/agent/_shared.ts`

### Step 3 — Extract sub-routers in order

Recommended order (smallest first for early-validation):

1. `profile.ts` (5 procedures) — smallest, validates the spread mechanic
2. `office.ts` (2 procedures) — tiny
3. `policy.ts` (7 procedures)
4. `actions.ts` (6 procedures)
5. `integrations.ts` (7 procedures, Gmail-heavy)
6. `demos.ts` (5 procedures, JSX-result-heavy)
7. `chat.ts` (18 procedures, largest)

Per sub-router:
- Copy procedure definitions verbatim from `agentRouter.ts`
- Construct `agent<Group>Router = router({...})` block
- Add Vitest happy-path case
- After each sub-file: run `pnpm tsc --noEmit` to catch import drift

### Step 4 — Rewrite composition shell

After all 7 sub-routers extracted:
- Delete the original 2,804-LOC content from `agentRouter.ts`
- Replace with the composition shell template above
- Keep imports tight (only the 7 sub-router imports + `router` from trpc)

### Step 5 — Client tRPC path audit

```bash
# Sub-agent runs this BEFORE merging — proves no procedure was lost
grep -rohE "trpc\.agent\.[a-zA-Z][a-zA-Z0-9]*" client/src --include="*.ts" --include="*.tsx" | sort -u > /tmp/2.10-client-paths-after.txt
diff /tmp/2.10-client-paths.txt /tmp/2.10-client-paths-after.txt
# expect empty diff
```

Also verify each top-level procedure in the new agentRouter:

```bash
# Hack to enumerate post-split procedures:
node -e "const { agentRouter } = require('./server/routers/agentRouter'); console.log(Object.keys(agentRouter._def.procedures).sort().join('\n'))" > /tmp/2.10-router-procedures.txt
wc -l /tmp/2.10-router-procedures.txt  # expect 50
```

### Step 6 — Vitest per sub-router

7 new test files. Each test imports the sub-router and calls a representative procedure with a mocked caller. Pattern (from v1 Phase 4F):

```ts
// server/routers/agent/profile.test.ts
import { describe, it, expect, vi } from "vitest";
import { agentProfileRouter } from "./profile";

vi.mock("../../db", () => ({ /* mocked db helpers */ }));

describe("agent/profile router", () => {
  it("findProfile returns null when no match", async () => {
    const caller = agentProfileRouter.createCaller({
      user: { id: 1, role: "admin" } as any,
      session: null as any,
      req: {} as any,
      res: {} as any,
    });
    const result = await caller.findProfile({ identifier: "nope@example.com" });
    expect(result).toBeNull();
  });
});
```

### Step 7 — Verify

```bash
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
pnpm test server/routers/agent/
pnpm test  # regression
```

### Step 8 — Smoke

- Boot `pnpm dev`
- Open admin → Autonomous Agents tab → click each sub-tab (Profile lookup, Inbox, Demo desks)
- Verify each renders without "TRPCClientError: No procedure found"
- Try a Gmail status check → verify resolves
- Try a "Reply to message" mutation → verify resolves

## Acceptance Criteria

- [ ] `server/routers/agent/` directory exists with 7 sub-router files
- [ ] `server/routers/agentRouter.ts` ≤80 LOC (composition shell only)
- [ ] Each sub-router file ≤900 LOC (chat exception); most ≤500
- [ ] 7 new `.test.ts` files with 1+ happy-path Vitest each
- [ ] Client tRPC path audit: zero missing paths (diff empty)
- [ ] Post-split agentRouter exposes 50 top-level procedures (matches baseline)
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression + 7+ new tests pass
- [ ] Manual: every admin agent tab renders

## Deliverable

- New directory: `server/routers/agent/` with 7 sub-routers + 7 tests
- Modified: `server/routers/agentRouter.ts` (2,804 → ≤80 LOC)
- Optional: `server/routers/agent/_shared.ts` (only if shared helpers warrant)

**Single squash-merge commit:**

```
refactor(routers): v2 Wave 2 Module 2.10 — split agentRouter 2,804 → 8 files

Closes audit C-priority agent god-file. 50 procedures grouped by domain
into 7 sub-routers under server/routers/agent/.

- agentRouter.ts: composition shell (≤80 LOC), spread pattern preserves
  trpc.agent.<procedure> top-level keys
- agent/profile.ts: 5 procedures (findProfile, upsertByIdentifier, ...)
- agent/actions.ts: 6 procedures (recordAction, recentOutcomes, ...)
- agent/policy.ts: 7 procedures (autoSendSettings, policy CRUD, ...)
- agent/office.ts: 2 procedures (agentOffice, officeOverview)
- agent/demos.ts: 5 demo invocations (demoInquiry, demoReview, ...)
- agent/chat.ts: 18 procedures (largest — chat + messaging + retrospective)
- agent/integrations.ts: 7 procedures (Gmail + agent reports)
- 7 happy-path Vitest files

Client tRPC path audit: 0 missing paths. All 50 procedures preserved.

DEFERRED (v3):
  - Demo agent internal `: any` typing
  - chat.ts further-split (900 LOC documented exception)

Audit ref: v2-audit §C; v2-plan.md Module 2.4.
```

## Rollback

- Single squash-merge → `git revert <SHA>` restores monolith. Sub-routers orphan.
- Admin-only blast radius; customer-facing zero impact.

## Manual intervention

- **Jeff:** click through admin Autonomous Agents tab — confirm each sub-section renders + 1 interaction per group works.
- **Supervisor:** verify client tRPC path audit diff is empty (load-bearing gate).
- **Supervisor:** verify post-split procedure count = 50.

## Test plan

- 7+ Vitest happy paths
- Full regression
- Manual: admin tabs render + 1 interaction per group

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.10-a | `chat.ts` (~900 LOC, 18 procedures) — accept LOC exception OR further-split (e.g., chat-msg + chat-channel + chat-retrospective)? | **Accept exception.** 900 LOC is a single coherent admin-chat surface. Further split adds coordination cost without payoff. v3 can revisit if chat grows. |
| D2.10-b | Demo agents (`demos.ts`) — split per-agent files (5 tiny files) vs single demos file (current plan)? | **Single demos file.** Demos are admin-only test surfaces; 5 small files is over-fragmentation. |
| D2.10-c | `_shared.ts` for AGENT_NAMES + channelEnum — extract OR inline-duplicate? | **Extract** if used by ≥3 sub-routers. Inline if ≤2. Sub-agent decides post-grep. |

**Must be committed before any module touches `server/routers/agentRouter.ts` or `server/routers/agent/`.** Parallelize-safe with 2.8, 2.9, 2.11, 2.12, 2.13.
