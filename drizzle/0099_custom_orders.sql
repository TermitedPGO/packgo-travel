-- 0099_custom_orders: 訂製單 (custom-orders) — 把一筆訂製單做成系統真正一筆訂單 (2026-06-21)。
-- 報價 → 收款(訂金/尾款)→ 確認 串成 customOrders 一列。客戶頁三顆按鈕落在這列上。
-- 設計:docs/features/custom-orders/design.md。
--
-- 兩步,皆 IDEMPOTENT(CREATE TABLE IF NOT EXISTS + INFORMATION_SCHEMA guard,mirror 0098):
--   1. CREATE TABLE customOrders
--   2. invoices.customOrderId(反向 FK,一單可多張發票)
-- Additive、nullable、no backfill、no DB FK(repo 慣例:靠 index 不靠 FK)。Hand-written。
--
-- 紅線(編碼於欄位):supplierCost 手動+絕不上客人文件;depositPaidAt/balancePaidAt
-- 只記已收,不是營收認列(CA B&P §17550,Trust 對帳另走銀行+會計)。

-- 1. customOrders (idempotent — IF NOT EXISTS)
CREATE TABLE IF NOT EXISTS `customOrders` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `orderNumber` VARCHAR(32) NOT NULL,
  `customerProfileId` INT NOT NULL,
  `userId` INT NULL,
  `customerName` VARCHAR(200) NOT NULL,
  `customerEmail` VARCHAR(320) NULL,
  `title` VARCHAR(200) NOT NULL,
  `destination` VARCHAR(200) NULL,
  `departureDate` DATE NULL,
  `returnDate` DATE NULL,
  `status` ENUM('draft','quoted','arranged','deposit_paid','paid','confirmed','departed','completed','cancelled') NOT NULL DEFAULT 'draft',
  `needsQuote` INT NOT NULL DEFAULT 1,
  `quotePdfUrl` VARCHAR(1024) NULL,
  `quoteId` INT NULL,
  `quoteSentAt` TIMESTAMP NULL DEFAULT NULL,
  `totalPrice` DECIMAL(12,2) NULL,
  `depositAmount` DECIMAL(12,2) NULL,
  `balanceAmount` DECIMAL(12,2) NULL,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `supplierCost` DECIMAL(12,2) NULL,
  `depositPaidAt` TIMESTAMP NULL DEFAULT NULL,
  `balancePaidAt` TIMESTAMP NULL DEFAULT NULL,
  `depositPaidAmount` DECIMAL(12,2) NULL,
  `balancePaidAmount` DECIMAL(12,2) NULL,
  `depositPaymentLink` VARCHAR(2048) NULL,
  `balancePaymentLink` VARCHAR(2048) NULL,
  `collectionSentAt` TIMESTAMP NULL DEFAULT NULL,
  `paymentMethod` VARCHAR(20) NULL,
  `confirmationPdfUrl` VARCHAR(1024) NULL,
  `confirmedAt` TIMESTAMP NULL DEFAULT NULL,
  `recognizedAt` TIMESTAMP NULL DEFAULT NULL,
  `bookingId` INT NULL,
  `notes` TEXT NULL,
  `createdBy` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `customOrders_orderNumber_unique` (`orderNumber`),
  KEY `idx_co_profile` (`customerProfileId`, `createdAt`),
  KEY `idx_co_user` (`userId`),
  KEY `idx_co_status` (`status`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. invoices.customOrderId (idempotent — only add if missing)
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoices'
    AND COLUMN_NAME = 'customOrderId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `invoices` ADD COLUMN `customOrderId` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- 3. invoices.customOrderId index (idempotent — only create if missing).
-- listInvoicesForCustomOrder filters on this reverse FK; plain CREATE INDEX is
-- not idempotent on re-run, so guard via INFORMATION_SCHEMA.STATISTICS.
SET @i1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'invoices'
    AND INDEX_NAME = 'idx_inv_custom_order'
);
SET @sql2 = IF(@i1 = 0,
  'CREATE INDEX `idx_inv_custom_order` ON `invoices` (`customOrderId`)',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
