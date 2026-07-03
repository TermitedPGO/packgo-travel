-- Down for 0110_customer_promises — drop the table if present.
-- Idempotent (DROP TABLE IF EXISTS, native — no PREPARE/EXECUTE needed).

DROP TABLE IF EXISTS `customerPromises`;
