-- 0100_customer_ai_summary: customer-ai-sessions 批3 m3 — AI 摘要快取兩欄 (2026-06-22)。
-- customerProfiles.aiSummary  (JSON)      — 四欄結論 {wants, actions, delivered, nextStep}
-- customerProfiles.aiSummaryAt(TIMESTAMP) — 算的時間;NULL = 從沒算過 → 開卡 lazy 算,cron 暖最近有動靜的。
--
-- 只存 business 結論,絕不存 PDF 原文 / PII(那些只進 prompt,見 server/_core/customerDocsText.ts)。
-- Additive、nullable、no backfill。Hand-written,idempotent(INFORMATION_SCHEMA guard,mirror 0098/0099)。

-- 1. customerProfiles.aiSummary (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'aiSummary'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `aiSummary` JSON NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customerProfiles.aiSummaryAt (idempotent — only add if missing)
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'aiSummaryAt'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `aiSummaryAt` TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
