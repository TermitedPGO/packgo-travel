# v2 · Wave 1 · Module 1.2 — Pino structured logger (high-priority subset)

**Parent plan:** docs/refactor/v2-plan.md (Wave 1)
**Audit ref:** v2-audit-2026-05-19.md §F "Logging" (lines 330-336) — "1,445 raw console.* calls in server, 59 in server/_core/" + §F recommended work table (line 365) "Replace console.* in server/_core/ and server/agents/autonomous/ with pino structured logger, 8h, P0"
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8h AI

## Goal
Introduce `pino` as the canonical structured-logging library and migrate the **high-priority subset** of `console.*` calls to it. Scope is intentionally bounded: `server/_core/*` (193 calls confirmed via grep, plan claimed 59 — actual is higher) + `server/agents/autonomous/*` (~7 calls confirmed via grep). **Full 1,445-site sweep is deferred to Wave 4 polish** (audit §F shows this volume; plan explicitly bounds Wave 1 to the ~200-call critical-path subset). After this module, every line that goes to Fly logs from the critical path is JSON with `level`, `requestId`, `correlationId`, and never contains PII.

## Pre-requisites
- **Module 1.1 (Sentry) should land first** so the logger can also pipe errors through Sentry transport (per pino-sentry pattern). If Module 1.1 is in flight, this module can run in parallel and stub the Sentry call.
- Working tree clean. Husky pre-commit tsc gate active.
- `redis` import surface (`server/redis.ts`) untouched — this module does not change Redis use.

## Inputs (read these before executing)
- `server/_core/*.ts` — full directory listing (~40 files). Run `grep -rn "console\." server/_core/ | grep -v "\.test\.ts" | wc -l` — current count is **193** (plan said 59; actual is 193 — likely v1 added more). Migrate **all of them** in this module; this is the high-priority subset.
- `server/agents/autonomous/*.ts` — 15 files. Confirmed grep shows **7** `console.*` calls in non-test files. Migrate all 7.
- `server/_core/index.ts` lines 50-75 — request-id middleware extension point. Need to read existing correlation-id practice (likely none — this module establishes it).
- `server/_core/notification.ts` — has `console.error` calls; migrate to logger.error with structured fields.
- `server/_core/stripeWebhook.ts` — extensive `console.log`/`error` for webhook event tracing. Migrate carefully: existing log lines are searchable artifacts (`fly logs | grep <eventId>`); pino JSON output may break those greps unless `pino-pretty` is used in dev only.
- `server/agents/autonomous/inquiryAgent.ts`, `gmailPipeline.ts`, etc. — these are the autonomous-agent files Wave 3 will test; migrating their logs first means Wave 3 tests can assert on `logger.info` calls (mocked) instead of `console.log` (harder to spy).
- Audit ref `v2-audit-2026-05-19.md` lines 330-371 (full §F Logging + Recommended work).

## Scope (what this module owns)
1. **Dependencies (package.json):**
   - `pino` (latest 9.x)
   - `pino-pretty` (dev only — `devDependencies`)
   - `pino-http` if used for Express middleware
2. **New file: `server/_core/logger.ts`** — exports a singleton `logger` (pino instance) + factory `createChildLogger(bindings)`. Config:
   - Dev: `pino-pretty` transport, colorize, level=`debug`
   - Prod: JSON transport, level=env `LOG_LEVEL` || `info`
   - Redact: `passportNumber`, `passportExpiry`, `dateOfBirth`, `email` (when not in `from`/`to` audit context — see DECISION 1), `phone`, `accessToken`, `refreshToken`, `apiKey`, `password`, `creditCardNumber`, any field name matching `*Token`/`*Secret`/`*Key`
3. **New file: `server/_core/correlationId.ts`** — Express middleware that:
   - Reads `x-request-id` header (or generates a `nanoid(8)`)
   - Attaches to `req.correlationId`
   - Returns it in response `x-request-id` header (lets Jeff trace a customer report through logs)
   - Uses `AsyncLocalStorage` to make `correlationId` accessible from anywhere in the request chain (without prop-drilling through tRPC ctx)
