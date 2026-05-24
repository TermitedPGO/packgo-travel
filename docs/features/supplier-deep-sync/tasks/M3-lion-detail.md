# M3 — Lion detail enrichment

> Blocked by M2. Parallel with M4. Blocks M5.

## Goal
Pull 5 Lion detail endpoints + parse each into Normalized shape per design.md §3.2.

## Files
- `server/services/supplierSync/lionDetail.ts` (new)
- `server/services/supplierSync/lionDetail.test.ts` (new)
- `server/services/supplierSync/__fixtures__/lion-*.json` (new) — sample API responses for tests

## Checklist
- [ ] Export `enrichLionProduct(productId, externalCode)` — calls all 5 endpoints via `rateLimitedCall` + `withRetry`
- [ ] Export `parseLionItinerary(raw): NormalizedItinerary | null`
- [ ] Export `parseLionPriceTerms(raw): NormalizedPriceTerms | null`
- [ ] Export `parseLionNotices(raw): NormalizedNotices | null`
- [ ] Export `parseLionOptional(raw): NormalizedOptional | null`
- [ ] Export `parseLionTourInfo(raw): NormalizedTourInfo | null`
- [ ] Each parser returns `null` if required fields missing — never throws on bad data
- [ ] Fixtures: capture real Lion responses (1 sample per endpoint) into `__fixtures__/`
- [ ] Vitest: each parser tested with happy path + missing fields + format变动 scenarios
- [ ] `enrichLionProduct` integration test with mocked endpoints

## Done when
- 5 parsers handle all observed Lion response variations
- Test coverage > 80%
- tsc clean
