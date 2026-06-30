-- 0103_gmail_watch_expiration: gmail-push — Gmail 推送(Pub/Sub)watch 到期時間 (2026-06-29)。
-- 把「每 3 分鐘輪詢 Gmail」升級成 Gmail push 達到秒級通知;輪詢保留作 fallback/對帳。
--
-- gmailIntegration.watchExpiration (BIGINT NULL) — users.watch 回傳的到期時間,
--   存 epoch 毫秒(Gmail 直接回 ms-since-epoch)。NULL = 目前沒有 active watch。
--   每天的續租 cron(scheduleGmailWatchRenew)會對「到期時間落在續租視窗內」的
--   integration 重新 watch。用 BIGINT 因為 epoch-ms 會超出 INT 範圍。
--
-- Additive、nullable、no backfill、no FK。Hand-written,idempotent
-- (INFORMATION_SCHEMA guard,mirror 0098/0100/0101/0102)。

-- 1. gmailIntegration.watchExpiration (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gmailIntegration'
    AND COLUMN_NAME = 'watchExpiration'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `gmailIntegration` ADD COLUMN `watchExpiration` BIGINT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
