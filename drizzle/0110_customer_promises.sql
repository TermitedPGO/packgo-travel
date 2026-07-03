-- 0110_customer_promises: 新表 customerPromises — 3a 承諾追蹤 (2026-07-03)。
--
-- 起因(docs/features/customer-cockpit/design-phase3-4.md 3a):Jeff 寄信裡常常
-- 答應客人一件具體的事(「週五可取件」「明天發報價」),系統從來不記得這些
-- 承諾,過期沒兌現全靠 Jeff 自己記住。這張表存每一則從寄出信件抽出來的承諾句 +
-- 到期日,看門狗規則(customOrderWatchdog.evaluateCommitment)在過期未兌現時
-- 跳黃卡提醒。
--
-- Migration 風格決策(見 design-phase3-4.md「Migration 風格決策」節,完整推理
-- 在那裡):這是新表,不是欄位新增。docs/MIGRATION_PATTERNS.md Rule 1 明講
-- CREATE TABLE 一律用 CREATE TABLE IF NOT EXISTS,不要用 PREPARE/EXECUTE 包裝
-- ——2026-05-13 migration 0070 就是這個包裝模式在 TiDB 上靜默 no-op 造成 P0
-- 事故(release_command exit 0,但表沒建出來)。0104-0109 的 INFORMATION_SCHEMA
-- guard 是套用在「欄位新增」(ALTER TABLE ADD COLUMN)上,不適用於新表 DDL。
--
-- 欄位:
--   customerProfileId — 跨客戶守門用(mark_promise 工具比對目前釘住客人)。
--   customOrderId — nullable 軟參考,承諾不一定掛在某張訂製單上(跟
--     customerInteractions.customOrderId 同慣例,NULL = 未分類)。
--   sourceInteractionId — 指向 customerInteractions.id(概念上的 FK,查重用:
--     recordPromisesForInteraction 靠這個防止同一封信被重複抽取燒 LLM)。
--   rawDateText — LLM 抽出的日期原文(「週五」「7/10」),resolveEventDate 算
--     dueDate 用的輸入,保留供除錯/未來顯示。
--   dueDate — resolveEventDate 算出來的到期日;抽不出來就 NULL,這則承諾永遠
--     不參與看門狗判斷(誠實邊界,見 evaluateCommitment)。
--   fulfilledAt / dismissedAt — 只有 mark_promise 工具、且只在 Jeff 聊天裡明確
--     表達時才會寫入,AI 絕不自動標記。
--
-- 索引:(customerProfileId, dueDate) 給看門狗查詢用;(sourceInteractionId) 給
-- 查重用。

CREATE TABLE IF NOT EXISTS `customerPromises` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customerProfileId` INT NOT NULL,
  `customOrderId` INT NULL,
  `sourceInteractionId` INT NOT NULL,
  `promiseText` TEXT NOT NULL,
  `rawDateText` VARCHAR(100) NULL,
  `dueDate` DATE NULL,
  `extractedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `fulfilledAt` TIMESTAMP NULL,
  `dismissedAt` TIMESTAMP NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_cp_profile_due` (`customerProfileId`, `dueDate`),
  KEY `idx_cp_source_interaction` (`sourceInteractionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
