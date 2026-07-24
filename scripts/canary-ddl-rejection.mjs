#!/usr/bin/env node
/**
 * canary-ddl-rejection.mjs — DB 硬化批第四件(9b):app_runtime 身分「不得跑 DDL」的實證測試。
 *
 * 這支跟 canary-runtime-probe.mjs(9a)是一對:
 *   9a 驗「該做到的事,真的做得到」(CRUD、資訊查詢、稽核鏈那三句指令)。
 *   9b(本檔)驗「不該做到的事,真的做不到」(四類 DDL 被權限層拒絕)。
 * 兩支的完整說明見 docs/infra/canary-verification.md。
 *
 * 安全鐵律(外部審查要求 — 讀懂再跑):
 *   1. 這支腳本【只准對隔離 canary schema】跑,那個 schema 完全無客戶/財務/商品資料。
 *      絕不對正式 test schema(prod 93 表)跑。靠 CANARY_APP_RUNTIME_DATABASE_URL 這個
 *      env 指向 canary,且連線身分必須是 app_runtime(CRUD 無 DDL)。
 *      schema 名必須【完全等於 canary】(比照 9a),近似名如 canary_backup 一律中止;
 *      正式 schema 名 test 另外硬擋。不符者【在連線之前】就中止,密碼不會送出去。
 *      這道連線前防呆是 preflight(),實作放在 9a、兩支共用同一份,不抄第二份。
 *   2. 任一 DDL 竟然【成功】= P0:立刻停測、印 P0 橫幅,不續試其餘 DDL
 *      (成功代表 app_runtime 還有 DDL 權限,權限隔離沒生效 — 這正是 2026-06-17 tours
 *      清空的結構成因)。停測之後只做一件事:把剛剛那個 DDL 造成的副作用收回來
 *      (見鐵律 5)。那不算「續試」,是還原自己弄髒的東西。
 *   3. 每個「被拒」證據都必須附【資料庫真實錯誤碼】(errno + sqlState),不接受腳本自報
 *      「預期被拒」。只有 privilege-denied 類錯誤碼(1142/1044/1045/1227)才算合格拒絕;
 *      其它錯(如 1146 表不存在)= 測試環境沒佈好,標 INCONCLUSIVE 要 Jeff 修 canary 佈置。
 *   4. 【零回吐】所有輸出一律不得把使用者貼進來的連線字串內插進去,一個片段都不行。
 *      拒絕與錯誤訊息只能是「固定字串 + 穩定代碼」;動態值只允許三種白名單化的來源
 *      (safeHost / safeIdent / safeNum),其餘一律固定字串。
 *      這條的由來是誠實的:2026-07-23 對抗審查【實測推翻】了舊版「連線字串與密碼
 *      絕不印出」的宣稱 —— 連線字串少一條斜線時(mysql:user:pw@host:4000/canary),
 *      整串憑證會掉進 URL 的 pathname,舊版 SCHEMA_MISMATCH 訊息把它原封印到 stderr,
 *      而且發生在連線之前。所以現在不再靠「印之前記得遮」,改成整類禁止內插。
 *      errSummary() 只取白名單欄位(絕不印原始 error 物件 —— Node 的 ERR_INVALID_URL
 *      會把完整連線字串掛在 `input` 這個 own enumerable 屬性上);redact() 是第二道網,
 *      不是主要防線。兩者實作與單測都在 9a,本檔直接 import,不另抄一份。
 *   5. 收尾一定要交代靶場狀態:本次有沒有建出/改動任何東西、清掉了沒有、還剩什麼、
 *      剩的要怎麼手動清。清理結果一律【回頭查 information_schema 複核】,不接受自報。
 *
 * 本批【不實跑】:prod 無 canary、app_runtime 角色尚未建立(見 docs/infra/db-role-hardening.md)。
 * 交付的是腳本 + 預期。Jeff 依 runbook 建好 canary schema 與 app_runtime 角色、佈好探測靶
 * 表 canary_probe_target 後,設 CANARY_APP_RUNTIME_DATABASE_URL 執行本腳本,四類 DDL 全被拒
 * (附 SQLSTATE)才算「權限隔離已驗」。
 *
 * 用法(Jeff,canary 佈置完成後):
 *   連線字串含密碼,【不要】直接打在指令列上(會被寫進 shell 歷史檔)。
 *   照 docs/infra/canary-verification.md「設環境變數」那一節的做法 A 或 B 設好
 *   CANARY_APP_RUNTIME_DATABASE_URL,然後:
 *     node scripts/canary-ddl-rejection.mjs
 *
 * 退出碼:0 = 四類 DDL 全被合格拒絕且靶場零殘留(通過);
 *          1 = 有 DDL 成功(P0)、有 INCONCLUSIVE、有殘留,或任何中止;
 *          2 = 未設 env(canary 尚未佈置,無害跳過)。
 */
