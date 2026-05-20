# v2 · Wave 4 · Module 4.24 — pino full sweep (~1,325 remaining `console.*` → structured logger)

**Parent plan:** docs/refactor/v2-plan.md (Wave 4 · Polish — deferred half of Wave 1 Module 1.2)
**Audit ref:** v2-audit-2026-05-19.md §F lines 332-334 (1,445 raw `console.*` in server/, of which Wave 1 cleared ~120 in `_core/` + autonomous agents)
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 8 h AI + 30 min Jeff review (spot-check a few logs in prod)
**Deploy window:** any weekday morning — wide touch but isolated change

## Goal

Finish what Wave 1 Module 1.2 started. Replace the remaining ~1,325 `console.log/error/warn` calls across `server/` with the pino structured logger from `server/_core/logger.ts`. Apply PII redaction. After this module, structured JSON logs are universal server-side and Jeff can grep prod by structured fields rather than text.

## Pre-requisites

- **Wave 1 Module 1.2 merged** — pino logger exists at `server/_core/logger.ts`.
- All previous Wave 4 modules merged — they may add small numbers of console calls that this module cleans up.

## Inputs (read these before executing)

- `server/_core/logger.ts` (Wave 1 Module 1.2) — pino instance + PII redaction.
- Current console-call inventory:
  ```bash
  grep -rn 'console\.\(log\|error\|warn\|info\|debug\)' server/ --include="*.ts" | grep -v "test.ts" | wc -l
  ```
- Audit §F line 333: ~1,325 expected.

## Scope (what this module owns)

- ✅ All `console.*` calls in `server/` (non-test) replaced with `logger.{info, warn, error}`.
- ✅ PII-bearing log lines audited and redacted via Wave 1's logger.
- ✅ ESLint rule added to block `console.*` in `server/` (test files excepted).
- ❌ NOT in scope: client-side `console.*` (allowed for now; Sentry catches client errors); test files; comments referencing console.

## Procedure

1. **Inventory:**
   ```bash
   grep -rn 'console\.' server/ --include="*.ts" | grep -v "test.ts" | grep -v "//.*console" > /tmp/console-calls.txt
   wc -l /tmp/console-calls.txt
   ```

2. **Categorize by call type:**
   - `console.log` → `logger.info({ ... }, 'message')`
   - `console.warn` → `logger.warn({ ... }, 'message')`
   - `console.error` → `logger.error({ err, ...context }, 'message')`
   - `console.debug` → `logger.debug({ ... }, 'message')`

3. **Per-file workflow:**
   - Read file.
   - Replace each call. Convert string-only logs to structured form:
     - **Before:** `console.log('Worker started for queue', queueName)`
     - **After:** `logger.info({ queueName }, 'worker started for queue')`
   - Identify PII risk (email, phone, token, passport in log message). For these, ensure redaction via logger's auto-redact (Wave 1 Module 1.2 has REDACT_KEYS) — OR remove the PII from the log entirely.
   - Save.

4. **High-traffic files first:**
   - `server/_core/index.ts` (server bootstrap)
   - `server/workers/*.ts` (cron / queue workers)
   - `server/agents/*.ts` (non-autonomous agents not covered by Wave 1)
   - `server/services/*.ts` (~1,000 of the ~1,325 likely here)

5. **Add ESLint rule** in `.eslintrc.cjs` or `eslint.config.js`:
   ```js
   {
     rules: {
       'no-console': ['error', { allow: [] }],
     },
     overrides: [
       { files: ['**/*.test.ts'], rules: { 'no-console': 'off' } },
       { files: ['scripts/**'], rules: { 'no-console': 'off' } },
     ],
   }
   ```
   This catches future regressions.

6. **Verify count drops:**
   ```bash
   grep -rn 'console\.' server/ --include="*.ts" | grep -v "test.ts" | wc -l
   ```
   Target: ≤20 (residual = legit non-production code paths, e.g., dev-only logging).

7. **Smoke test on staging:**
   - Deploy.
   - `fly logs -a packgo-staging` — see JSON-structured log entries instead of plain strings.
   - Verify a known PII field (e.g., user email in booking confirmation log) is redacted: `"email":"[REDACTED]"`.

## Acceptance Criteria

- [ ] `grep -rn 'console\.' server/ --include="*.ts" | grep -v "test.ts" | wc -l` ≤20.
- [ ] ESLint rule `no-console` active in server/.
- [ ] All replaced calls use structured form `logger.X({...context}, 'message')`.
- [ ] PII redaction confirmed on at least 3 known-PII log lines (booking, inquiry email, refund).
- [ ] `pnpm tsc --noEmit` exit 0.
- [ ] `pnpm test` green.
- [ ] `pnpm build` succeeds.
- [ ] Manual: `fly logs -a packgo-staging` shows JSON-formatted entries.

## Deliverable

- Modified: ~50-100 server files with `console.*` → `logger.X(...)`.
- Modified: `.eslintrc.cjs` (or equivalent) — `no-console` rule.

**Commit message:**

```
refactor(logging): Wave 4 module 4.24 — pino full sweep (1,325 → <20)

- console.{log,error,warn,info,debug} → logger.{info,warn,error,debug}
- Structured logs: { context }, 'message' form
- PII redaction via Wave 1 logger REDACT_KEYS (auto-applied)
- ESLint no-console rule in server/ (test/scripts excepted)

Audit §F impact: structured prod logs enable field-based alerting +
JSON ingestion (Better Stack or similar).

Refs: docs/refactor/v2-plan.md Wave 4 Module 4.24, audit §F lines 332-334
```

## Rollback

- Single revert restores console calls. Logger keeps working alongside (no removal).

## Manual intervention

- **Jeff (~10 min):** `fly logs -a packgo-staging --json | head -50` — verify structured JSON output.
- **Jeff (~5 min):** trigger an action that previously logged a PII-bearing line → verify field redacted.

## Test plan

**No new Vitest** — refactor, no behavioral change. Wave 1 Module 1.2 logger tests + redaction tests still cover.

**Regression anchor:** `pnpm test` count unchanged.

**Manual smoke:** `fly logs` inspection on staging.

## Decisions needed (Jeff)

1. **`console.debug` retention** — sometimes useful for dev-only output. Recommend: ESLint rule allows `console.debug` in dev mode; production drops it. Lock.
2. **Better Stack / Axiom upgrade** — audit §F line 369 P2 mentions $24/mo log aggregation. Defer to v3 unless Jeff sees fly logs is unworkable.
3. **Client console.* sweep** — out of scope for v2 (client errors covered by Sentry). Recommend file v3 task to clean up client console too.
