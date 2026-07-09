/**
 * rehearsalCore.mjs — 純邏輯核心,ship 前 SQL 彩排閘(EXPLAIN parse/resolution)。
 *
 * 這支檔有兩個消費者,故意寫成「無頂層副作用、無 import」的純函式:
 *   1. server/_core/sqlRehearsal/rehearsalCore.test.ts —— vitest 單測(安全鐵則四條)。
 *   2. scripts/sqlRehearsalGate.ts(orchestrator)—— 把本檔文字讀進來、去掉每行開頭
 *      的 `export `,和一段 bootstrap 串成「自帶內容、只依賴 node_modules(mysql2)」
 *      的遠端 blob,base64 後餵給 prod 機上的 node 執行。因為 prod 機上不會有這支檔,
 *      遠端 blob 必須自我完整;把本檔 inline 進去 = 遠端跑的守門邏輯跟這裡被單測的
 *      邏輯逐字同源,不會漂移。
 *
 * 因此本檔的硬性約束:
 *   - 只准 `export function` / `export async function`(orchestrator 靠 `/^export /` 去掉)。
 *   - 去掉 export 後剩下的必須是 CommonJS 也能跑的頂層函式宣告(遠端用 `node` 讀 stdin
 *     當 CJS 跑)。所以這裡不准有 import/其他 export 形式/top-level 副作用。
 *
 * 安全鐵則(對應派工單塊 B,每條有單測):
 *   1. 正向白名單:裸語句必須以查詢/DML 動詞(SELECT/INSERT/UPDATE/DELETE/REPLACE/WITH)
 *      開頭。閘自己統一加 EXPLAIN 前綴,故這條同時擋掉:(a) EXPLAIN 開頭(登記表不准
 *      自帶前綴);(b) 更關鍵的 bare `ANALYZE` 開頭 —— `EXPLAIN ` + `ANALYZE DELETE ...`
 *      會變成 EXPLAIN ANALYZE,TiDB 對 DML「真的執行」,唯讀 prod 大忌;(c) 其他任何
 *      非查詢/DML 動詞(SET/USE/CALL/LOAD/前導區塊註解...)。用正向白名單而非「擋 EXPLAIN」
 *      的黑名單,是因為黑名單擋不完(bare ANALYZE、前導區塊註解都能鑽)。
 *   2. 單語句檢查:原始裸語句內不得含分號(尾隨一個除外)。只驗「原始 sql」而不驗
 *      format 後結果 —— mysql2.format 對 `?` 值做引號跳脫,不可能把單語句 template
 *      變成多語句;反而 param 值裡合法的分號(如 '%a;b%')驗 format 後會被誤殺。
 *   3. 連線先 SET SESSION TRANSACTION READ ONLY 才跑(runRehearsal 保證 setup() 在
 *      任何 EXPLAIN 之前呼叫;單測用呼叫順序陣列釘住)。
 *   4. 只回 { key, source, error } —— 永不回 EXPLAIN 的結果行(避免 schema 細節進 log)。
 */

// 鐵則 1 — 正向白名單:只放行以查詢/DML 動詞開頭的裸語句。
// 這一條把「不准自帶 EXPLAIN」與「更關鍵的 bare ANALYZE(EXPLAIN ANALYZE 會真執行 DML)」
// 一起關掉。黑名單(只擋 EXPLAIN)擋不完:bare `ANALYZE DELETE ...`、前導 `/*x*/EXPLAIN ...`
// 都能鑽,故用白名單。前導註解 / 空白後才是動詞的也一律擋(保守但不漏)。
const ALLOWED_LEADING_VERB = /^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i;
export function assertLeadingVerbAllowed(sql) {
  if (!ALLOWED_LEADING_VERB.test(sql)) {
    throw new Error(
      "statement must begin with SELECT/INSERT/UPDATE/DELETE/REPLACE/WITH — the gate prepends EXPLAIN itself. " +
        "This positive allowlist rejects EXPLAIN- and ANALYZE-prefixed entries (EXPLAIN ANALYZE EXECUTES the statement on TiDB) " +
        "and any non-DML leading verb / leading comment.",
    );
  }
}

// 鐵則 2
export function assertSingleStatement(sql) {
  const trimmed = String(sql).replace(/\s+$/, "");
  const body = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
  if (body.includes(";")) {
    throw new Error(
      "statement contains an embedded ';' — only a single statement may be EXPLAINed " +
        "(a multi-statement string could run a second statement)",
    );
  }
}

/**
 * 把一條登記條目變成最終要送的 `EXPLAIN <完整字面語句>`。
 * formatFn = mysql2 的 format(客戶端把 sampleParams 代入 `?`;TiDB 的 EXPLAIN 不吃 `?`)。
 * 前綴 EXPLAIN 由這裡統一加,絕不信任登記表自帶(鐵則 1)。
 */
export function buildExplainStatement(sql, params, formatFn) {
  assertLeadingVerbAllowed(sql);
  assertSingleStatement(sql);
  const formatted = formatFn(sql, params ?? []);
  return "EXPLAIN " + formatted;
}

/**
 * 逐條彩排。setup() 一定在任何 EXPLAIN 之前跑(唯讀 session)。
 * 回傳只含 { key, source, error }(鐵則 4)—— queryFn 的結果行整個丟掉。
 * queryFn 丟例外(EXPLAIN parse/resolution 錯)或 guard 擋下 → 記一筆失敗;整批不中斷。
 */
export async function runRehearsal({ entries, queryFn, formatFn, setup }) {
  if (typeof setup === "function") await setup(); // 鐵則 3:先 READ ONLY
  const failures = [];
  let passed = 0;
  for (const e of entries) {
    let explainSql;
    try {
      explainSql = buildExplainStatement(e.sql, e.sampleParams, formatFn);
    } catch (err) {
      failures.push({ key: e.key, source: e.source, error: "guard: " + firstLine(err) });
      continue;
    }
    try {
      await queryFn(explainSql); // 結果行整個不理(鐵則 4)
      passed++;
    } catch (err) {
      failures.push({ key: e.key, source: e.source, error: firstLine(err) });
    }
  }
  return { ok: failures.length === 0, total: entries.length, passed, failures };
}

export function firstLine(e) {
  return (e && e.message ? String(e.message) : String(e)).split("\n")[0].slice(0, 300);
}
