-- Scaling guardrails — Jeff 2026-05-23: "想想可以做的事情因為往後的資料肯定會越來越大".
--
-- Adds:
--   bankTransactions.archived   — soft-archive flag for txns > 2 years old.
--                                  Default queries (transactionsList, classifyBatch,
--                                  financeKpi within-current-period) filter
--                                  WHERE archived=0 so the main hot path stays
--                                  lean as data grows. Year-end exports + Schedule
--                                  C still see archived rows by passing flag.
--   index idx_bank_txn_archived — for fast filter.
--
-- The actual archival is driven by a tRPC cron route added in this PR; this
-- migration just adds the column. Nothing flips to archived=1 until run.

ALTER TABLE bankTransactions
  ADD COLUMN archived TINYINT DEFAULT 0 NOT NULL;

CREATE INDEX idx_bank_txn_archived ON bankTransactions(archived, date);
