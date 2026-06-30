-- Down for 0103_gmail_watch_expiration — drop the watchExpiration column if present.
-- Idempotent (INFORMATION_SCHEMA guard).

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'gmailIntegration'
    AND COLUMN_NAME = 'watchExpiration'
);
SET @sql1 = IF(@c1 = 1,
  'ALTER TABLE `gmailIntegration` DROP COLUMN `watchExpiration`',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
