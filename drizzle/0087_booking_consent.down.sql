-- Rollback for 0087_booking_consent.

ALTER TABLE `bookings` DROP COLUMN `disclaimerVersion`;
ALTER TABLE `bookings` DROP COLUMN `disclaimerAcceptedAt`;
