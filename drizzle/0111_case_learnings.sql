-- 0111_case_learnings: 新表 caseLearnings — Phase5 學習閉環 (2026-07-03)。
--
-- 起因(docs/features/customer-cockpit/roadmap-100.md Phase5):案子完結
-- (completed/cancelled)時,這個客人學到的已經進他的記憶(customerProfiles.
-- aiNotes/keyFacts),但「這一類案子」學到的東西(供應商雷、路線經驗、定價
-- 經驗)沒有地方存,每次都從頭學。這張表存每一次案子完結後蒸餾出來的可複用
-- 教訓,新同類案子第一回合就能帶出「上次這類案子的教訓」。
--
-- Migration 風格決策:跟 0110_customer_promises 同理,這是新表不是欄位新增,
-- 沿用 docs/MIGRATION_PATTERNS.md Rule 1 的 CREATE TABLE IF NOT EXISTS 原生
-- DDL,不套用 0104-0109 那組給 ALTER TABLE ADD COLUMN 用的 INFORMATION_SCHEMA
-- + PREPARE 包裝(0070 事故:那套包裝在 TiDB 上對不適用的語句會靜默 no-op)。
--
-- 欄位:
--   caseType — 這一類案子的分類鍵(沿用 customOrders.category:flight/visa/
--     quote/general),決定要跟哪些教訓比對。
--   destination — 目的地(沿用 customOrders.destination 原文,NULL = 未填)。
--   lesson — LLM 蒸餾出的教訓文字,PII 紀律:不寫客人全名,一律用「某 12 月
--     北海道家庭案」式指代(distillCaseLearning 的 prompt 規則)。
--   sourceOrderId — 指向 customOrders.id(概念上的 FK,同慣例);查重用 —
--     一張單只蒸餾一次,晚間批次補漏靠這個判斷是否已經蒸餾過。
--   createdAt — 蒸餾時間。
--
-- 索引:(caseType, destination, createdAt) 給注入查詢用(同類案找最新 3 條);
-- (sourceOrderId) 給查重用。

CREATE TABLE IF NOT EXISTS `caseLearnings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `caseType` VARCHAR(32) NULL,
  `destination` VARCHAR(200) NULL,
  `lesson` TEXT NOT NULL,
  `sourceOrderId` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_cl_type_dest_created` (`caseType`, `destination`, `createdAt`),
  KEY `idx_cl_source_order` (`sourceOrderId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
