-- Reverse 0080_irs_grade_tracking.sql

DROP INDEX idx_bank_txn_counterparty_type ON bankTransactions;
DROP INDEX idx_bank_txn_counterparty ON bankTransactions;

ALTER TABLE bankTransactions
  DROP COLUMN receiptUrl,
  DROP COLUMN purposeNote,
  DROP COLUMN counterpartyType,
  DROP COLUMN counterparty;
