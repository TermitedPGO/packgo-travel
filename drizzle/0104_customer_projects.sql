-- 0104_customer_projects: 客人專案分層 — 每位常客的每一單(customOrder)獨立成專案,
-- 各自的 AI 工作台對話 + 真實往來 + AI 上下文 (2026-06-30)。
-- design: docs/features/customer-projects/design.md。
--
-- 兩個 nullable soft-ref 欄(無 FK,沿用 bookingId/quoteId 慣例):
--   customerChatMessages.customOrderId (INT NULL) — Jeff↔AI 工作台對話綁哪一單。
--   customerInteractions.customOrderId  (INT NULL) — 真實 Gmail/email 往來歸哪一單。
-- 兩者 NULL 一律語意「未分類」籃子;既有列全是 NULL → 向後相容,Gmail filing 不改也自然落未分類。
--
-- Additive、nullable、no backfill、no FK。Hand-written,idempotent
-- (INFORMATION_SCHEMA guard,mirror 0098/0100/0101/0102/0103)。

-- 1. customerChatMessages.customOrderId (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerChatMessages'
    AND COLUMN_NAME = 'customOrderId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerChatMessages` ADD COLUMN `customOrderId` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customerChatMessages idx_ccm_order (customOrderId, createdAt)
SET @i1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerChatMessages'
    AND INDEX_NAME = 'idx_ccm_order'
);
SET @sqlI1 = IF(@i1 = 0,
  'ALTER TABLE `customerChatMessages` ADD INDEX `idx_ccm_order` (`customOrderId`, `createdAt`)',
  'SELECT 1'
);
PREPARE sI1 FROM @sqlI1;
EXECUTE sI1;
DEALLOCATE PREPARE sI1;

-- 3. customerInteractions.customOrderId (idempotent — only add if missing)
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerInteractions'
    AND COLUMN_NAME = 'customOrderId'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `customerInteractions` ADD COLUMN `customOrderId` INT NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- 4. customerInteractions idx_int_order (customOrderId, createdAt)
SET @i2 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerInteractions'
    AND INDEX_NAME = 'idx_int_order'
);
SET @sqlI2 = IF(@i2 = 0,
  'ALTER TABLE `customerInteractions` ADD INDEX `idx_int_order` (`customOrderId`, `createdAt`)',
  'SELECT 1'
);
PREPARE sI2 FROM @sqlI2;
EXECUTE sI2;
DEALLOCATE PREPARE sI2;
