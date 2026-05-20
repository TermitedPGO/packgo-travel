-- v2 Wave 1 · Module 1.7 — add 'emergency' to inquiries.inquiryType enum.
--
-- Removes the `inquiryType: "emergency" as "other"` cast workaround in
-- server/routers/inquiries.ts createEmergency (was line 235), originally
-- docketed as migration 0070 but that slot was reassigned to
-- plaid_accounting. Lands now as 0077.
--
-- After this lands, emergency inquiries are persisted with the correct
-- enum value (not bucketed under "other"); admin Inbox can sort
-- inquiryType="emergency" natively instead of subject-prefix matching.
--
-- TiDB-safe: each statement standalone (see migration 0073 precedent).

ALTER TABLE `inquiries` MODIFY COLUMN `inquiryType` ENUM(
  'general',
  'custom_tour',
  'visa',
  'group_booking',
  'complaint',
  'emergency',
  'other'
) NOT NULL;

-- Backfill: prior emergency inquiries were persisted as 'other' due to
-- the as-cast workaround in inquiriesRouter.createEmergency. Match by
-- the subject prefix produced at server/routers/inquiries.ts:227 —
-- `[緊急 · ${labelZh}] ${input.currentLocation}`.
UPDATE `inquiries`
  SET `inquiryType` = 'emergency'
  WHERE `inquiryType` = 'other' AND `subject` LIKE '[緊急%';
