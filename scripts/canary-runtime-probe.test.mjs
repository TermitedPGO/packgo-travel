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
