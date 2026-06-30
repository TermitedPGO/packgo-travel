-- Down for 0105_project_category — drop the category column if present.
-- Idempotent (INFORMATION_SCHEMA guard).

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customOrders'
    AND COLUMN_NAME = 'category'
);
SET @sql1 = IF(@c1 = 1,
  'ALTER TABLE `customOrders` DROP COLUMN `category`',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
