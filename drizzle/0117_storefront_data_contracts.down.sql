-- Down migration for 0117_storefront_data_contracts (Batch P1a).
-- Purely additive migration ⇒ down = drop the six new tables.
-- Order: children before parents (soft refs only, but keep it tidy).
DROP TABLE IF EXISTS `itineraryStops`;
DROP TABLE IF EXISTS `itineraryDays`;
DROP TABLE IF EXISTS `itineraryVersions`;
DROP TABLE IF EXISTS `feeItems`;
DROP TABLE IF EXISTS `feeContracts`;
DROP TABLE IF EXISTS `productVersions`;
