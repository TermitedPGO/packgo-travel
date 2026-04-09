CREATE TABLE `emailSendLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`subscriberEmail` varchar(320) NOT NULL,
	`status` enum('pending','sent','failed','bounced') NOT NULL DEFAULT 'pending',
	`sentAt` timestamp,
	`errorMessage` text,
	`openedAt` timestamp,
	`clickedAt` timestamp,
	CONSTRAINT `emailSendLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketingCampaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(500) NOT NULL,
	`type` enum('social_post','email_newsletter','poster') NOT NULL,
	`status` enum('draft','scheduled','sending','sent','cancelled') NOT NULL DEFAULT 'draft',
	`tourIds` text,
	`content` text,
	`scheduledAt` timestamp,
	`sentAt` timestamp,
	`recipientCount` int DEFAULT 0,
	`metadata` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `marketingCampaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketingMaterials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int,
	`tourId` int NOT NULL,
	`type` enum('social_copy_fb','social_copy_ig','social_copy_line','email_html','poster_landscape','poster_square','poster_story') NOT NULL,
	`content` text,
	`imageUrl` varchar(1024),
	`metadata` text,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketingMaterials_id` PRIMARY KEY(`id`)
);
