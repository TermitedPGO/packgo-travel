-- Down for 0107_order_ai_understanding — drop the two columns if present.
-- Idempotent (INFORMATION_SCHEMA guard).

-- 1. drop aiUnderstandingAt if present
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customOrders'
    AND COLUMN_NAME = 'aiUnderstandingAt'
);
SET @sql2 = IF(@c2 = 1,
  'ALTER TABLE `customOrders` DROP COLUMN `aiUnderstandingAt`',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- 2. drop aiUnderstanding column if present
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customOrders'
    AND COLUMN_NAME = 'aiUnderstanding'
);
SET @sql1 = IF(@c1 = 1,
  'ALTER TABLE `customOrders` DROP COLUMN `aiUnderstanding`',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
