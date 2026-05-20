# v2 · Wave 2 · Module 2.13 — Extract `getRouteMap` 760-LOC procedure from `toursRouteMap.ts`

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.7)
**Audit ref:** v2-audit-2026-05-19.md §C lines 154-155, 212 (toursRouteMap split); v2-plan.md lines 224-229
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (parallelize-safe after Module 2.7)
**Est. effort:** 6-8 h AI + 15 min Jeff review
**Risk tier:** MEDIUM — every tour detail page calls `getRouteMap`. Wrong refactor = no route map renders.
**Deploy window:** any morning.

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.7 (db.ts split). Parallelize-safe with 2.8, 2.9, 2.10, 2.11, 2.12.

## Goal

Extract the 760-LOC `getRouteMap` procedure (sole reason `server/routers/toursRouteMap.ts` is 831 LOC — v1 Phase 4A documented this as an exception) into `server/services/routeMap/` with 3 modules: builder, renderer, fallbacks. Router becomes a thin caller. External tRPC path `trpc.tours.getRouteMap` unchanged.

## Pre-requisites

- Module 2.7 committed
- `server/routers/toursRouteMap.ts` exists at 831 LOC (v1 Phase 4A extraction)
- Working tree clean
- `pnpm tsc --noEmit` exit 0

## Inputs (read these before executing)

1. **`server/routers/toursRouteMap.ts`** — 831 LOC. Two procedures: `regenerateAiMap` (small) + `getRouteMap` (760 LOC, the target).
2. **v2-audit §C lines 154-155, 212** — documents the 760-LOC procedure exception.
3. **`client/src/components/tour-detail/TourRouteMapSvg.tsx`** — the customer-facing consumer of `getRouteMap`. Confirms expected output shape.
4. **`server/db/search.ts`** (post-Module-2.6) — `getCachedRouteMap` helper if exists; otherwise the cache is currently inline in `toursRouteMap.ts`.

## Scope (what this module owns)

### Procedure decomposition

The 760-LOC `getRouteMap` procedure does:
1. **Validation** — input zod check, tour lookup
2. **Cache check** — DB `routeMapCache` table read
3. **Coordinate fetch** — destinations + waypoints → lat/lng tuples (multi-fallback: tour data → AI inference → geocoding API)
4. **SVG build** — generate base SVG with map projection
5. **AI base-map overlay** — call gpt-image-2 if cache miss
6. **Marker rendering** — add city pins, route lines, day labels
7. **Cache write** — store final SVG in DB
8. **Return** — serialized SVG string + metadata

Decomposition into 3 service files:

```
server/services/routeMap/
├── builder.ts     ≤300 LOC  — Input validation + tour lookup + coordinate resolution
├── renderer.ts    ≤350 LOC  — SVG generation + AI overlay + marker rendering
└── fallbacks.ts   ≤200 LOC  — Coordinate fallback chain + cache I/O + error recovery
```

### Router post-extraction

```ts
// server/routers/toursRouteMap.ts (post-split)
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { buildRouteMap } from "../services/routeMap/builder";
import { regenerateAiMapImpl } from "../services/routeMap/renderer"; // if applicable

export const toursRouteMapRouter = router({
  getRouteMap: publicProcedure
    .input(z.object({ tourId: z.number() }))
    .query(async ({ input }) => {
      return await buildRouteMap(input.tourId);
    }),

  regenerateAiMap: adminProcedure
    .input(z.object({ tourId: z.number() }))
    .mutation(async ({ input }) => {
      return await regenerateAiMapImpl(input.tourId);
    }),
});
```

Target: `toursRouteMap.ts` ≤80 LOC (composition shell).

### Builder contract

