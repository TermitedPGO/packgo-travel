-- Round 80.22: Packpoint loyalty system.
-- Adds Packpoint balance + transaction log to users, plus per-tour earn-rate
-- override on tours. See docs/packpoint-policy.md for rules.

-- 1. Users — Packpoint balance, lifetime, last activity, birthDate
ALTER TABLE `users`
  ADD COLUMN `packpointBalance` int NOT NULL DEFAULT 0,
  ADD COLUMN `packpointLifetimeEarned` int NOT NULL DEFAULT 0,
  ADD COLUMN `packpointLastActivityAt` timestamp NULL,
  ADD COLUMN `birthDate` timestamp NULL;

-- 2. Tours — per-tour Packpoint multiplier + commission estimate + exclude flag
-- pointsEarnRate stored × 100 (25 = 0.25x default)
ALTER TABLE `tours`
  ADD COLUMN `pointsEarnRate` int NOT NULL DEFAULT 25,
  ADD COLUMN `estimatedCommissionPct` int NULL,
  ADD COLUMN `excludeFromPackpoint` boolean NOT NULL DEFAULT FALSE;

-- 3. Points transaction log (immutable audit trail)
CREATE TABLE IF NOT EXISTS `pointsTransactions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `delta` int NOT NULL,
  `reason` enum(
    'booking_earn',
    'signup_bonus',
    'review_bonus',
    'referral_bonus',
    'birthday_bonus',
    'photo_bonus',
    'redemption',
    'clawback',
    'expiration',
    'admin_adjust'
  ) NOT NULL,
  `referenceType` varchar(50),
  `referenceId` int,
  `description` text,
  `balanceAfter` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `pointsTransactions_id` PRIMARY KEY(`id`),
  KEY `idx_points_user` (`userId`, `createdAt`)
);
