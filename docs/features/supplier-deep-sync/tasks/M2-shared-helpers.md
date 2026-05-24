# M2 — sharedDetail helpers

> Blocked by M1. Blocks M3-M5.

## Goal
Common enrichment helpers + Normalized type defs per design.md §3.

## Files
- `server/services/supplierSync/sharedDetail.ts` (new) — rate-limit + retry + EnrichmentResult type
- `server/services/supplierSync/types.ts` (new) — NormalizedItinerary / PriceTerms / Notices / Optional / TourInfo per design §3.4

## Checklist
- [ ] Define `DetailKind` union + `ParseStatus` enum (match schema)
- [ ] Define `EnrichmentResult` interface
- [ ] Implement `rateLimitedCall<T>(fn, label)` — 2 sec interval + jitter (reuse `shared.ts` jitter helper)
- [ ] Implement `withRetry<T>(fn, maxAttempts=3)` — exponential backoff 1s, 2s, 4s
- [ ] Define all 5 Normalized type interfaces per design §3.4
- [ ] Export `upsertProductDetail(productId, results)` — Drizzle upsert into `supplierProductDetails`
- [ ] Vitest: `sharedDetail.test.ts` covers rate limit + retry behavior with mocked fn

## Done when
- All exports usable from M3/M4
- Test passes
- tsc clean
