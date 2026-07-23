/**
 * Tests for the canary DDL-rejection probe (9b). Uses Node's built-in test
 * runner, same as the 9a test:
 *
 *   node --test scripts/canary-ddl-rejection.test.mjs
 *
 * NOTHING here touches a real database. Every statement goes through an
 * injected fake connection that pattern-matches the exact SQL constants the
 * script sends, per CLAUDE.md's rule that tests must never touch a real DB.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  run,
  cleanupAndReport,
  findLeftovers,
  PROBES,
  CREATE_PROBE,
  ADDED_COL,
  MANUAL,
} from "./canary-ddl-rejection.mjs";
import { TARGET } from "./canary-runtime-probe.mjs";

const probeOf = (kind) => PROBES.find((p) => p.kind === kind);

/** MySQL/TiDB 風格的權限錯誤。 */
function denied(errno = 1142) {
  const e = new Error("command denied to user");
  e.errno = errno;
  e.sqlState = "42000";
  e.code = "ER_TABLEACCESS_DENIED_ERROR";
  return e;
}

/** 靶表不存在(佈置沒做好),應該被判 INCONCLUSIVE。 */
function noSuchTable() {
  const e = new Error("Table 'canary.canary_probe_target' doesn't exist");
  e.errno = 1146;
  e.sqlState = "42S02";
  e.code = "ER_NO_SUCH_TABLE";
  return e;
}

/**
 * 有狀態的假連線。DDL「成功」時真的會改動 state,所以之後的
 * information_schema 複核查到的是真的結果,不是寫死的答案。
 */
function makeConn({
  cu = "JgQYPzTFfGurZh9.app_runtime@%",
  db = "canary",
  allow = [],            // 哪幾類 DDL「竟然成功」
  undoFails = [],        // 哪幾類的還原語句會失敗
  probeError = denied(), // 被拒時丟什麼錯
  leftoverProbeTable = false, // 開跑前就殘留的測試表(前一次跑到一半)
} = {}) {
  const state = { probeTable: leftoverProbeTable, target: true, addedCol: false };
  const sent = [];
  const conn = {
    state,
    sent,
    async query(sql) {
      sent.push(sql);
      if (/CURRENT_USER/.test(sql)) return [[{ cu, db }]];

      for (const p of PROBES) {
        if (sql === p.sql) {
          if (!allow.includes(p.kind)) throw probeError;
          if (p.kind === "CREATE") state.probeTable = true;
          if (p.kind === "ALTER") state.addedCol = true;
          if (p.kind === "DROP") state.target = false;
          return [{ affectedRows: 0 }];
        }
        if (p.undo && sql === p.undo) {
          if (undoFails.includes(p.kind)) throw denied(1142);
          if (p.kind === "CREATE") state.probeTable = false;
          if (p.kind === "ALTER") state.addedCol = false;
          return [{ affectedRows: 0 }];
        }
      }
      throw new Error("unexpected query: " + sql);
    },
    async execute(sql, params) {
      sent.push(sql);
      if (/information_schema\.tables/.test(sql)) {
        const name = params[0];
        if (name === CREATE_PROBE) return [[{ n: state.probeTable ? 1 : 0 }]];
        if (name === TARGET) return [[{ n: state.target ? 1 : 0 }]];
        return [[{ n: 0 }]];
      }
      if (/information_schema\.columns/.test(sql)) {
        return [[{ n: state.addedCol ? 1 : 0 }]];
      }
      throw new Error("unexpected execute: " + sql);
    },
  };
  return conn;
}

/** 攔下 console.log / console.error,回傳 [exitCode, 整段輸出]。 */
async function capture(fn) {
  const lines = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => lines.push(a.join(" "));
  console.error = (...a) => lines.push(a.join(" "));
  try {
    const value = await fn();
    return { value, out: lines.join("\n") };
  } finally {
    console.log = log;
    console.error = err;
  }
}

/**
 * 這條斷言在每個測項都跑:輸出永遠不得出現未遮蔽的憑證。
 * 遮蔽後的 `mysql://***:***@host` 是可接受的(主機名本來就會印)。
 */
