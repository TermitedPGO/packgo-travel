-- v78l (Sprint 4A): supplier contact fields on tours.
-- Used by booking-confirmed Stripe webhook to auto-email the supplier with
-- customer + dates so Jeff stops doing this manually for every booking.
ALTER TABLE `tours` ADD COLUMN `supplierName` varchar(200);
--> statement-breakpoint
ALTER TABLE `tours` ADD COLUMN `supplierEmail` varchar(320);
--> statement-breakpoint
ALTER TABLE `tours` ADD COLUMN `supplierPhone` varchar(50);
--> statement-breakpoint
ALTER TABLE `tours` ADD COLUMN `supplierNotes` text;
