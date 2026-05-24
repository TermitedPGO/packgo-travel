# M5 — BullMQ worker + backfill + daily cron

> Blocked by M3+M4. Blocks M6-M8.

## Goal
End-to-end pipeline: enqueue → worker → enrich → upsert. Plus backfill kick-off script + daily cron per design.md §4.

## Files
- `server/queue.ts` (extend with `supplierDetailEnrichmentQueue` + job data type)
- `server/supplierDetailEnrichmentWorker.ts` (new)
- `server/scripts/backfill-supplier-details.ts` (new)
- `server/supplierDetailEnrichmentWorker.test.ts` (new)

## Checklist
- [ ] Define `SupplierEnrichmentJobData` interface + `supplierDetailEnrichmentQueue` export
- [ ] Worker calls `enrichLionProduct` or `enrichUvProduct` based on `supplierCode`
- [ ] Worker upserts result via `upsertProductDetail`
- [ ] Worker concurrency: 5
- [ ] Retry: 3 attempts, exponential backoff 60s/120s/240s
- [ ] Backfill script: query active products NOT in supplierProductDetails (or stale > 7 days) → enqueue all
- [ ] Backfill prints progress every 100 jobs + ETA
- [ ] Daily cron: registered in `server/queue.ts`, fires at `0 3 * * *` UTC
- [ ] Daily job logic: find new + changed + 30day-stale, enqueue each
- [ ] Vitest: mock enrichLion/Uv, verify upsert + retry behavior
- [ ] Worker is registered in `server/_core/index.ts` startup list (alongside other workers)

## Done when
- Worker runs locally + processes jobs
- Backfill script runs successfully against test DB with 10 fake products
- Daily cron registered, can be inspected via `flyctl cron list` or bull-board
