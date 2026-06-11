-- batch 6 m3: pre-departure notifications (LLM-drafted, admin-reviewed, per-customer)
CREATE TABLE `preDepartureNotifications` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `departureId` int NOT NULL,
  `bookingId` int NOT NULL,
  `userId` int NULL,
  `recipientName` varchar(128) NOT NULL,
  `recipientEmail` varchar(256) NOT NULL,
  `subject` varchar(256) NOT NULL DEFAULT '',
  `content` mediumtext NOT NULL,
  `status` enum('draft','approved','sent','skipped') NOT NULL DEFAULT 'draft',
  `sentAt` timestamp NULL,
  `approvedBy` int NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_departure` (`departureId`, `status`),
  INDEX `idx_booking` (`bookingId`)
);
