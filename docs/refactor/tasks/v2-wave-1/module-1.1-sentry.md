# v2 · Wave 1 · Module 1.1 — Sentry + sourcemaps

**Parent plan:** docs/refactor/v2-plan.md (Wave 1)
**Audit ref:** v2-audit-2026-05-19.md §F "Sentry" (lines 338-345) + §F recommended work table (line 364) — "Sentry setup (free tier 5K events/mo) + wrap all routers/workers, 6h, P0"
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 6h AI + 30min Jeff (Sentry account + DSN provisioning)

## Goal
Install Sentry on both server (Node) and client (React), wire `Sentry.init()` in both entry points, wrap the tRPC root + every BullMQ worker for server-side capture, and add sourcemap upload via the Vite plugin. After this module lands, every uncaught server exception and every client error-boundary trip lands in Jeff's Sentry inbox with a deobfuscated stack. This is the foundational observability dependency every later Wave 2/3/4 module assumes when it says "Sentry already catches regressions in <2min."

## Pre-requisites
- Jeff creates Sentry account (`https://sentry.io/signup/`) — free tier (5K events/mo). Recommend reactive upgrade rather than starting on $26 Team — see DECISION below.
- Jeff provisions a project (Node + React) and supplies DSN value (different per project, or use the unified DSN if Sentry offers it).
- `SENTRY_DSN` (server) and `VITE_SENTRY_DSN` (client) added to `.env` (NEW file — `.env.example` does NOT exist in repo, so this module also creates `.env.example` if helpful).
- Working tree clean. Husky pre-commit tsc gate active (already in repo per v1 Phase 6).
- No module dependencies — Module 1.1 is the gate everything else builds on.

