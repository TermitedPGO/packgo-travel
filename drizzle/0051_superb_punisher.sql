-- Round 80.19: Membership Phase 1 schema additions
-- Hand-edited migration: drizzle-kit generated a full schema dump because
-- meta tracking was out of sync. Reduced to just the incremental changes.
--
--   1. New aiAdvisorUsage table — tracks AI Travel Advisor message
--      counts per IP (anonymous) or per userId (logged-in) for tier
--      rate limiting (free = 5 / 30 days).
--   2. ALTER users — add tier (free/plus/concierge) + Stripe linkage
--      columns + tierExpiresAt for renewal tracking.

CREATE TABLE IF NOT EXISTS `aiAdvisorUsage` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ipHash` varchar(64),
	`userId` int,
	`sessionId` varchar(64),
	`messagePreview` text,
	`tokenCount` int NOT NULL DEFAULT 0,
	`tier` varchar(20) NOT NULL DEFAULT 'free',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `aiAdvisorUsage_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `tier` enum('free','plus','concierge') NOT NULL DEFAULT 'free';
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `stripeSubscriptionId` varchar(255);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `stripeCustomerId` varchar(255);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `tierExpiresAt` timestamp;
