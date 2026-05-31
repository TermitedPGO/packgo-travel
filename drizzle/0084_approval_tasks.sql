-- 0084_approval_tasks — Jeff 2026-05-30: 指揮中心 (Command Center) 審核箱脊椎.
--
-- Single source of truth for the approval inbox. Every operational lane
-- (cs / quote / marketing / finance) emits work that needs Jeff's sign-off
-- by inserting a row here via createApprovalTask (server/_core/approvalTasks.ts).
-- The 指揮中心 tab reads this table; approve/reject routes back to the lane
-- executor keyed by `taskType`.
--
-- design.md §2 (spine S-1). riskLevel policy (proposal §3 鐵律):
--   auto      → may be batch-approved in one click
--   review    → per-item review before send
--   hard_gate → money / irreversible / customer-visible — ALWAYS per-item,
--               NEVER bulk-approved.
-- `payload` is a lane-specific JSON string parsed by the executor on approve.
--
-- Hand-written to match the repo convention (migrations 0042+ are authored
-- by hand; drizzle-kit snapshots froze at ~0051 so `generate` re-emits every
-- existing table). Mirrors 0083_supplier_product_details.sql style.

CREATE TABLE approvalTasks (
  id INT AUTO_INCREMENT PRIMARY KEY,

  -- Which operational lane produced this task (executor namespace)
  lane ENUM('cs','quote','marketing','finance') NOT NULL,
  -- Fine-grained executor route within the lane (e.g. "cs.reply_inquiry")
  taskType VARCHAR(64) NOT NULL,
  -- auto = batch-ok / review = per-item / hard_gate = per-item, never bulk
  riskLevel ENUM('auto','review','hard_gate') NOT NULL,
  status ENUM('pending','approved','rejected','sent','failed','expired') NOT NULL DEFAULT 'pending',

  title VARCHAR(255) NOT NULL,
  summary TEXT,
  -- Lane-specific JSON string; executor parses on approve
  payload TEXT NOT NULL,

  -- Optional back-reference to a domain row (e.g. "inquiry" + its id)
  relatedType VARCHAR(64),
  relatedId VARCHAR(64),

  -- Producer identity — agent name or "system"/"admin:<id>"
  createdBy VARCHAR(64) NOT NULL,
  -- users.id of the admin who approved/rejected (NULL while pending)
  decidedBy INT,
  decidedAt TIMESTAMP NULL,
  -- Free-form failure detail when status = failed
  errorMessage TEXT,

  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Hot path: inbox filtered by lane + status (e.g. cs / pending)
CREATE INDEX idx_approvalTasks_lane_status ON approvalTasks(lane, status);

-- Cross-lane status counts (stats strip) + pending sweep
CREATE INDEX idx_approvalTasks_status ON approvalTasks(status);

-- Recency ordering for the inbox feed
CREATE INDEX idx_approvalTasks_createdAt ON approvalTasks(createdAt);
