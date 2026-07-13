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
  { source: "server/services/gmailIntakeAdapters.ts:150", reason: "新表首航:gmailIngestionLedger 由 migration 0117 建立,prod TiDB 尚未套用(migration 在 release_command 才跑,閘 6.5 的 EXPLAIN 在部署前執行),對不存在的表 EXPLAIN 必然 resolution 失敗,登記反而永紅 —— 無既有新表先例(0116 checkoutDisclosures / 0079 skillRuns 批皆無 raw SQL token)。0117 套用後移入正式登記,裸語句:INSERT INTO `gmailIngestionLedger` (`integrationId`,`gmailMessageId`,`gmailThreadId`,`gmailHistoryId`,`internalDateMs`,`fromAddress`,`source`,`status`) VALUES (?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE `integrationId` = integrationId(cls B,sql`integrationId` 為 no-op 片段)。" },
  { source: "server/services/gmailIntakeAdapters.ts:189", reason: "新表首航:同上,gmailIngestionLedger(0117)prod 尚未存在,EXPLAIN 不可行;0117 套用後移入正式登記,裸語句:SELECT * FROM `gmailIngestionLedger` WHERE (`integrationId` = ? AND (`status` = 'pending' OR (`status` = 'failed' AND `retryCount` <= ? AND `nextRetryAt` IS NOT NULL AND `nextRetryAt` <= ?))) ORDER BY `firstSeenAt` ASC LIMIT 100(cls B,sql`nextRetryAt IS NOT NULL` 為片段)。註:gmailIntegration 的 CAS UPDATE(advanceCursorCAS)純 drizzle builder 無 raw token,不在盤點口徑內。" },
];
