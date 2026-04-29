-- v78z-z3 Sprint 11: poster generation logs.
-- Tracks every gpt-image-2 call for cost surface + budget enforcement.
-- Idempotent: skip CREATE TABLE if already exists (in case dev DB was
-- pre-pushed via drizzle-kit).

SET @tbl_exists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'posterGenLogs'
);
SET @sql = IF(@tbl_exists = 0,
  'CREATE TABLE `posterGenLogs` (
    `id` int AUTO_INCREMENT NOT NULL,
    `tourId` int,
    `prompt` text NOT NULL,
    `size` varchar(16) NOT NULL,
    `quality` varchar(16) NOT NULL,
    `costUsd` varchar(16) NOT NULL,
    `durationMs` int NOT NULL,
    `storageKey` varchar(512),
    `status` varchar(32) NOT NULL,
    `errorMessage` text,
    `generatedBy` int,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `posterGenLogs_id` PRIMARY KEY(`id`)
  )',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'posterGenLogs'
    AND INDEX_NAME = 'posterGenLogs_createdAt_idx'
);
SET @idx_sql = IF(@idx_exists = 0,
  'CREATE INDEX `posterGenLogs_createdAt_idx` ON `posterGenLogs` (`createdAt`)',
  'SELECT 1'
);
PREPARE idxstmt FROM @idx_sql;
EXECUTE idxstmt;
DEALLOCATE PREPARE idxstmt;
