-- Rollback for 0085_supplier_status.

ALTER TABLE `bookings` DROP COLUMN `supplierConfirmedAt`;
ALTER TABLE `bookings` DROP COLUMN `supplierBookingRef`;
ALTER TABLE `bookings` DROP COLUMN `supplierStatus`;
