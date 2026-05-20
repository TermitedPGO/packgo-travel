# v2 · Wave 2 · Module 2.9 — Split `server/agents/masterAgent.ts` (3,300 → 7 pipeline files)

**Parent plan:** docs/refactor/v2-plan.md (Wave 2 · Module 2.3)
**Audit ref:** v2-audit-2026-05-19.md §C lines 188-201 (masterAgent split plan); v2-plan.md lines 175-189
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO (parallelize-safe with Module 2.8 after Module 2.7)
**Est. effort:** 22-26 h AI + 1 h Jeff (fixture review)
**Risk tier:** **HIGHEST IN WAVE 2** — every AI tour generation runs through this orchestrator. Pipeline misorder → prod tours fail.
**Deploy window:** Tue/Wed morning 9-11am PT + Wave 1's Sentry firing in prod (2min regression detection window).

> **CRITICAL SEQUENCING:** Starts ONLY after Module 2.7 (db.ts split) complete. May parallelize with Module 2.8 (TourDetailPeony) since they share no files. MUST be committed before next module that touches `server/agents/*`.

## Goal

Split `server/agents/masterAgent.ts` (3,300 LOC) into a supervisor shell + 6 pipeline files under `server/agents/_pipeline/` (underscore prefix per audit recommendation):

1. `server/agents/masterAgent.ts` (kept, ≤400 LOC) — supervisor: try/catch shell + Phase 0 cache check + pipeline orchestration
2. `_pipeline/scrape.ts` — Phase 1 (Lion API + Puppeteer fallback + DateExtractorAgent), ~1,100 LOC source
3. `_pipeline/contentAnalyzer.ts` — Phase 2 (content analysis + Lion title)
4. `_pipeline/colorTheme.ts` — Phase 3 (ColorTheme generation)
5. `_pipeline/fanout.ts` — Phase 4 (parallel 6-agent fanout: Itinerary + DetailsSkill + Transportation + etc.)
6. `_pipeline/assembly.ts` — Phase 5+6 (final assembly + universal fallbacks + image library + price rescue + self-repair + calibration)
7. `_pipeline/rollback.ts` — error recovery handlers

**External API stays stable:** `generateTourFromUrl(url, onProgress?)` signature unchanged. Callers (`server/routers/toursAdmin.ts`, BullMQ worker) keep their imports.

## Pre-requisites

- Module 2.7 committed (db.ts split done)
- Wave 1 Module 1.1 (Sentry) live in prod — fast regression detection
- Wave 1 Module 1.2 (pino logger) available — replace remaining `console.log` calls in supervisor
- Working tree clean
- `pnpm tsc --noEmit` exit 0

## Inputs (read these before executing)

1. **`server/agents/masterAgent.ts`** — 3,300 LOC. Full read required. The file has pre-existing `// Phase N: ...` comment markers that delineate seams.
2. **v2-audit-2026-05-19.md §C lines 190-200** — phase boundary line numbers from audit grep:
   - Phase 0: cache check (303-377)
   - Phase 1: scrape + Lion API (378-1487, **1109 LOC** — biggest block)
   - Phase 2: content analyzer (1488-1542)
   - Phase 3: color theme (1543-1621)
   - Phase 4: parallel fanout (1622-2158)
   - Phase 5: assembly (2159-2520)
   - Phase 6: universal fallbacks + image library + price rescue + self-repair (2521-3061)
   - Other: rollback (3062+)
3. **`server/agents/`** — sibling files (scrapeAgent, contentAnalyzerAgent, colorThemeAgent, itineraryAgent, etc.). Confirm these exist and are imported by masterAgent — they should remain unchanged.
4. **`server/agents/calibrationAgent.ts`** — called from Phase 6. Stays separate (its own file).
5. **`server/routers/toursAdmin.ts`** + **`server/workers/tourGenerationWorker.ts`** (or wherever masterAgent is invoked) — confirm import paths of `generateTourFromUrl`.
6. **CLAUDE.md §3.3** — AI generation pipeline expectations + 120s target.
7. **`docs/refactor/tasks/phase-4/module-4F-composition.md`** — supervisor coordination pattern.

## Scope (what this module owns)

### Directory structure

```
server/agents/
├── masterAgent.ts            ≤400 LOC  — supervisor shell
└── _pipeline/                            (new directory; underscore prefix per audit)
    ├── scrape.ts            ≤1,100 LOC (exception: single coherent phase)
    ├── contentAnalyzer.ts   ≤200 LOC
    ├── colorTheme.ts        ≤200 LOC
    ├── fanout.ts            ≤600 LOC
    ├── assembly.ts          ≤900 LOC (exception: assembly + fallbacks + self-repair)
    └── rollback.ts          ≤300 LOC
```

