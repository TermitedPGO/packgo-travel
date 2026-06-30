# m1 — schema + migration

目標:給 `customerChatMessages` 與 `customerInteractions` 各加一個 nullable `customOrderId`,
加 migration 0103。Additive、no backfill、no FK(soft ref,沿用專案慣例)。

## Checklist
- [ ] drizzle/schema.ts:`customerChatMessages` 加 `customOrderId: int("customOrderId")` + index `idx_ccm_order` on (customOrderId, createdAt)
- [ ] drizzle/schema.ts:`customerInteractions` 加 `customOrderId: int("customOrderId")` + index `idx_int_order` on (customOrderId, createdAt)
- [x] drizzle/0104_customer_projects.sql (+ .down.sql):idempotent ADD COLUMN ×2 + ADD INDEX ×2(INFORMATION_SCHEMA guard,mirror 0103)
- [ ] tsc 綠(型別 `$inferSelect` 自動帶新欄)

## 驗收
- 既有列 `customOrderId` = NULL,語意「未分類」,不破任何既有 query。
- migration 重跑不報錯(冪等)。
