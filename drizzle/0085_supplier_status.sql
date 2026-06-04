-- 0085_supplier_status — Phase 1.1: supplier fulfillment state machine.
--
-- Adds three columns to `bookings` so we track where each booking sits in the
-- supplier (UV / Lion) ordering flow, and so the customer-facing "confirmed /
-- seat secured" language can drive off `supplierStatus = 'vendor_confirmed'`
-- instead of off payment. A customer paying us is NOT the same as the seat
-- being secured with the supplier; conflating the two over-promises and fuels
-- chargebacks.
--
-- IDEMPOTENT — each ADD COLUMN checks INFORMATION_SCHEMA first (mirrors
-- 0048_customer_language.sql) so it is safe to re-run and safe on a prod DB
-- where a column may have been added manually. Hand-written per repo convention
-- (migrations 0042+ are authored by hand; drizzle-kit snapshots are frozen).

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'supplierStatus'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `bookings` ADD COLUMN `supplierStatus` ENUM(''not_placed'',''placed'',''vendor_confirmed'',''vendor_rejected'',''waitlisted'') NOT NULL DEFAULT ''not_placed''',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'supplierBookingRef'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `bookings` ADD COLUMN `supplierBookingRef` VARCHAR(128) NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;

SET @c3 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'supplierConfirmedAt'
);
SET @sql3 = IF(@c3 = 0,
  'ALTER TABLE `bookings` ADD COLUMN `supplierConfirmedAt` TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s3 FROM @sql3;
EXECUTE s3;
DEALLOCATE PREPARE s3;