## Inputs (read these before executing)
- `server/_core/index.ts` lines 1-50 — server entry, where `Sentry.init()` must run **before** `express()` is invoked (Sentry's request handler/tracing middleware must wrap routes).
- `server/_core/index.ts` lines 200-220 — existing `/healthz` route. Sentry must NOT capture `/healthz` 200s as transactions (noise).
- `server/_core/index.ts` lines 207-220 — Stripe webhook raw-body handler. Verify Sentry's tracing middleware does not consume the body before the raw-body parser runs.
- `client/src/main.tsx` (full 71 LOC) — client entry. `Sentry.init()` runs before `createRoot(...).render(...)`. The existing `queryClient.getQueryCache().subscribe(...)` error-logging block (lines 26-40) currently uses `console.error`; keep it (Module 1.2 replaces with pino-equivalent for server, but client keeps `console.error` PLUS a `Sentry.captureException(error)` call.
- `package.json` lines 1-80 — confirm `vite` version, `@trpc/server` version. Vite plugin must be compatible with current Vite (likely 5.x).
- `server/worker.ts` (import target at `server/_core/index.ts:22` — `import "../worker"`) — every BullMQ worker registered here must be wrapped so unhandled errors flow to Sentry.
- `server/agents/autonomous/*.ts` — agents catch and call `notifyOwner` on errors today; verify Sentry also captures those (don't double-notify, but don't lose data either).
- Audit ref `v2-audit-2026-05-19.md` lines 338-368 (full §F Observability section).

## Scope (what this module owns)
1. **Dependencies (package.json):**
   - `@sentry/node` (latest 8.x — supports OpenTelemetry, Hub-free API)
   - `@sentry/react`
   - `@sentry/vite-plugin` (sourcemap upload at build time)
   - No `@sentry/profiling-node` (free tier doesn't include profiling — skip).
2. **New file: `server/_core/sentry.ts`** — exports `initSentry()` (idempotent), `captureException(err, ctx?)`, `captureMessage(msg, level?)`. Pulls `SENTRY_DSN`, `NODE_ENV`, `FLY_MACHINE_VERSION || GIT_COMMIT` (matches existing pattern in `index.ts:204`) for release tagging.
3. **Modified: `server/_core/index.ts`** — call `initSentry()` at line ~44 (immediately after `dotenv/config` import side-effect, before `express()` instantiation). Wrap the Express app with Sentry's `requestHandler` / `tracingHandler` for HTTP context; Sentry's `errorHandler` registered LAST in the middleware chain so it captures anything that bubbles through.
4. **Modified: `server/worker.ts`** — wrap each BullMQ worker callback in `Sentry.withScope` so exceptions in cron/queue contexts get user-less but identifiable traces (tag = `worker:<jobName>`).
5. **Modified: `server/_core/notification.ts`** (`notifyOwner` callers across agents) — add `Sentry.captureException` alongside the email notification so the trail is in both places. **Do NOT remove `notifyOwner` calls** — email + Sentry is a belt-and-suspenders design Jeff wants per CLAUDE.md §核心原則.
6. **Modified: `client/src/main.tsx`** — `Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()], tracesSampleRate: 0.1 })` before `createRoot`. Add `Sentry.captureException(error)` inside the two `queryCache`/`mutationCache` error subscribers (lines 27-40).
7. **New file: `client/src/_core/SentryBoundary.tsx`** — wraps `<App />` (or, if more idiomatic, the inside of `<HelmetProvider>` in `main.tsx`) with `Sentry.ErrorBoundary` fallback. Fallback UI = the existing `LoadingPage` component with an "Something went wrong" message — keep i18n: add `t('errorBoundary.fallback')` in both `client/src/i18n/zh-TW.ts` and `client/src/i18n/en.ts`.
8. **Modified: `vite.config.ts`** — add `sentryVitePlugin({ org: '<jeff supplies>', project: '<jeff supplies>', authToken: env.SENTRY_AUTH_TOKEN })` so production builds upload sourcemaps. Only enabled when `SENTRY_AUTH_TOKEN` is present; dev builds skip.
9. **New file: `.env.example`** (does NOT exist in repo — this module creates it). Document `SENTRY_DSN`, `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. NO REAL VALUES — placeholder text.
10. **CLAUDE.md update:** add Sentry to §六 "關鍵檔案路徑" table (entry: `server/_core/sentry.ts`).

## Procedure
1. **Read all input files** listed above. Confirm `server/_core/index.ts:44-49` is the right Sentry-init insertion point (immediately after compression middleware, before any routes register).
2. `pnpm add @sentry/node @sentry/react @sentry/vite-plugin` (these go into `dependencies` for the runtime parts; `@sentry/vite-plugin` may belong in `devDependencies` — verify per its README).
3. **Create `server/_core/sentry.ts`** with `initSentry()` idempotent guard (a module-level boolean flag — calling twice is a no-op so tests don't double-register). Use `sampleRate: 1.0` for errors, `tracesSampleRate: 0.1` (10% transactions to stay within free-tier budget for an 800-monthly-user site).
4. **Modify `server/_core/index.ts`:**
   - Line ~22 (top imports): add `import { initSentry } from "./sentry";`
   - Line ~44 (just before `const app = express();`): `initSentry();`
   - Line ~50: `app.use(Sentry.Handlers.requestHandler())` (or new v8 API equivalent — verify v8 syntax)
   - Line ~50: `app.use(Sentry.Handlers.tracingHandler())`
   - **AFTER** all route registrations (find the last `app.use` / `app.post` before `server.listen`): `app.use(Sentry.Handlers.errorHandler())`
5. **Modify `server/worker.ts`:**
   - Wrap each `new Worker(jobName, async (job) => { ... })` so the async handler is `Sentry.wrapHandler(...)`. If `Sentry.wrapHandler` doesn't fit BullMQ's signature, use manual `try { await fn(); } catch (err) { Sentry.captureException(err, { tags: { jobName: job.name } }); throw err; }`.
6. **Modify `server/_core/notification.ts`:** inside `notifyOwner()`, add `Sentry.captureMessage(content.title, "warning")` (or `captureException` if `content.content` includes a stack). Don't break the existing email-send path.
7. **Modify `client/src/main.tsx`:**
   - Top of file: `import * as Sentry from "@sentry/react";`
   - After line 12 (after HelmetProvider import): `Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE, release: import.meta.env.VITE_GIT_COMMIT, integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true })], tracesSampleRate: 0.1, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 1.0 })`. (PII masking on by default — replay only on error.)
   - Lines 30, 38: append `Sentry.captureException(error)` inside both error-subscribers.
8. **Create `client/src/_core/SentryBoundary.tsx`** with `Sentry.ErrorBoundary` wrapper.
9. **Modify `vite.config.ts`:** import `sentryVitePlugin`; add to `plugins` array conditionally (`if (process.env.SENTRY_AUTH_TOKEN) plugins.push(sentryVitePlugin({ ... }))`).
10. **Create `.env.example`** with documented env vars.
11. **Update `CLAUDE.md` §六** — add the new file path row.
12. **Write Vitest** (see Test plan below).
13. Run `NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit` — must exit 0.
14. Run `pnpm test` — new test passes; no existing test regresses.
15. Run `pnpm build` — must succeed. Sourcemap upload skipped (no `SENTRY_AUTH_TOKEN` in dev), but build must not break.

## Acceptance Criteria
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm build` succeeds (with and without `SENTRY_AUTH_TOKEN` set)
- [ ] `pnpm test` all green
- [ ] **Per CLAUDE.md §九:** new Vitest test exists at `server/_core/sentry.test.ts` that asserts `Sentry.captureException` fires when a tRPC handler throws (mocked transport — use `vi.mock("@sentry/node")` returning a spy). Required.
- [ ] `initSentry()` is idempotent — calling twice does not double-register handlers (Vitest case 2).
- [ ] `notifyOwner` still works in tests (existing test in `server/_core/notification.test.ts` if any — otherwise add a regression anchor).
- [ ] `@sentry/node`, `@sentry/react`, `@sentry/vite-plugin` are in `package.json` `dependencies`/`devDependencies` as appropriate.
- [ ] `.env.example` documents the 5 new env vars.
- [ ] CLAUDE.md §六 table updated.
- [ ] Manual smoke (Jeff post-deploy): throw a test error in dev via `?debug=throw-sentry-test` URL param → see it in Sentry dashboard within 60s.

