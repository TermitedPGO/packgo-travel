-- Rollback for 0086_supplier_cost.

ALTER TABLE `bookings` DROP COLUMN `supplierCost`;
