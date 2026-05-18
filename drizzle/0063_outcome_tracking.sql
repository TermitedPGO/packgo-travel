-- Round 81 — Layer 0: Outcome Tracking infrastructure for autonomous agents.
--
-- Three tables:
--
-- 1. interactionOutcomes
--    Every action an autonomous agent takes is recorded with downstream
--    outcomes (did the customer reply? book? complain? did Jeff override?).
--    The Self-Retrospective Agent reads this table weekly and updates each
--    agent's policy autonomously based on what's correlated with conversion
--    + sentiment + lifetime value.
--
-- 2. agentPolicies
--    Versioned decision rules per agent. Each new version gets stored with
--    provenance (human-set vs self-retrospective). Active version flagged.
--    Rollback = mark older version active again.
--
-- 3. agentMetrics
--    Weekly rollup per agent. Drives the Monday digest email to Jeff +
--    feeds the self-retrospective agent's analysis.

CREATE TABLE `interactionOutcomes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agentName` varchar(50) NOT NULL,
  `interactionId` int NOT NULL,
  `customerProfileId` int,
  `actionTaken` varchar(50) NOT NULL,
  `confidence` int,
  `policyVersion` int,

  -- Short-term outcomes (24-72h)
  `customerReplied` int NOT NULL DEFAULT 0,
  `customerReplyTimeMs` int,
  `customerSentiment` enum('positive', 'neutral', 'negative'),

  -- Mid-term outcomes (30 days)
  `customerBooked` int NOT NULL DEFAULT 0,
  `bookedAmount` int,
  `customerOptedOut` int NOT NULL DEFAULT 0,
  `reviewSubmitted` int NOT NULL DEFAULT 0,
  `reviewRating` int,

  -- Long-term outcomes (90+ days)
  `refundRequested` int NOT NULL DEFAULT 0,
  `jeffOverride` int NOT NULL DEFAULT 0,
  `jeffOverrideReason` text,

  `outcomeFinalized` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_outcome_agent` (`agentName`, `createdAt`),
  KEY `idx_outcome_customer` (`customerProfileId`),
  KEY `idx_outcome_finalized` (`outcomeFinalized`, `createdAt`)
);

CREATE TABLE `agentPolicies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agentName` varchar(50) NOT NULL,
  `version` int NOT NULL,
  `rules` text NOT NULL,
  `active` int NOT NULL DEFAULT 0,
  `performanceData` text,
  `createdBy` varchar(50),
  `reasonNote` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_version` (`agentName`, `version`),
  KEY `idx_agent_active` (`agentName`, `active`)
);

CREATE TABLE `agentMetrics` (
  `id` int NOT NULL AUTO_INCREMENT,
  `agentName` varchar(50) NOT NULL,
  `weekStart` timestamp NOT NULL,
  `totalInteractions` int NOT NULL DEFAULT 0,
  `autoActionsCount` int NOT NULL DEFAULT 0,
  `escalatedCount` int NOT NULL DEFAULT 0,
  `jeffOverrideCount` int NOT NULL DEFAULT 0,
  `conversionRate` int,
  `avgSentimentScore` int,
  `avgResponseTimeMs` int,
  `errorRate` int,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_agent_week` (`agentName`, `weekStart`)
);
