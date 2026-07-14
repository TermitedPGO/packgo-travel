-- Down for 0117_gmail_ingestion_ledger — 移除 ledger 表 + 兩個 gmailIntegration 欄位。
-- Idempotent(IF EXISTS)。注意:down 會丟失 ledger 已累積的攝取稽核事實(哪些客戶信
-- 被發現/處理/失敗)—— 這是漏接稽核的唯一事實源,down 只該用於未上線環境回滾;
-- 一旦 shadow/history 模式在 prod 累積過真實列,不應執行本檔。intakeMode 欄移除後
-- 所有信箱回到 legacy 行為(現行 poll),不影響既有客戶信處理。不動任何其他表。
-- v3 的四個稽核欄(lastSeenHistoryId/discoveryReason/requeueCount/lastRequeuedAt)是
-- gmailIngestionLedger 的欄位,隨下方 DROP TABLE 一併移除,無需額外語句。

ALTER TABLE `gmailIntegration` DROP COLUMN IF EXISTS `intakeMode`;

--> statement-breakpoint

ALTER TABLE `gmailIntegration` DROP COLUMN IF EXISTS `lastSuccessfulSyncAt`;

--> statement-breakpoint

DROP TABLE IF EXISTS `gmailIngestionLedger`;
