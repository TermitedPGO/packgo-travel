# v2 · Wave 3 · Module 3.9 — Vitest smoke test for masterAgent supervisor

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — Module 3.8 line 323)
**Audit ref:** v2-audit-2026-05-19.md §I line 530 ("masterAgent.ts 3,300 LOC — AI tour orchestrator … no tests")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 6h AI + 0min Jeff

## Goal

Create `server/agents/masterAgent.test.ts` (NEW file — currently zero tests). Smoke-test the supervisor's orchestration flow with mocked sub-pipelines. ~6 cases covering:

1. **Cache-hit path** — supervisor checks cache first, returns cached result without invoking any pipeline
2. **Cache-miss → full happy path** — scrape → analyzer → fanout → assembly succeed in order
3. **One pipeline throws** — supervisor invokes fallback / recovery; final tour still emitted
4. **All-pipeline-fail catastrophic** — supervisor returns `{ok: false}` (or whatever masterAgent's failure shape is) without throwing
5. **Cache key disambiguation** — different URLs produce different cache keys
6. **Progress tracker invocation** — supervisor calls progressTracker on phase boundaries

## Pre-requisites

- **Wave 2 Module 2.3** (`masterAgent` split into supervisor + 6 pipelines under `server/agents/_pipeline/`) — **landed first**. This module tests the SPLIT supervisor, not the 3,300-LOC monolith.
  - **Important:** if Wave 2.3 hasn't landed yet, this module should be deferred. Sub-agents executing this without 2.3 landed will fail at "import from _pipeline" — escalate to supervisor.
- Wave 1 Module 1.2 (pino logger) — landed; logger calls are mocked via `vi.mock("../_core/logger")` instead of asserting console output.

## Inputs (read these before executing)

1. Post-Wave-2.3 `server/agents/masterAgent.ts` (target ≤ 400 LOC after split). Confirm the public API: likely `generateTourFromUrl(url, ctx): Promise<MasterAgentResult>`.
2. `server/agents/_pipeline/scrape.ts`, `contentAnalyzer.ts`, `colorTheme.ts`, `fanout.ts`, `assembly.ts`, `rollback.ts` — confirm export names + signatures of each pipeline function. Tests will `vi.mock` each.
3. `server/agents/progressTracker.ts` — confirm signature; mock its `update(phase, payload)` call.
4. `server/_core/llm.ts` — `invokeLLM` mock target (transitively used; some tests can mock at supervisor boundary without needing this).
5. `server/_core/stripeWebhookIdempotency.test.ts` — reference mock-DB style.

## Scope (what this module owns)

- New: `server/agents/masterAgent.test.ts` (~250 LOC, ~6 cases)
- New: `server/agents/masterAgent.fixtures.ts` if test data is non-trivial (e.g., scrape output, analyzer output)
- No source-code changes to `masterAgent.ts` or any pipeline file

Does NOT:
- Add tests for individual pipeline files (Wave 2.3 owns those per its own Vitest budget)
- Mock LLM at fine granularity (test at supervisor boundary; pipelines are mocked wholesale)

## Procedure

1. **Read post-2.3 masterAgent.ts** to confirm supervisor structure. Expected shape:
   ```ts
   export async function generateTourFromUrl(url, ctx) {
     // Phase 0: cache check
     // Phase 1: scrape (mock target)
     // Phase 2: contentAnalyzer (mock target)
     // Phase 3: colorTheme (mock target)
     // Phase 4: fanout (mock target — parallel 6-agent)
     // Phase 5: assembly + universal fallbacks (mock target)
     // Phase 6: persist + return
   }
   ```

2. **Build fixture data** for a "happy" tour generation:
   ```ts
   // masterAgent.fixtures.ts
   export const FIXTURE_SCRAPE_OUTPUT = {
     title: "韓國首爾 5 日遊",
     daysJson: [...],
     rawHtml: "...",
   };
   export const FIXTURE_ANALYZER_OUTPUT = {
     country: "Korea",
     theme: "city_exploration",
     budgetTier: "mid",
   };
   // ... etc
   ```

3. **Write the 6 test cases**:

   **Case 1 — Cache hit:**
   ```ts
   it("returns cached result without invoking pipelines on cache hit", async () => {
     vi.mocked(checkCache).mockResolvedValueOnce({ hit: true, tour: FIXTURE_CACHED_TOUR });
     const result = await generateTourFromUrl("https://lion.com.tw/x");
     expect(result.ok).toBe(true);
     expect(scrape).not.toHaveBeenCalled();
     expect(fanout).not.toHaveBeenCalled();
   });
   ```

   **Case 2 — Cache miss full happy path:**
   ```ts
   it("runs scrape → analyzer → fanout → assembly when cache misses", async () => {
     vi.mocked(checkCache).mockResolvedValueOnce({ hit: false });
     vi.mocked(scrape).mockResolvedValueOnce(FIXTURE_SCRAPE_OUTPUT);
     vi.mocked(contentAnalyzer).mockResolvedValueOnce(FIXTURE_ANALYZER_OUTPUT);
     vi.mocked(colorTheme).mockResolvedValueOnce({ primary: "#0D9488" });
     vi.mocked(fanout).mockResolvedValueOnce({ images: [], itinerary: [], cost: 100 });
     vi.mocked(assembly).mockResolvedValueOnce(FIXTURE_FINAL_TOUR);
     const result = await generateTourFromUrl("https://lion.com.tw/x");
     expect(result.ok).toBe(true);
     expect(scrape).toHaveBeenCalledOnce();
     expect(fanout).toHaveBeenCalledOnce();
   });
   ```

   **Case 3 — One pipeline throws → assembly recovers:**
   ```ts
   it("falls back when fanout throws but assembly can recover", async () => {
     // ... setup ...
     vi.mocked(fanout).mockRejectedValueOnce(new Error("fanout failed"));
     vi.mocked(rollback).mockResolvedValueOnce({ recovered: true, partial: FIXTURE_PARTIAL });
     const result = await generateTourFromUrl("https://lion.com.tw/x");
     expect(result.ok).toBe(true);   // recovered
     expect(rollback).toHaveBeenCalled();
   });
   ```

   **Case 4 — Catastrophic failure → graceful return:**
   ```ts
   it("returns {ok: false} when all pipelines fail without throwing", async () => {
     vi.mocked(scrape).mockRejectedValueOnce(new Error("scrape died"));
     vi.mocked(rollback).mockRejectedValueOnce(new Error("rollback also died"));
     const result = await generateTourFromUrl("https://lion.com.tw/x");
     expect(result.ok).toBe(false);
     expect(result.error).toBeDefined();
   });
   ```

   **Case 5 — Cache key disambiguation:**
   ```ts
   it("uses different cache keys for different URLs", async () => {
     vi.mocked(checkCache).mockImplementation(async (key) => ({ hit: false, key }));
     await generateTourFromUrl("https://lion.com.tw/a");
     await generateTourFromUrl("https://lion.com.tw/b");
     const calls = vi.mocked(checkCache).mock.calls;
     expect(calls[0][0]).not.toBe(calls[1][0]);
   });
   ```

   **Case 6 — Progress tracker phases:**
   ```ts
   it("calls progressTracker on phase boundaries", async () => {
     // ... mock all pipelines for happy path ...
     await generateTourFromUrl("https://lion.com.tw/x");
     const progressCalls = vi.mocked(progressUpdate).mock.calls;
     expect(progressCalls.map(c => c[0])).toEqual([
       "scrape", "analyzer", "colorTheme", "fanout", "assembly", "complete",
     ]);
   });
   ```

   Adjust phase names + signatures to match actual Wave 2.3 split output.

4. **Verify all 6 cases pass:** `pnpm test masterAgent`.

## Acceptance Criteria

- [ ] `server/agents/masterAgent.test.ts` exists with 6 passing cases
- [ ] `server/agents/masterAgent.fixtures.ts` exists (or inline if minimal)
- [ ] All pipeline modules mocked via `vi.mock("./_pipeline/<name>")`
- [ ] `progressTracker` mocked
- [ ] `invokeLLM` NOT called directly in any test (all mocked at pipeline boundary)
- [ ] Tests run in < 2 seconds total (no real LLM, no real DB)
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test masterAgent` passes — **§九 hard requirement satisfied**
- [ ] If Wave 2.3 hasn't landed, module ESCALATES (not partial-shipped)

## Deliverable

- New: `server/agents/masterAgent.test.ts` (~250 LOC, 6 cases)
- New: `server/agents/masterAgent.fixtures.ts` (~100 LOC of fixture objects)

Commit message:
```
test(agents): Wave 3 Module 3.9 — masterAgent supervisor Vitest smoke

Per CLAUDE.md §九 every autonomous agent must have Vitest coverage. The
biggest one (post-Wave-2.3 supervisor) didn't. Now does.

6 cases:
- Cache hit short-circuit
- Cache miss → full scrape → analyzer → fanout → assembly happy path
- Pipeline throw → rollback recovery
- Catastrophic failure → graceful {ok: false}
- Cache key disambiguation
- progressTracker phase ordering

All pipelines mocked via vi.mock(./_pipeline/*); no real LLM, no real
DB. Tests run in < 2s.

Refs: docs/refactor/tasks/v2-wave-3/module-3.9-vitest-master-agent.md
```

## Rollback

- Single revert. Tests only; no source changes.

## Manual intervention

- **None** if Wave 2.3 has landed.
- **YES escalate** if Wave 2.3 hasn't landed — defer until splits are in place.

## Test plan

- 6 Vitest cases as enumerated.

## Decisions needed (Jeff)

- **None.** Test design is mechanical given the supervisor's public API.

(Module proceeds without Jeff input once 2.3 is in.)
