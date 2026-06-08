-- Rollback for 0088_inquiry_tour_context.

ALTER TABLE `inquiries` DROP COLUMN `wizardAnswers`;
ALTER TABLE `inquiries` DROP COLUMN `relatedTourId`;
