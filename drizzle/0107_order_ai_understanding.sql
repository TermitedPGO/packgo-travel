-- 0107_order_ai_understanding: customOrders 加 aiUnderstanding/aiUnderstandingAt — AI 客人理解跟著專案走 (2026-07-01)。
-- 起因:Jeff「AI 客人理解 每一個專案都應該是專門的 太多會太亂」。概覽 tab 選了專案 chip
-- 時,AI 客人理解要顯示「這張 customOrder 自己的」理解,不是整戶大雜燴。手動「重新分析」
-- (analyzeOrder)才算,算完存這裡當快取 — 絕不自動燒 LLM。
--
-- customOrders.aiUnderstanding (TEXT NULL) — 這個專案專屬的客人理解(一段敘述 + 條列
--   key facts,繁中,搬運不生成)。NULL = 還沒分析(客戶頁顯示誠實空狀態)。
-- customOrders.aiUnderstandingAt (TIMESTAMP NULL) — 上次分析時間(卡片 caption 用)。
--
-- Additive、nullable、no backfill、no FK。Hand-written,idempotent
-- (INFORMATION_SCHEMA guard,mirror 0104/0105/0106)。

-- 1. customOrders.aiUnderstanding (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customOrders'
    AND COLUMN_NAME = 'aiUnderstanding'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customOrders` ADD COLUMN `aiUnderstanding` TEXT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customOrders.aiUnderstandingAt (idempotent — only add if missing)
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customOrders'
    AND COLUMN_NAME = 'aiUnderstandingAt'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `customOrders` ADD COLUMN `aiUnderstandingAt` TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
