# v2 · Wave 1 · Module 1.3 — UptimeRobot + `/health` endpoint

**Parent plan:** docs/refactor/v2-plan.md (Wave 1)
**Audit ref:** v2-audit-2026-05-19.md §F "UptimeRobot / health monitoring" (lines 346-350) — "If packgo09.manus.space goes down, Jeff finds out from a customer complaint" + §F recommended work table (lines 366-367) — "UptimeRobot setup with 5-min ping, 1h, P0" + "Add /health endpoint that checks DB + Redis + Stripe + LLM accessibility, 3h, P1"
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4h AI + 30min Jeff (UptimeRobot account + alert email)

## Goal
Extend the existing `/healthz` shallow probe (line 200 of `server/_core/index.ts`) with a richer `/health` endpoint that pings DB + Redis + Stripe + LLM, return-coded so UptimeRobot can detect partial degradation (not just process-up). Register a free-tier UptimeRobot monitor hitting prod every 5 minutes with email alert to Jeff. After this module, Jeff learns about prod downtime within 5 minutes (Sentry alone misses "the entire box is silent" because no events fire from a dead process).

## Pre-requisites
- **Working tree clean.** Husky pre-commit tsc gate active.
- **Module 1.1 (Sentry) preferable but not required** — `/health` can capture failed dependency-pings to Sentry once Module 1.1 lands; if not, log to console for now (will pino-migrate post Module 1.2).
- No module dependencies otherwise; runs parallel with 1.1/1.2.

