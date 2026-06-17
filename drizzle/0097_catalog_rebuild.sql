-- 0097_catalog_rebuild: tour-catalog-rebuild chunk 1 (2026-06-16) — UV+Lion
-- 重抓換批的「就地更新 + 快照回滾」地基(換批機制 C+C1,見
-- docs/features/tour-catalog-rebuild/tasks/chunk-1-rescrape-pipeline.md §3)。
--
-- 1. catalogBatches:一級批次物件(一次重抓一筆,記 scope/狀態/完整度統計/
--    replacedBatchId 供回滾)。
-- 2. toursCatalogArchive:promote 前的舊 tour 列整列 JSON 快照(回滾來源)。
-- 3. tours 加 batchId / lastBatchAt(就地更新標記,id 不變、不傷 FK/URL/SEO)。
--
-- IDEMPOTENT (CREATE TABLE IF NOT EXISTS + INFORMATION_SCHEMA guards,
-- mirrors 0093/0095/0096)。Additive + nullable,no backfill,no FK。
-- Hand-written per repo convention。

-- 1. catalogBatches 表
CREATE TABLE IF NOT EXISTS `catalogBatches` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `scope` ENUM('lion','uv','both') NOT NULL,
  `status` ENUM('staging','live','archived','failed') NOT NULL DEFAULT 'staging',
  `toursTotal` INT NOT NULL DEFAULT 0,
  `toursComplete` INT NOT NULL DEFAULT 0,
  `toursIncomplete` INT NOT NULL DEFAULT 0,
  `toursPromoted` INT NOT NULL DEFAULT 0,
  `replacedBatchId` INT NULL,
  `notes` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `promotedAt` TIMESTAMP NULL,
  `archivedAt` TIMESTAMP NULL,
  KEY `idx_catalogBatch_status` (`status`, `createdAt`)
);

-- 2. toursCatalogArchive 表(快照,回滾來源)
CREATE TABLE IF NOT EXISTS `toursCatalogArchive` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `batchId` INT NOT NULL,
  `tourId` INT NOT NULL,
  `snapshotJson` MEDIUMTEXT NOT NULL,
  `archivedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_toursArchive_batch` (`batchId`),
  KEY `idx_toursArchive_tour` (`tourId`, `archivedAt`)
);

-- 3. tours.batchId (idempotent — only add if missing)
SET @c_batchId = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tours'
    AND COLUMN_NAME = 'batchId'
);
SET @sql_batchId = IF(@c_batchId = 0,
  'ALTER TABLE `tours` ADD COLUMN `batchId` INT NULL',
  'SELECT 1'
);
PREPARE s_batchId FROM @sql_batchId;
EXECUTE s_batchId;
DEALLOCATE PREPARE s_batchId;

-- 4. tours.lastBatchAt (idempotent — only add if missing)
SET @c_lastBatchAt = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tours'
    AND COLUMN_NAME = 'lastBatchAt'
);
SET @sql_lastBatchAt = IF(@c_lastBatchAt = 0,
  'ALTER TABLE `tours` ADD COLUMN `lastBatchAt` TIMESTAMP NULL',
  'SELECT 1'
);
PREPARE s_lastBatchAt FROM @sql_lastBatchAt;
EXECUTE s_lastBatchAt;
DEALLOCATE PREPARE s_lastBatchAt;
