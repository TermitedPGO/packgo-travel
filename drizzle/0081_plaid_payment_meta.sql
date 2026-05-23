-- Capture Plaid's payment_meta + original_description so the AccountingAgent
-- can read Jeff's BofA notes / Zelle memos / Bill Pay reasons.
--
-- Jeff (2026-05-22): 「我需要 Agent read 我在 bofa 用的 notes 要不然要自動識別幹嘛」
--
-- Plaid /transactions/sync returns:
--   payment_meta: {
--     payee, payer, payment_method, reason, reference_number, by_order_of, ppd_id
--   }
--   original_description: raw bank-line text — has check memo, wire ref, etc.
--
-- Without these, the agent only sees the cleaned `name` ("Zelle payment from
-- CHUNFU HSIEH") and loses the actual memo Jeff typed in BofA's UI.
--
-- Type choice: JSON for payment_meta (variable shape; we store the entire
-- object so we don't pre-judge which sub-field matters). TEXT for
-- originalDescription (free-form, can be ~200 chars from BofA).

ALTER TABLE bankTransactions
  ADD COLUMN paymentMeta JSON NULL,
  ADD COLUMN originalDescription TEXT NULL;
