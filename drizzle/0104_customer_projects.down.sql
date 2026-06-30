-- Down for 0104_customer_projects — drop the two customOrderId columns (and their
-- indexes, which MySQL drops automatically with the column) if present.
-- Idempotent (INFORMATION_SCHEMA guard).

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerChatMessages'
    AND COLUMN_NAME = 'customOrderId'
);
SET @sql1 = IF(@c1 = 1,
  'ALTER TABLE `customerChatMessages` DROP COLUMN `customOrderId`',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerInteractions'
    AND COLUMN_NAME = 'customOrderId'
);
SET @sql2 = IF(@c2 = 1,
  'ALTER TABLE `customerInteractions` DROP COLUMN `customOrderId`',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
