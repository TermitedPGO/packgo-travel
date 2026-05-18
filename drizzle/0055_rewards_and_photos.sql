-- Round 80.22 Phase F: Reward vouchers + trip photos.
-- Vouchers: customer redeems Packpoint → unique code issued, used later
--   manually by admin (e.g., flight booking) or auto-checked by photo book
--   approval flow.
-- Photos: customer uploads from a completed booking → +10 Packpoint each
--   (capped per booking) + counts toward photo book voucher unlock.

CREATE TABLE IF NOT EXISTS `rewardVouchers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `type` enum('flight_credit', 'photo_book', 'tour_credit') NOT NULL,
  `code` varchar(32) NOT NULL,
  `amountUsd` int NOT NULL,
  `pointsCost` int NOT NULL,
  `status` enum('issued', 'redeemed', 'expired', 'voided') NOT NULL DEFAULT 'issued',
  `redeemedAt` timestamp NULL,
  `redeemedByAdminId` int,
  `redeemedAgainstBookingId` int,
  `expiresAt` timestamp NOT NULL,
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `rewardVouchers_id` PRIMARY KEY (`id`),
  KEY `idx_voucher_user` (`userId`, `status`),
  KEY `idx_voucher_code` (`code`)
);

-- Add unique constraint separately (TiDB inline UNIQUE limitation)
CREATE UNIQUE INDEX `uq_voucher_code` ON `rewardVouchers` (`code`);

CREATE TABLE IF NOT EXISTS `tripPhotos` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `bookingId` int NOT NULL,
  `photoUrl` varchar(1024) NOT NULL,
  `caption` varchar(500),
  `pointsAwarded` boolean NOT NULL DEFAULT FALSE,
  `isPublic` boolean NOT NULL DEFAULT FALSE,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `tripPhotos_id` PRIMARY KEY (`id`),
  KEY `idx_photo_booking` (`bookingId`),
  KEY `idx_photo_user` (`userId`)
);
