-- QA audit 2026-05-11 Phase 1 fix: Self-Retrospective proposals are posted to
-- agentMessages but had no way to record whether Jeff adopted or rejected them.
-- Next week's retrospective therefore had no signal about which proposals
-- worked, and could (and did) re-suggest the same things.
--
-- Adds proposalDecision so the UI can mark each proposal adopted/rejected,
-- and so the next retrospective can read past decisions as context.
--
-- Idempotent guard: tries to add the column, ignores duplicate-column error
-- so a half-applied migration retries safely.

SET @sql := IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'agentMessages'
      AND column_name = 'proposalDecision'
  ),
  'ALTER TABLE `agentMessages` ADD COLUMN `proposalDecision` ENUM(''pending'',''adopted'',''rejected'') NOT NULL DEFAULT ''pending''',
  'SELECT ''column proposalDecision already exists, skipping'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index for "show me undecided proposals" queries.
SET @sql := IF(
  NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE table_schema = DATABASE()
      AND table_name = 'agentMessages'
      AND index_name = 'idx_am_proposal_decision'
  ),
  'CREATE INDEX `idx_am_proposal_decision` ON `agentMessages`(`messageType`, `proposalDecision`, `createdAt`)',
  'SELECT ''index idx_am_proposal_decision already exists, skipping'''
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
