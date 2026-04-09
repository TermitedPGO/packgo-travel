CREATE TABLE `calibrationResults` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tourId` int NOT NULL,
	`contentFidelityScore` int NOT NULL,
	`translationScore` int NOT NULL,
	`imageScore` int NOT NULL,
	`completenessScore` int NOT NULL,
	`marketingScore` int NOT NULL,
	`totalScore` int NOT NULL,
	`verdict` enum('approved','review','rejected') NOT NULL,
	`issues` text,
	`autoFixesApplied` text,
	`sourceSnapshot` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `calibrationResults_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `tours` MODIFY COLUMN `status` enum('active','inactive','soldout','draft','pending_review') NOT NULL DEFAULT 'draft';