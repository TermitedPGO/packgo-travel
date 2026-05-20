# v2 · Wave 1 · Module 1.4 — PostHog + 5 key events

**Parent plan:** docs/refactor/v2-plan.md (Wave 1)
**Audit ref:** v2-audit-2026-05-19.md §J "Conversion blind spots" (lines 595-598) — "No funnel analytics (PostHog / Mixpanel / Google Analytics 4) — grep 'posthog|mixpanel|gtag' client/src → 0 matches" + §J recommended work (line 605) "Add PostHog + 5 key events, 4h, P0"
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 4h AI + 30min Jeff (PostHog account + project key)

## Goal
Install `posthog-js`, wire `posthog.capture(...)` for 5 conversion-funnel events (`tour_view`, `search`, `booking_start`, `booking_step`, `booking_complete`), and gate it behind `import.meta.env.VITE_POSTHOG_KEY` so dev sessions don't pollute prod data. After this module, Jeff can answer "% of users who reached booking step 3 then dropped" — currently impossible (audit §J line 596-598).

## Pre-requisites
- **Module 1.1 (Sentry) preferable** — PostHog and Sentry overlap (both want browserTracingIntegration). Verify they coexist in `main.tsx` without conflict; if both are present, PostHog goes second.
- Working tree clean.
- Jeff creates PostHog Cloud account, picks region (DECISION 1).

## Inputs (read these before executing)
- `client/src/main.tsx` (71 LOC) — where Sentry.init lands (Module 1.1) and PostHog.init lands here too.
- `client/src/pages/TourDetailPeony.tsx` — where `tour_view` fires (on mount).
- `client/src/pages/SearchResults.tsx` — where `search` fires (on form submit with query).
- `client/src/pages/BookTour.tsx` — where `booking_start`, `booking_step`, `booking_complete` fire. **Read this file's structure to understand booking step state machine** before instrumenting (multi-step form; track step name in `booking_step` event param).
- `client/src/_core/hooks/useAuth.ts` — for `posthog.identify(userId)` after login, `posthog.reset()` after logout.
- Audit ref `v2-audit-2026-05-19.md` lines 595-614 (full §J).

## Scope (what this module owns)
1. **Dependencies (package.json):**
   - `posthog-js` (latest)
2. **New file: `client/src/_core/analytics.ts`** — wrapper:
   - `initAnalytics()` — idempotent; called once in `main.tsx`.
   - `track(event, properties?)` — type-safe wrapper. Event name is a union type so typos are caught at tsc time.
   - `identify(userId, traits?)` — alias previously-anonymous user.
   - `reset()` — clear on logout.
   - **Strip query params from `$current_url` capture** to avoid PII in URLs (e.g., `?email=foo`).
   - **No capture when `VITE_POSTHOG_KEY` absent** (dev / test envs stay clean).
3. **Event union type** in `client/src/_core/analytics.ts`:
   ```ts
   type AnalyticsEvent =
     | { event: "tour_view"; properties: { tourId: string; tourSlug: string; tourTitle: string; sourceList?: "search" | "country" | "region" | "home" } }
     | { event: "search"; properties: { query: string; filtersJson?: string; resultCount: number } }
     | { event: "booking_start"; properties: { tourId: string; tourPrice: number } }
     | { event: "booking_step"; properties: { tourId: string; stepName: "date" | "travelers" | "details" | "confirm"; stepIndex: number } }
     | { event: "booking_complete"; properties: { tourId: string; bookingId: number; totalAmount: number; participantCount: number } };
   ```
4. **Modified: `client/src/main.tsx`** — call `initAnalytics()` after `Sentry.init()` (or independently if 1.1 not landed).
5. **Modified: `client/src/_core/hooks/useAuth.ts`** — on successful login `identify(user.id, { email, role })`; on logout `reset()`.
6. **Instrumentation sites (5):**
   - `client/src/pages/TourDetailPeony.tsx` — `useEffect(() => track("tour_view", {...}), [tourId])` on mount.
   - `client/src/pages/SearchResults.tsx` — `track("search", {...})` on results-fetched effect.
   - `client/src/pages/BookTour.tsx` — `track("booking_start", {...})` on first render; `track("booking_step", {...})` on step transitions; `track("booking_complete", {...})` in the final mutation success handler.
7. **`.env.example`** — add `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` (default `https://us.i.posthog.com`).
8. **CLAUDE.md §六** — add `client/src/_core/analytics.ts` row.
9. **Vitest:** wrapper does not capture when key missing; captures with correct shape when present.

