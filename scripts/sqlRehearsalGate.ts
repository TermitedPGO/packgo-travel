/**
 * sqlRehearsalGate.ts — ship 前 SQL 彩排閘的「本地 orchestrator」(硬化戰役 Wave 2 塊 B)。
 *
 * 由 scripts/safe-deploy.mjs 的閘 [6.5/7] 透過 `pnpm exec tsx scripts/sqlRehearsalGate.ts`
 * 呼叫。流程:
 *   1. 讀 server/_core/sqlRehearsal/registry.ts 的登記表(getRegistry)。
 *   2. 讀 scripts/sqlRehearsal/rehearsalCore.mjs 的文字,去掉每行開頭 `export `,和一段
 *      bootstrap 串成「自帶內容、只依賴 prod node_modules(mysql2)」的 CJS blob。因為
 *      prod 機上沒有這些 script 檔,blob 必須自我完整 —— 把核心 inline 進去 = 遠端跑的
 *      守門邏輯跟 rehearsalCore.test.ts 被單測的邏輯逐字同源,不漂移。
 *   3. base64 後走 Wave1 已驗證的通道 `flyctl ssh console -a packgo-travel -C
 *      "sh -lc 'echo <b64> | base64 -d | node'"` 餵給 prod 機上的 node,用機上
 *      DATABASE_URL 直連 TiDB,SET SESSION TRANSACTION READ ONLY 後逐條 EXPLAIN。
 *   4. 遠端只回 sentinel 包住的 JSON(key + pass/fail + error,無結果行)。
 *
 * 唯讀鐵則:不新增 HTTP 端點、不寫任何非 EXPLAIN 語句、READ ONLY session。EXPLAIN
 * 前綴由 rehearsalCore.mjs 統一加(拒絕登記表自帶 EXPLAIN,防 EXPLAIN ANALYZE 真執行)。
 *
 * 輸出契約(給 safe-deploy 解析):
 *   - 進度訊息一律寫 stderr(operator 看得到)。
 *   - 「唯一一行」機器可讀 JSON 寫 stdout:{ ok, total, passed, failures:[{key,source,error}],
 *     channelError? }。channelError 有值 = 通道問題(flyctl 連不上 / DB 連不上),擋部署但
 *     附逃生口。本腳本一律 exit 0(狀態編碼在 JSON 裡),讓 safe-deploy 決定紅/綠。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getRegistry } from "../server/_core/sqlRehearsal/registry";

const APP = "packgo-travel";
const START = "__REH_START__";
const END = "__REH_END__";

const err = (...a: unknown[]) => process.stderr.write(a.join(" ") + "\n");
/** 唯一的 stdout 輸出:機器可讀 JSON 後即結束。 */
function emit(result: Record<string, unknown>): never {
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

/** 把 rehearsalCore.mjs inline 成 CJS + bootstrap,產出送上 prod 的自帶 blob。 */
function buildRemoteBlob(entriesJson: string): string {
  const corePath = fileURLToPath(new URL("./sqlRehearsal/rehearsalCore.mjs", import.meta.url));
  const coreStripped = readFileSync(corePath, "utf8").replace(/^export\s+/gm, "");
  // bootstrap:CJS,連 TiDB(ssl fallback per Wave1)、READ ONLY、跑 runRehearsal、印 sentinel JSON。
  const bootstrap = `
;(async () => {
  const START = ${JSON.stringify(START)}, END = ${JSON.stringify(END)};
  const out = (o) => process.stdout.write(START + JSON.stringify(o) + END);
  let mysql, format;
  try {
    mysql = require("mysql2/promise");
    format = require("mysql2").format;
  } catch (e) {
    return out({ ok: false, channelError: "remote: mysql2 not resolvable — " + (e && e.message || e), total: 0, passed: 0, failures: [] });
  }
  const raw = process.env.DATABASE_URL;
  if (!raw) return out({ ok: false, channelError: "remote: DATABASE_URL unset on machine", total: 0, passed: 0, failures: [] });
  let conn;
  try {
    const u = new URL(raw);
    conn = await mysql.createConnection({
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\\//, ""),
      ssl: { rejectUnauthorized: false },
      multipleStatements: false,
    });
  } catch (e) {
    // 對抗審查 finding #2:DB connect / new URL(raw) 的錯訊可能夾帶 DATABASE_URL(含密碼)。
    // 明細只寫遠端 stderr(flyctl 看得到),回給本地的 channelError 用固定字串,不接 e.message。
    try { process.stderr.write("remote DB connect/URL parse error: " + (e && e.message || e) + "\\n"); } catch (e2) {}
    return out({ ok: false, channelError: "remote: DB connect / DATABASE_URL parse failed (明細在機上 stderr;已隱去以免洩漏連線字串)", total: 0, passed: 0, failures: [] });
  }
  try {
    const entries = ${entriesJson};
    // 唯讀 session。TiDB 特性:SET TRANSACTION READ ONLY 是 noop function,預設被
    // tidb_enable_noop_functions 擋(2026-07-09 實測撞到);先開 noop 讓它被接受。兩者
    // 都 best-effort —— 真正的唯讀保證是「只送 EXPLAIN」(EXPLAIN 不執行語句,guard 已擋
    // EXPLAIN ANALYZE / 多語句),READ ONLY 只是 belt-and-suspenders,失敗不該中斷整批彩排。
    const setup = async () => {
      try { await conn.query("SET SESSION tidb_enable_noop_functions = 1"); } catch (e) {}
      try { await conn.query("SET SESSION TRANSACTION READ ONLY"); } catch (e) {}
    };
    const queryFn = async (s) => { await conn.query(s); };
    const res = await runRehearsal({ entries, queryFn, formatFn: format, setup });
    out(res);
  } catch (e) {
    out({ ok: false, channelError: "remote: rehearsal crashed — " + (e && e.message || e), total: 0, passed: 0, failures: [] });
  } finally {
    try { await conn.end(); } catch {}
  }
})();
`;
  return coreStripped + "\n" + bootstrap;
}

function main() {
  const { entries } = getRegistry();
  err(`[sql-rehearsal] 登記表 ${entries.length} 條;組遠端 blob…`);
  // 只送 EXPLAIN 需要的欄位(key/source/sql/sampleParams),不送 note 等雜訊。
  const payload = entries.map((e) => ({
    key: e.key,
    source: e.sources[0] ?? "?",
    sql: e.sql,
    sampleParams: e.sampleParams,
  }));
  const blob = buildRemoteBlob(JSON.stringify(payload));
  // 開發用:--emit-blob 把要送上 prod 的 CJS blob 印到 stdout(給 node --check 驗語法),
  // 不連 flyctl、不碰 prod。
  if (process.argv.includes("--emit-blob")) {
    process.stdout.write(blob);
    process.exit(0);
  }
  // 通道:blob 走 stdin 餵 prod 機上的 node(不走命令列參數 —— 238 條的 blob 破百 KB,
  // 當 echo 參數會 argument list too long;stdin 無此限、也免 shell 轉義/base64)。
  // `sh -lc 'node'` 用登入殼把 cwd 落在 /app(mysql2 才 resolve 得到,已實測)。DATABASE_URL
  // 由機上 env 提供,絕不進命令列。遠端只把 sentinel 包住的 JSON 印到 stdout。
  const remoteCmd = `sh -lc 'node'`;

  err(`[sql-rehearsal] flyctl ssh → prod TiDB 逐條 EXPLAIN(唯讀;blob 走 stdin)…`);
  let stdout: string;
  try {
    stdout = execFileSync("flyctl", ["ssh", "console", "-a", APP, "-C", remoteCmd], {
      input: blob,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"], // stdin=blob;stdout=sentinel JSON;stderr→operator
      maxBuffer: 32 * 1024 * 1024,
      timeout: 180_000,
    });
  } catch (e: unknown) {
    const m = e && typeof e === "object" && "message" in e ? String((e as Error).message).split("\n")[0] : String(e);
    return emit({ ok: false, channelError: `flyctl ssh 通道失敗:${m}`, total: entries.length, passed: 0, failures: [] });
  }

  const s = stdout.indexOf(START);
  const t = stdout.indexOf(END);
  if (s === -1 || t === -1 || t < s) {
    return emit({
      ok: false,
      channelError: "遠端沒回可解析的 JSON(通道/啟動異常;stdout 前 500 字:" + stdout.slice(0, 500).replace(/\s+/g, " ") + ")",
      total: entries.length,
      passed: 0,
      failures: [],
    });
  }
  let res: Record<string, unknown>;
  try {
    res = JSON.parse(stdout.slice(s + START.length, t));
  } catch (e) {
    return emit({ ok: false, channelError: "遠端 JSON 解析失敗:" + String(e), total: entries.length, passed: 0, failures: [] });
  }
  // 對抗審查 finding #3:交叉比對遠端跑的條數 == 本地送出的條數。payload 若被截斷,
  // 遠端會回 total=0、ok:true(0/0)→ soft fail-open。這裡把數量不符當通道失敗擋下。
  if (!res.channelError && res.total !== entries.length) {
    return emit({
      ok: false,
      channelError: `遠端只回 total=${res.total},本地送出 ${entries.length} 條(payload 疑被截斷)— 當通道失敗擋部署`,
      total: entries.length,
      passed: typeof res.passed === "number" ? res.passed : 0,
      failures: Array.isArray(res.failures) ? res.failures : [],
    });
  }
  err(`[sql-rehearsal] 完成:ok=${res.ok} passed=${res.passed}/${res.total} failures=${Array.isArray(res.failures) ? res.failures.length : "?"}`);
  emit(res);
}

main();
