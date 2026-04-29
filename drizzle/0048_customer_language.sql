-- v78y: customerLanguage column on bookings.
-- This column was previously added to prod manually via `flyctl ssh` so the
-- bilingual email pipeline (booking confirmation / payment success / 5-window
-- trip reminders) can pick the right locale per customer.
--
-- This migration is IDEMPOTENT — it checks INFORMATION_SCHEMA before issuing
-- ALTER TABLE so it's safe to run on prod (where the column already exists)
-- and on a fresh dev database (where it doesn't).
--
-- DO NOT use `drizzle-kit generate` for this column — it would emit a plain
-- `ALTER TABLE bookings ADD COLUMN customerLanguage ...` which fails on prod
-- with "Duplicate column name 'customerLanguage'".

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'customerLanguage'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE `bookings` ADD COLUMN `customerLanguage` VARCHAR(8) DEFAULT ''zh-TW''',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
