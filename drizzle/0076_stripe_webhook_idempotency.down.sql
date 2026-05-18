-- Rollback for 0076. Drops the idempotency table.
-- WARNING: running this in production reverts Stripe webhook to per-handler
-- idempotency; Stripe will replay events received during the gap.
DROP TABLE IF EXISTS `stripeWebhookEvents`;