4. **Modified: `server/_core/index.ts`** — register `correlationId` middleware BEFORE Sentry's request handler (line ~50). After Sentry's handler, register `pino-http` for HTTP access-log lines.
5. **Migrate `server/_core/*.ts`** (40 files, 193 calls):
   - `console.log` → `logger.info` (with structured fields: `{ event: "tour.generated", tourId, durationMs }` instead of string interpolation)
   - `console.error` → `logger.error({ err }, "message")`
   - `console.warn` → `logger.warn`
   - `console.debug` → `logger.debug`
6. **Migrate `server/agents/autonomous/*.ts`** (15 files, 7 calls).
7. **Update `server/_core/notification.ts`** — Module 1.1's `Sentry.captureMessage` addition AND replace `console.error` with `logger.error({ err })`.
8. **NO migration to other server dirs in this module** — `server/routers/*` (~700 calls), `server/services/*`, `server/agents/*` non-autonomous (~500 calls), root `server/*.ts` (~50 calls) **deferred to Wave 4 Module TBD**. Add an explicit `TODO(wave-4-pino-sweep)` comment to a NEW file `docs/refactor/wave-4-deferrals.md` so it's not forgotten.

## Procedure
1. **Read** `server/_core/logger.ts` (will not exist; if it does, conflict — fail-fast).
2. **Confirm scope counts:**
   ```bash
   cd /Users/jeff/Desktop/網站
   grep -rn "console\." server/_core/ | grep -v "\.test\.ts" | wc -l   # expect ~193
   grep -rn "console\." server/agents/autonomous/ | grep -v "\.test\.ts" | wc -l  # expect ~7
   ```