import mysql from "mysql2/promise";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 日誌遮蔽(errSummary)與靶表名(TARGET)一律跟 9a 共用同一份實作,不另抄一份:
// 抄一份就會有一天只修到一邊。errSummary() 已有單測(canary-runtime-probe.test.mjs)。
// import 9a 不會讓它連線 —— 它只有被直接執行時才跑 main()。
import {
  errSummary,
  TARGET,
  SCHEMA,
  preflight,
  connOptionsFor,
  safeHost,
  safeIdent,
  safeNum,
  raceWithTimeout,
  installProcessGuards,
  attachConnErrorGuard,
  HANDSHAKE_TIMEOUT_MS,
} from "./canary-runtime-probe.mjs";

// privilege-denied 類錯誤碼(MySQL/TiDB):只有這些才算「因權限被拒」的合格拒絕。
//   1142 ER_TABLEACCESS_DENIED_ERROR   表層級命令權限不足(CREATE/ALTER/DROP/...)
//   1044 ER_DBACCESS_DENIED_ERROR      對該 database 無權
//   1045 ER_ACCESS_DENIED_ERROR        帳號/連線層權限
//   1227 ER_SPECIFIC_ACCESS_DENIED_ERROR 需要特定權限
const PRIVILEGE_DENIED_ERRNOS = new Set([1142, 1044, 1045, 1227]);

// 唯一允許的 schema 名(SCHEMA)從 9a import,兩支永遠是同一個常量。
// 探測靶:ALTER/TRUNCATE/DROP 需要一張已存在的 canary 表(由 migrator 角色在佈置時建)。
// 表名 TARGET 從 9a import,兩支永遠指同一張表。
// CREATE 探測用的新表名(若竟被建出 = P0;app_runtime 本就不該建得出來)。
export const CREATE_PROBE = "canary_ddl_probe_should_not_exist";
// ALTER 探測會加上去的欄名(若竟被加上 = P0)。
export const ADDED_COL = "canary_added_col";

/** 殘留物的手動清除指令(給 Jeff 貼進 TiDB SQL 編輯器,用 migrator 身分跑)。 */
export const MANUAL = {
  probeTable: "DROP TABLE IF EXISTS `canary`.`canary_ddl_probe_should_not_exist`;",
  addedCol: "ALTER TABLE `canary`.`canary_probe_target` DROP COLUMN `canary_added_col`;",
  target: "CREATE TABLE `canary`.`canary_probe_target` (id INT PRIMARY KEY);",
};

