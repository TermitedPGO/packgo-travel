-- 0086_supplier_cost — Phase 2.5: per-booking supplier cost for margin tracking.
--
-- Adds bookings.supplierCost: the cost Jeff entered after verifying it against
-- the operator's actual order confirmation. Manual entry only, NEVER
-- auto-derived (supplier pricing nuance has repeatedly burned auto-quotes).
-- Same unit/currency as totalPrice (int). Nullable = not entered yet.
--
-- IDEMPOTENT (INFORMATION_SCHEMA guard, mirrors 0048 / 0085). Hand-written per
-- repo convention (drizzle-kit snapshots are frozen).

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bookings'
    AND COLUMN_NAME = 'supplierCost'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `bookings` ADD COLUMN `supplierCost` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;
