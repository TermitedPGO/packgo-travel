-- IRS Schedule C-grade per-transaction tracking
-- 2026-05-22 — Jeff wants audit-trail-clean accounting for IRS Schedule C / §274
-- travel-meal documentation. Adds 4 columns:
--   counterparty       — normalized vendor/payer name (AI-extracted, Jeff-editable)
--   counterpartyType   — vendor/customer/owner/employee/refund/transfer/tax/other
--   purposeNote        — business-purpose 1-liner per IRS Rev. Proc. 2017-30
--   receiptUrl         — optional R2 link to receipt/invoice PDF (≥$75 expenses need this)
--
-- Indices added: counterparty (for vendor-history typeahead) + counterpartyType
-- (for Schedule C aggregation queries).
--
-- Audit trail for changes lives in existing `adminAuditLog` table — see the
-- corresponding code change in plaidRouter.ts (transactionUpdate now writes
-- an audit row whenever category / counterparty / purposeNote changes).

ALTER TABLE bankTransactions
  ADD COLUMN counterparty VARCHAR(255) NULL,
  ADD COLUMN counterpartyType VARCHAR(32) NULL,
  ADD COLUMN purposeNote TEXT NULL,
  ADD COLUMN receiptUrl VARCHAR(500) NULL;

CREATE INDEX idx_bank_txn_counterparty ON bankTransactions(counterparty);
CREATE INDEX idx_bank_txn_counterparty_type ON bankTransactions(counterpartyType);
