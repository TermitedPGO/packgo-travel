/**
 * registryWhitelist.ts — C 類白名單:server/ 裡「不進 EXPLAIN 彩排」的 raw SQL 出現點。
 * 每條寫明理由。coverage.test.ts:每個 source 要嘛在此、要嘛在 ENTRIES.sources。
 */
import type { WhitelistEntry } from "./registry";

export const WHITELIST: WhitelistEntry[] = [
  { source: "server/_core/healthCheck.ts:161", reason: "SELECT 1 是純健康探測(liveness ping),不含任何表/欄位,不對應任何 schema 查詢,EXPLAIN 對它無意義(MySQL/TiDB 對 SELECT 1 的 EXPLAIN 只會顯示 'No tables used',沒有計畫可彩排)。" },
  { source: "server/_core/guestNoiseGate.ts:86", reason: "可重用 SQL 片段常量(qualifiesViaContent 之類 EXISTS(...) 片段),本身非獨立語句無法單獨 EXPLAIN;其 parse 由呼叫端 adminCustomers.buildGuestListQuery / runGuestUnreadRankingQuery 與 globalSearch.* 的已登記查詢覆蓋。" },
  { source: "server/_core/guestNoiseGate.ts:93", reason: "可重用 SQL 片段常量(latestInboundIsSpam 之類子查詢片段),本身非獨立語句;其 parse 由呼叫端 globalSearch.* / adminCustomers.* 的已登記查詢覆蓋。" },
  { source: "server/_core/auditLog.ts:285", reason: "SELECT GET_LOCK('audit:tip:lock',3) 是 MySQL/TiDB advisory lock 函式呼叫(audit-chain-repair R8-2 共鎖域),不含任何表/欄位,EXPLAIN 無計畫可彩排(No tables used)。" },
  { source: "server/_core/auditLog.ts:305", reason: "SELECT RELEASE_LOCK('audit:tip:lock') 同上,advisory lock 釋放,無表無欄位,EXPLAIN 無意義。" },
  { source: "server/_core/auditLog.ts:315", reason: "KILL CONNECTION_ID() 是污染 session 隔離(R10-2:RELEASE_LOCK 失敗時終止帶鎖連線),session 管理指令無表無欄位,EXPLAIN 無意義。" },
];
