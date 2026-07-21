/**
 * grant-admin 鏈式稽核寫入承重測試(audit-chain-repair R5-3)。
 *
 *   node --test scripts/grant-admin.test.mjs
 *
 * 假 conn 只實作 execute(),對 in-memory 列存真 SQL 語意的關鍵子集:
 * tip SELECT 必須帶 "rowHash IS NOT NULL"(字面比對——刪掉過濾即紅)、
 * INSERT 記 payload、UPDATE 依 fail 次數注入失敗。與 server 端
 * canonicalAuditRow/computeRowHash 的口徑一致性由「欄位序快照」測試釘住。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalAuditRowMjs,
  computeRowHashMjs,
  writeChainedAuditRow,
  buildConnConfig,
} from "./grant-admin.mjs";

function makeConn({
  tipRows = [{ rowHash: "GOODHASH" }],
  insertId = 77,
  updateFailTimes = 0,
  lockAvailable = true,
  forkCount = 0,
  priorRowsSeq = null, // R7-2:收斂迴圈的 prior 查詢逐次回值(array of arrays)
  onFirstUpdate = null, // R7-2:第一次 UPDATE 後觸發(模擬 app 併發補 hash)
} = {}) {
  const executed = [];
  let updateFails = updateFailTimes;
  let updates = 0;
  let priorCalls = 0;
  const conn = {
    execute: async (sql, params = []) => {
      executed.push({ sql, params });
      // R6-3:DB advisory lock(排除其他腳本執行個體;拿不到不進 critical section)
      if (/GET_LOCK/i.test(sql)) return [[{ l: lockAvailable ? 1 : 0 }]];
      if (/RELEASE_LOCK/i.test(sql)) return [[{ r: 1 }]];
      if (/^SELECT COUNT\(\*\) AS n FROM adminAuditLog WHERE previousHash/i.test(sql)) {
        return [[{ n: forkCount }]];
      }
      if (/^SELECT rowHash FROM adminAuditLog WHERE id </i.test(sql)) {
        // R7-2 收斂迴圈的 prior 查詢
        const seq = priorRowsSeq ?? [tipRows];
        const out = seq[Math.min(priorCalls, seq.length - 1)] ?? [];
        priorCalls++;
        return [out];
      }
      if (/^SELECT rowHash FROM adminAuditLog/i.test(sql)) {
        // R5-3 契約:tip 查詢必須帶孤列過濾;沒帶 = production 掉了 isNotNull → 紅
        assert.match(sql, /rowHash IS NOT NULL/i, "tip query must filter out orphan (null-hash) rows");
        return [tipRows];
      }
      if (/^INSERT INTO adminAuditLog/i.test(sql)) return [{ insertId }];
      if (/^UPDATE adminAuditLog SET previousHash/i.test(sql)) {
        if (updateFails > 0) {
          updateFails--;
          throw new Error("update blew up");
        }
        updates++;
        if (updates === 1 && onFirstUpdate) onFirstUpdate();
        return [{}];
      }
      throw new Error(`unexpected sql: ${sql}`);
    },
    _executed: executed,
  };
  return conn;
}

const FIELDS = {
  userId: 5,
  userEmail: "support@packgoplay.com",
  userRole: "admin",
  action: "manual_role_grant",
  targetType: "user",
  targetId: "5",
  changes: '{"after":{"role":"admin"}}',
  reason: "test",
  ipAddress: "127.0.0.1",
  userAgent: "scripts/grant-admin.mjs",
  success: 1,
};

test("canonical 欄位序快照:逐字對齊 server canonicalAuditRow(重排即紅)", () => {
  const c = canonicalAuditRowMjs({
    id: 1, userId: 2, userEmail: "e", userRole: "r", action: "a",
    targetType: null, targetId: null, changes: null, reason: null,
    ipAddress: null, userAgent: null, success: 1, errorMessage: null,
    createdAt: new Date("2026-07-19T00:00:00.500Z"),
  });
  assert.equal(
    c,
    '{"id":1,"userId":2,"userEmail":"e","userRole":"r","action":"a","targetType":null,"targetId":null,"changes":null,"reason":null,"ipAddress":null,"userAgent":null,"success":1,"errorMessage":null,"createdAt":"2026-07-19T00:00:00.000Z"}',
  );
});

test("createdAt 截秒:INSERT 帶進 DB 的 Date 毫秒為 0(hash 與存值同源)", async () => {
  const conn = makeConn();
  await writeChainedAuditRow(conn, FIELDS);
  const ins = conn._executed.find((e) => /^INSERT/i.test(e.sql));
  const createdAt = ins.params[12];
  assert.ok(createdAt instanceof Date);
  assert.equal(createdAt.getMilliseconds(), 0);
});

test("tip 過濾 + 鏈接:previousHash 用最後一個非 null hash;hash = sha256(prev|canonical)", async () => {
  const conn = makeConn({ tipRows: [{ rowHash: "GOODHASH" }], insertId: 77 });
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.hashed, true);
  const upd = conn._executed.find((e) => /^UPDATE/i.test(e.sql));
  assert.equal(upd.params[0], "GOODHASH"); // previousHash
  // rowHash 可重算(用 INSERT 實際 payload 還原 canonical)
  const ins = conn._executed.find((e) => /^INSERT/i.test(e.sql));
  const canonical = canonicalAuditRowMjs({
    id: 77,
    userId: ins.params[0], userEmail: ins.params[1], userRole: ins.params[2],
    action: ins.params[3], targetType: ins.params[4], targetId: ins.params[5],
    changes: ins.params[6], reason: ins.params[7], ipAddress: ins.params[8],
    userAgent: ins.params[9], success: ins.params[10], errorMessage: ins.params[11],
    createdAt: ins.params[12],
  });
  assert.equal(upd.params[1], computeRowHashMjs("GOODHASH", canonical));
});

test("tip 全空(過濾後無列)→ previousHash=GENESIS", async () => {
  const conn = makeConn({ tipRows: [] });
  await writeChainedAuditRow(conn, FIELDS);
  const upd = conn._executed.find((e) => /^UPDATE/i.test(e.sql));
  assert.equal(upd.params[0], "GENESIS");
});

test("hash UPDATE 失敗重試一次成功 → hashed:true,UPDATE 跑兩次同 payload", async () => {
  const conn = makeConn({ updateFailTimes: 1 });
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.hashed, true);
  const upds = conn._executed.filter((e) => /^UPDATE/i.test(e.sql));
  assert.equal(upds.length, 2);
  assert.deepEqual(upds[0].params, upds[1].params); // 同 payload 冪等重試
});

test("hash UPDATE 連兩敗 → hashed:false(孤列留下,不 throw,fail-visible)", async () => {
  const conn = makeConn({ updateFailTimes: 2 });
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.hashed, false);
  assert.equal(r.insertId, 77);
});

// ---- R6-3 新增契約 ----

test("R6-3 P1-4:連線設定固定 UTC timezone(timezone:'Z')", () => {
  const cfg = buildConnConfig("mysql://user:pass@example.tidbcloud.com:4000/packgo");
  assert.equal(cfg.timezone, "Z");
  assert.equal(cfg.port, 4000);
});

test("R6-3 P1-4:PDT→DB→UTC round-trip —— timezone Z 下存儲字串與 canonical 同一瞬間", () => {
  // mysql2 在 timezone:'Z' 下把 Date 以 UTC 牆鐘序列化("YYYY-MM-DD HH:MM:SS");
  // verifier 經 drizzle 讀回時以 UTC 解析。模擬這條路:UTC 序列化 → +Z 解析 →
  // canonical 必須與原 Date 的 canonical 相等(任何本機時區下都成立)。
  const d = new Date("2026-07-19T19:34:56.000Z");
  const storedUtc = d.toISOString().replace("T", " ").slice(0, 19); // mysql2 tz=Z 序列化
  const readBack = new Date(storedUtc.replace(" ", "T") + "Z");     // drizzle UTC 解析
  const base = { id: 9, userId: 1, userEmail: "e", userRole: "r", action: "a",
    targetType: null, targetId: null, changes: null, reason: null,
    ipAddress: null, userAgent: null, success: 1, errorMessage: null };
  assert.equal(
    canonicalAuditRowMjs({ ...base, createdAt: readBack }),
    canonicalAuditRowMjs({ ...base, createdAt: d }),
  );
  // 反向對照:若用「本機時區牆鐘」序列化(mysql2 預設、無 timezone:'Z'),
  // 只要本機非 UTC,讀回瞬間就會偏移、canonical 不同(hash 必炸)。
  const offsetMin = new Date().getTimezoneOffset();
  if (offsetMin !== 0) {
    const localWall = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    const wrongReadBack = new Date(localWall.replace(" ", "T") + "Z");
    assert.notEqual(
      canonicalAuditRowMjs({ ...base, createdAt: wrongReadBack }),
      canonicalAuditRowMjs({ ...base, createdAt: d }),
    );
  }
});

test("R6-3 P1-5:advisory lock 拿不到 → throw,不進 read-tip+insert", async () => {
  const conn = makeConn({ lockAvailable: false });
  await assert.rejects(() => writeChainedAuditRow(conn, FIELDS), /advisory lock unavailable/);
  assert.ok(!conn._executed.some((e) => /^SELECT rowHash/i.test(e.sql)), "must not read tip");
  assert.ok(!conn._executed.some((e) => /^INSERT/i.test(e.sql)), "must not insert");
});

test("R6-3 P1-5:Y 叉機械偵測 —— 同 previousHash 另有他列 → forked:true", async () => {
  const conn = makeConn({ forkCount: 1 });
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.forked, true);
  assert.equal(r.hashed, true);
});

test("R6-3:無併發 → forked:false,且 RELEASE_LOCK 一定執行", async () => {
  const conn = makeConn();
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.forked, false);
  assert.ok(conn._executed.some((e) => /RELEASE_LOCK/i.test(e.sql)));
});

// ---- R7-2:收斂迴圈真併發 regression ----

test("R7-2 Codex 交錯:app 先插孤列、grant 鏈舊 tip、app 再補 hash → grant 收斂重鏈自己的列,無 Y 叉", async () => {
  // 時序:tip 讀到 GOODHASH(app 孤列 id 76 尚無 hash)→ grant insert id 77、
  // 第一次 UPDATE(prev=GOODHASH)後 app 把 id 76 補成 H_APP → 收斂迴圈 prior
  // 查詢第一次回 H_APP(≠GOODHASH)→ 重算重寫 → 第二次 prior 仍 H_APP → 穩定。
  let appFilled = false;
  const conn = makeConn({
    onFirstUpdate: () => { appFilled = true; },
    priorRowsSeq: null, // 動態:見下 override
  });
  // 動態 prior:app 補 hash 前回 GOODHASH,補後回 H_APP
  const origExecute = conn.execute;
  conn.execute = async (sql, params) => {
    if (/^SELECT rowHash FROM adminAuditLog WHERE id </i.test(sql)) {
      conn._executed.push({ sql, params });
      return [[{ rowHash: appFilled ? "H_APP" : "GOODHASH" }]];
    }
    return origExecute(sql, params);
  };
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.hashed, true);
  assert.equal(r.forked, false);
  // 最終 UPDATE 的 previousHash 必須是 app 補上的 H_APP(重鏈完成)
  const upds = conn._executed.filter((e) => /^UPDATE/i.test(e.sql));
  assert.ok(upds.length >= 2, "must re-chain at least once");
  assert.equal(upds[upds.length - 1].params[0], "H_APP");
  // 重算的 rowHash 與 H_APP 前驅一致(可重算驗證)
  const ins = conn._executed.find((e) => /^INSERT/i.test(e.sql));
  const canonical = canonicalAuditRowMjs({
    id: 77,
    userId: ins.params[0], userEmail: ins.params[1], userRole: ins.params[2],
    action: ins.params[3], targetType: ins.params[4], targetId: ins.params[5],
    changes: ins.params[6], reason: ins.params[7], ipAddress: ins.params[8],
    userAgent: ins.params[9], success: ins.params[10], errorMessage: ins.params[11],
    createdAt: ins.params[12],
  });
  assert.equal(upds[upds.length - 1].params[1], computeRowHashMjs("H_APP", canonical));
});

test("R7-2 鏡像交錯:別列在 grant 之後仍鏈同一前驅(grant 無權改別人的列)→ forked:true fail-closed", async () => {
  const conn = makeConn({ forkCount: 1 });
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.forked, true, "mirror-race fork must be detected, not silently ignored");
});

test("R7-2 穩定情況:前驅未變 → 不重鏈(單次 UPDATE),forked:false", async () => {
  const conn = makeConn(); // prior 查詢回 tipRows=GOODHASH,與初始 prev 相同
  const r = await writeChainedAuditRow(conn, FIELDS);
  assert.equal(r.forked, false);
  const upds = conn._executed.filter((e) => /^UPDATE/i.test(e.sql));
  assert.equal(upds.length, 1);
});

// ---- R8-2:真共鎖 deferred/latch regression ----
// 共享鎖域(同名 'audit:tip:lock')的假 conn:GET_LOCK 被持有時「等待」直到
// RELEASE(真非同步,不是同步注入)。模擬 Codex 要求的時序:app writer 在
// grant 持鎖期間嘗試進場 → 被鎖擋住 → grant 先完成並釋放 → app 才進場,
// tip 讀到 grant 的 hash → 鏈上 grant,線性無 Y 叉。
test("R8-2 latch:app 在 grant 持鎖期間進場被擋,grant 釋放後 app 才寫 → 最終鏈線性、無 Y 叉", async () => {
  // 共享 advisory lock 狀態
  let held = false;
  const waiters = [];
  const acquire = () =>
    held ? new Promise((res) => waiters.push(res)).then(() => { held = true; return 1; }) : ((held = true), Promise.resolve(1));
  const release = () => {
    held = false;
    const w = waiters.shift();
    if (w) w();
  };
  // 共享 store(id → row)
  const store = [{ id: 70, action: "seed", rowHash: "SEED", previousHash: null }];
  const tipOf = () => [...store].filter((r) => r.rowHash).sort((a, b) => b.id - a.id)[0]?.rowHash ?? "GENESIS";
  let nextId = 77;
  const events = [];

  const conn = {
    execute: async (sqlText, params = []) => {
      if (/GET_LOCK/i.test(sqlText)) { await acquire(); events.push("grant:lock"); return [[{ l: 1 }]]; }
      if (/RELEASE_LOCK/i.test(sqlText)) { events.push("grant:release"); release(); return [[{ r: 1 }]]; }
      if (/^SELECT COUNT\(\*\) AS n FROM adminAuditLog WHERE previousHash/i.test(sqlText)) {
        const n = store.filter((r) => r.previousHash === params[0] && r.id !== params[1]).length;
        return [[{ n }]];
      }
      if (/^SELECT rowHash FROM adminAuditLog WHERE id </i.test(sqlText)) {
        const prior = [...store].filter((r) => r.id < params[0] && r.rowHash).sort((a, b) => b.id - a.id)[0];
        return [[prior ? { rowHash: prior.rowHash } : undefined].filter(Boolean)];
      }
      if (/^SELECT rowHash FROM adminAuditLog/i.test(sqlText)) return [[{ rowHash: tipOf() }]];
      if (/^INSERT INTO adminAuditLog/i.test(sqlText)) {
        const id = nextId++;
        store.push({ id, action: params[3], rowHash: null, previousHash: null });
        events.push(`grant:insert:${id}`);
        return [{ insertId: id }];
      }
      if (/^UPDATE adminAuditLog SET previousHash/i.test(sqlText)) {
        const row = store.find((r) => r.id === params[2]);
        if (row) { row.previousHash = params[0]; row.rowHash = params[1]; }
        events.push(`grant:hash:${params[2]}`);
        return [{}];
      }
      throw new Error(`unexpected sql: ${sqlText}`);
    },
    _executed: [],
  };

  // app writer:尊重同一鎖域(R8-2 之後 app 端也取 GET_LOCK);在 grant 進行中
  // 嘗試進場 —— 會被 latch 擋到 grant 釋放後才跑 insert+hash 全程。
  const appWriter = async () => {
    await acquire();
    events.push("app:lock");
    const prev = tipOf();
    const id = nextId++;
    store.push({ id, action: "app.action", rowHash: null, previousHash: null });
    const row = store.find((r) => r.id === id);
    row.previousHash = prev;
    row.rowHash = "H_APP_" + prev.slice(0, 8);
    events.push(`app:hash:${id}`);
    release();
  };

  // 先啟動 grant,等它真的持鎖後才放 app 進場(deferred/latch,非同步時序)
  const grantP = writeChainedAuditRow(conn, FIELDS);
  while (!events.includes("grant:lock")) await new Promise((res) => setTimeout(res, 5));
  const appP = appWriter();
  const r = await grantP;
  await appP;

  assert.equal(r.hashed, true);
  assert.equal(r.forked, false);
  // 時序:app 的進場(app:lock)必須在 grant:release 之後
  assert.ok(events.indexOf("app:lock") > events.indexOf("grant:release"), `events=${events.join(",")}`);
  // 最終鏈線性:每個 previousHash 都唯一(無兩列同前驅)
  const prevs = store.filter((r) => r.previousHash != null).map((r) => r.previousHash);
  assert.equal(new Set(prevs).size, prevs.length, "no Y-fork: all previousHash values unique");
  // app 鏈上 grant 的 hash
  const grantRow = store.find((r) => r.id === 77);
  const appRow = store.find((r) => r.id === 78);
  assert.equal(appRow.previousHash, grantRow.rowHash);
});
