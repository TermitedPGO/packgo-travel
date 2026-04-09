CREATE TABLE `affiliateClicks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`platform` enum('trip_flights','trip_hotels','trip_homepage') NOT NULL,
	`targetUrl` varchar(2048) NOT NULL,
	`referrerPage` varchar(500),
	`tourId` int,
	`ipAddress` varchar(45),
	`userAgent` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `affiliateClicks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tourPriceComparisons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tourId` int NOT NULL,
	`flightEstimate` int,
	`hotelEstimate` int,
	`activityEstimate` int,
	`mealEstimate` int,
	`transportEstimate` int,
	`otherEstimate` int,
	`totalSelfBook` int,
	`flightSource` varchar(500),
	`hotelSource` varchar(500),
	`lastUpdated` timestamp NOT NULL DEFAULT (now()),
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tourPriceComparisons_id` PRIMARY KEY(`id`)
);
