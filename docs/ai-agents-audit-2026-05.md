# AI Agents Audit — 2026-05-01

**Status:** Partial audit (manual). Architect sub-agent stalled before producing
deep dive — this doc captures findings from Round 80.15 manual review +
applied quick wins.

**Owner:** Jeff Hsieh
**Repo:** `server/agents/*` + `server/_core/llm.ts` + `server/_core/llmCache.ts`

---

## TL;DR

The system is **better than I initially feared**. Most agents (8/12 LLM-using)
already route to Haiku. The two biggest gaps were:

1. **No circuit breaker** — Anthropic outage = full system stall. **FIXED in 80.15.**
2. **Two short-task agents using Sonnet by default** — fixed to Haiku in 80.15.

Bigger structural improvements (multi-provider fallback, parallel orchestration,
prompt cache audit) are listed below for next rounds.

---

## Agents inventory + model routing (as of 2026-05-01)

| Agent | Model | Role | Status |
|-------|-------|------|--------|
| `calibrationAgent` | Haiku 4.5 | Quality scoring on AI-generated tours | ✅ correct |
| `flightAgent` | Haiku 4.5 | Extract flight info from raw content | ✅ correct |
| `contentAnalyzerAgent` | Haiku 4.5 (Sonnet imported as fallback) | Analyze raw tour content | ✅ correct |
| `imagePromptAgent` | Haiku 4.5 | Generate image prompts | ✅ correct |
| `itineraryPolishAgent` | Haiku 4.5 | Polish itinerary text | ✅ correct |
| `itineraryUnifiedAgent` | Haiku 4.5 | Unified itinerary build | ✅ correct |
| `dateExtractorAgent` | Sonnet 4.5 | Vision-based date extraction from screenshots | ✅ intentional (Vision needs Sonnet) |
| `learningAgent` | Sonnet (default) → **Haiku** | Tour pattern learning | 🟢 fixed in 80.15 |
| `skillLearnerAgent` | Sonnet (default) → **Haiku** | Skill keyword extraction | 🟢 fixed in 80.15 |
| `transportationAgent` | (no `invokeLLM` direct calls) | — | ✅ no LLM, safe |
| `colorThemeAgent` | (file not yet read) | Theme color generation | 📝 TODO verify |
| `imageGenerationAgent` | (file not yet read) | Image generation (likely calls Stability/SD) | 📝 TODO verify |

### Architecture observations

**`masterAgent.ts` (936+ lines) does not call `invokeLLM` directly.** It's pure
orchestration — calling sub-agents in sequence. Refactoring it for parallel
execution is a viable optimization (see below) but doesn't affect cost.

**`claudeAgent.ts`** is a wrapper class around `invokeLLM` with model presets
(Haiku / Sonnet / Opus). Most agents use `getHaikuAgent()` from this. Good
abstraction.

---

## Round 80.15 changes (deployed)

### 🟢 Quick wins applied

1. **Circuit breaker added to `llm.ts`** ✅
   - Trips after 5 consecutive infra failures within 30s
   - Stays OPEN for 30s, then HALF_OPEN probe
   - Throws `LLM_CIRCUIT_OPEN` error when tripped (instead of hammering Anthropic)
   - Doesn't trip on user-side 4xx (besides 429 rate-limit)
   - Logs to Redis stats: `circuit_opened` counter
   - Exposed: `getCircuitState()` for diagnostics

2. **`learningAgent` + `skillLearnerAgent` forced to Haiku** ✅
   - Both were calling `invokeLLM` without `model` → defaulted to Sonnet
   - Both are short classification tasks (skill keyword extraction)
   - Cost saving: ~12x per call on these specific agents
   - Quality risk: low (categorization, not deep reasoning)

### Existing infrastructure already good

