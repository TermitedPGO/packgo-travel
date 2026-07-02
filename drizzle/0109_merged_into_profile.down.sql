-- Down for 0109_merged_into_profile — drop the column if present.
-- Idempotent (INFORMATION_SCHEMA guard).

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerProfiles'
    AND COLUMN_NAME = 'mergedIntoProfileId'
);
SET @sql1 = IF(@c1 = 1,
  'ALTER TABLE `customerProfiles` DROP COLUMN `mergedIntoProfileId`',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