```ts
// server/services/routeMap/builder.ts
import { getTourById } from "../../db"; // post Module 2.2
import { getCachedRouteMap, setCachedRouteMap } from "./fallbacks";
import { renderRouteMapSvg } from "./renderer";

export async function buildRouteMap(tourId: number): Promise<RouteMapResult> {
  const cached = await getCachedRouteMap(tourId);
  if (cached) return cached;

  const tour = await getTourById(tourId);
  if (!tour) throw new TRPCError({ code: "NOT_FOUND" });

  const coords = await resolveCoordinates(tour);
  const svg = await renderRouteMapSvg(tour, coords);

  await setCachedRouteMap(tourId, svg);
  return { svg, cached: false };
}
```

### Out of scope

- Replacing the SVG generation algorithm
- Changing AI base-map provider (gpt-image-2 stays)
- Adjusting cache TTL
- Adding new route-map features

## Procedure

### Step 1 — Pre-extraction inventory

```bash
cd /Users/jeff/Desktop/網站
wc -l server/routers/toursRouteMap.ts
grep -nE "^\s+(getRouteMap|regenerateAiMap):" server/routers/toursRouteMap.ts
```

### Step 2 — Identify natural seams inside `getRouteMap`

Read the 760-LOC procedure body. Look for these markers:

- Cache read block (early return)
- Validation block (zod throws)
- Coordinate resolution (likely has internal `try/catch` for fallback chain)
- SVG construction (template-literal heavy block)
- AI overlay call (`invokeLLM` or gpt-image-2 call)
- Marker render (loops over departures/cities)
- Cache write

Build a paragraph-level mental map. Annotate the source file with sub-agent comments (`// === STEP X ===`) WITHOUT changing logic, run `pnpm tsc --noEmit` to confirm zero behavior change.

### Step 3 — Create `routeMap/fallbacks.ts`

The simplest of the 3. Extract:
- `getCachedRouteMap(tourId)`
- `setCachedRouteMap(tourId, svg)`
- `resolveCoordinatesFallbackChain(tour)` — try-tour-data → try-AI-inference → try-geocoding
- Error mapping (geocoding API down → return null + log)

### Step 4 — Create `routeMap/renderer.ts`

Extract the SVG-render block:
- `renderRouteMapSvg(tour, coords)` — orchestrator
- `buildBaseMap(coords)` — base SVG with projection
- `overlayAiBaseMap(svg, prompt)` — gpt-image-2 call (if enabled)
- `addMarkers(svg, cities, days)` — pins + lines + labels
- `regenerateAiMapImpl(tourId)` — admin-triggered regen

### Step 5 — Create `routeMap/builder.ts`

The orchestrator:
- `buildRouteMap(tourId)` — uses builder + renderer + fallbacks
- Input validation (zod schema can live here OR in the router)

### Step 6 — Rewrite router

`server/routers/toursRouteMap.ts` becomes ≤80 LOC.

### Step 7 — Add Vitest

```ts
// server/services/routeMap/builder.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../db", () => ({
  getTourById: vi.fn().mockResolvedValue({ id: 1, destination: "Japan", departures: [] }),
}));
vi.mock("./fallbacks", () => ({
  getCachedRouteMap: vi.fn().mockResolvedValue(null),
  setCachedRouteMap: vi.fn(),
  resolveCoordinatesFallbackChain: vi.fn().mockResolvedValue([{ lat: 35.6, lng: 139.7 }]),
}));
vi.mock("./renderer", () => ({
  renderRouteMapSvg: vi.fn().mockResolvedValue("<svg></svg>"),
}));

import { buildRouteMap } from "./builder";

describe("buildRouteMap", () => {
  it("cache hit returns cached SVG", async () => {
    const { getCachedRouteMap } = await import("./fallbacks");
    (getCachedRouteMap as any).mockResolvedValueOnce({ svg: "<cached/>", cached: true });
    const result = await buildRouteMap(1);
    expect(result.cached).toBe(true);
  });

  it("cache miss → renders new SVG and caches", async () => {
    const result = await buildRouteMap(1);
    expect(result.svg).toContain("<svg");
  });

  it("missing tour throws NOT_FOUND", async () => {
    const { getTourById } = await import("../../db");
    (getTourById as any).mockResolvedValueOnce(undefined);
    await expect(buildRouteMap(999)).rejects.toThrow();
  });
});
```

