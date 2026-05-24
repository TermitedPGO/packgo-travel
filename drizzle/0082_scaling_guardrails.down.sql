DROP INDEX idx_bank_txn_archived ON bankTransactions;
ALTER TABLE bankTransactions DROP COLUMN archived;