## Inputs (read these before executing)
- `server/_core/index.ts` lines 198-206 — existing `/healthz` shallow handler. Keep it (Fly's internal probe + UptimeRobot for backwards-compat use the same path? — confirm via `fly.toml`).
- `fly.toml` line 43 — `path = "/healthz"` is what Fly's `http_service.checks` uses. **DO NOT change this path** — moving it breaks Fly's deploy health-probe.
- `server/redis.ts` — Redis client surface. Confirm a `PING` helper exists or wire one.
- `server/_core/llm.ts` — LLM invoke surface. Confirm a low-cost ping (e.g., `models.list` or a cached "health" prompt that hits llm but doesn't burn budget).
- `server/db.ts` line 1 — verify there's an export usable for `SELECT 1` (typically `db.execute(sql\`SELECT 1\`)`).
- `server/routers.ts` — composition shell. Where does a new `system.health` public router get wired? Per CLAUDE.md §六, `server/_core/systemRouter.ts` exists and is the right home (already has `auditLog*` admin procs).
- `server/_core/systemRouter.ts` — read full file to understand current public/admin proc layout. **Module 1.3 adds a public `health` query.**

## Scope (what this module owns)
1. **New file: `server/_core/healthCheck.ts`** — exports `runHealthChecks(): Promise<{ overall: "ok" | "degraded" | "down", checks: { db, redis, stripe, llm } }>`. Each sub-check returns `{ status: "ok" | "fail", latencyMs: number, error?: string }`.
   - **DB:** `SELECT 1` via Drizzle execute; timeout 2s; PING-cached for 30s (don't hammer DB).
   - **Redis:** `redis.ping()`; timeout 1s.
   - **Stripe:** `stripe.balance.retrieve()`; **cache 5min** (per plan §1.3 line 76 — Stripe charges API requests).
   - **LLM:** `llm.models.list()` if SDK supports it; **cache 1h** (per plan, ~$0 cost but rate-limited).
2. **Modified: `server/_core/systemRouter.ts`** — add a public query:
   ```ts
   health: publicProcedure.query(async () => {
     return runHealthChecks();
   }),
   ```
   Available at `trpc.system.health.useQuery()`.
3. **Modified: `server/_core/index.ts`** — register an **Express route** `app.get("/health", ...)` (separate from `/healthz` which stays shallow) that:
   - Calls `runHealthChecks()`
   - Returns 200 if `overall === "ok"`
   - Returns 503 if any sub-check has `status === "fail"`
   - Body is the full check object (JSON)
   - Register **before** Stripe webhook raw-body parser (path matters; `/health` is JSON not raw).
4. **Optional cache layer:** in-process Map<string, { value, expiresAt }> for the Stripe + LLM ping responses. No Redis required for this cache (single-process Fly machine).
5. **Vitest:** assert 200 on happy; 503 when a dependency throws.
6. **CLAUDE.md update:** §六 add `server/_core/healthCheck.ts` row.
7. **No fly.toml change** — `/healthz` stays for Fly's probe, `/health` is for UptimeRobot.

## Procedure
1. **Read inputs.** Verify `server/redis.ts`, `server/_core/llm.ts`, `server/db.ts` for exact ping/select primitives.
2. **Create `server/_core/healthCheck.ts`** with `runHealthChecks()`:
   - Use `Promise.allSettled` so a single failing dependency doesn't kill the others.
   - Wrap each ping with a `Promise.race(ping, timeout)` pattern.
   - In-memory cache: top-of-module `const stripeCache: { value?: HealthCheckResult, expiresAt: number } = { expiresAt: 0 }; const llmCache: ...`.
3. **Create `server/_core/healthCheck.test.ts`:**
   - Mock the 4 dependency calls. Pass happy → assert `overall: "ok"`.
   - Mock Redis throw → assert `overall: "degraded"`, `checks.redis.status: "fail"`.
   - Mock all 4 throw → assert `overall: "down"`.
4. **Wire into `server/_core/systemRouter.ts`:** add `health: publicProcedure.query(...)`. Verify the router is composed into root in `server/routers.ts`.
5. **Wire Express route in `server/_core/index.ts`:**
   ```ts
   app.get("/health", async (_req, res) => {
     const result = await runHealthChecks();
     const code = result.overall === "ok" ? 200 : 503;
     res.status(code).json(result);
   });
   ```
   Insert after the `/healthz` handler (~line 207), before Stripe webhook.
6. **Run** `pnpm tsc --noEmit` + `pnpm test`.
7. **Update CLAUDE.md §六** file map.
8. **Document UptimeRobot config in a comment** at the top of `healthCheck.ts`:
   ```
   UptimeRobot monitor: 5-min HTTP keyword check on https://packgoplay.com/health
   alert email: <jeff supplies>
   keyword: "ok" (expect overall:"ok" in response body)
   ```

## Acceptance Criteria
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` all green (+ new Vitest from this module)
- [ ] **Per CLAUDE.md §九:** Vitest test exists at `server/_core/healthCheck.test.ts` with at least:
  1. Happy-path: all 4 dependencies return ok → response 200, `overall: "ok"`.
  2. Failure: Redis throws → response 503, `checks.redis.status: "fail"`, `overall: "degraded"`.
- [ ] `curl localhost:3000/health` returns 200 + JSON on dev box (manual smoke).
- [ ] `curl localhost:3000/healthz` STILL returns 200 + the shallow body (regression check; Fly's probe must keep working).
- [ ] Stripe cache: hitting `/health` twice within 5min doesn't make 2 Stripe API calls (mock confirms).
- [ ] LLM cache: 2 hits within 1h → 1 LLM call.
- [ ] CLAUDE.md §六 updated.
- [ ] **UptimeRobot:** Jeff registers an HTTP monitor; keyword-match `"ok"` in response. Confirm first ping shows green within 10 minutes of registration.

## Deliverable
- **New files:**
  - `server/_core/healthCheck.ts`
  - `server/_core/healthCheck.test.ts`
- **Modified files:**
  - `server/_core/index.ts` (`/health` route registered)
  - `server/_core/systemRouter.ts` (`health` public proc added)
  - `CLAUDE.md`
- **Expected commit message:**
  ```
  feat(observability): /health endpoint + UptimeRobot integration

  - new healthCheck.ts: pings DB+Redis+Stripe+LLM with per-check timeout
    + caching (Stripe 5min, LLM 1h) so high-frequency uptime polls don't
    cost money. Returns { overall, checks: {db,redis,stripe,llm} }
  - new /health Express route: 200 on all-ok, 503 on any-fail. /healthz
    (Fly's internal probe) untouched
  - new public tRPC system.health query: same payload, for admin
    dashboard tile in future modules
  - UptimeRobot monitor config documented inline (5-min HTTP keyword
    check; alert email to Jeff)

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.3
  ```

## Rollback
- Single `git revert <SHA>`. No data layer change.
- `/healthz` was untouched, so Fly's deploy probe is unaffected.

## Manual intervention
1. **Jeff creates UptimeRobot account** (~5min) at `https://uptimerobot.com` (free tier — 50 monitors, 5-min interval).
2. **Jeff creates one monitor:**
   - Type: HTTP(s) keyword
   - URL: `https://packgoplay.com/health`
   - Keyword: `ok`
   - Alert: email to Jeff
   - Interval: 5 minutes
3. **Post-deploy smoke (~2min):** Jeff visits `https://packgoplay.com/health` directly; sees JSON with all checks green.

## Test plan
- **`server/_core/healthCheck.test.ts`** (NEW):
  - Case 1 (happy): mock all 4 dependencies → assert response has `overall: "ok"`, 200.
  - Case 2 (Redis down): mock `redis.ping()` to reject → assert response has `overall: "degraded"`, `checks.redis.status: "fail"`, 503.
  - Case 3 (all down): mock all → reject → assert `overall: "down"`, 503.
  - Case 4 (Stripe cache): call `runHealthChecks()` twice within 5min, mock Stripe; assert Stripe called only once.
  - Case 5 (LLM cache): same pattern with 1h window.
- **`server/_core/index.test.ts` or equivalent route test:** if a test harness exists for the Express app, add a route test asserting `GET /health` returns 200 + JSON. Otherwise skip; Playwright in Wave 4 covers.

## Decisions needed (Jeff)
1. **UptimeRobot tier — free (5-min interval, 50 monitors) vs Pro ($7/mo, 1-min interval).** Default: free. 5-min detection is good enough for Jeff's <10K-customer scale.
2. **Stripe ping vs. skip Stripe in `/health`.** Each `balance.retrieve()` counts toward Stripe API rate budget; 5-min cache makes it ~288 calls/day (well under limits). Default: include.
3. **LLM ping cost.** OpenAI `models.list` is free; Anthropic equivalent may charge. If Anthropic's SDK doesn't expose a free list endpoint, skip LLM ping in `/health` and rely on Sentry instead. Default: try `models.list`; if it errors with cost, remove.
4. **Alert noise threshold.** UptimeRobot default = alert on first failure. False positives possible on transient network blips. Default: stick with UptimeRobot's default; if Jeff sees too many false alerts in week 1, reconfigure to "alert after 2 consecutive failures" (a paid feature — likely defer).
