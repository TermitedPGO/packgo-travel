-- 0091_customer_chat_messages: 批2 m3 per-customer 對話(2026-06-10 Jeff 拍板:
-- 獨立新表,不混 agentMessages)。
--
-- One thread per customer: Jeff ↔ agent turns bound by customerUserId
-- (users.id, soft ref — no FK, mirrors repo convention). `context` keeps the
-- streamed turn's suggestedActions/cards JSON for later card rendering; v1
-- renders body text only. Rows are never deleted (thread = permanent record).
--
-- IDEMPOTENT (CREATE TABLE IF NOT EXISTS, mirrors 0089). Additive, no
-- backfill. Hand-written per repo convention.

CREATE TABLE IF NOT EXISTS `customerChatMessages` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `customerUserId` INT NOT NULL,
  `senderRole` ENUM('jeff','agent') NOT NULL,
  `body` TEXT NOT NULL,
  `context` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT (now()),
  CONSTRAINT `customerChatMessages_id` PRIMARY KEY(`id`),
  INDEX `idx_ccm_customer` (`customerUserId`, `createdAt`)
);
