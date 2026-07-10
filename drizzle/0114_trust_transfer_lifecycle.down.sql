-- Down for 0114_trust_transfer_lifecycle — drop the two lifecycle columns.
-- Idempotent(TiDB 原生 IF EXISTS)。注意:down 會丟失已回填的轉出配對紀錄
-- (transferredAt/transferBankTransactionId),但不動任何既有欄位或列;
-- 轉帳偵測重跑可從 bankTransactions 重新配對回填。

ALTER TABLE `trustDeferredIncome` DROP COLUMN IF EXISTS `transferredAt`;

--> statement-breakpoint

ALTER TABLE `trustDeferredIncome` DROP COLUMN IF EXISTS `transferBankTransactionId`;
