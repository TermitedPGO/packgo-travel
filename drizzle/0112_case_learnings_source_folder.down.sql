-- Down for 0112_case_learnings_source_folder — drop the index + sourceFolder column if present.
-- Idempotent (TiDB 原生 IF EXISTS)。
--
-- 注意:sourceOrderId 不強制改回 NOT NULL —— 若塊B 已寫過 blocked 案(sourceOrderId NULL),
-- MODIFY 回 NOT NULL 會失敗。down 只還原 additive 的部分(欄位 + 索引),讓 sourceOrderId 維持
-- nullable(對 app 無害:distillCaseLearning 仍寫非 NULL 值,getCaseLearnings 讀 lesson 不看它)。

ALTER TABLE `caseLearnings` DROP INDEX IF EXISTS `idx_cl_source_folder`;

--> statement-breakpoint

ALTER TABLE `caseLearnings` DROP COLUMN IF EXISTS `sourceFolder`;
