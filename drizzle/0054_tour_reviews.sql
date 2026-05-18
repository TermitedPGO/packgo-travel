-- Round 80.22 Phase E: Tour reviews table.
-- One review per booking (uq_review_booking). Status drives moderation flow
-- (pending → approved | rejected | hidden). Approved reviews earn the
-- author +50 Packpoint via the reviews.adminApprove tRPC mutation.

CREATE TABLE IF NOT EXISTS `tourReviews` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `tourId` int NOT NULL,
  `bookingId` int NOT NULL,
  `rating` int NOT NULL,
  `title` varchar(200) NOT NULL,
  `content` text NOT NULL,
  `photos` text,
  `language` varchar(8) NOT NULL DEFAULT 'zh-TW',
  `status` enum('pending', 'approved', 'rejected', 'hidden') NOT NULL DEFAULT 'pending',
  `moderatedAt` timestamp NULL,
  `moderatedBy` int,
  `rejectionReason` text,
  `publishedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tourReviews_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_review_booking` UNIQUE (`bookingId`),
  KEY `idx_review_tour_status` (`tourId`, `status`)
);
