-- Round 81 — Two-way agent chat.
--
-- Adds `senderRole` to `agentMessages` so each row can be EITHER from the
-- agent (existing default) OR from Jeff (when he initiates / replies).
-- Together with `agentName` this gives us per-agent conversation threads:
--   SELECT * FROM agentMessages WHERE agentName = 'inquiry' ORDER BY createdAt
-- yields the full back-and-forth between Jeff and InquiryAgent.
--
-- The `jeffResponse` column on existing rows still works for the "reply to
-- this specific escalation" flow — we kept it for backward compat, but new
-- ad-hoc chats use the senderRole='jeff' row pattern instead.

ALTER TABLE `agentMessages`
  ADD COLUMN `senderRole` enum('agent', 'jeff') NOT NULL DEFAULT 'agent' AFTER `agentName`,
  ADD INDEX `idx_am_chat` (`agentName`, `createdAt`);
