# v2 · Wave 3 · Module 3.12 — Confidence threshold env config

**Parent plan:** docs/refactor/v2-plan.md (Wave 3 — supports Module 3.4 auto-dispatch gate)
**Audit ref:** v2-audit-2026-05-19.md §A line 79 ("Wire skill auto-dispatch … → admin draft")
**Owner agent:** (filled by supervisor at Stage 4 dispatch)
**Status:** TODO
**Est. effort:** 2h AI + 5min Jeff (env value)

## Goal

Add `AGENT_CONFIDENCE_THRESHOLD` env variable (default `80`) that controls the minimum InquiryAgent confidence required for skill auto-dispatch (module 3.4). Below threshold → skill is NOT auto-dispatched even if registry has a match; inquiry escalates to Jeff for manual review.

Centralizing this in env (vs hard-coded in dispatcher) lets Jeff tune live without a deploy. Future v3 will move per-skill thresholds into `agentPolicies` DB row; v2 ships a single env knob.

Module 3.4 (auto-dispatch) consumes BOTH `AGENT_CONFIDENCE_THRESHOLD` (gate for ANY autonomous action) AND a NEW `AGENT_AUTO_SEND_THRESHOLD` (gate for auto-send specifically, higher bar). This module defines both.

## Pre-requisites

- **Module 3.4 (auto-dispatch)** — references the env. Should land in parallel; 3.4 can hard-code 80 as fallback if 3.12 lands after.
- No Wave 1/2 dependencies.

## Inputs (read these before executing)

1. `server/agents/skills/dispatcher.ts` (post-module-3.4) — confirm where the threshold is consumed.
2. `.env.example` — find the format + section to append to.
3. `server/_core/index.ts` or wherever env validation lives — confirm if there's a schema check (e.g., `zod` env validator).
4. CLAUDE.md §六 file map — add a row referencing the env after it lands.

## Scope (what this module owns)

- Modified: `.env.example` — add `AGENT_CONFIDENCE_THRESHOLD=80` with comment
- Modified: `server/agents/skills/dispatcher.ts` — replace literal `80` with `parseIntOrDefault(process.env.AGENT_CONFIDENCE_THRESHOLD, 80)`
- New (optional): `server/_core/envConfig.ts` — a centralized lookup. If no such file exists, inline the env read. **Defer** creating a new env-config file unless one already exists.
- Documentation: 1-line update in CLAUDE.md §六 or §三 (architecture) about the env
- Vitest: `server/agents/skills/dispatcher.test.ts` (already created by module 3.4) — extend with 2 cases on threshold behavior
- Define second env var `AGENT_AUTO_SEND_THRESHOLD` (number, 0-100). Default 90. Read at dispatcher boot. Module 3.4 uses this.

Does NOT:
- Add per-skill thresholds (v3)
- Move into DB (`agentPolicies` would be ideal but v2 keeps it env-only for simplicity)

## Procedure

1. **Determine where env vars are read in this repo.** Likely pattern: `process.env.X ?? "default"` inline. Confirm by grepping for `process.env.STRIPE_SECRET_KEY` and seeing how it's used.

2. **Add to `.env.example`** (find the agent section or create one):
   ```
   # ───────────────────────────────────────────────────────────────────
   # Autonomous-agent tuning (v2 Wave 3)
   # ───────────────────────────────────────────────────────────────────
   # Minimum InquiryAgent confidence (0-100) required to auto-dispatch
   # a skill. Below this, the inquiry escalates to Jeff for manual review.
   # Default 80; tune in prod after observing skill draft quality.
   AGENT_CONFIDENCE_THRESHOLD=80
   ```

3. **Update `dispatcher.ts`** (module 3.4 wrote the inline `80` literal; replace):
   ```ts
   // Read once at module load (or per-call if Jeff wants hot-reload).
   const AGENT_CONFIDENCE_THRESHOLD = (() => {
     const raw = process.env.AGENT_CONFIDENCE_THRESHOLD;
     const parsed = raw ? parseInt(raw, 10) : NaN;
     if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
     return 80;
   })();
   ```
   And replace the threshold ref:
   ```ts
   confidenceThreshold: AGENT_CONFIDENCE_THRESHOLD,
   ```

   Module 3.4 originally accepted `confidenceThreshold` as a parameter from `gmailPipeline.ts`. With this module, `gmailPipeline.ts`'s call can be simplified — the dispatcher uses its own constant. Update gmailPipeline accordingly to remove the inline `Number(process.env.AGENT_CONFIDENCE_THRESHOLD ?? 80)` and let the dispatcher own it.

