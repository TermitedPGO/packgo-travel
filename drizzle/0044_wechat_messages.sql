-- v78: WeChat message inbox (and manual-paste mode while OA is pending)
CREATE TABLE `wechatMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` enum('wechat_oa','manual_paste','moments_reply') NOT NULL,
	`fromOpenId` varchar(64),
	`fromDisplayName` varchar(200),
	`inboundText` text NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`aiDraftText` text,
	`aiDraftAt` timestamp,
	`aiConfidence` decimal(3,2),
	`status` enum('pending_draft','ready_review','approved','sent','skipped') NOT NULL DEFAULT 'pending_draft',
	`finalText` text,
	`approvedAt` timestamp,
	`sentAt` timestamp,
	`linkedQuoteId` int,
	`linkedBookingId` int,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `wechatMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `wechatMessages_status_idx` ON `wechatMessages` (`status`);
--> statement-breakpoint
CREATE INDEX `wechatMessages_receivedAt_idx` ON `wechatMessages` (`receivedAt`);
