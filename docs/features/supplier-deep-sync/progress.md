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
| M6 | TourDetail page rich content sections | ✅ Done | Claude main | SupplierDetailSection.tsx, tours.getSupplierDetail tRPC, accordion-based 4 sections, i18n keys added |
| M7 | InquiryAgent system prompt context inject | ⏳ Deferred — needs new design (InquiryAgent doesn't currently search products) | future session | |
| M8 | Admin SupplierEnrichmentTab + /health | ✅ Done | Claude main | Tab live at /admin/v2 → 系統 → 🌏 供應商深度同步. Auto-refresh 10s. Re-enrich buttons wire tRPC. |

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

- 2026-05-24 23:15 UTC — **PROD DEPLOYED** + bugs fixed
  - Initial deploy missed migration because 0083 not in `drizzle/meta/_journal.json` — fixed in commit `48bdc48` (drizzle migrate() only runs migrations registered in journal, not just .sql files in folder)
  - Backfill script in `scripts/` not bundled to prod container (Dockerfile copies /app/server/assets only) — replaced with `suppliers.triggerFullBackfill` tRPC mutation (commit `c94ad1a`)
  - Migration 0083 ran cleanly after journal fix
  - **Backfill triggered via tRPC** — 5728 jobs enqueued

- 2026-05-24 23:42 UTC — **M8 shipped, backfill running**
  - SupplierEnrichmentTabV2 live at `/admin/v2` → 系統 → 🌏 供應商深度同步
  - Auto-refreshes every 10s. Per-supplier matrix: parsed / parse_failed / missing + progress bar + last enriched
  - "Re-enrich now" buttons wire `suppliers.triggerFullBackfill`
  - **Backfill status @ 23:42**: Lion 128/4590 (2.8%), UV 0/1138 (worker processes Lion first due to FIFO ordering). ETA full completion: ~3-5 hours.

- Remaining: M6 (TourDetail render rich content) + M7 (InquiryAgent context inject) — defer to fresh session for context safety

- 2026-05-25 00:40 UTC — **M6 shipped, end of Stage 1**
  - SupplierDetailSection.tsx: 4 accordion sections (itinerary days / price terms / notices / optional)
  - tRPC `tours.getSupplierDetail(tourId)`: resolves sourceUrl pattern → supplierProduct → supplierProductDetails, returns pre-parsed JSON
  - Wired into TourDetailPeony/index.tsx after NotesSection
  - i18n keys added for zh-TW + en (ja/ko inherit en via spread)
  - **Visually verified** on prod tour 1230427 (關西四日): DAY 1/4 cards render with flight info + meal indicators; 費用說明 accordion expands showing 包含 (簽證費/機場稅) + 付款條件; 注意事項 accordion visible; 最後更新時間戳對齊右側
  - Falls back silently when supplierProductDetails has no parsed data (e.g. backfill not yet processed)

**Stage 1 complete: 7/8 modules (M7 deferred — needs redesign since InquiryAgent doesn't currently search products).**

Backfill continues running. Customer-facing TourDetail pages now auto-show rich supplier content as backfill enriches each product.
