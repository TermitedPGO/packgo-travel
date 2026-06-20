-- 0098_manual_customer: 客人頁「新增客人」— 手動建立客人 (2026-06-20)。
-- Jeff 可在客人頁手動加一位客人(電話/微信/轉介紹來、不是從網站表單進來的)。
-- 存成一筆 customerProfiles guest row (userId NULL, source='manual')。
--
-- 兩個欄位都加在 customerProfiles：
--   name   — 手動客人姓名 (guest 本來只能從 email 推名)。
--   source — 標記手動建立 ('manual'),讓 guestList 不靠詢問也能顯示這位客人。
--
-- IDEMPOTENT (INFORMATION_SCHEMA guards, mirrors 0096)。Additive + nullable,
-- no backfill,no FK。Hand-written per repo convention。

-- 1. customerProfiles.name (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'name'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `name` VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customerProfiles.source (idempotent — only add if missing)
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'source'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `source` VARCHAR(20) NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
