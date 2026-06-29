-- 0102_customer_follow_up_date: Q4-A 客人頁「跟進日」— 每位客人一個可選的跟進日期 (2026-06-29)。
-- Jeff 可在客人駕駛艙的真相條上替某位客人設一個跟進日;到期(日期 <= 今天,
-- America/Los_Angeles 紐瓦克時區)時,卡片頂端深色提醒「今天該跟進」。
--
-- customerProfiles.followUpDate (DATE NULL) — 純日曆日期,不含時間/時區;NULL = 沒設。
--   存 DATE 而非 TIMESTAMP,client 用 "YYYY-MM-DD" 字串比較,避免 UTC 換日漂移。
--
-- Additive、nullable、no backfill、no FK。Hand-written,idempotent
-- (INFORMATION_SCHEMA guard,mirror 0098/0100/0101)。

-- 1. customerProfiles.followUpDate (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'followUpDate'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerProfiles` ADD COLUMN `followUpDate` DATE NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
