-- 0101_interaction_external_id: gmail-full-thread-filing MVP [1] — 對話收齊冪等鍵 (2026-06-23)。
-- customerInteractions.externalId    (VARCHAR 255 NULL) — RFC822 Message-ID,跨帳號同一封去重鍵。
-- customerInteractions.gmailThreadId (VARCHAR 255 NULL) — Gmail thread id,身分層 same_thread 信號預留。
-- UNIQUE(customerProfileId, externalId) — 同一客人同一封只一列;MySQL 唯一索引允許多 NULL,既有 453 列(externalId 全 NULL)不衝突。
--
-- Additive、nullable、no backfill(既有列由 server/_core/threadFiling.ts claim-or-insert 認領)。
-- Hand-written,idempotent(INFORMATION_SCHEMA guard,mirror 0100)。

-- 1. customerInteractions.externalId (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerInteractions'
    AND COLUMN_NAME = 'externalId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `customerInteractions` ADD COLUMN `externalId` VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 2. customerInteractions.gmailThreadId (idempotent — only add if missing)
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerInteractions'
    AND COLUMN_NAME = 'gmailThreadId'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `customerInteractions` ADD COLUMN `gmailThreadId` VARCHAR(255) NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

-- 3. UNIQUE(customerProfileId, externalId) (idempotent — only add if missing)
SET @c3 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customerInteractions'
    AND INDEX_NAME = 'uq_ci_profile_external'
);
SET @sql3 = IF(@c3 = 0,
  'ALTER TABLE `customerInteractions` ADD UNIQUE INDEX `uq_ci_profile_external` (`customerProfileId`, `externalId`)',
  'SELECT 1'
);
PREPARE s3 FROM @sql3;
EXECUTE s3;
DEALLOCATE PREPARE s3;
