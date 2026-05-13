-- Phase 1 of PACK&GO LLC bookkeeping automation: Plaid integration tables.
-- Jeff connects bank accounts + credit cards via Plaid Link, transactions
-- flow into bankTransactions, AccountingAgent categorizes them, year-end
-- exports to CPA for filing.
--
-- Three tables:
--   linkedBankAccounts  — one row per Plaid Item × Account (a single Plaid
--                          Item = one bank login, can contain multiple
--                          accounts e.g. checking + savings + credit card)
--   bankTransactions    — one row per posted/pending transaction pulled from
--                          Plaid /transactions/sync
--   plaidWebhookEvents  — audit trail of every incoming Plaid webhook body
--
-- HISTORY NOTE: an earlier version of this file wrapped each CREATE TABLE
-- in `SET @sql := IF(NOT EXISTS …); PREPARE stmt; EXECUTE; DEALLOCATE`
-- for idempotency. drizzle-orm's migrator considered that migration applied
-- on the first run, but the DDL inside the PREPARE block silently no-op'd
-- on TiDB Cloud (production target). Result: __drizzle_migrations gained
-- the row but the tables never existed → Phase 0 deploy looked successful
-- but every plaid.* tRPC query 500'd on missing table. Hotfix: manual
-- CREATE via SSH; permanent fix: this rewrite using plain
-- CREATE TABLE IF NOT EXISTS (which TiDB handles natively).
--
-- See docs/MIGRATION_PATTERNS.md for the full post-mortem and rules to
-- follow for future migrations.

CREATE TABLE IF NOT EXISTS `linkedBankAccounts` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `userId` INT NOT NULL,
  `plaidItemId` VARCHAR(64) NOT NULL,
  `plaidAccountId` VARCHAR(128) NOT NULL,
  `plaidAccessTokenEncrypted` TEXT NOT NULL,
  `plaidInstitutionId` VARCHAR(64),
  `institutionName` VARCHAR(128) NOT NULL,
  `institutionLogoUrl` VARCHAR(512),
  `accountMask` VARCHAR(8),
  `accountName` VARCHAR(128) NOT NULL,
  `accountOfficialName` VARCHAR(256),
  `accountType` ENUM('depository','credit','loan','investment','other') NOT NULL,
  `accountSubtype` VARCHAR(32),
  `isTrustAccount` TINYINT NOT NULL DEFAULT 0,
  `isActive` TINYINT NOT NULL DEFAULT 1,
  `currentBalance` DECIMAL(14,2),
  `availableBalance` DECIMAL(14,2),
  `isoCurrencyCode` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `cursor` VARCHAR(512),
  `lastSyncedAt` TIMESTAMP NULL,
  `lastSyncError` TEXT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_plaid_account` (`plaidAccountId`),
  KEY `idx_user_active` (`userId`,`isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `bankTransactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `linkedAccountId` INT NOT NULL,
  `plaidTransactionId` VARCHAR(128) NOT NULL,
  `date` DATE NOT NULL,
  `authorizedDate` DATE,
  `amount` DECIMAL(14,2) NOT NULL,
  `isoCurrencyCode` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `merchantName` VARCHAR(256),
  `description` TEXT,
  `paymentChannel` VARCHAR(32),
  `plaidCategoryPrimary` VARCHAR(64),
  `plaidCategoryDetailed` VARCHAR(128),
  `agentCategory` VARCHAR(64),
  `agentConfidence` INT,
  `agentReasoning` TEXT,
  `jeffOverrideCategory` VARCHAR(64),
  `jeffOverrideReason` TEXT,
  `excludeFromAccounting` TINYINT NOT NULL DEFAULT 0,
  `excludeReason` VARCHAR(256),
  `isPending` TINYINT NOT NULL DEFAULT 0,
  `accountOwner` VARCHAR(128),
  `relatedBookingId` INT,
  `relatedInquiryId` INT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_plaid_txn` (`plaidTransactionId`),
  KEY `idx_account_date` (`linkedAccountId`,`date` DESC),
  KEY `idx_agent_category` (`agentCategory`,`date` DESC),
  KEY `idx_pending` (`isPending`,`date` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `plaidWebhookEvents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `webhookType` VARCHAR(64) NOT NULL,
  `webhookCode` VARCHAR(64) NOT NULL,
  `plaidItemId` VARCHAR(64),
  `payload` TEXT,
  `processedAt` TIMESTAMP NULL,
  `processedSuccess` TINYINT NOT NULL DEFAULT 0,
  `processedError` TEXT,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_item_created` (`plaidItemId`,`createdAt` DESC),
  KEY `idx_unprocessed` (`processedSuccess`,`createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
