-- Round 81 — Layer 1: Customer Memory System.
--
-- Two tables:
--
-- 1. customerProfiles
--    Single source of truth per customer (resolves multi-channel identity:
--    same person on email + WhatsApp + WeChat = one profile). AI-extracted
--    communication preferences let agents match each customer's tone /
--    detail level / preferred channel automatically.
--
--    The aiNotes field is periodically summarized by a maintenance agent
--    so context never grows unbounded.
--
-- 2. customerInteractions
--    Full message log across all channels (inbound + outbound). Every
--    interaction (whether AI auto-sent, AI-drafted-then-human-approved, or
--    fully human) is logged. Powers per-customer context for the AI agents
--    + the outcome-tracking pipeline.

CREATE TABLE `customerProfiles` (
  `id` int NOT NULL AUTO_INCREMENT,

  -- Multi-channel identifiers (any of these can identify the customer)
  `userId` int,
  `email` varchar(255),
  `phone` varchar(32),
  `wechatId` varchar(100),
  `lineId` varchar(100),
  `whatsappPhone` varchar(32),

  -- AI-learned communication preferences
  `preferredLanguage` varchar(8) NOT NULL DEFAULT 'zh-TW',
  `communicationStyle` enum('formal', 'casual', 'detailed', 'concise'),
  `preferredChannel` varchar(20),

  -- Family / context (free-form, AI-extracted)
  `familyContext` text,
  `budgetTier` int,

  -- Engagement signals
  `totalSpend` int NOT NULL DEFAULT 0,
  `bookingCount` int NOT NULL DEFAULT 0,
  `lastInteractionAt` timestamp NULL,
  `responseTimeExpectationMs` int,
  `vipScore` int NOT NULL DEFAULT 0,

  -- AI observations (periodically auto-summarized)
  `aiNotes` text,

  `status` enum('active', 'dormant', 'opted_out', 'blocked') NOT NULL DEFAULT 'active',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_cp_email` (`email`),
  KEY `idx_cp_phone` (`phone`),
  UNIQUE KEY `uq_cp_user` (`userId`),
  KEY `idx_cp_vip` (`vipScore`),
  KEY `idx_cp_status` (`status`)
);

CREATE TABLE `customerInteractions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customerProfileId` int NOT NULL,

  `channel` enum('email', 'whatsapp', 'wechat', 'line', 'sms', 'phone', 'web_form', 'review') NOT NULL,
  `direction` enum('inbound', 'outbound') NOT NULL,

  `content` text NOT NULL,
  `contentSummary` text,

  -- Outbound message provenance (which agent / how authored)
  `generatedBy` enum('human', 'ai_auto', 'ai_draft_human_approved'),
  `agentName` varchar(50),

  -- AI classifications
  `sentiment` enum('positive', 'neutral', 'negative'),
  `classification` varchar(50),
  `urgency` int NOT NULL DEFAULT 50,

  -- Outcome linking (set when outcome record finalizes)
  `outcomeId` int,

  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_int_customer` (`customerProfileId`, `createdAt`),
  KEY `idx_int_channel` (`channel`, `direction`),
  KEY `idx_int_class` (`classification`),
  KEY `idx_int_outcome` (`outcomeId`)
);