4. **Add 2 Vitest cases** to `dispatcher.test.ts`:
   - **Custom threshold via env:** spy on `process.env.AGENT_CONFIDENCE_THRESHOLD = "95"` before importing dispatcher; quote_request at confidence=85 → returns `null` (below 95).
   - **Invalid threshold falls back to 80:** `process.env.AGENT_CONFIDENCE_THRESHOLD = "not-a-number"`; quote_request at confidence=85 → dispatches (because parsing fails → defaults to 80).
   - Note: Vitest module-level imports are tricky with env vars. Use `vi.resetModules()` + dynamic `import` inside each test, OR use a `getConfidenceThreshold()` function that reads env each call (preferred for testability — recommend changing dispatcher.ts to use a function getter).

5. **Update CLAUDE.md §六 file map** with one line:
   ```
   | AGENT_CONFIDENCE_THRESHOLD env | `.env.example` + `server/agents/skills/dispatcher.ts` |
   ```

## Acceptance Criteria

- [ ] `.env.example` has `AGENT_CONFIDENCE_THRESHOLD=80` with descriptive comment
- [ ] `dispatcher.ts` reads from env (with sane fallback to 80 if missing/invalid)
- [ ] Threshold is bounded [0, 100]; out-of-range values fall back to 80
- [ ] `gmailPipeline.ts` no longer has the inline `process.env.AGENT_CONFIDENCE_THRESHOLD` read (centralized in dispatcher)
- [ ] 2 new Vitest cases extend `dispatcher.test.ts` covering env-override behavior
- [ ] `pnpm tsc --noEmit` exits 0
- [ ] `pnpm test dispatcher` passes (5+ original + 2 new = 7+ cases)
- [ ] CLAUDE.md updated with env reference

## Deliverable

- Modified: `.env.example` (~6 LOC addition)
- Modified: `server/agents/skills/dispatcher.ts` (~10 LOC)
- Modified: `server/agents/autonomous/gmailPipeline.ts` (~3 LOC simplification)
- Modified: `server/agents/skills/dispatcher.test.ts` (+ 2 cases)
- Modified: `CLAUDE.md` §六 (1 line)

Commit message:
```
feat(agents): Wave 3 Module 3.12 — AGENT_CONFIDENCE_THRESHOLD env config

Centralizes the skill auto-dispatch confidence gate in a single env
variable, default 80. Below threshold, an inquiry escalates to Jeff
instead of triggering a skill run.

Lets Jeff tune live without a deploy. v3 will move to per-skill
thresholds in agentPolicies DB rows; v2 ships single global knob.

Invalid values (non-numeric or out of [0,100]) fall back to 80 with a
console.warn. 2 new Vitest cases verify env override + fallback.

Refs: docs/refactor/tasks/v2-wave-3/module-3.12-confidence-threshold-config.md
```

## Rollback

- Single revert. The dispatcher's previous hard-coded `80` is restored automatically (the inline `Number(process.env.X ?? 80)` from module 3.4 is the pre-state).

## Manual intervention

- **YES, 5min Jeff** to set the prod value. If Jeff defers, default 80 takes effect — no blocker.
- Prod deploy: set `AGENT_CONFIDENCE_THRESHOLD=80` (or Jeff's preference) in Fly secrets.

## Test plan

- 2 new Vitest cases in `dispatcher.test.ts`.

## Decisions needed (Jeff)

1. **Default value** — 80 proposed. Jeff may want it higher (e.g., 85) to be conservative initially. Default if Jeff defers: **80**.
2. **Per-skill override v3** — not in this module's scope. Note that future v3 will likely move to `agentPolicies.skillThresholds: {quote: 75, visa: 85}` JSON column.
- `AGENT_AUTO_SEND_THRESHOLD` initial production value: **90 (recommended), 85, or stricter 95?** Higher = fewer auto-sends but each more trusted; lower = more auto-sends with higher false-positive risk. v2 lands at 90; v3 can dial.

(Module proceeds with proposed defaults if Jeff defers.)
