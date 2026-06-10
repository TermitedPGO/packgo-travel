-- 0092_flight_orders: 批2 m4 代客訂機票最小狀態機(2026-06-10 Jeff 拍板)。
--
-- Digitizes the manual flow 核件(護照名)→ Trip.com 備訂 → Jeff 親自刷卡 →
-- 出票確認單。狀態: prepared → awaiting_payment → ticketed;cancelled 只能
-- 在未出票前。HARD LINE: 系統不碰卡號/CVV/付款鈕 — bookingUrl 只是 Jeff
-- 自己打開的連結。passengerNames 只存護照拼音姓名,本表刻意沒有任何
-- 護照號碼欄位(那要走 tokenCrypto 加密,不在此表)。
--
-- IDEMPOTENT (CREATE TABLE IF NOT EXISTS, mirrors 0091). Additive, no
-- backfill. Hand-written per repo convention.

CREATE TABLE IF NOT EXISTS `flightOrders` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `customerUserId` INT NOT NULL,
  `status` ENUM('prepared','awaiting_payment','ticketed','cancelled') NOT NULL DEFAULT 'prepared',
  `airline` VARCHAR(80) NOT NULL,
  `flightSummary` VARCHAR(255) NOT NULL,
  `pricePerPerson` INT NULL,
  `passengerCount` INT NOT NULL DEFAULT 1,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'USD',
  `passengerNames` VARCHAR(500) NULL,
  `bookingUrl` VARCHAR(2000) NULL,
  `pnr` VARCHAR(20) NULL,
  `eticketNumbers` VARCHAR(255) NULL,
  `orderRef` VARCHAR(40) NULL,
  `notes` VARCHAR(1000) NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT (now()),
  `updatedAt` TIMESTAMP NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `flightOrders_id` PRIMARY KEY(`id`),
  INDEX `idx_fo_customer` (`customerUserId`, `createdAt`)
);
