-- Phase 2 of 2026-05 refactor — central Stripe webhook idempotency.
--
-- Replaces six per-handler `if (existing) return` checks in
-- server/_core/stripeWebhook.ts (lines 180/486/930) with a single
-- UNIQUE-key insert at the top of handleStripeWebhook.
--
-- TiDB-safe: each statement standalone (see migration 0073 precedent).

CREATE TABLE `stripeWebhookEvents` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `eventId` VARCHAR(255) NOT NULL,
  `eventType` VARCHAR(128) NOT NULL,
  `status` ENUM('processing','succeeded','failed') NOT NULL,
  `errorMessage` TEXT,
  `receivedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processedAt` TIMESTAMP NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_stripeWebhookEvents_eventId` (`eventId`)
);
