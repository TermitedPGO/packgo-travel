-- 0089_workspace_dispositions: 整合工作台 P3 — Jeff's per-item「處理好了」triage.
--
-- A disposition is Jeff's manual "I've handled this" marker, SEPARATE from the
-- entity's own system status (a booking can be 'confirmed' while Jeff has not
-- marked it handled, and vice versa, design.md §1.3). Presence of a row =
-- handled; deleting the row = un-handled. Keyed by (itemKind, itemId) so each
-- heterogeneous item (booking / inquiry / task) has at most one disposition.
--
-- Additive, no FK (itemId is a soft ref across tables), no backfill.
-- Idempotent via CREATE TABLE IF NOT EXISTS (re-run safe).

CREATE TABLE IF NOT EXISTS `workspaceDispositions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `itemKind` VARCHAR(32) NOT NULL,
  `itemId` INT NOT NULL,
  `handledBy` INT NULL,
  `handledAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workspace_disp_item` (`itemKind`, `itemId`)
);
