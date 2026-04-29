-- v73: admin operation audit log
-- Tracks WHO performed WHAT mutation WHEN, with before/after diff and request context.
CREATE TABLE `adminAuditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`userEmail` varchar(320) NOT NULL,
	`userRole` varchar(32) NOT NULL,
	`action` varchar(64) NOT NULL,
	`targetType` varchar(32),
	`targetId` varchar(64),
	`changes` text,
	`reason` text,
	`ipAddress` varchar(45),
	`userAgent` varchar(500),
	`success` int NOT NULL DEFAULT 1,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `adminAuditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `adminAuditLog_userId_idx` ON `adminAuditLog` (`userId`);
--> statement-breakpoint
CREATE INDEX `adminAuditLog_action_idx` ON `adminAuditLog` (`action`);
--> statement-breakpoint
CREATE INDEX `adminAuditLog_target_idx` ON `adminAuditLog` (`targetType`,`targetId`);
--> statement-breakpoint
CREATE INDEX `adminAuditLog_createdAt_idx` ON `adminAuditLog` (`createdAt`);
