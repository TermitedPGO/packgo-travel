#!/usr/bin/env node
/**
 * canary-ddl-rejection.mjs — DB 硬化批第四件:app_runtime 身分「不得跑 DDL」的實證測試。
 *
 * 安全鐵律(外部審查要求 — 讀懂再跑):
 *   1. 這支腳本【只准對隔離 canary schema】跑,那個 schema 完全無客戶/財務/商品資料。
 *      絕不對正式 test schema(prod 93 表)跑。靠 CANARY_APP_RUNTIME_DATABASE_URL 這個
 *      env 指向 canary,且連線身分必須是 app_runtime(CRUD 無 DDL)。
 *   2. 任一 DDL 竟然【成功】= P0:立刻停測、印 P0 橫幅、exit 1,不續試其餘 DDL
 *      (成功代表 app_runtime 還有 DDL 權限,權限隔離沒生效 — 這正是 2026-06-17 tours
 *      清空的結構成因)。
 *   3. 每個「被拒」證據都必須附【資料庫真實錯誤碼】(errno + sqlState),不接受腳本自報
 *      「預期被拒」。只有 privilege-denied 類錯誤碼(1142/1044/1045/1227)才算合格拒絕;
 *      其它錯(如 1146 表不存在)= 測試環境沒佈好,標 INCONCLUSIVE 要 Jeff 修 canary 佈置。
 *
 * 本批【不實跑】:prod 無 canary、app_runtime 角色尚未建立(見 docs/infra/db-role-hardening.md)。
 * 交付的是腳本 + 預期。Jeff 依 runbook 建好 canary schema 與 app_runtime 角色、佈好探測靶
 * 表 canary_probe_target 後,設 CANARY_APP_RUNTIME_DATABASE_URL 執行本腳本,四類 DDL 全被拒
 * (附 SQLSTATE)才算「權限隔離已驗」。
 *
 * 用法(Jeff,canary 佈置完成後):
 *   CANARY_APP_RUNTIME_DATABASE_URL='mysql://<prefix>.app_runtime:<pw>@<canary-host>:4000/canary' \
 *     node scripts/canary-ddl-rejection.mjs
 *
 * 退出碼:0 = 四類 DDL 全被合格拒絕(通過);1 = 有 DDL 成功(P0)或有 INCONCLUSIVE;
 *          2 = 未設 env(canary 尚未佈置,無害跳過)。
 */
import mysql from "mysql2/promise";

// privilege-denied 類錯誤碼(MySQL/TiDB):只有這些才算「因權限被拒」的合格拒絕。
//   1142 ER_TABLEACCESS_DENIED_ERROR   表層級命令權限不足(CREATE/ALTER/DROP/...)
//   1044 ER_DBACCESS_DENIED_ERROR      對該 database 無權
//   1045 ER_ACCESS_DENIED_ERROR        帳號/連線層權限
//   1227 ER_SPECIFIC_ACCESS_DENIED_ERROR 需要特定權限
const PRIVILEGE_DENIED_ERRNOS = new Set([1142, 1044, 1045, 1227]);

// 探測靶:ALTER/TRUNCATE/DROP 需要一張已存在的 canary 表(由 migrator 角色在佈置時建)。
const TARGET = "canary_probe_target";
// CREATE 探測用的新表名(若竟被建出 = P0;app_runtime 本就不該建得出來)。
const CREATE_PROBE = "canary_ddl_probe_should_not_exist";

// 四類 DDL 探測。sql 一律單引號字串常量,不插值(地雷 #7 紀律)。
const PROBES = [
  { kind: "CREATE", sql: "CREATE TABLE " + CREATE_PROBE + " (id INT PRIMARY KEY)" },
  { kind: "ALTER", sql: "ALTER TABLE " + TARGET + " ADD COLUMN canary_added_col INT NULL" },
  { kind: "TRUNCATE", sql: "TRUNCATE TABLE " + TARGET },
  { kind: "DROP", sql: "DROP TABLE " + TARGET },
];

function banner(line) {
  const bar = "=".repeat(72);
  console.error(bar);
  console.error(line);
  console.error(bar);
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

  // 連 canary,身分應為 app_runtime。先自證身分與所在 schema(唯讀),留證。
  const u = new URL(url);
  const conn = await mysql.createConnection({
    host: u.hostname,
    port: u.port ? Number(u.port) : 4000,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
    multipleStatements: false,
  });

  try {
    const [who] = await conn.query("SELECT CURRENT_USER() AS cu, DATABASE() AS db");
    const cu = who && who[0] ? who[0].cu : "?";
    const dbName = who && who[0] ? who[0].db : "?";
    console.log("[canary-ddl] 連線身分 CURRENT_USER()=" + cu + "  schema=" + dbName);
    // 硬防呆:身分名裡若不含 app_runtime,或 schema 名裡不含 canary,直接拒跑
    // (避免有人誤把正式連線字串塞進來 — 安全鐵律 1)。
    if (!/app_runtime/i.test(String(cu))) {
      banner("[canary-ddl] 中止:連線身分不含 'app_runtime'(" + cu + ")。只准用 app_runtime 對 canary 跑。");
      process.exit(1);
    }
    if (!/canary/i.test(String(dbName))) {
      banner("[canary-ddl] 中止:schema 名不含 'canary'(" + dbName + ")。只准對隔離 canary schema 跑。");
      process.exit(1);
    }

    const results = [];
    for (const probe of PROBES) {
      let outcome;
      try {
        await conn.query(probe.sql);
        // 走到這裡 = DDL 沒被拒 = 成功。安全鐵律 2:立刻停,P0,不續試。
        banner(
          "[canary-ddl] P0!! " + probe.kind + " 竟然成功(app_runtime 仍有 DDL 權限)。\n" +
            "  SQL: " + probe.sql + "\n" +
            "  權限隔離未生效 —— 立即停測,不續試其餘 DDL。這是 2026-06-17 tours 清空的結構成因。\n" +
            "  處置:撤掉 app_runtime 的 DDL 權限(見 docs/infra/db-role-hardening.md),重跑本測。",
        );
        await conn.end();
        process.exit(1);
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
            hint: "非 privilege-denied 錯碼;檢查 " + TARGET + " 是否由 migrator 佈好、canary schema 是否正確。",
          };
        }
      }
      results.push(outcome);
      const tag = outcome.status === "REJECTED_OK" ? "✅ 合格拒絕" : "⚠️  不合格";
      console.log(
        "[canary-ddl] " + probe.kind.padEnd(8) + tag +
          "  errno=" + outcome.errno + " sqlState=" + outcome.sqlState + " code=" + outcome.code,
      );
    }

    await conn.end();

    const allRejected = results.every((r) => r.status === "REJECTED_OK");
    if (allRejected) {
      console.log("\n[canary-ddl] 通過:四類 DDL 全被權限層拒絕(各附 SQLSTATE)。權限隔離已驗。");
      process.exit(0);
    }
    banner("[canary-ddl] 未通過:有 DDL 非因權限被拒(INCONCLUSIVE)。修好 canary 佈置後重跑。");
    process.exit(1);
  } catch (e) {
    try { await conn.end(); } catch { /* noop */ }
    banner("[canary-ddl] 執行錯誤(非 DDL 探測結果):" + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }
}

main();
