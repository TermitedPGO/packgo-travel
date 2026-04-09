CREATE TABLE `competitorAlerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitorTourId` int NOT NULL,
	`alertType` enum('price_drop','price_increase','low_seats','sold_out','new_departure','tour_cancelled','guaranteed') NOT NULL,
	`title` varchar(500) NOT NULL,
	`message` text,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'info',
	`metadata` text,
	`isRead` int NOT NULL DEFAULT 0,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitorAlerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitorDepartures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitorTourId` int NOT NULL,
	`departureDate` varchar(20) NOT NULL,
	`returnDate` varchar(20),
	`adultPrice` int,
	`childPrice` int,
	`singleSupplement` int,
	`totalSeats` int,
	`availableSeats` int,
	`departureStatus` enum('open','full','cancelled','guaranteed') NOT NULL DEFAULT 'open',
	`scrapedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitorDepartures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitorPriceHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitorTourId` int NOT NULL,
	`departureDate` varchar(20) NOT NULL,
	`price` int NOT NULL,
	`previousPrice` int,
	`priceChange` int,
	`changeType` enum('increase','decrease','new','unchanged') NOT NULL DEFAULT 'new',
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `competitorPriceHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitorTours` (
	`id` int AUTO_INCREMENT NOT NULL,
	`competitor` enum('liontravel','colatour','settour') NOT NULL DEFAULT 'liontravel',
	`tourUrl` varchar(1024) NOT NULL,
	`normGroupId` varchar(100),
	`tourTitle` varchar(500),
	`destination` varchar(255),
	`duration` int,
	`basePrice` int,
	`lastScrapedAt` timestamp,
	`scrapeStatus` enum('active','paused','error') NOT NULL DEFAULT 'active',
	`scrapeErrorMessage` text,
	`scrapeFrequency` enum('6h','12h','daily','weekly') NOT NULL DEFAULT 'daily',
	`matchedTourId` int,
	`notes` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitorTours_id` PRIMARY KEY(`id`)
);
