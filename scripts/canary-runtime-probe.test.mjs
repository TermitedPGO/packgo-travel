/**
 * Tests for the canary positive-path probe (9a). Uses Node's built-in test
 * runner so it needs no vitest config wiring:
 *
 *   node --test scripts/canary-runtime-probe.test.mjs
 *
 * NOTHING here touches a real database. Every query goes through an injected
 * fake `query` that pattern-matches the SQL, per CLAUDE.md's rule that tests
 * must never insert into a real DB.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  runProbe,
  classifyLockResult,
  classifyKillOutcome,
  renderReport,
  renderRow,
  redact,
  errSummary,
  dispWidth,
  ProbeAbort,
  TARGET,
  LOCK_NAME,
  SCHEMA,
  PREFLIGHT,
  preflight,
  raceWithTimeout,
  installProcessGuards,
  attachConnErrorGuard,
} from "./canary-runtime-probe.mjs";

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

const OK_TLS = {
  protocol: "TLSv1.3",
  authorized: true,
  cipher: "TLS_AES_256_GCM_SHA384",
  issuer: "Let's Encrypt",
};

/**
 * Builds a fake `query` that answers by SQL shape. `o` overrides behaviour for
 * individual probes so each test can bend exactly one thing.
 */
function makeFake(o = {}) {
  const state = {
    rows: new Map(), // id -> { id, note }
    baseline: o.baseline ?? 0,
    columns: o.columns ?? [
      { COLUMN_NAME: "id", COLUMN_KEY: "PRI" },
      { COLUMN_NAME: "note", COLUMN_KEY: "" },
    ],
    tableCount: o.tableCount ?? 1,
    calls: [],
    committed: false,
    rolledBack: false,
  };
  // seed baseline rows using ids that can never collide with the probe range
  for (let i = 0; i < state.baseline; i++) state.rows.set(i + 1, { id: i + 1 });

  const query = async (sql, params) => {
    state.calls.push({ sql, params });
    const s = String(sql);

    if (/CURRENT_USER\(\)/.test(s)) {
      return [
        {
          cu: o.currentUser ?? "canary.app_runtime@%",
          db: o.database ?? "canary",
          v: "8.5.3-serverless",
        },
      ];
    }
    if (/COUNT\(\*\) AS n FROM information_schema\.tables/.test(s)) {
      return [{ n: state.tableCount }];
    }
    if (/FROM information_schema\.columns/.test(s)) {
      return state.columns;
    }
    if (/TABLE_NAME AS t FROM information_schema\.tables/.test(s)) {
      if (o.schemaContractRows) return o.schemaContractRows;
      return [{ t: TARGET }, { t: "other_table" }];
    }
    if (new RegExp(`COUNT\\(\\*\\) AS n FROM ${TARGET}`).test(s)) {
      return [{ n: state.rows.size }];
    }
    if (/^SELECT 1$/.test(s.trim())) {
      if (o.select1Throws) throw o.select1Throws;
      return [{ 1: 1 }];
    }
    if (/GET_LOCK/.test(s)) {
      if (o.getLockThrows) throw o.getLockThrows;
      return [{ l: o.getLockResult ?? 1 }];
    }
    if (/RELEASE_LOCK/.test(s)) {
      if (o.releaseLockThrows) throw o.releaseLockThrows;
      return [{ r: o.releaseLockResult ?? 1 }];
    }
    if (/^KILL CONNECTION_ID/.test(s.trim())) {
      return [];
    }
    if (/^INSERT INTO/.test(s.trim())) {
      if (o.insertThrows) throw o.insertThrows;
      state.rows.set(params[0], { id: params[0] });
      return { affectedRows: 1 };
    }
    if (/^UPDATE/.test(s.trim())) {
      if (o.updateThrows) throw o.updateThrows;
      const id = params[params.length - 1];
      if (!state.rows.has(id)) return { affectedRows: 0 };
      if (params.length === 2) state.rows.get(id).note = params[0];
      return { affectedRows: o.updateAffected ?? 1 };
    }
    if (/^DELETE FROM/.test(s.trim())) {
      if (o.deleteThrows && !/IN \(/.test(s)) throw o.deleteThrows;
      if (o.cleanupThrows && /IN \(/.test(s)) throw o.cleanupThrows;
      let n = 0;
      for (const id of params ?? []) if (state.rows.delete(id)) n++;
      // simulate a leak: cleanup silently does nothing
      if (o.cleanupLeaks && /IN \(/.test(s)) {
        for (const id of params ?? []) state.rows.set(id, { id });
      }
      return { affectedRows: n };
    }
    if (/^SELECT `?\w+`? AS v FROM/.test(s.trim())) {
      const row = state.rows.get(params[0]);
      return row ? [{ v: row.note ?? null }] : [];
    }
    if (/^SELECT id FROM/.test(s.trim())) {
      const row = state.rows.get(params[0]);
      return row ? [{ id: row.id }] : [];
    }
    throw new Error(`fake query: unhandled SQL: ${s}`);
  };

  const tx = {
    begin: async () => {
      if (o.beginThrows) throw o.beginThrows;
    },
    commit: async () => {
      state.committed = true;
    },
    rollback: async () => {
      state.rolledBack = true;
    },
  };

  return { state, query, tx };
}

function run(o = {}) {
  const fake = makeFake(o);
  return runProbe({
    query: fake.query,
    tx: fake.tx,
    tlsInfo: o.tlsInfo === undefined ? OK_TLS : o.tlsInfo,
    killProbe: async () => {
      if (o.killThrows) throw o.killThrows;
    },
    rand: () => 0.5, // deterministic id: 1_900_000_000 + 5_000_000
    log: () => {},
  }).then((r) => ({ ...r, fake }));
}

const byNo = (results, no) => results.find((r) => r.no === no);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("redact strips credentials from a connection string", () => {
  const s = "mysql://app_runtime:S3cretPw!@gw.tidbcloud.com:4000/canary";
  const out = redact(s);
  assert.ok(!out.includes("S3cretPw!"), "password must not survive redaction");
  assert.ok(!out.includes("app_runtime"), "user must not survive redaction");
  assert.equal(out, "mysql://***:***@gw.tidbcloud.com:4000/canary");
});

test("errSummary never prints the raw error object's extra properties", () => {
  const e = new TypeError("Invalid URL");
  e.code = "ERR_INVALID_URL";
  e.input = "mysql://app_runtime:S3cretPw!@gw.tidbcloud.com:NOTAPORT/canary";
  const out = errSummary(e);
  assert.ok(!out.includes("S3cretPw!"), "password leaked into summary");
  assert.ok(!out.includes("NOTAPORT"), "raw input leaked into summary");
  assert.match(out, /code=ERR_INVALID_URL/);
  assert.match(out, /msg=Invalid URL/);
});

test("errSummary redacts credentials embedded in the message itself", () => {
  const e = new Error("connect failed for mysql://u:p@host:4000/canary");
  assert.ok(!errSummary(e).includes("u:p@"));
});

test("errSummary handles non-objects", () => {
  assert.equal(errSummary("boom"), "(non-Error thrown)");
  assert.equal(errSummary(null), "(non-Error thrown)");
});

test("classifyLockResult three-way split", () => {
  assert.equal(classifyLockResult(1), "PASS");
  assert.equal(classifyLockResult("1"), "PASS");
  assert.equal(classifyLockResult(0), "INCONCLUSIVE");
  assert.equal(classifyLockResult(null), "FAIL");
  assert.equal(classifyLockResult(undefined), "FAIL");
  assert.equal(classifyLockResult("nonsense"), "FAIL");
});

test("classifyKillOutcome: no error is a pass", () => {
  assert.equal(classifyKillOutcome(null).status, "PASS");
});

test("classifyKillOutcome: disconnect codes are the expected success", () => {
  for (const code of ["PROTOCOL_CONNECTION_LOST", "ECONNRESET", "EPIPE"]) {
    const r = classifyKillOutcome({ code });
    assert.equal(r.status, "PASS", `${code} should pass`);
    assert.match(r.note, /切斷/);
  }
  assert.equal(classifyKillOutcome({ fatal: true }).status, "PASS");
});

test("classifyKillOutcome: privilege errnos fail", () => {
  for (const errno of [1095, 1227, 1142, 1044]) {
    assert.equal(classifyKillOutcome({ errno }).status, "FAIL", `errno ${errno}`);
  }
});

test("classifyKillOutcome: unknown errno is inconclusive, never a silent pass", () => {
  const r = classifyKillOutcome({ errno: 8888, sqlState: "HY000" });
  assert.equal(r.status, "INCONCLUSIVE");
});

test("dispWidth counts CJK as two columns", () => {
  assert.equal(dispWidth("abc"), 3);
  assert.equal(dispWidth("靶表"), 4);
  assert.equal(dispWidth("[通過] 03."), 4 + 2 + 4);
});

test("renderRow pads to a stable width regardless of CJK", () => {
  const a = renderRow({ no: "04", label: "網站的健康檢查心跳", status: "PASS" });
  const b = renderRow({ no: "05", label: "short", status: "FAIL" });
  assert.equal(dispWidth(a), dispWidth(b));
});

test("report uses only the three ASCII markers, no emoji, no em dash", () => {
  const out = renderReport(
    [
      { no: "01", label: "a", status: "PASS", evidence: "e" },
      { no: "02", label: "b", status: "FAIL", evidence: "errno=1142" },
      { no: "03", label: "c", status: "INCONCLUSIVE" },
    ],
    { schema: "canary", user: "app_runtime", host: "h", baseline: 0, after: 0 },
  );
  assert.ok(out.includes("[通過]"));
  assert.ok(out.includes("[沒過]"));
  assert.ok(out.includes("[不成立]"));
  assert.ok(!/[—–]/.test(out), "report must contain no dashes");
  assert.ok(
    !/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/u.test(out),
    "report must contain no emoji",
  );
  assert.match(out, /不要自己加權限/);
});

// ---------------------------------------------------------------------------
// runProbe: happy path
// ---------------------------------------------------------------------------

test("all green: 14 items, every one passes, exit 0", async () => {
  const { results, exitCode, meta } = await run();
  assert.equal(exitCode, 0);
  assert.equal(results.length, 14);
  const bad = results.filter((r) => r.status !== "PASS");
  assert.deepEqual(bad, [], `unexpected non-pass: ${JSON.stringify(bad)}`);
  assert.equal(meta.baseline, 0);
  assert.equal(meta.after, 0);
});

test("all green leaves the target table exactly as it found it", async () => {
  const { fake, meta } = await run({ baseline: 3 });
  assert.equal(meta.baseline, 3);
  assert.equal(meta.after, 3);
  assert.equal(fake.state.rows.size, 3);
});

test("probe ids live in the reserved range and stay under INT max", async () => {
  const { meta } = await run();
  for (const id of meta.ids) {
    assert.ok(id >= 1_900_000_000, `id ${id} below reserved range`);
    assert.ok(id < 2_147_483_647, `id ${id} exceeds INT max`);
  }
});

test("uses the canary lock name, never the production audit lock", async () => {
  const { fake } = await run();
  const lockSql = fake.state.calls
    .map((c) => String(c.sql))
    .filter((s) => /GET_LOCK|RELEASE_LOCK/.test(s));
  assert.ok(lockSql.length >= 2);
  for (const s of lockSql) {
    assert.ok(s.includes(LOCK_NAME), `lock sql should use canary name: ${s}`);
    assert.ok(
      !s.includes("audit:tip:lock"),
      "MUST NOT touch the production audit lock name",
    );
  }
});

test("every UPDATE and DELETE carries a WHERE id filter, and TRUNCATE is never used", async () => {
  const { fake } = await run();
  for (const c of fake.state.calls) {
    const s = String(c.sql).trim();
    if (/^(UPDATE|DELETE)/i.test(s)) {
      assert.match(s, /WHERE id (=|IN)/, `missing WHERE id guard: ${s}`);
    }
    assert.ok(!/TRUNCATE/i.test(s), `TRUNCATE is forbidden: ${s}`);
  }
});

// ---------------------------------------------------------------------------
// runProbe: guard aborts
// ---------------------------------------------------------------------------

test("aborts when there is no TLS at all", async () => {
  await assert.rejects(() => run({ tlsInfo: null }), (e) => {
    assert.ok(e instanceof ProbeAbort);
    assert.match(e.message, /沒有加密/);
    return true;
  });
});

test("aborts when the certificate does not verify, and never suggests disabling verification", async () => {
  await assert.rejects(
    () =>
      run({
        tlsInfo: {
          protocol: "TLSv1.3",
          authorized: false,
          authorizationError: "SELF_SIGNED_CERT_IN_CHAIN",
        },
      }),
    (e) => {
      assert.ok(e instanceof ProbeAbort);
      assert.ok(!/rejectUnauthorized/i.test(e.message));
      assert.match(e.message, /不要改成不驗憑證/);
      return true;
    },
  );
});

test("aborts when the identity is not app_runtime", async () => {
  await assert.rejects(() => run({ currentUser: "root@%" }), (e) => {
    assert.match(e.message, /app_runtime/);
    return true;
  });
});

test("aborts loudly when pointed at the production test schema", async () => {
  await assert.rejects(() => run({ database: "test" }), (e) => {
    assert.match(e.message, /正式 schema/);
    return true;
  });
});

test("aborts on a near-miss schema name like canary_backup", async () => {
  await assert.rejects(() => run({ database: "canary_backup" }), (e) => {
    assert.match(e.message, /剛好是 'canary'/);
    return true;
  });
});

test("aborts when the target table is missing", async () => {
  await assert.rejects(() => run({ tableCount: 0 }), (e) => {
    assert.match(e.message, /步驟 8/);
    return true;
  });
});

test("aborts when the target table is implausibly large", async () => {
  await assert.rejects(() => run({ baseline: 1001 }), (e) => {
    assert.match(e.message, /指錯地方/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// runProbe: failure and degraded paths
// ---------------------------------------------------------------------------

test("GET_LOCK returning 0 is INCONCLUSIVE and still fails the run", async () => {
  const { results, exitCode } = await run({ getLockResult: 0 });
  const lock = byNo(results, "11");
  assert.equal(lock.status, "INCONCLUSIVE");
  assert.match(lock.note, /殘留鎖/);
  assert.equal(exitCode, 1, "fail-closed: inconclusive must not exit 0");
  // release is not attempted when the lock was never held
  assert.equal(byNo(results, "12").status, "INCONCLUSIVE");
});

test("KILL denied by privilege is a hard fail with a plain-language reason", async () => {
  const err = Object.assign(new Error("access denied"), {
    errno: 1095,
    sqlState: "42000",
  });
  const { results, exitCode } = await run({ killThrows: err });
  const kill = byNo(results, "14");
  assert.equal(kill.status, "FAIL");
  assert.match(kill.note, /逃生口是死的/);
  assert.match(kill.evidence, /errno=1095/);
  assert.equal(exitCode, 1);
});

test("KILL severing its own connection is the expected success", async () => {
  const err = Object.assign(new Error("read ECONNRESET"), {
    code: "ECONNRESET",
  });
  const { results, exitCode } = await run({ killThrows: err });
  const kill = byNo(results, "14");
  assert.equal(kill.status, "PASS");
  assert.match(kill.note, /正常的/);
  assert.equal(exitCode, 0, "expected disconnect must not fail the run");
});

test("KILL with an unexpected errno is INCONCLUSIVE, never an assumed pass", async () => {
  const err = Object.assign(new Error("weird"), { errno: 8888 });
  const { results, exitCode } = await run({ killThrows: err });
  assert.equal(byNo(results, "14").status, "INCONCLUSIVE");
  assert.equal(exitCode, 1);
});

test("single-column target table degrades UPDATE to a permission-only check", async () => {
  const { results, exitCode } = await run({
    columns: [{ COLUMN_NAME: "id", COLUMN_KEY: "PRI" }],
    updateAffected: 0, // TiDB clustered PK may report 0 rows changed
  });
  const upd = byNo(results, "08");
  assert.equal(upd.status, "PASS", "affectedRows 0 must not fail the degraded path");
  assert.match(upd.note, /降級判定/);
  assert.equal(exitCode, 0);
});

test("degraded UPDATE still fails when the DB denies the privilege", async () => {
  const err = Object.assign(new Error("denied"), { errno: 1142, sqlState: "42000" });
  const { results, exitCode } = await run({
    columns: [{ COLUMN_NAME: "id", COLUMN_KEY: "PRI" }],
    updateThrows: err,
  });
  assert.equal(byNo(results, "08").status, "FAIL");
  assert.equal(exitCode, 1);
});

test("INSERT denied fails and the ledger still balances", async () => {
  const err = Object.assign(new Error("denied"), { errno: 1142 });
  const { results, exitCode, meta } = await run({ insertThrows: err, baseline: 2 });
  assert.equal(byNo(results, "06").status, "FAIL");
  assert.equal(byNo(results, "13").status, "PASS", "nothing written, so nothing to leak");
  assert.equal(meta.after, 2);
  assert.equal(exitCode, 1);
});

test("a cleanup leak is reported with a copy-pasteable SQL statement", async () => {
  const { results, exitCode } = await run({ cleanupLeaks: true });
  const ledger = byNo(results, "13");
  assert.equal(ledger.status, "FAIL");
  assert.match(ledger.note, /DELETE FROM `canary`/);
  assert.match(ledger.note, /WHERE id IN \(/);
  assert.equal(exitCode, 1);
});

test("a stuck lock is killed only AFTER cleanup, so the ledger still balances", async () => {
  // RELEASE_LOCK returning 0 leaves the connection holding the lock. The
  // remediation KILL must not run before cleanup, or the DELETE/COUNT would
  // execute on a dead connection: real rows left behind plus a false leak report.
  const { results, exitCode, fake } = await run({
    releaseLockResult: 0,
    baseline: 2,
  });
  assert.equal(byNo(results, "12").status, "FAIL");
  assert.equal(byNo(results, "13").status, "PASS", "cleanup must still have run");
  assert.equal(fake.state.rows.size, 2, "probe rows must be gone");

  const sqls = fake.state.calls.map((c) => String(c.sql).trim());
  const killIdx = sqls.findIndex((s) => /^KILL CONNECTION_ID/.test(s));
  const cleanupIdx = sqls.findIndex((s) => /^DELETE FROM .* WHERE id IN \(/.test(s) && sqls.indexOf(s) > 0);
  const lastCount = sqls.map((s, i) => (/COUNT\(\*\) AS n FROM canary_probe_target/.test(s) ? i : -1)).filter((i) => i >= 0).pop();
  assert.ok(killIdx >= 0, "remediation KILL should have been issued");
  assert.ok(killIdx > cleanupIdx, "KILL must come after the cleanup DELETE");
  assert.ok(killIdx > lastCount, "KILL must come after the reconciliation COUNT");
  assert.equal(exitCode, 1);
});

test("SELECT 1 failing is called out as a connection problem, not a permission one", async () => {
  const { results } = await run({ select1Throws: new Error("gone") });
  const r = byNo(results, "04");
  assert.equal(r.status, "FAIL");
  assert.match(r.note, /不是權限問題/);
});

test("schema contract probe fails when the target table is not visible", async () => {
  const { results, exitCode } = await run({ schemaContractRows: [{ t: "other" }] });
  assert.equal(byNo(results, "05").status, "FAIL");
  assert.equal(exitCode, 1);
});

test("schema contract pass is honest about what it did not prove", async () => {
  const { results } = await run();
  assert.match(byNo(results, "05").note, /還沒證明正式 schema/);
});

test("a transaction that cannot begin is rolled back and reported", async () => {
  const { results, exitCode } = await run({ beginThrows: new Error("no tx") });
  assert.equal(byNo(results, "10").status, "FAIL");
  assert.equal(exitCode, 1);
});

test("the report renders end to end from a real runProbe result", async () => {
  const { results, meta } = await run({ getLockResult: 0 });
  const out = renderReport(results, { ...meta, host: "gw.example" });
  assert.match(out, /正向驗證/);
  assert.match(out, /第 11 項/);
  assert.match(out, /靶場:開始 0 列,結束 0 列/);
});

// ---------------------------------------------------------------------------
// redact:密碼含 @ / 空白 / 斜線 / tab 這些會打死正規式的字元,一樣要遮掉
// ---------------------------------------------------------------------------

test("redact masks passwords containing @, spaces, slashes and tabs", () => {
  const nasty = [
    ["at 符號", "p@ss@word"],
    ["空白", "p ss word"],
    ["斜線", "p/ss/word"],
    ["tab", "p\tss"],
    ["混合", "p@ /s\tS3cret"],
    ["冒號", "p:ss:word"],
  ];
  for (const [label, pw] of nasty) {
    const s = `mysql://app_runtime:${pw}@gw.tidbcloud.com:4000/canary`;
    const out = redact(s);
    assert.ok(!out.includes(pw), `${label}:密碼整串沒被遮掉 → ${out}`);
    assert.ok(!out.includes("S3cret"), `${label}:密碼片段沒被遮掉 → ${out}`);
    assert.ok(!out.includes("app_runtime"), `${label}:帳號沒被遮掉 → ${out}`);
    assert.ok(out.includes("gw.tidbcloud.com"), `${label}:主機名不該被吃掉`);
    assert.ok(out.includes("***"), `${label}:沒有遮蔽標記`);
  }
});

test("redact masks a credentialled URL embedded mid-message, even with an @ in the password", () => {
  const msg = "connect ETIMEDOUT for mysql://app_runtime:p@ssZQX9SENTINEL@gw.example:4000/canary now";
  const out = redact(msg);
  assert.ok(!out.includes("ZQX9SENTINEL"), `password leaked: ${out}`);
  assert.ok(out.includes("***:***@"), out);
});

test("redact leaves credential-free text alone", () => {
  assert.equal(redact("plain message"), "plain message");
  assert.equal(redact(""), "");
  assert.equal(redact(null), "");
  assert.equal(redact("https://example.com/docs"), "https://example.com/docs");
});

// ---------------------------------------------------------------------------
// preflight:連線【之前】的防呆。這是 9a 最重要的一道 —— 這支會寫資料。
// ---------------------------------------------------------------------------

const URL_WITH = (schemaPart, pw = "ZQX9SENTINEL") =>
  `mysql://prefix.app_runtime:${pw}@gw.example.com:4000${schemaPart}`;

test("preflight accepts exactly one thing: schema === canary", () => {
  const r = preflight(URL_WITH("/canary"));
  assert.equal(r.ok, true);
  assert.equal(r.code, PREFLIGHT.OK);
  assert.equal(r.schema, "canary");
  assert.equal(r.host, "gw.example.com");
  assert.ok(r.u instanceof URL);
});

test("preflight rejects the near-miss schema canary_backup", () => {
  const r = preflight(URL_WITH("/canary_backup"));
  assert.equal(r.ok, false);
  assert.equal(r.code, PREFLIGHT.SCHEMA_MISMATCH);
  assert.match(r.reason, /剛好是 'canary'/);
  assert.match(r.reason, /canary_backup/);
});

test("preflight rejects the production schema test, in any casing", () => {
  for (const name of ["test", "TEST", "Test"]) {
    const r = preflight(URL_WITH(`/${name}`));
    assert.equal(r.ok, false, name);
    assert.equal(r.code, PREFLIGHT.PROD_SCHEMA, name);
    assert.match(r.reason, /正式 schema 'test'/);
  }
});

test("preflight rejects Canary: schema comparison is case sensitive", () => {
  const r = preflight(URL_WITH("/Canary"));
  assert.equal(r.ok, false);
  assert.equal(r.code, PREFLIGHT.SCHEMA_MISMATCH);
  assert.match(r.reason, /大小寫不同/);
});

test("preflight rejects an empty or blank connection string", () => {
  for (const raw of ["", "   ", undefined, null, 12345]) {
    const r = preflight(raw);
    assert.equal(r.ok, false, String(raw));
    assert.equal(r.code, PREFLIGHT.EMPTY_URL, String(raw));
    assert.match(r.reason, /連線字串是空的/);
  }
});

test("preflight rejects a connection string with no schema path at all", () => {
  for (const tail of ["", "/"]) {
    const r = preflight(URL_WITH(tail));
    assert.equal(r.ok, false, JSON.stringify(tail));
    assert.equal(r.code, PREFLIGHT.NO_SCHEMA, JSON.stringify(tail));
    assert.match(r.reason, /沒有指定 schema/);
  }
});

test("preflight rejects an impossible port (99999) before any connection", () => {
  const r = preflight("mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:99999/canary");
  assert.equal(r.ok, false);
  assert.equal(r.code, PREFLIGHT.BAD_URL);
  assert.match(r.reason, /port/);
});

test("preflight diagnoses a bare % in the password instead of leaving URI malformed", () => {
  const r = preflight("mysql://prefix.app_runtime:ZQX9%SENTINEL@gw.example.com:4000/canary");
  assert.equal(r.ok, false);
  assert.equal(r.code, PREFLIGHT.BAD_ENCODING);
  assert.match(r.reason, /密碼裡有 % 這個編碼字元/);
  assert.match(r.reason, /純英數 32 位/);
});

test("preflight rejects any attempt to switch certificate verification off", () => {
  for (const raw of [
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/canary?ssl={\"rejectUnauthorized\":false}",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/canary?rejectUnauthorized=false",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/canary?rejectUnauthorized=0",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/canary?REJECTUNAUTHORIZED=FALSE",
  ]) {
    const r = preflight(raw);
    assert.equal(r.ok, false, raw);
    assert.equal(r.code, PREFLIGHT.TLS_DISABLED, raw);
    assert.match(r.reason, /不准不驗/);
  }
});

test("preflight never echoes the password back in any rejection reason", () => {
  const cases = [
    "",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/canary_backup",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/test",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/Canary",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:99999/canary",
    "mysql://prefix.app_runtime:ZQX9%SENTINEL@gw.example.com:4000/canary",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/canary?rejectUnauthorized=false",
    "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/mysql://u:p@evil/canary",
  ];
  for (const raw of cases) {
    const r = preflight(raw);
    assert.equal(r.ok, false, raw);
    assert.ok(!r.reason.includes("ZQX9SENTINEL"), `密碼漏進拒絕訊息:${r.reason}`);
    assert.ok(
      !/([a-z][a-z0-9+.-]*:\/\/)(?!\*\*\*:\*\*\*@)[^\s/@]*:[^\s/@]*@/i.test(r.reason),
      `拒絕訊息裡有未遮蔽的連線字串:${r.reason}`,
    );
  }
});

// ---------------------------------------------------------------------------
// handshake 逾時
// ---------------------------------------------------------------------------

test("raceWithTimeout returns the value when the factory wins", async () => {
  const v = await raceWithTimeout(async () => "connected", 1000, "too slow");
  assert.equal(v, "connected");
});

test("raceWithTimeout rejects a connection that accepts TCP but never finishes the handshake", async () => {
  const never = () => new Promise(() => {});
  await assert.rejects(
    () => raceWithTimeout(never, 30, "交握逾時"),
    (e) => {
      assert.equal(e.code, "CANARY_HANDSHAKE_TIMEOUT");
      assert.match(e.message, /交握逾時/);
      return true;
    },
  );
});

test("raceWithTimeout destroys a connection that arrives after the timeout", async () => {
  let destroyed = false;
  const late = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ destroy: () => { destroyed = true; } }), 40),
    );
  await assert.rejects(() => raceWithTimeout(late, 10, "交握逾時"));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(destroyed, true, "逾時後才回來的連線沒有被丟掉,行程會掛著不結束");
});

test("raceWithTimeout swallows a rejection that arrives after the timeout", async () => {
  const lateFail = () =>
    new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 30));
  await assert.rejects(() => raceWithTimeout(lateFail, 10, "交握逾時"));
  // 若沒吞掉,這裡會冒出 unhandledRejection 把整個 test runner 打掛。
  await new Promise((r) => setTimeout(r, 60));
});

test("raceWithTimeout propagates a real connection error untouched", async () => {
  const boom = Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" });
  await assert.rejects(
    () => raceWithTimeout(() => Promise.reject(boom), 1000, "交握逾時"),
    (e) => e === boom,
  );
});

// ---------------------------------------------------------------------------
// process 級攔截與連線 error 監聽(三條繞過 main().catch() 的通道)
// ---------------------------------------------------------------------------

/** 只認 on / emit 的最小 process 替身。 */
function fakeProc() {
  const handlers = new Map();
  return {
    on(name, fn) {
      handlers.set(name, fn);
      return this;
    },
    fire(name, arg) {
      const fn = handlers.get(name);
      if (!fn) throw new Error(`no handler for ${name}`);
      fn(arg);
    },
    has: (name) => handlers.has(name),
  };
}

/** ERR_INVALID_URL 那種把整條連線字串掛在 own property 上的錯。 */
const leakyError = () =>
  Object.assign(new TypeError("Invalid URL"), {
    code: "ERR_INVALID_URL",
    input: "mysql://prefix.app_runtime:ZQX9SENTINEL@gw.example.com:4000/canary",
  });

test("installProcessGuards catches BOTH uncaughtException and unhandledRejection", () => {
  const proc = fakeProc();
  installProcessGuards("[canary-probe]", { proc, log: () => {}, exit: () => {} });
  assert.ok(proc.has("uncaughtException"), "uncaughtException 沒被接住");
  assert.ok(proc.has("unhandledRejection"), "unhandledRejection 沒被接住");
});

test("installProcessGuards prints only a redacted summary and exits 1", () => {
  for (const channel of ["uncaughtException", "unhandledRejection"]) {
    const proc = fakeProc();
    const lines = [];
    const exits = [];
    installProcessGuards("[canary-probe]", {
      proc,
      log: (l) => lines.push(String(l)),
      exit: (c) => exits.push(c),
    });
    proc.fire(channel, leakyError());
    const out = lines.join("\n");
    assert.ok(!out.includes("ZQX9SENTINEL"), `${channel} 把密碼印出來了:${out}`);
    assert.ok(!out.includes("gw.example.com"), `${channel} 把主機連同字串印出來了`);
    assert.match(out, /code=ERR_INVALID_URL/);
    assert.deepEqual(exits, [1], `${channel} 沒有 fail-closed exit 1`);
  }
});

/** 只認 on / emit 的最小連線替身。 */
function fakeConn() {
  const handlers = [];
  return {
    on(name, fn) {
      if (name === "error") handlers.push(fn);
      return this;
    },
    emitError(e) {
      if (!handlers.length) throw e; // EventEmitter 沒人接 'error' 時的真實行為
      for (const fn of handlers) fn(e);
    },
    get listenerCount() {
      return handlers.length;
    },
  };
}

test("attachConnErrorGuard turns a connection error event into a redacted line", () => {
  const conn = fakeConn();
  const lines = [];
  const exits = [];
  assert.equal(
    attachConnErrorGuard(conn, "[canary-ddl]", {
      log: (l) => lines.push(String(l)),
      exit: (c) => exits.push(c),
    }),
    true,
  );
  assert.equal(conn.listenerCount, 1, "沒有掛上 error 監聽,錯誤會被 Node 原樣印出");
  conn.emitError(leakyError());
  const out = lines.join("\n");
  assert.ok(!out.includes("ZQX9SENTINEL"), `連線 error 事件把密碼印出來了:${out}`);
  assert.match(out, /連線層錯誤/);
  assert.deepEqual(exits, [1]);
});

test("attachConnErrorGuard tolerates the self-inflicted disconnect 9a expects", () => {
  const conn = fakeConn();
  const lines = [];
  const exits = [];
  attachConnErrorGuard(conn, "[canary-probe]", {
    log: (l) => lines.push(String(l)),
    exit: (c) => exits.push(c),
    tolerateDisconnect: true,
  });
  conn.emitError(
    Object.assign(new Error("Connection lost"), { code: "PROTOCOL_CONNECTION_LOST" }),
  );
  assert.deepEqual(exits, [], "預期內的自我斷線不該中止流程,成績單還沒印");
  assert.match(lines.join("\n"), /預期得到/);
  // 但不是斷線的錯誤,照樣 fail-closed。
  conn.emitError(leakyError());
  assert.deepEqual(exits, [1]);
  assert.ok(!lines.join("\n").includes("ZQX9SENTINEL"));
});

test("attachConnErrorGuard is a no-op on something that is not an emitter", () => {
  assert.equal(attachConnErrorGuard(null, "[x]"), false);
  assert.equal(attachConnErrorGuard({}, "[x]"), false);
});

// ---------------------------------------------------------------------------
// 9a 的結構事實:防呆擋在連線之前,三條通道都有人接
// ---------------------------------------------------------------------------

test("9a calls preflight before it prints 連線中 or opens a connection", () => {
  // 整行註解一律丟掉:不然把防線註解掉的突變會因為註解裡還留著那行字而測不出來。
  const src = readFileSync(
    new URL("./canary-runtime-probe.mjs", import.meta.url),
    "utf8",
  )
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  const preIdx = src.indexOf("preflight(url)");
  const connIdx = src.indexOf("連線中:");
  const createIdx = src.indexOf("mysql.createConnection");
  assert.ok(preIdx > 0, "9a 沒有呼叫 preflight");
  assert.ok(connIdx > preIdx, "「連線中」印在 preflight 之前,密碼會先送出去");
  assert.ok(createIdx > preIdx, "createConnection 排在 preflight 之前");
  assert.match(src, /installProcessGuards\("\[canary-probe\]"\)/);
  assert.match(src, /attachConnErrorGuard\(conn, "\[canary-probe\]"/);
  assert.match(src, /raceWithTimeout\(/);
});
