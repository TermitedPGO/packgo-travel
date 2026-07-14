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
-- v3 就地修訂(2026-07-13, Codex 15 輪 P0-2 labelsAdded 狀態感知重排 —— 同樣尚未套用,
-- 故直接改 CREATE 定義):加四個稽核欄支援 ignored→pending 重排。發現寫入從單純
-- INSERT IGNORE 升為狀態感知 upsert —— 一封被分類為 ignored(noise/self)的信之後又有
-- 較新的 INBOX 事件(labelAdded INBOX / 重新掃到)時,重排回 pending 重新分類,不再永久
-- 卡在 ignored;processed 列只更新 lastSeenHistoryId 絕不重跑商業副作用。
--   * lastSeenHistoryId:最近一次入箱事件的 historyId(gmailHistoryId 維持首次發現值)。
--   * discoveryReason:'initial'(首次)/'inbox_requeue'(重排)。
--   * requeueCount / lastRequeuedAt:重排次數與時點(稽核軌跡,不覆蓋原分類歷史)。
--
-- v4 就地修訂(2026-07-13, Codex 16 輪兩個開放 P0 —— 同樣尚未套用,故直接改 CREATE):
--   * P0-2 事件級重排冪等:加 `lastRequeueEventId`(單調重排水位)。重排閘門從「只要
--     eventKind=label_added_inbox 且 status=ignored」升為「該 label 事件的 history record
--     id 嚴格大於本列 lastRequeueEventId」——replay 同一(或較舊)事件即使該列已循環回
--     ignored 也不再重排(requeueCount 不重複累加)。lastSeenHistoryId 的 upsert 由
--     COALESCE-only 改為 forward-only 單調(見 adapter statement 1),不再被較舊值倒退。
--     lastRequeueEventId 只在真正重排時寫,statement 1 從不碰它 → 兩語句無讀後寫危害。
--   * P0-3 orchestration fencing + DB row claim:加 `claimToken`/`claimExpiresAt`/
--     `claimStage`。classify 與 feed 各自對候選列做原子 CAS claim(帶原狀態 + lease 條件的
--     UPDATE,affectedRows=1 才是 winner);markProcessed/markFailed/markIgnored/classify
--     一律帶 claimToken 條件,舊/失效 token 或已被他人完成的列寫回被拒(A 成功後 B 撞唯一鍵
--     的 markFailed 不得把 processed 覆成 failed)。lease 可續期,crash 後到期才可重取。
--     per-integration fencing 仍為第一層,row claim 為商業副作用的最後一道門。
--     idx_ledger_claim(integrationId,status,claimExpiresAt)支撐每輪 claim 掃描。
--
-- v5 就地修訂(2026-07-14, Codex 18 輪 §七 scan floor —— 同樣尚未套用,故直接改 CREATE):
--   * 加 `scanConsumedFloor` VARCHAR(100) NULL:scan(bootstrap / 404 fallback)發現的列
--     沒有 per-message history event id(lastSeenHistoryId/lastRequeueEventId 皆 NULL),
--     持久保存「掃描前 capture 的 mailbox baseline」作 consumed floor(獨立欄,不冒充
--     per-message lastSeenHistoryId)。重排閘門(adapter statement 1 WHERE)由比
--     COALESCE(lastRequeueEventId, lastSeenHistoryId) 升為嚴格大於
--     MAX(lastRequeueEventId, lastSeenHistoryId, scanConsumedFloor)——修掉「scan 建列的
--     NULL 水位吞掉第一個真 label 事件」的洞,且拒絕把 NULL 一律當 '0' 兜底。
--     只在 scan INSERT 寫,之後 history sighting 的 ODKU 不覆蓋;message_added 建列保持 NULL。
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
  `lastSeenHistoryId` VARCHAR(100) NULL,
  `discoveryReason` VARCHAR(64) NULL,
  `requeueCount` INT NOT NULL DEFAULT 0,
  `lastRequeuedAt` TIMESTAMP NULL,
  `lastRequeueEventId` VARCHAR(100) NULL,
  `scanConsumedFloor` VARCHAR(100) NULL,
  `claimToken` VARCHAR(64) NULL,
  `claimExpiresAt` TIMESTAMP NULL,
  `claimStage` VARCHAR(16) NULL,
  UNIQUE KEY `uq_ledger_integration_msg` (`integrationId`, `gmailMessageId`),
  KEY `idx_ledger_status` (`integrationId`, `status`, `nextRetryAt`),
  KEY `idx_ledger_thread` (`integrationId`, `gmailThreadId`),
  KEY `idx_ledger_claim` (`integrationId`, `status`, `claimExpiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--> statement-breakpoint

ALTER TABLE `gmailIntegration` ADD COLUMN IF NOT EXISTS `lastSuccessfulSyncAt` TIMESTAMP NULL;

--> statement-breakpoint

ALTER TABLE `gmailIntegration` ADD COLUMN IF NOT EXISTS `intakeMode` ENUM('legacy','shadow','history') NOT NULL DEFAULT 'legacy';
