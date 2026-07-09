/**
 * registry.ts — SQL 彩排登記表(硬化戰役 Wave 2:資料庫真實化)。
 *
 * 這張表是「ship 前對 prod TiDB 逐條跑 EXPLAIN」的清單。server/ 每一處 raw SQL
 * ——`sql\`\`` 樣板(含泛型寫法 `sql<T>\`\``)與 `db.execute(`——要嘛在 ENTRIES 有條目、
 * 要嘛在 WHITELIST 有一行理由,否則 coverage.test.ts 會紅。彩排把「這條 SQL 在
 * TiDB 上 parse/resolution 不了」擋在 ship 前(TiDB 已咬三口:LIKE ESCAPE 反斜線、
 * migration 註解 `-->` 切壞 0112、ORDER BY 關聯子查詢)。
 *
 * ── 邊界(後人別誤信「彩排 = 全保險」)────────────────────────────────
 * EXPLAIN 抓的是 parse / resolution 錯:語法、未知欄位/表、子句結構、名稱解析。
 * EXPLAIN 抓不到「行為差異 / 結果對不對」:
 *   - LIKE ... ESCAPE 的跳脫字元語意(反斜線 '\\' vs '!';考古在
 *     caseFileImport.ts:243-254)。兩種寫法都 parse 得過,差別在執行期比對行為 ——
 *     這類靠 vitest 不靠彩排。ESCAPE 活體 caseDocumentImport.ts:225 /
 *     caseLessonHarvest.ts:180 仍登記(確保「parse 得過」),但它們的正確性不是彩排保的。
 *   - raw sql<Date> 在 mysql2/TiDB 回 naive 字串(reference_drizzle_rawsql_date_gotcha)。
 *   - 秒級截斷、America/Los_Angeles 曆日、關聯子查詢排序「結果」對不對。
 * 一句話:彩排證明「SQL 在 TiDB parse 得過」,不證明「SQL 的結果是對的」。
 * ────────────────────────────────────────────────────────────────────
 *
 * 條目來源優先序:真 builder 的 `.toSQL()`(drizzle 不連線也能渲染)> 手抄等價形
 * (handWritten: true,走查抽查比對)。sql 一律存「裸語句」(SELECT/UPDATE/... 開頭,
 * 不含 EXPLAIN 前綴 —— 前綴由 scripts/sqlRehearsal/rehearsalCore.mjs 的閘統一加,
 * 見那裡的安全鐵則 1「拒絕 EXPLAIN 開頭」)。sql 內的 `?` 只准是真佔位符,絕不可在
 * 字串字面內出現 `?`(mysql2.format 會連字串內的 `?` 一起代入 → 參數錯位)。
 *
 * migration 檔(drizzle/*.sql)不在此表 —— 已有 migrationBreakpoint.test.ts 守,不重複建設。
 * B 類的 sql 是「包住該片段的整條 query」;A 類是本身完整的獨立語句。
 */
import { ENTRIES } from "./registryEntries";
import { WHITELIST } from "./registryWhitelist";

export interface RehearsalEntry {
  /** 全表唯一 key,命名 `<檔名>.<函式或用途>[.<分支>]`。 */
  key: string;
  /** 涵蓋此 query 的每個 `sql\`\`` / `db.execute(` 出現點,格式 "server/path.ts:行號"。 */
  sources: string[];
  /** A = 本身完整的獨立語句;B = builder 內片段(登記包住它的整條 query)。 */
  cls: "A" | "B";
  /** 裸語句:SELECT/UPDATE/INSERT/DELETE 開頭,? 佔位符,不含 EXPLAIN 前綴。 */
  sql: string;
  /** 無害假值,數量必須 == sql 內 ? 佔位符數(registry.test.ts 驗)。 */
  sampleParams: unknown[];
  /** true = 手抄等價形(未經真 toSQL);false/缺 = 由真 builder .toSQL() 產。 */
  handWritten?: boolean;
  /** 選填:信心不足處、動態分支說明、已知的既有 bug(照實登記不修)等。 */
  note?: string;
}

export interface WhitelistEntry {
  /** "server/path.ts:行號" —— 該 sql\`\` / db.execute( 出現點不進 EXPLAIN 的理由。 */
  source: string;
  reason: string;
}

export interface Registry {
  entries: RehearsalEntry[];
  whitelist: WhitelistEntry[];
}

/**
 * 數一條裸語句裡的 `?` 佔位符數。與 mysql2.format 的消耗口徑一致(它會把每個 `?`
 * 都代入一個參數,包括字串字面內的 —— 所以裸語句禁止在字串內出現 `?`)。
 */
export function countPlaceholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

/** 回傳整張登記表(entries + whitelist)。orchestrator 與各測試共用此單一來源。 */
export function getRegistry(): Registry {
  return { entries: ENTRIES, whitelist: WHITELIST };
}