function assertNoCredentials(out) {
  assert.ok(
    !/([a-z][a-z0-9+.-]*:\/\/)(?!\*\*\*:\*\*\*@)[^\s/@]*:[^\s/@]*@/i.test(out),
    "輸出出現了未遮蔽的連線字串",
  );
  assert.ok(!/S3cretPw/.test(out), "輸出出現了密碼");
}

// ---------------------------------------------------------------------------
// 正常路徑:四類全被拒
// ---------------------------------------------------------------------------

test("四類 DDL 全被權限層拒絕 → exit 0,且明確報告無需清理", async () => {
  const conn = makeConn();
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 0);
  assertNoCredentials(out);
  for (const kind of ["CREATE", "ALTER", "TRUNCATE", "DROP"]) {
    assert.match(out, new RegExp(kind + "\\s*✅ 合格拒絕"));
  }
  assert.match(out, /errno=1142 sqlState=42000/);
  assert.match(out, /本次沒有任何 DDL 成功/);
  assert.match(out, /清理複核:靶場乾淨/);
  assert.match(out, /通過:四類 DDL 全被權限層拒絕/);
});

test("非權限錯碼(1146 靶表不存在)→ INCONCLUSIVE,exit 1", async () => {
  const conn = makeConn({ probeError: noSuchTable() });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /errno=1146/);
  assert.match(out, /不合格/);
  assert.match(out, /有 DDL 非因權限被拒/);
});

// ---------------------------------------------------------------------------
// P0 路徑:DDL 竟然成功
// ---------------------------------------------------------------------------

test("CREATE 竟然成功 → 停測不續試,自動清掉建出來的表,exit 1", async () => {
  const conn = makeConn({ allow: ["CREATE"] });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /P0!! CREATE 竟然成功/);
  // 鐵律 2:不續試其餘 DDL。
  assert.ok(!conn.sent.includes(probeOf("ALTER").sql), "P0 之後還去試了 ALTER");
  assert.ok(!conn.sent.includes(probeOf("TRUNCATE").sql), "P0 之後還去試了 TRUNCATE");
  assert.ok(!conn.sent.includes(probeOf("DROP").sql), "P0 之後還去試了 DROP");
  // 鐵律 5:自己弄髒的要收回來,而且是真的收掉(狀態複核)。
  assert.ok(conn.sent.includes(probeOf("CREATE").undo), "沒有送出還原語句");
  assert.equal(conn.state.probeTable, false);
  assert.match(out, /清理結果:✅ 已把被建出來的測試表刪掉/);
  assert.match(out, /清理複核:靶場乾淨/);
  assert.match(out, /未通過\(P0\):CREATE 竟然成功/);
  assert.match(out, /副作用已清乾淨/);
});

test("CREATE 成功但清理也失敗 → 明講殘留什麼、附手動清除語句", async () => {
  const conn = makeConn({ allow: ["CREATE"], undoFails: ["CREATE"] });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.equal(conn.state.probeTable, true, "表應該還留著");
  assert.match(out, /清理結果:❌ 把被建出來的測試表刪掉失敗/);
  assert.match(out, /code=ER_TABLEACCESS_DENIED_ERROR/);
  assert.match(out, /清理複核:⚠️ {2}還有殘留/);
  assert.ok(out.includes(MANUAL.probeTable), "沒有印出手動 DROP 語句");
  assert.match(out, /副作用沒清乾淨/);
});

test("ALTER 竟然成功 → 把加上去的欄位移掉", async () => {
  const conn = makeConn({ allow: ["ALTER"] });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /P0!! ALTER 竟然成功/);
  assert.equal(conn.state.addedCol, false);
  assert.ok(out.includes(ADDED_COL));
  assert.match(out, /清理複核:靶場乾淨/);
});

test("DROP 竟然成功 → 還原不了,老實說靶表不見了並附重建語句", async () => {
  const conn = makeConn({ allow: ["DROP"] });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /P0!! DROP 竟然成功/);
  assert.equal(conn.state.target, false);
  assert.match(out, /清理結果:❌ 刪表沒辦法用 app_runtime 還原/);
  assert.ok(out.includes("靶表 " + TARGET + " 不見了"));
  assert.ok(out.includes(MANUAL.target), "沒有印出重建靶表的語句");
  assert.match(out, /副作用沒清乾淨/);
});