## Deliverable
- **New files:**
  - `server/_core/sentry.ts`
  - `server/_core/sentry.test.ts`
  - `client/src/_core/SentryBoundary.tsx`
  - `.env.example`
- **Modified files:**
  - `package.json`
  - `pnpm-lock.yaml`
  - `server/_core/index.ts`
  - `server/worker.ts`
  - `server/_core/notification.ts`
  - `client/src/main.tsx`
  - `vite.config.ts`
  - `client/src/i18n/zh-TW.ts`
  - `client/src/i18n/en.ts`
  - `CLAUDE.md`
- **Expected commit message:**
  ```
  feat(observability): wire Sentry on server + client + sourcemap upload

  - server: initSentry() in _core/index.ts before express(); requestHandler
    + tracingHandler wrap routes; errorHandler registered last; BullMQ
    workers wrapped with try/captureException; notifyOwner ALSO captures
    to Sentry (belt-and-suspenders)
  - client: Sentry.init in main.tsx before createRoot; ErrorBoundary
    wraps app; PII-masked Session Replay on error only (no replay on
    happy-path sessions per cost discipline)
  - vite: sentryVitePlugin uploads sourcemaps in prod builds (gated on
    SENTRY_AUTH_TOKEN env var; dev builds untouched)
  - .env.example created (was absent); 5 new vars documented

  Free-tier sized: 5K events/mo, 10% trace sampling, 0% session replay
  sampling (only on error). Reactive upgrade to Team tier deferred.

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.1
  ```

## Rollback
- Single `git revert <SHA>`. No data-layer changes; pure middleware addition.
- If Sentry's middleware breaks Express routing in an unexpected way, the revert leaves the system exactly as it was pre-Sentry. No migration to undo.
- DSN env vars: leave in `.env`/Fly secrets — harmless when no init call references them.

## Manual intervention
1. **Jeff creates Sentry account** (~10min) — `https://sentry.io/signup/`, free tier.
2. **Jeff provisions one project** (Node + React unified, or two separate — Sentry asks). Supplies:
   - `SENTRY_DSN` (server)
   - `VITE_SENTRY_DSN` (client; may be identical to server DSN — same project)
   - `SENTRY_AUTH_TOKEN` (for sourcemap upload; from User Settings → Auth Tokens, scope `project:write`)
   - `SENTRY_ORG` (slug, e.g., `packgo`)
   - `SENTRY_PROJECT` (slug, e.g., `packgo-web`)
3. **Jeff adds these 5 to Fly secrets** (`fly secrets set ...`).
4. **Post-deploy verification (~5min):** Jeff visits staging with `?debug=throw-sentry-test` URL param (the agent adds this debug hook OR uses an existing admin button); confirms the error lands in Sentry dashboard.

## Test plan
- **`server/_core/sentry.test.ts` (NEW):**
  - Case 1 (happy): `vi.mock("@sentry/node")` — call `initSentry()` once; assert `Sentry.init` called with expected DSN/env/release args.
  - Case 2 (idempotency): call `initSentry()` twice; assert `Sentry.init` called exactly once.
  - Case 3 (capture from handler exception): mock the tRPC error path. Simulate a procedure throwing → assert `Sentry.captureException` called with the error.
- **`server/_core/notification.test.ts` (extend or create):**
  - Existing notifyOwner test still passes (regression anchor).
  - New case: `notifyOwner` also calls `Sentry.captureMessage` (mocked).
- **Client tests:** Skip (client error boundary is hard to test in Vitest; Playwright in Wave 4 Module 4.16 covers).
- **Build smoke (manual or CI):** `pnpm build` produces sourcemaps in `dist/public/assets/*.map`; verify with `ls dist/public/assets/*.map | wc -l > 0`.

## Decisions needed (Jeff)
1. **Sentry tier — free 5K vs $26/mo Team.** Plan §Stage-3-entry-decisions defaults free. Confirm.
2. **Replay sampling — keep at 0%/100%-on-error?** Default per plan: yes (cost discipline; replay on errors is huge debugging value).
3. **PII masking in Session Replay** — `maskAllText: true` is the default; if Jeff wants to allow opt-in for specific debug sessions, that's a v3 customization. Confirm v2 stays maxed-mask.
4. **Sourcemap upload — gate on `SENTRY_AUTH_TOKEN` (current plan) or always-on with hardcoded org/project?** Default: gate; otherwise CI without the token fails build.