// 四類 DDL 探測。sql 一律字串常量,不插值任何外部輸入(地雷 #7 紀律)。
// undo = DDL 竟然成功時把副作用收回來的還原語句;null 代表還原不了,只能請 Jeff 重佈。
export const PROBES = [
  {
    kind: "CREATE",
    sql: "CREATE TABLE " + CREATE_PROBE + " (id INT PRIMARY KEY)",
    effect: "建出了測試表 " + CREATE_PROBE,
    undo: "DROP TABLE IF EXISTS " + CREATE_PROBE,
    undoDesc: "把被建出來的測試表刪掉",
    manual: MANUAL.probeTable,
  },
  {
    kind: "ALTER",
    sql: "ALTER TABLE " + TARGET + " ADD COLUMN " + ADDED_COL + " INT NULL",
    effect: "在靶表 " + TARGET + " 上加了欄位 " + ADDED_COL,
    undo: "ALTER TABLE " + TARGET + " DROP COLUMN " + ADDED_COL,
    undoDesc: "把被加上去的欄位移掉",
    manual: MANUAL.addedCol,
  },
  {
    kind: "TRUNCATE",
    sql: "TRUNCATE TABLE " + TARGET,
    effect: "清空了靶表 " + TARGET + " 的內容(靶表零客戶資料,清掉的只有探測列)",
    undo: null,
    undoDesc: "清空沒辦法自動還原",
    manual:
      "表結構還在、內容沒了。要補回探測列請依 docs/infra/db-role-hardening.md,用 migrator 身分重灌。",
  },
  {
    kind: "DROP",
    sql: "DROP TABLE " + TARGET,
    effect: "刪掉了靶表 " + TARGET,
    undo: null,
    undoDesc: "刪表沒辦法用 app_runtime 還原",
    manual: MANUAL.target,
  },
];

function banner(line) {
  const bar = "=".repeat(72);
  console.error(bar);
  console.error(line);
  console.error(bar);
}

/** conn 查詢的薄包裝,回傳 rows 陣列。 */
async function rows(conn, sql, params) {
  const [r] = params ? await conn.execute(sql, params) : await conn.query(sql);
  return Array.isArray(r) ? r : [];
}

/** 讀 COUNT(*) AS n 的第一列。 */
async function countOf(conn, sql, params) {
  const r = await rows(conn, sql, params);
  return Number(r[0] && r[0].n != null ? r[0].n : 0);
}

/**
 * 回頭查 information_schema,列出靶場現在還殘留什麼。
 * 這是「清理結果」的複核來源 —— 腳本不自報清乾淨,一律用查詢證明。
 */
export async function findLeftovers(conn) {
  const out = [];
  const probeTables = await countOf(
    conn,
    "SELECT COUNT(*) AS n FROM information_schema.tables " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [CREATE_PROBE],
  );
  if (probeTables > 0) {
    out.push({ what: "測試表 " + CREATE_PROBE + " 還在", manual: MANUAL.probeTable });
  }
  const targetTables = await countOf(
    conn,
    "SELECT COUNT(*) AS n FROM information_schema.tables " +
      "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [TARGET],
  );
  if (targetTables === 0) {
    out.push({ what: "靶表 " + TARGET + " 不見了", manual: MANUAL.target });
  } else {
    const addedCols = await countOf(
      conn,
      "SELECT COUNT(*) AS n FROM information_schema.columns " +
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [TARGET, ADDED_COL],
    );
    if (addedCols > 0) {
      out.push({ what: "靶表多出欄位 " + ADDED_COL, manual: MANUAL.addedCol });
    }
  }
  return out;
}

/**
 * 清理 + 交代結果(安全鐵律 5)。不管有沒有東西要清,這段一定會印。
 *
 * 「乾淨」的定義有兩個條件,缺一不可:
 *   1. 回頭查 information_schema 沒查到殘留(結構層面)。
 *   2. 本次所有副作用都是【還原得回來】的(undo 不是 null)。
 * 第 2 條是誠實化修正:TRUNCATE 成功時結構完好、information_schema 查起來很乾淨,
 * 但靶表內容已經被清空而且還原不了。舊版只看第 1 條,結果三行前才說「清空沒辦法
 * 自動還原」,結尾卻印「副作用已清乾淨」,自己打自己的臉。
 * 原則:腳本永遠不准自報清乾淨。
 *
 * @returns {Promise<boolean>} 靶場是否確認乾淨(複核通過【且】沒有還原不了的副作用)。
 */