3. `pnpm add pino pino-http && pnpm add -D pino-pretty`
4. **Create `server/_core/logger.ts`** with the singleton + redact paths (use pino's `redact` option for `req.headers.authorization`, `body.password`, `body.passportNumber`, etc.).
5. **Create `server/_core/correlationId.ts`** with `AsyncLocalStorage<{ correlationId: string }>` exposed via `getCorrelationId()` helper.
6. **Migrate `server/_core/notification.ts`** first (smallest file with `console`) to validate the pattern. Run `pnpm tsc --noEmit` after.
7. **Migrate each `server/_core/*.ts` file** one at a time. After each batch of 5 files, run `pnpm tsc --noEmit`. Don't batch 40 — diff is noise then.
8. **Migrate `server/agents/autonomous/*.ts`** — 7 calls is one Edit per file at most.
9. **Update `server/_core/index.ts`:**
   - Top import: `import { logger } from "./logger"; import { correlationIdMiddleware } from "./correlationId";`
   - Line ~46 (after compression): `app.use(correlationIdMiddleware);`
   - Line ~50 (after Sentry handlers, if Module 1.1 landed): `app.use(pinoHttp({ logger }));`
   - Replace `console.log("Server running on http://localhost:${port}/")` with `logger.info({ port }, "Server running")` at line ~55.
10. **Update `CLAUDE.md` §四 禁止事項** with new forbidden pattern:
    ```
    // ❌ 禁止：在 server/_core/* 或 server/agents/autonomous/* 用 console.*
    //   應使用 import { logger } from "@/_core/logger"
    //   logger.info({ event, ...fields }, "message")
    ```
11. **Update `CLAUDE.md` §六** — add `server/_core/logger.ts` row.
12. **Create `docs/refactor/wave-4-deferrals.md`** documenting the remaining ~1,250 `console.*` sites to migrate in Wave 4.
13. **Write Vitest** (see Test plan).
14. **Verify:**
    ```bash
    grep -rn "console\." server/_core/ | grep -v "\.test\.ts" | wc -l   # expect 0
    grep -rn "console\." server/agents/autonomous/ | grep -v "\.test\.ts" | wc -l  # expect 0
    NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
    pnpm test
    ```

## Acceptance Criteria
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` all green (+ new Vitest from this module)
- [ ] `grep -rn "console\." server/_core/ | grep -v "\.test\.ts"` returns **0 matches** (exception: if any line has an inline `// eslint-disable-line no-console` justified comment, document why — but target is zero)
- [ ] `grep -rn "console\." server/agents/autonomous/ | grep -v "\.test\.ts"` returns **0 matches**
- [ ] **Per CLAUDE.md §九:** new Vitest test exists at `server/_core/logger.test.ts` verifying:
  1. `logger.info({ passportNumber: "X12345" }, "test")` redacts the value in output
  2. `logger.info({ email: "j@example.com" }, "test")` — verify per DECISION 1
  3. `getCorrelationId()` returns the value set by middleware (tested via `AsyncLocalStorage.run`)
- [ ] `docs/refactor/wave-4-deferrals.md` exists and documents remaining `console.*` sites.
- [ ] CLAUDE.md §四 + §六 updated.
- [ ] `pino` and `pino-http` in `dependencies`; `pino-pretty` in `devDependencies`.

## Deliverable
- **New files:**
  - `server/_core/logger.ts`
  - `server/_core/logger.test.ts`
  - `server/_core/correlationId.ts`
  - `server/_core/correlationId.test.ts`
  - `docs/refactor/wave-4-deferrals.md`
- **Modified files:**
  - `package.json`, `pnpm-lock.yaml`
  - `server/_core/index.ts`
  - `server/_core/notification.ts`
  - ~40 files in `server/_core/*.ts` (all `console.*` migrated)
  - ~15 files in `server/agents/autonomous/*.ts` (touched if they had `console.*`)
  - `CLAUDE.md`
- **Expected commit message:**
  ```
  feat(observability): pino structured logger for critical-path subset

  - new server/_core/logger.ts: pino singleton + child-logger factory;
    pino-pretty in dev, JSON in prod; LOG_LEVEL env-driven; PII redact
    for passportNumber/email/phone/tokens/secrets
  - new server/_core/correlationId.ts: AsyncLocalStorage-backed
    request ID; returned in x-request-id response header so Jeff can
    trace a customer report end-to-end
  - migrated ~200 console.* sites in server/_core/* + server/agents/
    autonomous/* (the critical-path subset). Remaining ~1,250 sites in
    routers/services/root tracked in docs/refactor/wave-4-deferrals.md
    for the Wave 4 polish sweep
  - CLAUDE.md §四 禁止事項 + §六 file map updated

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.2
  ```

## Rollback
- **Multi-file revert.** `git revert <SHA>` of the single commit restores all `console.*` calls.
- No data risk (logging only).
- `pino` deps stay in `package.json` after revert; harmless.

## Manual intervention
- **None.** All work is mechanical.
- After deploy, Jeff verifies Fly log output is JSON in prod (eyeball check on `fly logs` output) — should see `{"level":30,...}` instead of plain text. ~2min sanity check.

## Test plan
- **`server/_core/logger.test.ts`** (NEW):
  - Case 1 (PII redact - passportNumber): log a passport number; assert serialized output replaces the value with `"[Redacted]"`.
  - Case 2 (PII redact - phone): same pattern.
  - Case 3 (token redact): log `accessToken: "xyz"`; assert redacted.
  - Case 4 (level filter): default level=info; logger.debug call produces no output.
  - Case 5 (child logger): `logger.child({ requestId: "abc" })`.info emits the binding.
- **`server/_core/correlationId.test.ts`** (NEW):
  - Case 1: middleware reads existing `x-request-id` header → preserves it.
  - Case 2: middleware generates a new one when header absent.
  - Case 3: `AsyncLocalStorage.run(...)` → `getCorrelationId()` inside returns the value.
- **Regression:** existing tests for `server/_core/notification.ts` etc. must still pass (no semantic change, just log channel).

## Decisions needed (Jeff)
1. **Email redaction strictness.** Pino's `redact` can mask `email` everywhere; but admin audit logs intentionally want `customerEmail` visible. Two options:
   - **A (recommended):** redact `email` only when in specific paths like `req.body.email`, `req.body.password.*email*`; keep `customerEmail` (database field name) visible.
   - **B:** redact all `email` fields globally; admin queries fetch via tRPC where the response is rendered client-side (not logged).
   - Default if Jeff defers: A.
2. **Dev console format.** Default = `pino-pretty` colorized. Confirm Jeff wants colorized (vs raw JSON in dev too).
3. **Log to stdout vs file.** Default = stdout (Fly captures); skip file rotation. Confirm.
4. **`pino-http` access-log verbosity.** Default = level=info, log every request. If too noisy on `/healthz` (Fly hits it every 30s), filter out via `customLogLevel: (req, res) => req.url === "/healthz" ? "silent" : "info"`. Default: do the silencing.