- ✅ 24h app-level cache (`llmCache.ts`)
- ✅ Per-day Redis stats (`HGETALL llm:stats:YYYY-MM-DD`)
- ✅ Anthropic prompt-cache awareness (logs `cache_creation_input_tokens` / `cache_read_input_tokens`)
- ✅ Per-model token tracking (`input:claude-haiku-4-5`, `output:claude-sonnet-4-5`)
- ✅ Cache hit/miss + prompt cache write/read counters
- ✅ Most agents on Haiku (~80% of LLM calls)

---

## Recommended next-round work

### 🔴 Critical (high-value, do next)

**A. Multi-provider fallback (OpenAI / Gemini)**
- Current: circuit breaker fails-fast when OPEN, no degraded path
- Add: when `circuit.state === OPEN`, route to OpenAI GPT-5 or Gemini 2.5
- Requires: `OPENAI_API_KEY` Fly secret + OpenAI client + adapter
- Effort: 4-6h
- Risk: medium (output schema differences)
- Cost impact: only fires during outage (cost-neutral 99% of the time)

**B. Verify Anthropic prompt-cache `cache_control` is applied**
- Logs show `cache_read_input_tokens=0` historically — possible cache miss
- Check whether system prompts have `cache_control: { type: "ephemeral" }` block
- If not added: 90% input-token cost savings on cache hits
- Effort: 2h audit + targeted fix
- Risk: low

### 🟡 High (medium-value)

**C. Parallelize masterAgent steps**
- Current: agents run sequentially even when independent
- Potential parallelism (per code reading):
  - Image prompt + cost extract + notice extract can run together
  - Hotel + meal + flight extract are independent of each other
- Estimated time saving: ~30-40% (120s → 70-80s)
- Effort: 6-8h (need careful dependency analysis)
- Risk: medium (race conditions if not careful)

**D. Consolidate itinerary agents**
- `itineraryExtractAgent` + `itineraryPolishAgent` + `itineraryUnifiedAgent` look like iterative additions
- Likely only `itineraryUnifiedAgent` is actively used now
- Audit: which are dead code, remove
- Effort: 2-3h
- Risk: low (just code cleanup)

### 🟢 Medium

**E. Shadow testing infrastructure**
- When Jeff edits a prompt or swaps a model, A/B compare output quality
- Implementation: store last N AI generations + their feedback scores + run alt prompt offline
- Effort: 1-2 days
- Risk: low (offline only)

**F. Skill learning feedback loop**
- `skillLearnerAgent` extracts keywords; do they actually flow back to system prompts?
- Check: are `skillLibrary` skills used in subsequent generations?
- Effort: 4h audit
- Risk: low

### ⚪ Nice-to-have

**G. Daily cost report via Redis stats**
- Already collecting per-day per-model token counts
- Add a daily admin email: "Yesterday: Haiku 1.2M in / 0.4M out = $0.30, Sonnet 100K = $0.30"
- Effort: 2h
- Risk: low

---

## Estimated monthly LLM cost (rough)

**Without measured data — order of magnitude only:**

Assume 50 AI tour generations / month at ~50K tokens each:
- 50 × 50K = 2.5M tokens / month
- At Haiku rates ($1/1M input, $5/1M output, ~3:1 ratio): ~$15-25/month
- At Sonnet rates ($3 / $15): ~$50-75/month

**With Round 80.15 changes:**
- 2 more agents now on Haiku: marginal saving (~$5-10/month)
- Circuit breaker: cost-neutral (only saves when outage)

**With recommended A+B (OpenAI fallback + prompt cache):**
- Prompt cache: ~$10-15/month savings on input tokens (large system prompts)
- OpenAI fallback: cost-neutral

**Bigger lever for cost:** if Sonnet calls (dateExtractor, large reasoning) get
prompt cache properly, ~50% reduction.

---

## TODO follow-ups

- [ ] Re-spawn LLM architect with tighter scope (cost analysis only) when watchdog issue is resolved
- [ ] Read `colorThemeAgent.ts` and `imageGenerationAgent.ts` to complete inventory
- [ ] Audit `cache_control` placement — most likely the lowest-effort highest-impact fix
- [ ] Decide on OpenAI fallback (need API key budget + key)
