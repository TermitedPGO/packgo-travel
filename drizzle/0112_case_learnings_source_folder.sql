-- 0112_case_learnings_source_folder: 批十一 塊B「案件經驗收割」需要 (2026-07-06)。
--
-- 起因:塊B 要把每個案件資料.md 的「對話經驗(踩坑)/風險注意事項」逐條蒸餾進
-- caseLearnings,且「全部 15 案都收,含 blocked 未建客人卡的案子」。既有 caseLearnings
-- 是給案子完結後 distillCaseLearning 用的,sourceOrderId NOT NULL(一單一課、以訂單去重)。
-- 兩個衝突要解:
--   1. blocked 案沒有訂單 → sourceOrderId 必須可為 NULL。
--   2. 塊B 的冪等去重是「同一個案件資料夾只收一次」,不是「一張單一次」→ 需要 sourceFolder。
--
-- Migration 風格:照 docs/MIGRATION_PATTERNS.md —— TiDB 原生 MODIFY / ADD COLUMN IF NOT
-- EXISTS / ADD INDEX IF NOT EXISTS,不套 PREPARE/IF(0070 事故:PREPARE 內 DDL 在 TiDB 靜默
-- no-op)。每句 SQL 之間用 drizzle 的分句標記分隔(見下方各句),migrator 靠它切句。
--
-- 欄位:
--   sourceOrderId — 改 nullable。有訂單的案子仍填(與 distillCaseLearning 相容);blocked
--     案填 NULL。distillCaseLearning 的「一單一課」去重仍以非 NULL 的 sourceOrderId 判斷,
--     不受影響。
--   sourceFolder — 案件資料夾名(folderName)。塊B 冪等:同 folderName 已有列就整案跳過。
--     distillCaseLearning 寫的列 sourceFolder 為 NULL,兩條路互不干擾。
-- 索引:(sourceFolder, createdAt) 給塊B 冪等查詢用。

ALTER TABLE `caseLearnings` MODIFY COLUMN `sourceOrderId` INT NULL;

--> statement-breakpoint

ALTER TABLE `caseLearnings` ADD COLUMN IF NOT EXISTS `sourceFolder` VARCHAR(255) NULL;

--> statement-breakpoint

ALTER TABLE `caseLearnings` ADD INDEX IF NOT EXISTS `idx_cl_source_folder` (`sourceFolder`, `createdAt`);
