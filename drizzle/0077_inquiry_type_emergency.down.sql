-- Rollback for 0077. Reverts the inquiryType enum and reclassifies any
-- emergency rows back to 'other'.
--
-- WARNING: lossy if new emergency inquiries have been created since the
-- forward migration ran — they will all be bucketed as 'other'. Safe for
-- an immediate same-day rollback; not safe after a week of operation.

UPDATE `inquiries`
  SET `inquiryType` = 'other'
  WHERE `inquiryType` = 'emergency';

ALTER TABLE `inquiries` MODIFY COLUMN `inquiryType` ENUM(
  'general',
  'custom_tour',
  'visa',
  'group_booking',
  'complaint',
  'other'
) NOT NULL;
