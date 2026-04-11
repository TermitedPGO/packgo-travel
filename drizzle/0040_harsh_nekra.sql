CREATE TABLE `tourMonitorLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tourId` int NOT NULL,
	`monitoredAt` timestamp NOT NULL DEFAULT (now()),
	`sourceUrl` varchar(1024),
	`departureDate` varchar(20),
	`previousStatus` varchar(20),
	`currentStatus` varchar(20),
	`previousPrice` int,
	`currentPrice` int,
	`priceChanged` int DEFAULT 0,
	`previousSeats` int,
	`currentSeats` int,
	`seatsChanged` int DEFAULT 0,
	`hasChanges` int DEFAULT 0,
	`changesSummary` text,
	`rawSnapshot` text,
	`runId` varchar(64),
	`status` enum('success','failed','skipped') NOT NULL DEFAULT 'success',
	`errorMessage` text,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tourMonitorLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `tours` ADD `lastMonitoredAt` timestamp;--> statement-breakpoint
ALTER TABLE `tours` ADD `monitorStatus` varchar(20);--> statement-breakpoint
ALTER TABLE `tours` ADD `monitorChangeSummary` text;--> statement-breakpoint
ALTER TABLE `tours` ADD `calibrationScore` int;--> statement-breakpoint
ALTER TABLE `tours` ADD `calibrationVerdict` varchar(20);--> statement-breakpoint
ALTER TABLE `tours` ADD `calibrationReport` text;--> statement-breakpoint
ALTER TABLE `tours` ADD `calibratedAt` timestamp;