Total ≤3,700 LOC for the split (matches source 3,300 + ~400 LOC for cross-file type re-exports and helper signature changes).

**Per CLAUDE.md §九 LOC rule**: `scrape.ts` and `assembly.ts` exceed 300 LOC. Document this as an exception via D4-style note (similar to v1's `toursAdmin.ts`/`skills.ts` exemption). Each is a single coherent phase that doesn't decompose cleanly.

### Supervisor contract

```ts
// server/agents/masterAgent.ts (post-split supervisor)
import { runScrapePhase } from "./_pipeline/scrape";
import { runContentAnalyzerPhase } from "./_pipeline/contentAnalyzer";
import { runColorThemePhase } from "./_pipeline/colorTheme";
import { runFanoutPhase } from "./_pipeline/fanout";
import { runAssemblyPhase } from "./_pipeline/assembly";
import { handlePipelineError } from "./_pipeline/rollback";
import { getCachedGeneration, setCachedGeneration } from "./_helpers/genCache"; // existing or extract

export async function generateTourFromUrl(
  url: string,
  onProgress?: (stage: string, percent: number) => void
): Promise<GenerationResult> {
  try {
    // Phase 0
    const cached = await getCachedGeneration(url);
    if (cached) return cached;

    // Phase 1
    const scraped = await runScrapePhase(url, onProgress);

    // Phase 2
    const analyzed = await runContentAnalyzerPhase(scraped, onProgress);

    // Phase 3 (parallel with start of fanout in original)
    const theme = await runColorThemePhase(analyzed, onProgress);

    // Phase 4
    const fanout = await runFanoutPhase(analyzed, theme, scraped, onProgress);

    // Phase 5+6 (with self-repair)
    const assembled = await runAssemblyPhase({ analyzed, theme, fanout, scraped }, onProgress);

    await setCachedGeneration(url, assembled);
    return assembled;
  } catch (err) {
    return await handlePipelineError(err, url);
  }
}
```

Each phase function:
- Takes structured input (from prior phase output)
- Returns structured output (input to next phase)
- Owns its own logging + Sentry capture + retry logic
- Has its own Vitest

### Out of scope

- Pipeline performance optimization (Wave 2 is structural; perf belongs to v3)
- Fixing the 120s P95 target (existing perf-tracking unchanged)
- Replacing the autonomous-agent monitoring `AgentMonitor` integration

## Procedure

### Step 1 — Pre-extraction inventory

```bash
cd /Users/jeff/Desktop/網站
wc -l server/agents/masterAgent.ts
grep -nE "^\s*//\s*Phase [0-9]" server/agents/masterAgent.ts
grep -nE "^export (async )?function" server/agents/masterAgent.ts
grep -rnE "from ['\"]\\.\\.?/agents/masterAgent" server/ client/ --include="*.ts"
```

Save the callers list — they MUST stay working.

### Step 2 — Identify shared helpers + types

Before extracting, identify:
- Types defined inside `masterAgent.ts` that multiple phases use (e.g., `ScrapeResult`, `AnalysisResult`, `ThemeResult`). Extract to `server/agents/_pipeline/types.ts` OR keep in `masterAgent.ts` and import from there.
- Helper functions used by multiple phases (e.g., `notifyOwner`, retry wrappers). If they exist, leave in `masterAgent.ts` and import to pipeline files.

Sub-agent's first deliverable: a 1-page `/tmp/2.9-types-inventory.txt` listing shared types + their dependents.

### Step 3 — Extract Phase 1 (scrape) first

Largest block, most contained: Phase 1 scraping (L378-L1487, 1,109 LOC including DateExtractorAgent integration at L1187-1196).

```ts
// server/agents/_pipeline/scrape.ts
import { scrapeDynamicPage, scrapeStaticFallback } from "../scrapeAgent";
import { extractDatesFromScreenshots } from "../dateExtractorAgent"; // if exists
import { fetchLionTour, normalizeLionGroup } from "../lionApiClient"; // if exists
import type { ScrapeResult, ProgressCallback } from "./types";

export async function runScrapePhase(
  url: string,
  onProgress?: ProgressCallback
): Promise<ScrapeResult> {
  onProgress?.("scraping", 10);

  // Verbatim copy from masterAgent.ts L378-L1487 (without the outer try/catch — supervisor handles that)
  // ...
}
```

After this extraction:
- `masterAgent.ts` shrinks by ~1,100 LOC
- `pnpm tsc --noEmit` must pass
- Run a manual scrape test on staging via admin "Generate Tour from URL" button

### Step 4 — Extract Phases 2-6 in order

Same pattern for each:
1. Read the source block
2. Create the new file with a single exported async function
3. Replace the source block in `masterAgent.ts` with a function call
4. Run tsc after each extraction (don't batch — single-phase commits)

### Step 5 — Extract rollback / error handler

```ts
// server/agents/_pipeline/rollback.ts
import { captureException } from "../../_core/sentry"; // from Wave 1 Module 1.1
import { logger } from "../../_core/logger"; // from Wave 1 Module 1.2
import { notifyOwner } from "../_helpers/notifyOwner"; // existing or extract

export async function handlePipelineError(
  err: unknown,
  url: string
): Promise<GenerationResult> {
  captureException(err, { tags: { phase: "masterAgent", url } });
  logger.error({ err, url }, "[masterAgent] pipeline failed");
  await notifyOwner({ subject: "Tour generation failed", url, error: String(err) });
  return { success: false, error: String(err), url };
}
```

### Step 6 — Add Vitest for supervisor + per-phase smoke

```ts
// server/agents/masterAgent.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./_pipeline/scrape", () => ({
  runScrapePhase: vi.fn().mockResolvedValue({ rawText: "fixture", screenshots: {} }),
}));
vi.mock("./_pipeline/contentAnalyzer", () => ({
  runContentAnalyzerPhase: vi.fn().mockResolvedValue({ title: "Fixture Tour", days: 5 }),
}));
vi.mock("./_pipeline/colorTheme", () => ({
  runColorThemePhase: vi.fn().mockResolvedValue({ primary: "#0D9488" }),
}));
vi.mock("./_pipeline/fanout", () => ({
  runFanoutPhase: vi.fn().mockResolvedValue({ itinerary: [], details: {} }),
}));
vi.mock("./_pipeline/assembly", () => ({
  runAssemblyPhase: vi.fn().mockResolvedValue({ success: true, tourId: 1 }),
}));

import { generateTourFromUrl } from "./masterAgent";

describe("masterAgent supervisor", () => {
  it("orchestrates Phase 0-6 happy path", async () => {
    const result = await generateTourFromUrl("https://example.com/tour");
    expect(result.success).toBe(true);
    expect(result.tourId).toBe(1);
  });

  it("calls rollback on pipeline error", async () => {
    const { runScrapePhase } = await import("./_pipeline/scrape");
    (runScrapePhase as any).mockRejectedValueOnce(new Error("scrape failed"));
    const result = await generateTourFromUrl("https://example.com/tour");
    expect(result.success).toBe(false);
  });
});
```

Plus per-phase smoke tests:
- `server/agents/_pipeline/scrape.test.ts` — mock fetch + Puppeteer, 1 happy path + 1 failure injection
- `server/agents/_pipeline/contentAnalyzer.test.ts` — mock LLM, 1 happy + 1 failure
- (same for each of the 6 pipeline files)

### Step 7 — Verify

```bash
NODE_OPTIONS="--max-old-space-size=6144" pnpm tsc --noEmit
pnpm test server/agents/  # all agent tests
pnpm test  # full regression
```

### Step 8 — Smoke test (REQUIRED before merge)

On staging:
1. Admin "Generate Tour from URL" → submit a known-good Lion travel URL
2. Watch the progress polling (every 3s per CLAUDE.md §3.3)
3. Verify all phases run + final tour record created
4. Verify total time ≤120s (P95 target)
5. Inspect the generated tour record — quality should be identical to pre-split

## Acceptance Criteria

- [ ] `server/agents/_pipeline/` directory exists with 6 phase files + types.ts (if needed)
- [ ] `server/agents/masterAgent.ts` ≤400 LOC
- [ ] Each `_pipeline/*.ts` ≤600 LOC (scrape.ts and assembly.ts exception-documented; ≤1,100 and ≤900 respectively)
- [ ] `server/agents/masterAgent.test.ts` exists with supervisor smoke (mocked pipelines, happy + failure)
- [ ] Each pipeline file has its own `.test.ts` with happy + failure injection cases (12 total cases minimum)
- [ ] `generateTourFromUrl(url, onProgress?)` signature unchanged
- [ ] All callers (`server/routers/toursAdmin.ts`, BullMQ worker) still build + run
- [ ] `pnpm tsc --noEmit` exit 0
- [ ] `pnpm test` regression + ~14 new test cases pass
- [ ] **Staging smoke (Jeff)**: 1 fresh tour generation from a Lion URL ≤120s, quality identical to pre-split

## Deliverable

- New directory: `server/agents/_pipeline/` with 6 phase files + types
- New: 7 test files (supervisor + 6 phases)
- Modified: `server/agents/masterAgent.ts` (3,300 → ~400 LOC)

**Single squash-merge commit:**

```
refactor(masteragent): v2 Wave 2 Module 2.9 — split masterAgent 3,300 → 7 files

Closes audit C-priority highest-blast-radius god-file. Pipeline phases
moved to server/agents/_pipeline/.

- masterAgent.ts: supervisor shell (try/catch + Phase 0 cache + phase
  orchestration). ≤400 LOC.
- _pipeline/scrape.ts: Phase 1 (Lion API + Puppeteer + DateExtractorAgent).
  ≤1,100 LOC — exception-documented; single coherent phase.
- _pipeline/contentAnalyzer.ts: Phase 2.
- _pipeline/colorTheme.ts: Phase 3.
- _pipeline/fanout.ts: Phase 4 (6-agent parallel).
- _pipeline/assembly.ts: Phase 5+6 (assembly + fallbacks + self-repair).
  ≤900 LOC — exception-documented.
- _pipeline/rollback.ts: error recovery (Sentry capture + notifyOwner).
- 7 Vitest files: supervisor smoke + per-phase happy + per-phase failure
  injection (~14 cases).

External API `generateTourFromUrl(url, onProgress?)` unchanged.
Staging smoke: 1 fresh tour generated ≤120s, quality preserved.

Wave 1's Sentry firing gives <2min regression detection. Rollback =
revert this commit (sub-pipelines orphan, original logic restored).

Audit ref: v2-audit §C lines 188-201; v2-plan.md Module 2.3.
```

## Rollback

- Single squash-merge → `git revert <SHA>` restores monolith. Pipeline files orphan.
- **HIGHEST-risk module in Wave 2**: every AI tour generation runs through this. If Sentry shows any pipeline-related error spike post-deploy → revert IMMEDIATELY.
- Decision tree:
  - Sentry shows error in `_pipeline/scrape.ts` only → keep deploy, investigate that phase
  - Sentry shows pipeline orchestration error (wrong phase order, missing data between phases) → revert + Jeff investigates fixture mismatch

## Manual intervention

- **Jeff (REQUIRED, 1h):** review the supervisor shell — confirm it matches the original orchestration flow (cache check → scrape → analyze → theme → fanout → assemble → cache write). Confirm progress callback fires at expected stages.
- **Jeff (REQUIRED):** staging smoke — 1 fresh tour generation. Compare side-by-side with a pre-split-generated tour: title, theme, itinerary depth, pricing detail, calibration score. Must be ≥ pre-split quality.
- **Supervisor:** verify all callers (`grep -rn "generateTourFromUrl" server/`) work post-split. Spot-check the BullMQ worker.
- **Supervisor:** confirm Sentry is firing on a forced error (manually throw inside `scrape.ts` to verify pipeline error capture works end-to-end).

## Test plan

- ~14 new Vitest cases across 7 files (supervisor + 6 phases × 2 cases each)
- Full regression run
- **Staging end-to-end (Jeff)**: 1 Lion URL → fresh tour generation; compare quality
- **Sentry forced-error test (supervisor)**: throw inside `_pipeline/scrape.ts` on staging, verify Sentry captures it

## Decisions needed (Jeff)

| # | Decision | Default if Jeff defers |
|---|---|---|
| D2.9-a | LOC exception for `_pipeline/scrape.ts` (1,100 LOC) and `_pipeline/assembly.ts` (900 LOC) — accept exemption OR further-split? | **Accept exemption.** v2-plan.md line 178 documents the seam; further split risks introducing more inter-pipeline state passing. CLAUDE.md update notes the exception. |
| D2.9-b | Types — colocate in `_pipeline/types.ts` (current plan) vs inline per-file? | **Colocate.** Shared types between phases (ScrapeResult → ContentAnalyzer input etc.) need a single source of truth. |
| D2.9-c | Should Phase 3 (colorTheme) run in parallel with Phase 4 (fanout) per the original Phase comment at L14 ("Phase 3: ColorTheme + ImagePrompt (Parallel)"), or strictly sequential as the supervisor template above shows? | **Read the original carefully.** v2-audit §C line 14 says "Parallel". If original ran them parallel via Promise.all, supervisor must preserve that. Sub-agent reads + flags. |

**Must be committed before any module touches `server/agents/masterAgent.ts`** (none others should in Wave 2; safe to parallelize with 2.8, 2.10, 2.11, 2.12, 2.13).
