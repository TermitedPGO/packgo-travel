/**
 * registryWhitelist.ts — C 類白名單:server/ 裡「不進 EXPLAIN 彩排」的 raw SQL 出現點。
 * 每條寫明理由。coverage.test.ts:每個 source 要嘛在此、要嘛在 ENTRIES.sources。
 */
import type { WhitelistEntry } from "./registry";

export const WHITELIST: WhitelistEntry[] = [
  { source: "server/_core/healthCheck.ts:161", reason: "SELECT 1 是純健康探測(liveness ping),不含任何表/欄位,不對應任何 schema 查詢,EXPLAIN 對它無意義(MySQL/TiDB 對 SELECT 1 的 EXPLAIN 只會顯示 'No tables used',沒有計畫可彩排)。" },
  { source: "server/_core/guestNoiseGate.ts:86", reason: "可重用 SQL 片段常量(qualifiesViaContent 之類 EXISTS(...) 片段),本身非獨立語句無法單獨 EXPLAIN;其 parse 由呼叫端 adminCustomers.buildGuestListQuery / runGuestUnreadRankingQuery 與 globalSearch.* 的已登記查詢覆蓋。" },
  { source: "server/_core/guestNoiseGate.ts:93", reason: "可重用 SQL 片段常量(latestInboundIsSpam 之類子查詢片段),本身非獨立語句;其 parse 由呼叫端 globalSearch.* / adminCustomers.* 的已登記查詢覆蓋。" },
  // ── gmail-intake-ledger 新表首航(0117 gmailIngestionLedger,prod 尚未套用)────
  // TODO(0117 上 prod 後):把下面兩條移入 registryEntries 正式登記(裸語句見各條 reason),
  // 從白名單刪除。追蹤:docs/features/gmail-intake-ledger/progress.md。
  { source: "server/services/gmailIntakeAdapters.ts:190", reason: "新表首航:gmailIngestionLedger 由 migration 0117 建立,prod TiDB 尚未套用(migration 在 release_command 才跑,閘 6.5 的 EXPLAIN 在部署前執行),對不存在的表 EXPLAIN 必然 resolution 失敗,登記反而永紅 —— 無既有新表先例(0116 checkoutDisclosures / 0079 skillRuns 批皆無 raw SQL token)。0117 套用後移入正式登記。v2(Codex 12 輪 P0-1)裸語句為最小發現列,drizzle 對 .values() 提供的每個值一律綁參(含常量 internalDateMs=0 與 status='pending',皆為 ?,非內聯字面量;多列一次 insert 時 VALUES 元組逐列重複):INSERT INTO `gmailIngestionLedger` (`integrationId`,`gmailMessageId`,`gmailThreadId`,`gmailHistoryId`,`internalDateMs`,`source`,`status`) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `integrationId` = integrationId,sampleParams 每列 [1,'m1','t1','H2',0,'history','pending'](cls B,sql`integrationId` 為 no-op 片段)。" },
  { source: "server/services/gmailIntakeAdapters.ts:290", reason: "新表首航:同上,gmailIngestionLedger(0117)prod 尚未存在,EXPLAIN 不可行;0117 套用後移入正式登記。v2 listActionable 裸語句(feeder 只取已分類的 customer/receipt pending 加重試到期的 failed),drizzle 綁參形式(status/route/limit 全為 ?):SELECT * FROM `gmailIngestionLedger` WHERE (`integrationId` = ? AND ((`status` = ? AND `route` IN (?, ?)) OR (`status` = ? AND `retryCount` <= ? AND `nextRetryAt` IS NOT NULL AND `nextRetryAt` <= ?))) ORDER BY `firstSeenAt` ASC LIMIT ?,sampleParams [1,'pending','customer','receipt','failed',2,NOW(),100](cls B,sql`nextRetryAt IS NOT NULL` 為片段)。註:gmailIntegration 的 CAS UPDATE(advanceCursorCAS)、listUnclassified/recordClassifyFailure/classify 均純 drizzle builder 無 raw token,不在盤點口徑內。" },
];