export async function cleanupAndReport(conn, sideEffects) {
  console.log("");
  console.log("[canary-ddl] ---- 靶場清理 ----");

  if (sideEffects.length === 0) {
    console.log("[canary-ddl] 本次沒有任何 DDL 成功,腳本沒建出也沒改動任何東西,無需清理。");
  }
  for (const se of sideEffects) {
    console.log("[canary-ddl] 需要清理:" + se.effect);
    if (!se.undo) {
      console.log("[canary-ddl] 清理結果:❌ " + se.undoDesc + ",要手動處理:");
      console.log("            " + se.manual);
      continue;
    }
    try {
      await conn.query(se.undo);
      console.log("[canary-ddl] 清理結果:✅ 已" + se.undoDesc + "(下面再複核一次)");
    } catch (e) {
      console.log("[canary-ddl] 清理結果:❌ " + se.undoDesc + "失敗:" + errSummary(e));
      console.log("[canary-ddl] 請手動執行(TiDB SQL 編輯器,用 migrator 身分):");
      console.log("            " + se.manual);
    }
  }

  let leftovers;
  try {
    leftovers = await findLeftovers(conn);
  } catch (e) {
    console.log("[canary-ddl] 清理複核查不動:" + errSummary(e));
    console.log(
      "[canary-ddl] 請自行到 TiDB 確認 " + TARGET + " 與 " + CREATE_PROBE + " 的狀態。",
    );
    return false;
  }

  // 還原不了的副作用(undo === null)。結構查起來乾淨不代表資料還在。
  const irreversible = sideEffects.filter((se) => !se.undo);

  if (leftovers.length === 0 && irreversible.length === 0) {
    console.log(
      "[canary-ddl] 清理複核:靶場乾淨(沒有 " + CREATE_PROBE + "、靶表 " + TARGET +
        " 在、沒有多出 " + ADDED_COL + " 欄)。",
    );
    return true;
  }

  if (leftovers.length === 0) {
    console.log(
      "[canary-ddl] 清理複核:⚠️  結構查起來是完整的(表在、沒有多出欄位)," +
        "但本次有還原不了的副作用,不算清乾淨:",
    );
    for (const se of irreversible) {
      console.log("            - " + se.effect);
      console.log("              " + se.undoDesc + "。" + se.manual);
    }
    return false;
  }

  console.log("[canary-ddl] 清理複核:⚠️  還有殘留,請手動清:");
  for (const l of leftovers) {
    console.log("            - " + l.what);
    console.log("              " + l.manual);
  }
  // 已經被 information_schema 查出來的殘留不再重複列一次(例如 DROP:靶表不見了
  // 這件事上面那份清單已經講過)。只補列查不出來的,例如 TRUNCATE 清掉的內容。
  for (const se of irreversible) {
    if (leftovers.some((l) => l.manual === se.manual)) continue;
    console.log("            - 另外這一項還原不了:" + se.effect);
    console.log("              " + se.undoDesc + "。" + se.manual);
  }
  return false;
}

/**
 * 連上之後的主流程,回傳退出碼。
 * 這裡不呼叫 process.exit —— 一律 return,讓 main() 的 finally 保證連線關掉,
 * 也保證 P0 之後清理跑得到(舊版在 P0 直接 exit,建出來的測試表就留在靶場了)。
 */
