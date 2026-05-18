-- Round 80.22 Phase H2: Supplier poster distribution.
-- Captures supplier posters (雄獅 / 縱橫) → AI rebrand + multi-platform
-- copy generation → admin review → distribute to 7 platforms.

CREATE TABLE IF NOT EXISTS `posterAssets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sourceVendor` enum('lion', 'zongheng', 'house', 'other') NOT NULL,
  `title` varchar(500),
  `targetAudience` enum('family', 'honeymoon', 'parent_child', 'business', 'senior', 'general') NOT NULL DEFAULT 'general',
  `originalImageUrl` varchar(1024) NOT NULL,
  `originalCopyText` text,
  `brandedImageUrl` varchar(1024),
  `aiAnalysis` text,
  `status` enum('uploaded', 'processing', 'ready', 'approved', 'distributed', 'archived', 'failed') NOT NULL DEFAULT 'uploaded',
  `notes` text,
  `createdBy` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `posterAssets_id` PRIMARY KEY (`id`),
  KEY `idx_poster_status` (`status`, `createdAt`)
);

CREATE TABLE IF NOT EXISTS `posterPlatformCopies` (
  `id` int AUTO_INCREMENT NOT NULL,
  `posterAssetId` int NOT NULL,
  `platform` enum('wechat_moments', 'wechat_group', 'xiaohongshu', 'line', 'facebook', 'instagram', 'newsletter') NOT NULL,
  `copyText` text NOT NULL,
  `hashtags` text,
  `status` enum('draft', 'approved', 'posted', 'skipped') NOT NULL DEFAULT 'draft',
  `postedAt` timestamp NULL,
  `postedUrl` varchar(1024),
  `notes` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `posterPlatformCopies_id` PRIMARY KEY (`id`),
  KEY `idx_platform_copy_poster` (`posterAssetId`),
  KEY `idx_platform_copy_status` (`platform`, `status`)
);
