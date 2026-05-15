-- Supplier product sync — Phase 1 schema.
--
-- See drizzle/schema.ts "Supplier Product Sync" block for design notes.
-- Four tables:
--   suppliers           — registry of supply sources (lion, uv, …)
--   supplierProducts    — one row per product mirrored from supplier
--   supplierDepartures  — one row per departure date per product
--   supplierSyncRuns    — audit log of every sync job execution
--
-- All tables use camelCase column names matching the Drizzle schema.
-- Encrypted credentials go through server/_core/tokenCrypto.ts.
--
-- 2026-05-15: each CREATE / ALTER kept as its own statement (TiDB-safe;
-- see migration 0073 for the precedent — TiDB Cloud rejects in-statement
-- AFTER references to columns added in the same ALTER).

CREATE TABLE `suppliers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `displayName` VARCHAR(128) NOT NULL,
  `baseUrl` VARCHAR(512) NOT NULL,
  `defaultCurrency` VARCHAR(3) NOT NULL,
  `credentialsEncrypted` TEXT,
  `isActive` BOOLEAN NOT NULL DEFAULT TRUE,
  `lastFullSyncAt` TIMESTAMP NULL,
  `lastHotSyncAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_supplier_code` (`code`)
);

-- Seed the two suppliers the research PDF identifies. Done in migration
-- (not at runtime) so the BullMQ workers find them immediately on first
-- boot of the Phase 1 deploy. baseUrl matches the public catalog API
-- (NOT the BMS login URL); BMS credentials get added separately in Phase 3.
INSERT INTO `suppliers` (`code`, `displayName`, `baseUrl`, `defaultCurrency`)
VALUES
  ('lion', '雄獅旅遊 (Lion Travel)', 'https://www.liontravel.com', 'TWD'),
  ('uv',   'UV Bookings (ToursBMS)', 'https://uvbookings.toursbms.com', 'USD');

CREATE TABLE `supplierProducts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `supplierId` INT NOT NULL,
  `externalProductCode` VARCHAR(128) NOT NULL,
  `title` VARCHAR(512) NOT NULL,
  `days` INT NOT NULL DEFAULT 0,
  `departureCity` VARCHAR(128) NULL,
  `destinationCountry` VARCHAR(128) NULL,
  `destinationCity` VARCHAR(128) NULL,
  `imageUrl` VARCHAR(1024) NULL,
  `currency` VARCHAR(3) NOT NULL,
  `status` ENUM('active', 'inactive', 'pending') NOT NULL DEFAULT 'active',
  `isHiddenByAdmin` BOOLEAN NOT NULL DEFAULT FALSE,
  `rawProductJson` MEDIUMTEXT NULL,
  `lastSyncedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_supplier_external` (`supplierId`, `externalProductCode`),
  KEY `idx_supplier_status` (`supplierId`, `status`, `isHiddenByAdmin`),
  KEY `idx_destination` (`destinationCountry`)
);

CREATE TABLE `supplierDepartures` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `supplierProductId` INT NOT NULL,
  `supplierId` INT NOT NULL,
  `externalDepartureCode` VARCHAR(128) NOT NULL,
  `departureDate` DATE NOT NULL,
  `retailPrice` DECIMAL(14, 2) NOT NULL,
  `agentPrice` DECIMAL(14, 2) NULL,
  `currency` VARCHAR(3) NOT NULL,
  `totalSeats` INT NOT NULL DEFAULT 0,
  `spareSeats` INT NOT NULL DEFAULT 0,
  `availability` ENUM('available', 'limited', 'full', 'unavailable') NOT NULL DEFAULT 'available',
  `rawDepartureJson` MEDIUMTEXT NULL,
  `lastSyncedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_product_external_dep` (`supplierProductId`, `externalDepartureCode`),
  KEY `idx_product_date` (`supplierProductId`, `departureDate`),
  KEY `idx_availability` (`availability`, `departureDate`)
);

CREATE TABLE `supplierSyncRuns` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `supplierId` INT NOT NULL,
  `kind` ENUM('full', 'hot', 'manual', 'detail') NOT NULL,
  `startedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finishedAt` TIMESTAMP NULL,
  `productsScanned` INT NOT NULL DEFAULT 0,
  `productsAdded` INT NOT NULL DEFAULT 0,
  `productsUpdated` INT NOT NULL DEFAULT 0,
  `productsDeactivated` INT NOT NULL DEFAULT 0,
  `departuresScanned` INT NOT NULL DEFAULT 0,
  `departuresUpdated` INT NOT NULL DEFAULT 0,
  `status` ENUM('running', 'success', 'failed', 'partial') NOT NULL DEFAULT 'running',
  `durationMs` INT NULL,
  `errorMessage` TEXT NULL,
  `bullJobId` VARCHAR(128) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_supplier_started` (`supplierId`, `startedAt`),
  KEY `idx_run_status` (`status`, `startedAt`)
);