export async function run(conn) {
  // 連線身分與所在 schema 自證(唯讀),留證。
  const who = await rows(conn, "SELECT CURRENT_USER() AS cu, DATABASE() AS db");
  const cu = String(who[0] && who[0].cu != null ? who[0].cu : "?");
  const dbName = String(who[0] && who[0].db != null ? who[0].db : "?");
  // 印出去的一律是白名單化過的版本(safeIdent 的字元集不含冒號與斜線,
  // 任何連線字串形狀都過不了)。這兩個值是【連上之後】伺服器自己回報的。
  const cuShown = safeIdent(cu);
  const dbShown = safeIdent(dbName);
  console.log("[canary-ddl] 連線身分 CURRENT_USER()=" + cuShown + "  schema=" + dbShown);

  // 硬防呆第二道:連上之後用伺服器回報的真實值再核一次(連線字串可能被重導)。
  // 走到這裡都還沒跑過任何 DDL,靶場零改動,所以直接中止、不需要清理。
  if (!/app_runtime/i.test(cu)) {
    banner(
      "[canary-ddl] 中止:連線身分不含 'app_runtime'(" + cuShown + ")。" +
        "只准用 app_runtime 對 canary 跑。代碼 ABORT_IDENTITY。",
    );
    return 1;
  }
  if (/^test$/i.test(dbName)) {
    banner(
      "[canary-ddl] 中止:你把正式 schema(test)貼進來了。絕不准對正式站跑。" +
        "代碼 ABORT_PROD_SCHEMA。",
    );
    return 1;
  }
  if (dbName !== SCHEMA) {
    banner(
      "[canary-ddl] 中止:schema 名必須剛好是 '" + SCHEMA + "'(目前是 " + dbShown + ")," +
        "不接受近似名(canary_backup 之類)。代碼 ABORT_SCHEMA_MISMATCH。",
    );
    return 1;
  }

  const results = [];
  const sideEffects = [];
  let p0 = null;

  for (const probe of PROBES) {
    let outcome;
    try {
      await conn.query(probe.sql);
      // 走到這裡 = DDL 沒被拒 = 成功。安全鐵律 2:立刻停,P0,不續試其餘 DDL。
      sideEffects.push(probe);
      p0 = probe;
      banner(
        "[canary-ddl] P0!! " + probe.kind + " 竟然成功(app_runtime 仍有 DDL 權限)。\n" +
          "  SQL: " + probe.sql + "\n" +
          "  副作用: " + probe.effect + "\n" +
          "  權限隔離未生效 —— 立即停測,不續試其餘 DDL。這是 2026-06-17 tours 清空的結構成因。\n" +
          "  處置:撤掉 app_runtime 的 DDL 權限(見 docs/infra/db-role-hardening.md),重跑本測。",
      );
      break;
    } catch (e) {
      const errno = e && typeof e.errno === "number" ? e.errno : null;
      const sqlState = e && e.sqlState ? e.sqlState : null;
      const code = e && e.code ? e.code : null;
      if (errno != null && PRIVILEGE_DENIED_ERRNOS.has(errno)) {
        outcome = { kind: probe.kind, status: "REJECTED_OK", errno, sqlState, code };
      } else {
        // 被拒但不是權限錯(多半是靶表沒佈好 1146,或 schema 佈置問題)= 不合格。
        outcome = {
          kind: probe.kind,
          status: "INCONCLUSIVE",
          errno,
          sqlState,
          code,
          hint:
            "非 privilege-denied 錯碼;檢查 " + TARGET + " 是否由 migrator 佈好、canary schema 是否正確。",
        };
      }
    }
    results.push(outcome);
    const tag = outcome.status === "REJECTED_OK" ? "✅ 合格拒絕" : "⚠️  不合格";
    // errno / sqlState / code 是資料庫回報的值,一樣走白名單才印(零回吐政策)。
    console.log(
      "[canary-ddl] " + probe.kind.padEnd(8) + tag +
        "  errno=" + safeNum(outcome.errno) +
        " sqlState=" + (outcome.sqlState == null ? "null" : safeIdent(String(outcome.sqlState))) +
        " code=" + (outcome.code == null ? "null" : safeIdent(String(outcome.code))),
    );
  }

  // 不管過沒過,一定交代靶場狀態(安全鐵律 5)。
  const clean = await cleanupAndReport(conn, sideEffects);

  console.log("");
  if (p0) {
    banner(
      "[canary-ddl] 未通過(P0):" + p0.kind + " 竟然成功,權限隔離沒生效。" +
        (clean ? "副作用已清乾淨。" : "副作用沒清乾淨,見上面的手動清除指令。"),
    );
    return 1;
  }
  const allRejected =
    results.length === PROBES.length && results.every((r) => r.status === "REJECTED_OK");
  if (allRejected && clean) {
    console.log(
      "[canary-ddl] 通過:四類 DDL 全被權限層拒絕(各附 SQLSTATE),靶場零殘留。權限隔離已驗。",
    );
    return 0;
  }
  if (allRejected && !clean) {
    banner("[canary-ddl] 未通過:四類 DDL 雖然全被拒,但靶場有殘留/複核不過。照上面的指令清完再跑一次。");
    return 1;
  }
  banner("[canary-ddl] 未通過:有 DDL 非因權限被拒(INCONCLUSIVE)。修好 canary 佈置後重跑。");
  return 1;
}

