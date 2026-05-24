# Supplier Deep Sync — Progress

> **Vibe Coding Stage 4 / 4** — 監工視角的進度總覽。

## Modules

| ID | Title | Status | Assignee | Notes |
|----|-------|--------|----------|-------|
| M1 | Schema migration (0083) | ✅ Done | Claude main | drizzle/0083_supplier_product_details.sql + schema.ts updated, tsc clean |
| M2 | sharedDetail helpers (rate-limit, retry, types) | ✅ Done | Claude main | types.ts + sharedDetail.ts + 14 vitest passing |
| M3 | Lion 5-endpoint enrichment + parsers | ⏳ Blocked by M2 | Sub-agent A | Parallel with M4 |
| M4 | UV 3-endpoint enrichment + parsers | ⏳ Blocked by M2 | Sub-agent B | Parallel with M3 |
| M5 | BullMQ worker + backfill script + daily cron | ⏳ Blocked by M3+M4 | Claude main | |
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
  - tsc clean, vitest pass
  - **Migration NOT yet pushed to prod** — push when M5 ready to consume
  - Next session pick up at M3 (Lion 5-endpoint detail parsers)
