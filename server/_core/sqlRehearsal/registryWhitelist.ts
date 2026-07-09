/**
 * registryWhitelist.ts — C 類白名單:server/ 裡「不進 EXPLAIN 彩排」的 raw SQL 出現點。
 * 每條寫明理由。coverage.test.ts:每個 source 要嘛在此、要嘛在 ENTRIES.sources。
 */
import type { WhitelistEntry } from "./registry";

export const WHITELIST: WhitelistEntry[] = [
  { source: "server/_core/healthCheck.ts:161", reason: "SELECT 1 是純健康探測(liveness ping),不含任何表/欄位,不對應任何 schema 查詢,EXPLAIN 對它無意義(MySQL/TiDB 對 SELECT 1 的 EXPLAIN 只會顯示 'No tables used',沒有計畫可彩排)。" },
  { source: "server/_core/guestNoiseGate.ts:86", reason: "可重用 SQL 片段常量(qualifiesViaContent 之類 EXISTS(...) 片段),本身非獨立語句無法單獨 EXPLAIN;其 parse 由呼叫端 adminCustomers.buildGuestListQuery / runGuestUnreadRankingQuery 與 globalSearch.* 的已登記查詢覆蓋。" },
  { source: "server/_core/guestNoiseGate.ts:93", reason: "可重用 SQL 片段常量(latestInboundIsSpam 之類子查詢片段),本身非獨立語句;其 parse 由呼叫端 globalSearch.* / adminCustomers.* 的已登記查詢覆蓋。" },
];
