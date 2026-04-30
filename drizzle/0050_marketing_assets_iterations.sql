-- v78z-z3 Sprint 11: Image 2.0 Phase A v1.
-- Two new tables for the ChatGPT-in-admin poster composer:
--   marketingAssets: reference image library (logo / photo / past poster)
--   posterIterations: per-project iteration history (v1 / v2 / v3...)
-- Both idempotent.

SET @t1_exists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketingAssets'
);
SET @t1_sql = IF(@t1_exists = 0,
  'CREATE TABLE `marketingAssets` (
    `id` int AUTO_INCREMENT NOT NULL,
    `ownerId` int,
    `kind` varchar(32) NOT NULL,
    `label` varchar(200) NOT NULL,
    `storageKey` varchar(512) NOT NULL,
    `width` int,
    `height` int,
    `fileSize` int,
    `mimeType` varchar(64),
    `notes` text,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `marketingAssets_id` PRIMARY KEY(`id`)
  )',
  'SELECT 1'
);
PREPARE s1 FROM @t1_sql;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @t2_exists = (
  SELECT COUNT(*) FROM information_schema.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posterIterations'
);
SET @t2_sql = IF(@t2_exists = 0,
  'CREATE TABLE `posterIterations` (
    `id` int AUTO_INCREMENT NOT NULL,
    `projectKey` varchar(64) NOT NULL,
    `parentIterationId` int,
    `ownerId` int,
    `prompt` text NOT NULL,
    `mode` varchar(16) NOT NULL,
    `size` varchar(16) NOT NULL,
    `quality` varchar(16) NOT NULL,
    `costUsd` varchar(16) NOT NULL,
    `durationMs` int NOT NULL,
    `storageKey` varchar(512),
    `status` varchar(32) NOT NULL,
    `errorMessage` text,
    `referenceAssetIds` text,
    `createdAt` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT `posterIterations_id` PRIMARY KEY(`id`)
  )',
  'SELECT 1'
);
PREPARE s2 FROM @t2_sql;
EXECUTE s2;
DEALLOCATE PREPARE s2;

SET @idx1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'marketingAssets' AND INDEX_NAME = 'marketingAssets_kind_idx'
);
SET @idx1_sql = IF(@idx1 = 0,
  'CREATE INDEX `marketingAssets_kind_idx` ON `marketingAssets` (`kind`)',
  'SELECT 1'
);
PREPARE s3 FROM @idx1_sql;
EXECUTE s3;
DEALLOCATE PREPARE s3;

SET @idx2 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'posterIterations' AND INDEX_NAME = 'posterIterations_project_idx'
);
SET @idx2_sql = IF(@idx2 = 0,
  'CREATE INDEX `posterIterations_project_idx` ON `posterIterations` (`projectKey`)',
  'SELECT 1'
);
PREPARE s4 FROM @idx2_sql;
EXECUTE s4;
DEALLOCATE PREPARE s4;
