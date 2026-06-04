# Worker / Web split — design

> Status: DESIGN (not yet implemented). Author handoff 2026-06-03.
> Decision: Jeff approved **Option B — split BullMQ workers to a separate Fly
> machine** (web machine stays small + responsive; worker machine runs the heavy
> jobs). Root cause it fixes: one `shared-cpu-2x / 1GB` machine runs web + ~15
> BullMQ workers + Puppeteer/Chromium + LLM agents, so any heavy job (or a
> runaway) starves the web server → customer-facing 503. Happened 3× on
> 2026-06-03 (enrichment concurrency, deploy cold-boot Chromium OOM, a runaway
> script).

## Goal

Two Fly **process groups** from the SAME image:
- `app` — Express + Vite SSR only. Serves customers + the admin. Enqueues jobs
  (BullMQ producers) but runs NO workers, NO Chromium. Small machine.
- `worker` — all BullMQ Workers (consumers) + the Puppeteer/Chromium pool + LLM
  agents. No HTTP. Bigger machine.

Both share the existing external Redis (Upstash) + DB (TiDB), so no data plumbing
changes. Producers (web) and consumers (worker) talk through Redis as today.

## Current coupling (what to change)

- `server/_core/index.ts:37` → `import "../worker";` starts `tourGenerationWorker`
  + `tourTranslationWorker` + (worker.ts also calls `initQuoteFollowUpWorker()`,
  `initAbandonmentRecoveryWorker()`).
- ~14 other workers are `new Worker(...)` at module top-level:
  `server/{competitorMonitor,bookingFollowup,gmailPoll,marketing,plaidSync,
  retrospective,supplierDetailEnrichment,scalingGuardrail,tourMonitor,
  tripReminder,trustRecognition}Worker.ts`. Find every place these get imported
  into the web process (grep `Worker"` imports + lazy `await import('../xWorker')`
  inside route handlers, e.g. `index.ts:987 await import('../tripReminderWorker')`).
- `server/queue.ts` holds the **producers** (`xQueue.add`, schedulers). These STAY
  reachable from web (web enqueues). Only the **Worker** (consumer) side moves.

## Implementation

1. **New worker entry** `server/_core/worker-entry.ts`:
   - `import "../worker"` + import every `*Worker.ts` module (so all consumers
     start) + any repeatable-job schedulers (`scheduleDailyTourMonitor`,
     `scheduleWeeklyRetrospective`, `scheduleDailyTripReminders`, gmail poll, plaid
     daily, trust recognition, scaling guardrail). Today some of these schedulers
     run from web startup / routes — move them here.
   - Connect Redis, log "worker process up", keep alive (the Workers hold the
     event loop; add a SIGTERM graceful drain like the web has).
   - NO Express, NO `app.listen`.
2. **Web entry** `server/_core/index.ts`:
   - REMOVE `import "../worker"`.
   - Remove/relocate any route-level `await import('../xWorker')` so the web
     process never instantiates a Worker. (Producers/`xQueue.add` stay.)
   - Guard with `assert(process.env.FLY_PROCESS_GROUP !== 'worker')` is optional;
     the fly `[processes]` command already separates them.
3. **Build** (`package.json`): add a 2nd esbuild entry → `dist/worker-entry.js`
   (same banner/format as `dist/index.js`).
4. **fly.toml**:
   ```toml
   [processes]
     app    = "node dist/index.js"
     worker = "node dist/worker-entry.js"

   [http_service]
     processes = ["app"]      # only web machines get HTTP + /healthz

   [[vm]]
     processes = ["app"]
     size   = "shared-cpu-1x"
     memory = "512mb"         # web is light without Chromium/workers

   [[vm]]
     processes = ["worker"]
     size   = "shared-cpu-2x"
     memory = "2gb"           # Chromium + LLM agent headroom
   ```
   - `release_command` (migrate) stays — runs once before either group.
5. **Deploy**: `flyctl deploy` provisions 1 app + 1 worker machine. (COSTS MONEY —
   needs Jeff's explicit go: ~$17/mo total est., verify on Fly.)

## Test / verify (before calling it done)

- `app` machine RSS drops (no Chromium/workers); `/healthz` + `/` 200.
- `worker` machine logs "worker up", drains a queued job (e.g. one tour rewrite).
- Trigger a heavy worker batch (e.g. 20 rewrites) and confirm `app` `/` stays
  fast (the isolation win).
- No worker double-runs (web must NOT also start them) — check a job is processed
  once (BullMQ concurrency unchanged on the worker side).
- Cron/repeatable jobs still fire (scheduled from worker-entry now).

## Rollback

Revert fly.toml `[processes]` + re-add `import "../worker"` to `index.ts` →
single `app` machine, exactly today's setup. Keep worker-entry.ts dormant.

## Risks / watch

- Schedulers that currently run from web startup must move to worker-entry, else
  repeatable jobs stop. Enumerate them carefully.
- Lazy `await import('../xWorker')` in any route would silently start a worker in
  web — grep them all out.
- Redis connection count doubles (2 processes) — Upstash free tier limit, check.
- Graceful shutdown: worker SIGTERM must drain in-flight jobs (mirror the web's
  existing SIGTERM handler) so a deploy doesn't kill a tour mid-generation.
