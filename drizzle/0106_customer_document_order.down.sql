-- Down for 0106_customer_document_order — drop the index + column if present.
-- Idempotent (INFORMATION_SCHEMA / STATISTICS guard).

-- 1. drop idx_doc_order if present
SET @i1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerDocuments'
    AND INDEX_NAME = 'idx_doc_order'
);
SET @sqlI1 = IF(@i1 > 0,
  'ALTER TABLE `customerDocuments` DROP INDEX `idx_doc_order`',
  'SELECT 1'
);
PREPARE sI1 FROM @sqlI1;
EXECUTE sI1;
DEALLOCATE PREPARE sI1;

-- 2. drop customOrderId column if present
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerDocuments'
    AND COLUMN_NAME = 'customOrderId'
);
SET @sql1 = IF(@c1 = 1,
  'ALTER TABLE `customerDocuments` DROP COLUMN `customOrderId`',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