async function main() {
  const url = process.env.CANARY_APP_RUNTIME_DATABASE_URL;
  if (!url) {
    console.log(
      "[canary-ddl] SKIPPED:未設 CANARY_APP_RUNTIME_DATABASE_URL。\n" +
        "  本批不實跑(prod 無 canary、app_runtime 角色未建)。\n" +
        "  Jeff 依 docs/infra/db-role-hardening.md 建好 canary schema + app_runtime 角色\n" +
        "  + 佈好 " + TARGET + " 後,設此 env 再跑。",
    );
    process.exit(2);
  }

  // 硬防呆第一道:還沒連線就先擋(安全鐵律 1 的「不符一律中止且不連線」)。
  // 實作 preflight() 放在 9a,兩支共用同一份,不抄第二份。擋在這裡,密碼連送都不會
  // 送出去。preflight 內部的 new URL() catch【不接參數】:ERR_INVALID_URL 把完整
  // 連線字串(含密碼)掛在 error 的 `input` own enumerable 屬性上。
  const pre = preflight(url);
  if (!pre.ok) {
    // pre.reason 一定是 9a 那張 PREFLIGHT_REASON 固定字串表裡的句子,pre.code 是穩定
    // 代碼。這兩樣以外什麼都不印 —— 尤其不印「你貼的是什麼」(那正是 critical 的成因)。
    banner(
      "[canary-ddl] 中止(還沒連線,密碼沒有送出去):" + pre.reason + "\n" +
        "  代碼:" + pre.code,
    );
    process.exit(1);
  }

  console.log("[canary-ddl] 連線中:" + safeHost(pre.host));
  // createConnection 也必須自己包 try:放在 try 外面時,連線層錯誤會走未捕捉例外
  // 路徑,把整個 error 物件連同它掛著的連線資訊一起印出來。
  // 外面再包 raceWithTimeout:mysql2 的 connectTimeout 在 TCP 連上那刻就失效,
  // 對方接了 TCP 卻不回合法 handshake(port 打成 443)會無限卡死。
  let conn;
  try {
    conn = await raceWithTimeout(
      () => mysql.createConnection(connOptionsFor(pre)),
      HANDSHAKE_TIMEOUT_MS,
      "連了 " + HANDSHAKE_TIMEOUT_MS / 1000 +
        " 秒還沒完成 MySQL 交握(對方接了 TCP 卻不講 MySQL,多半是 port 打錯)",
    );
  } catch (e) {
    banner("[canary-ddl] 中止:連不上或憑證驗不過。" + errSummary(e));
    process.exit(1);
  }
  // 第三條繞過通道:連線物件自己的 error 事件。這支不切自己的連線,一律當錯誤。
  attachConnErrorGuard(conn, "[canary-ddl]");

  let exitCode = 1;
  try {
    exitCode = await run(conn);
  } catch (e) {
    banner("[canary-ddl] 執行錯誤(非 DDL 探測結果):" + errSummary(e));
    exitCode = 1;
  } finally {
    try {
      await conn.end();
    } catch {
      /* noop */
    }
  }
  process.exit(exitCode);
}

// 只有被直接執行時才連線;被 import(測試)時只提供上面那些可注入的函式。
// 用 resolve + fileURLToPath 比對(同 9a、同 safe-deploy.mjs 的寫法):repo 路徑含中文,
// 手工拼 file:// URL 會因為百分號編碼差異比對不到。
const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  // 三條會繞過 main().catch() 的通道:uncaughtException、unhandledRejection、
  // 連線物件的 error 事件。前兩條在這裡接住,第三條在 main() 裡對連線掛監聽。
  // 任何一條漏掉,Node 預設處理器就會 util.inspect 整個 error 物件,
  // 把掛在它 own enumerable 屬性上的連線字串(含密碼)整串印出來。
  installProcessGuards("[canary-ddl]");
  // 最後一道網:main() 裡任何漏網的 throw 都只印遮蔽後的單行摘要,
  // 絕不讓 Node 的未捕捉例外處理器把原始 error 物件(可能含連線字串)印出來。
  main().catch((e) => {
    banner("[canary-ddl] 未預期錯誤:" + errSummary(e));
    process.exit(1);
  });
}
