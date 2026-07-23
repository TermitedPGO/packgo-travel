-- 0117_storefront_data_contracts (Batch P1a, 2026-07-20)
-- Storefront data contract layer: versioned product content (productVersions),
-- itinerary contracts packgo.itinerary.v1 (itineraryVersions/Days/Stops), and
-- fee disclosures (feeContracts/feeItems, integer minor units only).
-- Additive only: 6 new tables, no changes to existing tables.
--
-- Migration 風格 (Round 2, docs/MIGRATION_PATTERNS.md Rule 1 + Rule 2, 照
-- 0111/0113/0116 的寫法): CREATE TABLE IF NOT EXISTS + secondary index 以
-- inline KEY 寫進 CREATE TABLE 本體(新表不需要獨立 CREATE INDEX,也就沒有
-- 不可重跑的裸 CREATE INDEX 語句),語句之間照 Rule 2 放分句標記。
-- 不用 PREPARE/IF 包裝(0070 事故:PREPARE 內 DDL 在 TiDB 靜默失敗)。
-- 整檔可重跑:任何語句部分成功後重跑不會卡死。
CREATE TABLE IF NOT EXISTS `feeContracts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contractId` varchar(64) NOT NULL,
	`productVersionId` int NOT NULL,
	`originMarket` varchar(32) NOT NULL DEFAULT 'US-CA',
	`destinationJurisdictions` json,
	`displayRegion` varchar(64),
	`validFrom` timestamp,
	`validTo` timestamp,
	`sourceStatus` enum('demo_estimate','supplier_quote','awaiting_supplier_quote','confirmed') NOT NULL DEFAULT 'demo_estimate',
	`status` enum('draft','published','superseded') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feeContracts_id` PRIMARY KEY(`id`),
	CONSTRAINT `feeContracts_contractId_unique` UNIQUE(`contractId`),
	KEY `idx_fc_pv_status` (`productVersionId`,`status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `feeItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`feeContractId` int NOT NULL,
	`feeId` varchar(64) NOT NULL,
	`category` enum('mandatory','tips','self','optional') NOT NULL,
	`labelZh` varchar(255) NOT NULL,
	`labelEn` varchar(255) NOT NULL,
	`amountMinorUnits` int NOT NULL,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`unit` enum('per_person','per_booking') NOT NULL DEFAULT 'per_person',
	`includedInPackgoCharge` boolean NOT NULL DEFAULT false,
	`requiredForTrip` boolean NOT NULL DEFAULT false,
	`payeeType` enum('airline','government','guide_and_driver','leader_and_driver','restaurant_or_traveler_choice','packgo_or_hotel','local_supplier','ticket_supplier','other') NOT NULL,
	`paymentTiming` enum('before_departure','during_trip','if_selected') NOT NULL,
	`sourceStatus` enum('demo_estimate','supplier_quote','confirmed') NOT NULL DEFAULT 'demo_estimate',
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `feeItems_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_fi_contract_fee` UNIQUE(`feeContractId`,`feeId`),
	KEY `idx_fi_contract_category` (`feeContractId`,`category`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `itineraryDays` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itineraryVersionId` int NOT NULL,
	`dayId` varchar(64) NOT NULL,
	`dayNumber` int NOT NULL,
	`city` varchar(120),
	`cityEn` varchar(120),
	`summary` text,
	`sourceStatus` enum('demo_estimate','source_document','supplier_confirmed') NOT NULL DEFAULT 'demo_estimate',
	`movementDurationMinutes` int,
	`movementStatus` enum('estimated','confirmed','pending') NOT NULL DEFAULT 'pending',
	`mealBreakfast` enum('self','included','included_unconfirmed','in_flight','pending') NOT NULL DEFAULT 'pending',
	`mealLunch` enum('self','included','included_unconfirmed','in_flight','pending') NOT NULL DEFAULT 'pending',
	`mealDinner` enum('self','included','included_unconfirmed','in_flight','pending') NOT NULL DEFAULT 'pending',
	`stayPropertyStatus` enum('proposed_or_equivalent','confirmed_property','not_applicable') NOT NULL DEFAULT 'proposed_or_equivalent',
	`stayBookingStatus` enum('unconfirmed','confirmed','not_applicable') NOT NULL DEFAULT 'unconfirmed',
	`stayRatingValue` int,
	`stayRatingSystem` enum('hotel_classification','unverified'),
	`stayRatingSourceStatus` enum('itinerary_standard_unverified','source_document_unverified','source_document_claim','verified'),
	`stayRatingVerifiedAt` timestamp,
	`mediaSourceStatus` enum('demo_placeholder','actual','contextual','equivalent') NOT NULL DEFAULT 'demo_placeholder',
	`mediaRightsStatus` enum('prototype_only','licensed','owned') NOT NULL DEFAULT 'prototype_only',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `itineraryDays_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_id_version_day` UNIQUE(`itineraryVersionId`,`dayId`),
	KEY `idx_id_version_daynum` (`itineraryVersionId`,`dayNumber`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `itineraryStops` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itineraryDayId` int NOT NULL,
	`stopId` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`nameEn` varchar(255),
	`kind` enum('arrival','heritage','stay','rail','culture','experience','landscape','museum','dining','harbor','departure','sight') NOT NULL,
	`summary` text,
	`lat` decimal(10,7),
	`lon` decimal(10,7),
	`sourceStatus` enum('source_document','estimated','pending') NOT NULL DEFAULT 'pending',
	`visitStatus` enum('planned_from_source','route_or_stop_unconfirmed','proposed_stay','confirmed') NOT NULL DEFAULT 'route_or_stop_unconfirmed',
	`imageAssetId` varchar(255),
	`mediaStatus` enum('demo_placeholder','actual','contextual','equivalent') NOT NULL DEFAULT 'demo_placeholder',
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `itineraryStops_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_is_day_stop` UNIQUE(`itineraryDayId`,`stopId`),
	KEY `idx_is_day_sort` (`itineraryDayId`,`sortOrder`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `itineraryVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productVersionId` int NOT NULL,
	`schemaVersion` varchar(64) NOT NULL DEFAULT 'packgo.itinerary.v1',
	`itineraryId` varchar(64) NOT NULL,
	`versionNumber` int NOT NULL,
	`sourceStatus` enum('demo_estimate','source_document','supplier_confirmed') NOT NULL DEFAULT 'demo_estimate',
	`originMarket` varchar(32),
	`destinationJurisdictions` json,
	`status` enum('draft','published','superseded') NOT NULL DEFAULT 'draft',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `itineraryVersions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_iv_itinerary_version` UNIQUE(`itineraryId`,`versionNumber`),
	KEY `idx_iv_pv_status` (`productVersionId`,`status`),
	KEY `idx_iv_itinerary_status` (`itineraryId`,`status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `productVersions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tourId` int NOT NULL,
	`versionNumber` int NOT NULL,
	`status` enum('draft','published','superseded') NOT NULL DEFAULT 'draft',
	`contentHash` varchar(128),
	`publishedAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `productVersions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_pv_tour_version` UNIQUE(`tourId`,`versionNumber`),
	KEY `idx_pv_tour_status` (`tourId`,`status`)
);
