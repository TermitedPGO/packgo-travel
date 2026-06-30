-- 0105_project_category: 客人專案加「總類」— flight / quote / visa / general (2026-06-30)。
-- 讓每條專案 chat 讀成「時間 · 總類 · 幹嘛」。起因:Emerald(AXT 協調人)一個信箱送很多
-- 不同案子(Morris 機票、Weiguo 機票、Leslie 先生簽證、員工家屬機票…),總類用來一眼分辨。
--
-- customOrders.category (VARCHAR(32) NULL) — 存 key(flight/quote/visa/general),
--   UI 映射到 i18n 標籤;varchar 而非 enum,日後加類別免 migration。NULL = 未標。
--
-- Additive、nullable、no backfill、no FK。Hand-written,idempotent
-- (INFORMATION_SCHEMA guard,mirror 0102/0103/0104)。

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customOrders'
    AND COLUMN_NAME = 'category'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customOrders` ADD COLUMN `category` VARCHAR(32) NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
