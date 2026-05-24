# Supplier Deep Sync — Progress

> **Vibe Coding Stage 4 / 4** — 監工視角的進度總覽。

## Modules

| ID | Title | Status | Assignee | Notes |
|----|-------|--------|----------|-------|
| M1 | Schema migration (0083) | ✅ Done | Claude main | drizzle/0083_supplier_product_details.sql + schema.ts updated, tsc clean |
| M2 | sharedDetail helpers (rate-limit, retry, types) | ✅ Done | Claude main | types.ts + sharedDetail.ts + 14 vitest passing |
| M3 | Lion 5-endpoint enrichment + parsers | ✅ Done | Claude main | lionDetail.ts + 22 vitest. travelinfo synthesizes Day 1/N from flight info (daytripinfojson left for Stage 2). |
| M4 | UV 3-endpoint enrichment + parsers | ✅ Done | Claude main | uvDetail.ts + 17 vitest. tourInfo = missing (no UV equivalent). |
| M5 | BullMQ worker + backfill script + daily cron | ✅ Done | Claude main | Worker concurrency 5, daily-cron sentinel pattern, backfill script with ETA, _core/index.ts registered. |
| M6 | TourDetail page rich content sections | ⏳ Blocked by M5 | Sub-agent C | Parallel M6/7/8 |
| M7 | InquiryAgent system prompt context inject | ⏳ Blocked by M5 | Sub-agent D | |
| M8 | Admin SupplierEnrichmentTab + /health | ⏳ Blocked by M5 | Sub-agent E | |

## Decisions (locked from design.md)

- **D1** Backfill: tonight UTC 23:00, 5 concurrent workers, est 3-4 hr
- **D2** Daily sync: 03:00 UTC, picks up new/changed/30day-stale
- **D3** Rate: 2 sec/call, 5 concurrent
- **D4** TourDetail: 4 new sections, fallback to LLM brain-storm if parse fail
- **D5** InquiryAgent: inject top-3 candidate details into system prompt (no RAG this stage)

## Acceptance bar

- [ ] tsc clean
- [ ] i18n parity 100%
- [ ] Vitest cover per module
- [ ] Migration up/down tested
- [ ] Backfill 跑完 ≥ 95% parsed
- [ ] TourDetail (1 Lion + 1 UV product) 顯示 rich content
- [ ] InquiryAgent demo 答 "Lion 東京 5 天 hotel 是哪個牌子"
- [ ] /health degrades when queue depth > 10000

## Log

- 2026-05-24 17:00 UTC — proposal.md + design.md approved by Jeff
- 2026-05-24 17:15 UTC — tasks/M1-M8.md written, coding begins
- 2026-05-24 22:05 UTC — **M1 + M2 shipped**
  - M1: migration 0083 + schema.ts `supplierProductDetails` table + types
  - M2: types.ts (Normalized*) + sharedDetail.ts (rateLimitedCall / withRetry / ok/fail/missing / upsertProductDetail) + 14 unit tests
- 2026-05-24 22:35 UTC — **M3 + M4 + M5 shipped**
  - M3: lionDetail.ts — enrichLionProduct + 5 parsers + 22 vitest
  - M4: uvDetail.ts — enrichUvProduct + 4 parsers (tourInfo missing) + 17 vitest
  - M5: supplierDetailEnrichmentWorker.ts + supplierDetailEnrichmentQueue + backfill script + daily-cron sentinel + _core/index.ts registration
  - Total **86 vitest passing** across supplierSync/
  - tsc clean
  - **Ready to deploy** — migration 0083 needs to push first, then worker auto-spins on app startup
  - Next: M6 (TourDetail render) + M7 (InquiryAgent context) + M8 (admin observability) — parallel-able
