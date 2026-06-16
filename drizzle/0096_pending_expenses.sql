-- 0096_pending_expenses: email-receipt-intake (2026-06-15) — Gmail 收據/發票
-- 自動收單,排成「待確認支出」給 Jeff 逐筆按確認才入帳。
--
-- 1. 新增 pendingExpenses 表 (staging — AI 只接收/讀出/排好,不自己入帳)
--    gmailMessageId UNIQUE → 重複 poll 不重建。
-- 2. accountingEntries 加 `account` enum (trust/operating) — Jeff 確認時填,
--    handledMode='ledger' 才寫一筆分錄。
--
-- IDEMPOTENT (INFORMATION_SCHEMA guards, mirrors 0090/0093/0095)。Additive +
-- nullable,no backfill,no FK。Hand-written per repo convention。

-- 1. pendingExpenses 表 (CREATE TABLE IF NOT EXISTS — additive, safe)
CREATE TABLE IF NOT EXISTS `pendingExpenses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `source` ENUM('gmail','manual','upload') NOT NULL DEFAULT 'gmail',
  `gmailMessageId` VARCHAR(128) NULL,
  `gmailThreadId` VARCHAR(128) NULL,
  `integrationId` INT NULL,
  `fromAddress` VARCHAR(320) NULL,
  `emailSubject` VARCHAR(500) NULL,
  `vendor` VARCHAR(255) NULL,
  `amount` DECIMAL(12,2) NULL,
  `currency` VARCHAR(3) NULL,
  `receiptDate` TIMESTAMP NULL,
  `description` TEXT NULL,
  `extractionConfidence` INT NOT NULL DEFAULT 0,
  `needsReview` INT NOT NULL DEFAULT 0,
  `extractionRaw` TEXT NULL,
  `attachmentKey` VARCHAR(1024) NULL,
  `attachmentFilename` VARCHAR(512) NULL,
  `attachmentMimeType` VARCHAR(128) NULL,
  `status` ENUM('pending','confirmed','rejected') NOT NULL DEFAULT 'pending',
  `handledMode` ENUM('ledger','receipt_only') NULL,
  `account` ENUM('trust','operating') NULL,
  `entryCategory` VARCHAR(50) NULL,
  `bookingId` INT NULL,
  `accountingEntryId` INT NULL,
  `rejectReason` VARCHAR(500) NULL,
  `createdBy` INT NULL,
  `confirmedBy` INT NULL,
  `confirmedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_pending_gmail_msg` (`gmailMessageId`),
  KEY `idx_pending_status` (`status`, `createdAt`)
);

-- 2. accountingEntries.account enum (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'accountingEntries'
    AND COLUMN_NAME = 'account'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `accountingEntries` ADD COLUMN `account` ENUM(''trust'',''operating'') NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