## Procedure
1. **Read inputs** in order. Especially `BookTour.tsx` — booking step state machine determines where `booking_step` fires. Confirm step names.
2. `pnpm add posthog-js`
3. **Create `client/src/_core/analytics.ts`** with the wrapper + event union. Use `posthog.init(key, { api_host, capture_pageview: false, capture_pageleave: false, autocapture: false, person_profiles: 'identified_only' })` — manual capture only (no autocapture noise), no anonymous person profiles (saves PostHog quota and PII).
4. **Strip PII from URLs:** override `sanitize_properties` PostHog config to remove `email`, `phone`, `token` query params.
5. **Modify `main.tsx`** — call `initAnalytics()` after Sentry init.
6. **Modify `useAuth.ts`** — call `identify()` on login success, `reset()` on logout.
7. **Instrument the 5 events** site-by-site. For `booking_step`, pull the step name from existing state (don't add new state).
8. **Update `.env.example`** with the 2 new vars.
9. **Update `CLAUDE.md` §六** with the new file row.
10. **Write Vitest** (see Test plan).
11. **Verify:**
    - `pnpm tsc --noEmit` exit 0 — the union type catches typos.
    - `pnpm build` — bundle size delta < 50KB (posthog-js is ~30KB gzipped).
    - Manual: in dev (no `VITE_POSTHOG_KEY`), `track("tour_view", {...})` is a no-op (no network call).

## Acceptance Criteria
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` all green (+ new Vitest from this module)
- [ ] `pnpm build` succeeds; bundle delta < 50KB.
- [ ] **Per CLAUDE.md §九:** Vitest at `client/src/_core/analytics.test.ts` with:
  1. `track()` is no-op when `VITE_POSTHOG_KEY` env unset (mock PostHog → assert capture not called).
  2. `track()` invokes `posthog.capture` with correct event+properties when key present.
  3. `track("tour_view", { tourId, ...invalid })` — TS error at compile time. **Validated by tsc, not runtime test.**
- [ ] 5 events fire (manual smoke on staging once Jeff has access):
  - Open a tour detail page → `tour_view` appears in PostHog inspector.
  - Run a search → `search` appears.
  - Start booking → `booking_start`.
  - Each booking step transition → `booking_step` with `stepName`.
  - Complete booking → `booking_complete`.
- [ ] No query-string PII captured (verify in inspector: `$current_url` has no `?email=...`).
- [ ] CLAUDE.md §六 updated.

## Deliverable
- **New files:**
  - `client/src/_core/analytics.ts`
  - `client/src/_core/analytics.test.ts`
- **Modified files:**
  - `package.json`, `pnpm-lock.yaml`
  - `client/src/main.tsx`
  - `client/src/_core/hooks/useAuth.ts`
  - `client/src/pages/TourDetailPeony.tsx`
  - `client/src/pages/SearchResults.tsx`
  - `client/src/pages/BookTour.tsx`
  - `.env.example`
  - `CLAUDE.md`
- **Expected commit message:**
  ```
  feat(analytics): PostHog + 5 conversion-funnel events

  - posthog-js wired in client/src/_core/analytics.ts with type-safe
    track() helper (event-name union catches typos at tsc)
  - 5 events instrumented:
      tour_view       (TourDetailPeony mount)
      search          (SearchResults fetch effect)
      booking_start   (BookTour first render)
      booking_step    (BookTour step transitions, stepName param)
      booking_complete (BookTour success handler)
  - identify() on login, reset() on logout (useAuth)
  - dev safety: no capture without VITE_POSTHOG_KEY; PII-stripping in
    URLs; autocapture disabled (only explicit events). Free tier sized:
    ~5 events × 800 users/mo × 10 sessions = ~40K events/mo, well
    under 1M-events/mo free tier
  - .env.example documents new vars

  Refs: docs/refactor/v2-plan.md Wave 1 · Module 1.4
  ```

## Rollback
- Single `git revert <SHA>`. No data layer.
- PostHog account itself can stay; no data dependencies.

## Manual intervention
1. **Jeff creates PostHog account** (~5min) at `https://posthog.com/signup`. Region: **US Cloud** (default per plan — lowest latency from Fly IAD).
2. **Jeff provisions one project**, supplies:
   - `VITE_POSTHOG_KEY` — public project API key
   - `VITE_POSTHOG_HOST` — `https://us.i.posthog.com` (or EU equivalent)
3. **Jeff adds these to Fly secrets / `.env` prod.**
4. **Post-deploy smoke** — Jeff opens prod, runs a search, opens a tour, starts a booking. Confirms 4 events appear in PostHog dashboard within 60s.

## Test plan
- **`client/src/_core/analytics.test.ts`** (NEW):
  - Case 1 (env-absent): `import.meta.env.VITE_POSTHOG_KEY = undefined`; `initAnalytics()` no-op; `track()` no-op (mock `posthog.capture` → assert not called).
  - Case 2 (env-present): mock env present; `initAnalytics()` calls `posthog.init`.
  - Case 3 (capture shape): `track("tour_view", { tourId: "x", tourSlug: "y", tourTitle: "z" })` → assert `posthog.capture` called with `"tour_view"` + props.
  - Case 4 (PII strip): URL `https://x/?email=foo` → assert sanitize_properties strips it (mock + spy).
  - Case 5 (logout reset): `reset()` → assert `posthog.reset` called.

## Decisions needed (Jeff)
1. **PostHog region — US (default) vs EU.** Plan defaults US (lowest latency from Fly IAD). Confirm.
2. **Tier — free 1M events/mo.** Default: free. Estimated usage <50K events/mo, well under cap.
3. **Person profile mode — `identified_only` (default per plan) vs `always`.** `identified_only` saves quota by not creating profiles for anonymous visitors. Default: `identified_only`.
4. **Session recording — enable or skip.** Default: SKIP (PostHog Session Recording overlaps with Sentry Session Replay from Module 1.1; redundant + costs quota). Confirm.
5. **Booking step names exact wording.** Default: `date | travelers | details | confirm`. Confirm matches `BookTour.tsx` actual state.
