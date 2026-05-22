-- v2 Wave 3 Module 3.4-B — skill execution audit + idempotency
--
-- Persists every skill-orchestrator run triggered by the gmailPipeline.
-- One row per `dispatchSkillFromInquiry()` invocation that resolved into
-- a `ran` outcome (skip outcomes never write here).
--
-- Why row-claim BEFORE orchestrator.run:
--   - Ties the run to the inbound interaction even if the orchestrator
--     crashes mid-flight (status stays 'running' → ops cron can re-check)
--   - Future v3 idempotency: a second pipeline tick that retries the
--     same threadId can short-circuit by finding an existing row
--
-- Why no FK constraints:
--   - customerInteractions.id is FK to customerProfiles, but in TiDB FKs
--     are silently validated only at write time (no on-delete cascade).
--     PACK&GO's existing audit tables (adminAuditLog etc.) use loose
--     references for the same reason — soft FK via index, not constraint.

CREATE TABLE skillRuns (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Identifies which skill ran. Matches the SkillId union in registry.ts
  -- (varchar — string union, not enum, so registry-level changes don't
  -- require migrations).
  skillId VARCHAR(60) NOT NULL,

  -- The InquiryAgent classification that triggered dispatch. Matches the
  -- 12-value union (7 legacy + 5 v2 sub-intents). varchar because the
  -- enum lives in TypeScript, not MySQL (see classifier-sub-intents
  -- module 3.1 — customerInteractions.classification is also varchar).
  intent VARCHAR(50) NOT NULL,

  -- Soft references — null when the row is created before the related
  -- entity exists (e.g. interactionId can land before agentMessageId).
  interactionId INT,
  customerProfileId INT,
  agentMessageId INT,

  -- Lifecycle:
  --   running   — row claimed; orchestrator in-flight
  --   succeeded — orchestrator returned ok=true; draft + pdf persisted
  --   failed    — orchestrator returned ok=false with needsJeff=false
  --               (transient/retryable — won't currently auto-retry but
  --                future v3 sweeper can pick these up)
  --   escalated — orchestrator returned ok=false with needsJeff=true
  --               (Jeff intervention required)
  status ENUM('running','succeeded','failed','escalated') NOT NULL DEFAULT 'running',

  -- Output artifacts (only present on status='succeeded')
  pdfStoragePath VARCHAR(500),
  draftBody TEXT,
  meta JSON,

  -- Failure context (only present on status in ('failed','escalated'))
  errorMessage VARCHAR(1024),

  -- Cost / latency for AgentMonitor + selfRetrospective
  llmTokensIn INT DEFAULT 0,
  llmTokensOut INT DEFAULT 0,
  llmCostCents INT DEFAULT 0,
  durationMs INT,

  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completedAt TIMESTAMP,

  INDEX idx_skillRuns_interactionId (interactionId),
  INDEX idx_skillRuns_status_createdAt (status, createdAt),
  INDEX idx_skillRuns_skillId_createdAt (skillId, createdAt)
);
