# Round 80.15-D Cleanup — Deprecated Itinerary Agents

> Cleanup of `itineraryExtractAgent.ts` / `itineraryPolishAgent.ts` after
> Round 80.15 marked them `@deprecated`. Production path is unchanged —
> `masterAgent.ts` continues to use `ItineraryUnifiedAgent` exclusively.

## Summary

The two deprecated agents had a combined ~1,126 lines of pre-LLM
extraction logic, Claude Haiku batched polishing, fidelity checks, and
auto-repair. None of it is reachable from production any more
(`itineraryUnifiedAgent.ts` replaced both in a single LLM call), but
straight-up deletion would break four importers — three at the type
level, one at the runtime level (admin diagnostics tool). This cleanup
keeps the imports valid while removing all the dead LLM logic.

## Files created

- **`server/agents/itineraryTypes.ts`** (139 lines) — new module that
  owns the shared types previously declared inside the deprecated
  agents:
  - `TourType` (union)
  - `ExtractedItinerary` / `ExtractedActivity`
  - `PolishedItinerary` / `PolishedActivity`
  - Each type carries full JSDoc explaining its consumers.

## Files modified

- **`server/agents/itineraryExtractAgent.ts`** — 593 → 72 lines.
  Stripped the entire extraction pipeline (tour-type identification,
  structured/markdown/fallback extractors, hotel/attraction snapshot
  builders). What remains: type re-exports, the `ItineraryExtractResult`
  interface, and a class shell whose `execute()` throws
  `"deprecated (Round 80.15)"`.
- **`server/agents/itineraryPolishAgent.ts`** — 533 → 98 lines. Stripped
  the Claude Haiku batched polishing, JSON-schema definition,
  `performFidelityCheck`, `autoRepairItineraries`, and
  `polishAllDaysParallel` / `polishBatch`. What remains: type
  re-exports, the `FidelityCheck` / `ItineraryPolishResult` /
  `OriginalDataSnapshot` interfaces (still read by `diagnostics.ts`),
  and a class shell whose `execute()` throws.
- **`server/utils/tagGenerator.ts`** — `TourType` import switched from
  `"../agents/itineraryExtractAgent"` to `"../agents/itineraryTypes"`.
- **`server/services/itineraryImageService.ts`** — `PolishedItinerary`
  import switched from `"../agents/itineraryPolishAgent"` to
  `"../agents/itineraryTypes"`.
- **`server/agents/diagnostics.ts`** — imports updated; added an inline
  comment explaining that the agents are still instantiated only so the
  diagnostics tool can mark them as deprecated, and that the whole
  `testItineraryExtractAgent` / `testItineraryPolishAgent` block can be
  removed once shadow-testing infrastructure exists.

## Files explicitly NOT touched

- `server/agents/itineraryUnifiedAgent.ts` — production path.
- `server/agents/masterAgent.ts` — production orchestrator.
- `client/src/components/admin/AiTeamRoster.tsx` — admin UI; does not
  import from server.
- i18n strings for `ItineraryExtractAgent` / `ItineraryPolishAgent` in
  `client/src/i18n/{en,zh-TW}.ts` — UI labels for the roster entries.

## Line accounting

| File | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `itineraryExtractAgent.ts` | 593 | 72 | −521 |
| `itineraryPolishAgent.ts` | 533 | 98 | −435 |
| `itineraryTypes.ts` (new) | 0 | 139 | +139 |
| **Net** | | | **−817** |

## Behaviour change

- Production: none — `masterAgent.ts` never called these agents.
- Admin diagnostics: `testItineraryExtractAgent` /
  `testItineraryPolishAgent` will now report `error` status with message
  `"… is deprecated (Round 80.15)"` instead of running real LLM calls.
  This is the desired outcome until shadow testing exists.

## Verification

- `pnpm check` — TypeScript 0 errors.
- No deploy — Jeff will handle.
