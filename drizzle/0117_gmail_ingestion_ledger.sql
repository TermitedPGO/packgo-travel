-- 0117_gmail_ingestion_ledger: 客戶信攝取的唯一可稽核事實源 + intakeMode 旗標
-- (gmail-intake-ledger 批, 2026-07-13, Codex 11 輪九點契約 §1)。
--
-- 起因(docs/features/gmail-intake-ledger/proposal.md):已證實客戶信永久漏接
-- 路徑(unread 當游標 + push watch 靜默死 + reconcile 盲區)。裁定:History API
-- 升為權威增量游標,ingestion ledger 當唯一可稽核事實源,message 級唯一鍵
-- (integrationId+gmailMessageId)做 at-least-once 發現 + 冪等落庫;先耐久落帳
-- 再推游標(原子邊界),任一候選未落帳游標不得前進。
--
-- 本 migration 三件事:
--   1. 建 gmailIngestionLedger:一列 = 一封 History 引擎(或 bounded fallback /
--      backfill)發現的 Gmail 訊息。UNIQUE(integrationId, gmailMessageId) = 冪等鍵。
--      internalDateMs 用 BIGINT 存 epoch 毫秒(不用 DATETIME,毫秒不被取整到秒)。
--      不存 subject/body/附件任何內容 —— fromAddress 是 eligibility 唯一必要欄。
--   2. gmailIntegration 加 lastSuccessfulSyncAt(History 游標最後一次成功前進的
--      時間;NULL = 從未 History 同步;404 bounded fallback 的重疊窗從此 −24h 起)。
--   3. gmailIntegration 加 intakeMode ENUM(legacy/shadow/history) default legacy
--      —— 逐信箱切換 History 路徑的旗標,只改 DB 欄不動 env。legacy(預設)=
--      現行 3 分鐘 poll 零變化;shadow = History 引擎跑+寫 ledger 但不餵下游不貼標;
--      history = ledger pending 餵既有 processOneEmail 鏈。
--
-- v2 就地修訂(2026-07-13, Codex 12 輪退回兩結構 P0 —— 本 migration 尚未套用於
-- 任何 DB,故直接改 CREATE 定義而非追加 ALTER):
--   * P0-1 ledger 先於分類 —— 一列在「發現」當下即以最小欄落帳,分類移到下游。
--     因此:`fromAddress` 由 NOT NULL 改 NULL(發現時還沒抓 From header);
--     新增 `route`/`wouldRoute` ENUM 可空(分類階段才寫,收據路由先於 noise/self
--     終態);新增 `classifiedAt` 可空(分類時點)。`internalDateMs` 維持 NOT NULL
--     但發現時先寫 0,分類 hydrate 後回填(不改欄位型別,避免動 schema 面)。
--   * 修訂只擴欄不改鍵:UNIQUE(integrationId,gmailMessageId) 冪等鍵不變,
--     _journal 不變(同一 idx 117,仍未套用)。
--
-- Migration 風格:照 docs/MIGRATION_PATTERNS.md Rule 1,CREATE TABLE / ADD COLUMN
-- IF NOT EXISTS(TiDB 原生),不套 PREPARE/IF(0070 事故);Rule 2,語句間用
-- breakpoint 標記行分隔(標記獨立成行,註解內不得出現字面標記 —— 0112 事故)。
-- 本檔僅產出,絕不對任何 DB 執行(紅線 9;prod 由 pnpm ship 的 release_command
-- 跑,執行後照 Rule 3 SHOW TABLES/COLUMNS 驗證)。
--
-- 回退參考(documented down,非自動執行 —— 本 repo migration 為 forward-only,
-- forward-fix 為主;此段供人工回退時照抄):
--   DROP TABLE IF EXISTS `gmailIngestionLedger`;
--   ALTER TABLE `gmailIntegration` DROP COLUMN IF EXISTS `intakeMode`;
--   ALTER TABLE `gmailIntegration` DROP COLUMN IF EXISTS `lastSuccessfulSyncAt`;
-- (v2 擴欄若已套用而只想回退欄位:DROP COLUMN route/wouldRoute/classifiedAt,
--  MODIFY fromAddress ... NOT NULL —— 但表未上線前無此需要。)

CREATE TABLE IF NOT EXISTS `gmailIngestionLedger` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `integrationId` INT NOT NULL,
  `gmailMessageId` VARCHAR(128) NOT NULL,
  `gmailThreadId` VARCHAR(128) NOT NULL,
  `gmailHistoryId` VARCHAR(100) NULL,
  `internalDateMs` BIGINT NOT NULL,
  `fromAddress` VARCHAR(320) NULL,
  `source` ENUM('history','push_wake','fallback_scan','backfill') NOT NULL,
  `status` ENUM('pending','processed','ignored','failed') NOT NULL DEFAULT 'pending',
  `route` ENUM('customer','receipt','noise','self_or_outbound','manual_review') NULL,
  `wouldRoute` ENUM('customer','receipt','noise','self_or_outbound','manual_review') NULL,
  `classifiedAt` TIMESTAMP NULL,
  `failureKind` VARCHAR(64) NULL,
  `errorDetail` VARCHAR(512) NULL,
  `httpStatus` INT NULL,
  `retryCount` INT NOT NULL DEFAULT 0,
  `nextRetryAt` TIMESTAMP NULL,
  `firstSeenAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastAttemptAt` TIMESTAMP NULL,
  `processedAt` TIMESTAMP NULL,
  `interactionId` INT NULL,
  UNIQUE KEY `uq_ledger_integration_msg` (`integrationId`, `gmailMessageId`),
  KEY `idx_ledger_status` (`integrationId`, `status`, `nextRetryAt`),
  KEY `idx_ledger_thread` (`integrationId`, `gmailThreadId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

ALTER TABLE `gmailIntegration` ADD COLUMN IF NOT EXISTS `lastSuccessfulSyncAt` TIMESTAMP NULL;

--> statement-breakpoint

ALTER TABLE `gmailIntegration` ADD COLUMN IF NOT EXISTS `intakeMode` ENUM('legacy','shadow','history') NOT NULL DEFAULT 'legacy';