test("TRUNCATE 竟然成功 → 表還在但內容沒了,照實報告", async () => {
  const conn = makeConn({ allow: ["TRUNCATE"] });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /P0!! TRUNCATE 竟然成功/);
  assert.match(out, /清理結果:❌ 清空沒辦法自動還原/);
  // 結構沒被破壞,所以複核仍是乾淨的;但整體判定仍為 P0 未通過。
  assert.match(out, /清理複核:靶場乾淨/);
  assert.match(out, /未通過\(P0\):TRUNCATE 竟然成功/);
});

// ---------------------------------------------------------------------------
// 防呆(連上之後的第二道)
// ---------------------------------------------------------------------------

test("身分不含 app_runtime → 中止,一個 DDL 都不送", async () => {
  const conn = makeConn({ cu: "root@%" });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /中止:連線身分不含 'app_runtime'/);
  for (const p of PROBES) {
    assert.ok(!conn.sent.includes(p.sql), "中止後仍送出了 " + p.kind);
  }
});

test("schema 名只是「含有」canary(canary_backup)→ 中止,不再放行", async () => {
  const conn = makeConn({ db: "canary_backup" });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /schema 名必須剛好是 'canary'/);
  for (const p of PROBES) {
    assert.ok(!conn.sent.includes(p.sql), "中止後仍送出了 " + p.kind);
  }
});

test("schema 名是正式站的 test → 中止", async () => {
  for (const db of ["test", "TEST", "Test"]) {
    const conn = makeConn({ db });
    const { value, out } = await capture(() => run(conn));
    assert.equal(value, 1);
    assertNoCredentials(out);
    assert.match(out, /正式 schema\(test\)/);
    for (const p of PROBES) {
      assert.ok(!conn.sent.includes(p.sql), "中止後仍送出了 " + p.kind);
    }
  }
});

test("schema 名剛好等於 canary 才放行", async () => {
  const conn = makeConn({ db: "canary" });
  const { value } = await capture(() => run(conn));
  assert.equal(value, 0);
  assert.ok(conn.sent.includes(probeOf("CREATE").sql));
});

// ---------------------------------------------------------------------------
// 清理與殘留複核
// ---------------------------------------------------------------------------

test("開跑前就有前一次的殘留 → 四類全被拒也不算通過", async () => {
  const conn = makeConn({ leftoverProbeTable: true });
  const { value, out } = await capture(() => run(conn));
  assert.equal(value, 1);
  assertNoCredentials(out);
  assert.match(out, /四類 DDL 雖然全被拒,但靶場有殘留/);
  assert.ok(out.includes(MANUAL.probeTable));
});

test("findLeftovers 如實回報三種殘留", async () => {
  const clean = makeConn();
  assert.deepEqual(await findLeftovers(clean), []);

  const dirty = makeConn();
  dirty.state.probeTable = true;
  dirty.state.addedCol = true;
  const found = (await findLeftovers(dirty)).map((l) => l.what);
  assert.equal(found.length, 2);
  assert.ok(found.some((w) => w.includes(CREATE_PROBE)));
  assert.ok(found.some((w) => w.includes(ADDED_COL)));

  const gone = makeConn();
  gone.state.target = false;
  const missing = await findLeftovers(gone);
  assert.equal(missing.length, 1);
  assert.ok(missing[0].what.includes("不見了"));
  assert.equal(missing[0].manual, MANUAL.target);
});

test("複核本身查不動時,回報 false 並只印遮蔽摘要", async () => {
  const conn = makeConn();
  conn.execute = async () => {
    const e = new Error("connect ECONNREFUSED mysql://u:S3cretPw!@h:1/canary");
    e.code = "ECONNREFUSED";
    return Promise.reject(e);
  };
  const { value, out } = await capture(() => cleanupAndReport(conn, []));
  assert.equal(value, false);
  assert.match(out, /清理複核查不動/);
  assert.match(out, /code=ECONNREFUSED/);
  // errSummary 會把訊息裡的連線字串遮掉。
  assertNoCredentials(out);
  assert.match(out, /\*\*\*:\*\*\*@/);
});
