# M4 — UV detail enrichment

> Blocked by M2. Parallel with M3. Blocks M5.

## Goal
Pull 3 UV detail endpoints + parse into Normalized shapes per design.md §3.3.

## Files
- `server/services/supplierSync/uvDetail.ts` (new)
- `server/services/supplierSync/uvDetail.test.ts` (new)
- `server/services/supplierSync/__fixtures__/uv-*.json` (new)

## Checklist
- [ ] Export `enrichUvProduct(productId, externalCode)` — calls 3 endpoints with rate limit + retry
- [ ] Parser: `parseUvItinerary` (from `getProductTravelDetail`)
- [ ] Parser: `parseUvPriceTerms` (from `getProductMain` price block)
- [ ] Parser: `parseUvNotices` (from `getProductMain` notice block)
- [ ] Parser: `parseUvOptional` (from `getProductGroup` if exists)
- [ ] Note: UV has no equivalent to Lion's `tourInfo` — that field stays `missing` for UV products
- [ ] Fixtures + tests same as M3
- [ ] tsc clean

## Done when
- 4 parsers handle UV responses + edge cases (UV often returns sparse data)
- Test coverage > 80%
