-- 0114_trust_transfer_lifecycle: trustDeferredIncome 加轉出欄位 — F2 塊B (2026-07-10)。
--
-- 起因(docs/features/finance-dept/dispatch-f2.md 塊B):CST §17550 的完整生命
-- 週期是「收訂金(Trust)→ 出發認列(recognizedAt)→ 轉出到 Operating」。既有
-- 遞延表只記到認列,錢有沒有真的離開 Trust 帳戶無欄可記,「認了沒轉錢」全靠
-- Jeff 記得。本 migration 補閉環的最後一段:
--
--   transferredAt — 轉出時間(NULL = 還沒轉/還沒配對到轉帳)。非空 = 閉環完成。
--   transferBankTransactionId — Trust 側流出那筆 bankTransactions.id(概念 FK,
--     無實體約束,同 bankTransactionLinks.targetId / relatedBookingId 既有慣例)。
--
-- 回填來源:server/services/trustTransferDetection.ts 在 bankTransactions 找
-- 「Trust 流出 + Operating 流入」同額近日配對,對上已認列(recognizedAt 非空)
-- 的遞延列才回填(認列後才可轉出,紅綠測試釘死)。
--
-- Migration 風格:照 docs/MIGRATION_PATTERNS.md Rule 1,TiDB 原生 ADD COLUMN
-- IF NOT EXISTS,不套 PREPARE/IF(0070 事故)。兩句之間用 drizzle 分句標記
-- 分隔(見下方,標記獨立成行,不寫進註解 —— 0112 事故)。

ALTER TABLE `trustDeferredIncome` ADD COLUMN IF NOT EXISTS `transferredAt` TIMESTAMP NULL;

--> statement-breakpoint

ALTER TABLE `trustDeferredIncome` ADD COLUMN IF NOT EXISTS `transferBankTransactionId` INT NULL;
