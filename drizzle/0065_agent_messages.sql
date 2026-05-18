-- Round 81 — agent → Jeff chatbox / inbox.
--
-- Agents proactively post messages to Jeff (observations, questions,
-- digest summaries, alerts). Distinct from `interactionOutcomes` which is
-- automatic action logging; `agentMessages` is human-readable chat from
-- the agent's voice. Examples:
--   - "我這週發現複雜詢問都被我 escalate,可能 minConfidence 抓太高"
--   - "Lisa Chen 的退費是第二次,你看一下要不要直接給 voucher"
--   - "今天我處理了 12 件 inquiry,1 件 escalate(原因: complaint)"
--
-- Jeff can reply via jeffResponse + readByJeff=1; replies feed into the
-- self-retrospective agent's weekly learning pass.

CREATE TABLE `agentMessages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agentName` varchar(50) NOT NULL,
  `messageType` enum('proposal','observation','question','alert','digest','escalation') NOT NULL,
  `title` varchar(200) NOT NULL,
  `body` text NOT NULL,
  `context` text,
  `priority` enum('low','normal','high','critical') NOT NULL DEFAULT 'normal',
  -- Cross-link to other tables for one-click navigation
  `relatedOutcomeId` int,
  `relatedInteractionId` int,
  `relatedCustomerProfileId` int,
  -- Jeff's response loop
  `readByJeff` int NOT NULL DEFAULT 0,
  `jeffResponse` text,
  `readAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_am_unread` (`readByJeff`, `priority`, `createdAt`),
  KEY `idx_am_agent` (`agentName`, `createdAt`),
  KEY `idx_am_priority` (`priority`, `createdAt`)
);
