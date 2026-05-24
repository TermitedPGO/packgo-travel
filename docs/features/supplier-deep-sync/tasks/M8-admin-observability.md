# M8 — Admin observability + health check

> Blocked by M5. Parallel with M6+M7.

## Goal
Admin tab showing per-supplier enrichment status + /health depth check per design.md §7.

## Files
- `client/src/components/admin-v2/SupplierEnrichmentTabV2.tsx` (new)
- `server/routers/suppliersRouter.ts` (extend: `enrichmentOverview` query + `reEnrichMissing` mutation)
- `server/_core/healthCheck.ts` (extend: supplier queue depth check)
- `client/src/pages/AdminV2.tsx` (register new tab under 系統 domain)

## Checklist
- [ ] tRPC query `suppliers.enrichmentOverview` returns:
  ```
  { lion: { total, itineraryParsed, parseFailed, missing }, uv: {...} }
  ```
- [ ] tRPC mutation `suppliers.reEnrichMissing(supplierCode)` enqueues all missing + parse_failed jobs
- [ ] Admin tab renders matrix table + per-supplier "Re-enrich now" button
- [ ] Tab also shows last 20 enrichment runs (timestamp, count processed, fail count)
- [ ] `/health` adds `supplierEnrichment` check: degraded if queue depth > 10000 OR last successful job > 48h ago
- [ ] Follow admin design system tokens (Trip.com-style, rounded-xl cards)
- [ ] Vitest: RTL test the tab + tRPC unit tests
- [ ] i18n parity: new copy in 4 locales

## Done when
- Tab visible in admin /admin/v2 under 系統
- /health check correctly degrades when queue is backed up
- Re-enrich button works end-to-end
