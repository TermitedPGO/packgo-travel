-- 0087_booking_consent — Phase 3.2: persist the CA B&P §17550 consent.
--
-- The booking form's consent checkbox was client-only (gated the submit button,
-- never stored), so a chargeback had no proof the customer affirmed the
-- disclosures + cancellation policy. Adds two columns to record it:
--   disclaimerAcceptedAt — when the customer accepted (NULL = no record)
--   disclaimerVersion    — which disclosure-text version they accepted
--
-- IDEMPOTENT (INFORMATION_SCHEMA guard, mirrors 0048 / 0085 / 0086). Additive +
-- nullable. Hand-written per repo convention.

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'disclaimerAcceptedAt'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `bookings` ADD COLUMN `disclaimerAcceptedAt` TIMESTAMP NULL DEFAULT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'disclaimerVersion'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `bookings` ADD COLUMN `disclaimerVersion` VARCHAR(32) NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
