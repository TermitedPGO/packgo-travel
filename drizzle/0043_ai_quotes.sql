-- v78: AI quote generator — saves customer intent → matched tours → PDF
CREATE TABLE `aiQuotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`rawRequest` text NOT NULL,
	`extractedParams` text,
	`quoteNumber` varchar(32) NOT NULL,
	`recommendedTours` text,
	`estimatedTotal` int,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`pdfUrl` varchar(1024),
	`customerName` varchar(200),
	`customerEmail` varchar(320),
	`customerPhone` varchar(50),
	`userId` int,
	`status` enum('generated','sent','viewed','converted','expired') NOT NULL DEFAULT 'generated',
	`bookingId` int,
	`validUntil` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `aiQuotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `aiQuotes_quoteNumber_unique` UNIQUE(`quoteNumber`)
);
--> statement-breakpoint
CREATE INDEX `aiQuotes_email_idx` ON `aiQuotes` (`customerEmail`);
--> statement-breakpoint
CREATE INDEX `aiQuotes_status_idx` ON `aiQuotes` (`status`);
--> statement-breakpoint
CREATE INDEX `aiQuotes_createdAt_idx` ON `aiQuotes` (`createdAt`);
