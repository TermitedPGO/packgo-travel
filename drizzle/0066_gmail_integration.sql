-- Round 81 — Gmail OAuth integration for email pipeline.
--
-- Stores OAuth credentials per connected Gmail mailbox + tracks polling
-- state (lastPollAt, lastMessageId) so we don't re-process the same
-- emails. Tokens are stored as TEXT — in a future iteration we should
-- encrypt at rest, but for v1 we rely on the existing DB encryption-at-
-- rest provided by TiDB Cloud + restricted access via fly secrets.

CREATE TABLE `gmailIntegration` (
  `id` int NOT NULL AUTO_INCREMENT,
  `userId` int,
  `emailAddress` varchar(255) NOT NULL,
  `accessToken` text NOT NULL,
  `refreshToken` text NOT NULL,
  `scope` text,
  `tokenExpiresAt` timestamp NULL,
  -- Polling state
  `lastPollAt` timestamp NULL,
  `lastHistoryId` varchar(100),
  `messagesProcessed` int NOT NULL DEFAULT 0,
  `messagesFailed` int NOT NULL DEFAULT 0,
  -- Lifecycle
  `isActive` int NOT NULL DEFAULT 1,
  `disconnectReason` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gmail_email` (`emailAddress`),
  KEY `idx_gmail_active` (`isActive`, `lastPollAt`)
);