3 tests covering: happy cache hit, happy cache miss + render, malformed (missing tour).

### Step 8 — Verify

```bash
pnpm tsc --noEmit
pnpm test server/services/routeMap/
pnpm test  # regression
```

### Step 9 — Smoke

- Boot `pnpm dev`
- Visit a tour detail page → route map renders
- Trigger admin "Regenerate AI Map" → confirm new SVG saved
- Visit same tour again → confirm cache hit (faster load)

## Acceptance Criteria

- [ ] `server/services/routeMap/` directory exists with builder + renderer + fallbacks
- [ ] `server/services/routeMap/builder.ts` ≤300 LOC
- [ ] `server/services/routeMap/renderer.ts` ≤350 LOC
- [ ] `server/services/routeMap/fallbacks.ts` ≤200 LOC
- [ ] `server/routers/toursRouteMap.ts` ≤80 LOC
- [ ] `server/services/routeMap/builder.test.ts` exists with 3 cases (cache hit / cache miss / not found)
- [ ] tRPC path `trpc.tours.getRouteMap` unchanged from client perspective
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression + 3+ new tests
- [ ] Manual: tour detail route map renders cached + uncached + admin regen works

## Deliverable

- New: `server/services/routeMap/{builder,renderer,fallbacks}.ts` + `builder.test.ts`
- Modified: `server/routers/toursRouteMap.ts` (831 → ≤80 LOC)

**Single squash-merge commit:**

```
refactor(routers): v2 Wave 2 Module 2.13 — extract getRouteMap 760-LOC procedure

Closes audit C-priority documented exception (v1 Phase 4A flagged this
as the largest single procedure in the codebase). 760-LOC procedure
split into 3 service files under server/services/routeMap/.

- routeMap/builder.ts: orchestrator (cache check → resolve coords →
  render → cache write). ≤300 LOC.
- routeMap/renderer.ts: SVG generation + AI overlay (gpt-image-2) +
  marker rendering. ≤350 LOC.
- routeMap/fallbacks.ts: coordinate fallback chain + cache I/O + error
  recovery. ≤200 LOC.
- server/routers/toursRouteMap.ts: thin router shell. 831 → ≤80 LOC.
- builder.test.ts: 3 cases (cache hit / cache miss render / not found).

tRPC path trpc.tours.getRouteMap unchanged. Client TourRouteMapSvg.tsx
consumer unaffected.

Audit ref: v2-audit §C lines 154-155, 212; v2-plan.md Module 2.7.
```

## Rollback

- Single squash-merge → `git revert <SHA>` restores 831-LOC router.
- 3 new service files orphan.

## Manual intervention

- **Jeff:** review the renderer split — confirm AI overlay logic preserved (especially the gpt-image-2 prompt construction).
- **Supervisor:** verify staging cache hit rate same as pre-split (no extra DB queries introduced).

## Test plan

- 3 new Vitest cases on `builder.ts`
- Full regression
- Manual: tour detail route map (cached + uncached) + admin regen

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.13-a | 3-file split (builder/renderer/fallbacks) vs 2-file (builder + renderer; fold fallbacks into renderer)? | **3-file.** Cache I/O is distinct from SVG rendering; separation eases future cache-strategy changes. |
| D2.13-b | Should `regenerateAiMap` admin procedure stay in router OR move to renderer? | **Move impl to renderer**; router calls `regenerateAiMapImpl()`. Same pattern as `getRouteMap` → `buildRouteMap`. |

**This is the LAST Wave 2 module.** After it commits + the Wave 2 verification gate passes (v2-plan.md lines 233-241), Wave 2 closes and Wave 3 (Autonomy Thesis) can start.
