-- Down for 0108_customer_unread — drop the two columns if present.
-- Idempotent (INFORMATION_SCHEMA guard).

-- 1. drop jeffViewedAt if present
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'jeffViewedAt'
);
SET @sql2 = IF(@c2 = 1,
  'ALTER TABLE `customerProfiles` DROP COLUMN `jeffViewedAt`',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- 2. drop lastInboundAt if present
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'lastInboundAt'
);
SET @sql1 = IF(@c1 = 1,
  'ALTER TABLE `customerProfiles` DROP COLUMN `lastInboundAt`',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
