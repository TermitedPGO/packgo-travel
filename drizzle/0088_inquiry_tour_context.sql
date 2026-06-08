-- 0088_inquiry_tour_context: tour-page redesign, structured inquiry context.
--
-- The redesigned tour-page action area lets a customer tap "request quote /
-- customize" pre-seeded with which tour they were viewing plus their answers to
-- a 3-question fit wizard (group size / timeframe / budget band). Those are
-- qualitative buckets, so they go in honest columns rather than being forced
-- into the typed numberOfPeople/budget/preferredDepartureDate fields:
--   relatedTourId: soft ref to tours.id (NULL = inquiry not from a tour page)
--   wizardAnswers: JSON { people, timeframe, budget } language-neutral keys
--
-- IDEMPOTENT (INFORMATION_SCHEMA guard, mirrors 0085 / 0086 / 0087). Additive +
-- nullable, no data backfill, no FK constraint (matches the userId/assignedTo
-- soft refs already on this table). Hand-written per repo convention.

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inquiries'
    AND COLUMN_NAME = 'relatedTourId'
);
SET @sql1 = IF(@c1 = 0,
  'ALTER TABLE `inquiries` ADD COLUMN `relatedTourId` INT NULL',
  'SELECT 1'
);
PREPARE s1 FROM @sql1;
EXECUTE s1;
DEALLOCATE PREPARE s1;

SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inquiries'
    AND COLUMN_NAME = 'wizardAnswers'
);
SET @sql2 = IF(@c2 = 0,
  'ALTER TABLE `inquiries` ADD COLUMN `wizardAnswers` JSON NULL',
  'SELECT 1'
);
PREPARE s2 FROM @sql2;
EXECUTE s2;
DEALLOCATE PREPARE s2;
