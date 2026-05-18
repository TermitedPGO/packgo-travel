-- Round 80.22 Phase D: Referral program columns on users.
-- referralCode is generated lazily by the application code on first read
-- (existing users get codes the next time they hit any /me endpoint).
-- See server/_core/referral.ts for code generation + collision retry.
--
-- TiDB note: doesn't support inline UNIQUE on ADD COLUMN — must split into
-- column add + separate CREATE UNIQUE INDEX.

ALTER TABLE `users`
  ADD COLUMN `referralCode` varchar(16) NULL,
  ADD COLUMN `referredBy` int NULL,
  ADD COLUMN `referralBonusAwarded` boolean NOT NULL DEFAULT FALSE;

-- Unique index serves both fast lookup AND collision detection on insert.
CREATE UNIQUE INDEX `idx_users_referralCode` ON `users` (`referralCode`);
