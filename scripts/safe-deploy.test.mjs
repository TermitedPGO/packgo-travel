/**
 * Tests for the deploy guard. Uses Node's built-in test runner so it needs no
 * vitest config wiring:
 *
 *   node --test scripts/safe-deploy.test.mjs      (or: pnpm deploy:test)
 *
 * Every side effect is faked via the injected `deps`, so NOTHING here touches
 * real git / tsc / vitest / flyctl / the network. The "all green" case asserts
 * the guard *reaches* the flyctl call (recorded by the fake) without running it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runGuard } from "./safe-deploy.mjs";

function makeDeps(o = {}) {
  const state = {
    branch: "main",
    porcelain: "",
    behind: "0",
    ahead: "0",
    tscFail: false,
    testFail: false,
    ...o,
  };
  const calls = [];
  let deleted = 0;
  let errorLogDeleted = 0;
  const logs = [];
  const errors = [];

  const run = (cmd) => {
    calls.push(cmd);
    if (cmd.includes("rev-parse --abbrev-ref")) return state.branch + "\n";
    if (cmd.includes("status --porcelain")) return state.porcelain;
    if (cmd.includes("git fetch")) return "";
    if (cmd.includes("rev-list --count HEAD..origin/main")) return state.behind + "\n";
    if (cmd.includes("rev-list --count origin/main..HEAD")) return state.ahead + "\n";
    if (cmd.includes("tsc")) {
      if (state.tscFail) throw new Error("tsc errors");
      return "";
    }
    if (cmd.includes("vitest")) {
      if (state.testFail) throw new Error("tests failed");
      return "";
    }
    if (cmd.includes("flyctl deploy")) {
      // The real deploy is a `... | tee .deploy-last-error.log` pipeline; a
      // non-zero flyctl exit surfaces (pipefail) as a throw here.
      if (state.deployFail) throw new Error("flyctl deploy exit 1");
      return "deployed";
    }
    if (cmd.includes("flyctl releases")) return " v999    │ complete │ Release";
    if (cmd.includes("curl")) return JSON.stringify({ overall: "ok", checks: {} });
    return "";
  };

  return {
    run,
    env: { DEPLOY_TOKEN: "good-token", ...o.env },
    readApprove: () => (o.approve === undefined ? "good-token" : o.approve),
    // 6.9 外部審查閘 fake。預設回一段「乾淨」索引(無 待傳/待裁定/退回)讓既有綠案
    // 照常過;測試可用 reviewIndex 覆寫成含標記的內容,或 reviewIndex:null 模擬檔案不存在。
    readReviewIndex: () =>
      o.reviewIndex === undefined
        ? "PACKGO AI 交流索引\n- 這批全部已完成並同步\n- 沒有未結項\n"
        : o.reviewIndex,
    deleteApprove: () => {
      deleted++;
    },
    deleteErrorLog: () => {
      errorLogDeleted++;
    },
    listMigrations: () => ["0086_supplier_cost", "0087_booking_consent"],
    health: () => state.healthResult ?? { overall: "ok", checks: { db: { status: "ok", latencyMs: 1 } } },
    // Wave1 Block A — ship 後自動煙霧 fake dep. Directly returns an object
    // (no real curl), matching the file's existing `health` fake convention.
    // Records a "smoke()" call marker so tests can assert whether it was
    // invoked at all (the LOCAL_SCRIPT_TOKEN-unset skip path must NOT call it).
    smoke: () => {
      calls.push("smoke()");
      return state.smokeResult ?? { ok: true, arms: [] };
    },
    // 閘 6.5 — SQL 彩排 fake。預設回全過;測試可用 rehearseResult 注入失敗/通道錯,
    // 或 rehearseThrow 模擬 orchestrator 起不來(tsx crash)。記一個 "rehearse()" 標記
    // 讓測試能斷言「SKIP_SQL_REHEARSAL=1 時完全沒被呼叫」。
    rehearse: () => {
      calls.push("rehearse()");
      if (state.rehearseThrow) throw new Error("tsx failed to start");
      return state.rehearseResult ?? { ok: true, total: 42, passed: 42, failures: [] };
    },
    log: (...a) => {
      logs.push(a.join(" "));
    },
    error: (...a) => {
      errors.push(a.join(" "));
    },
    _calls: calls,
    _logs: logs,
    _errors: errors,
    get _deleted() {
      return deleted;
    },
    get _errorLogDeleted() {
      return errorLogDeleted;
    },
  };
}

const reachedDeploy = (d) => d._calls.some((c) => c.includes("flyctl deploy"));

// ---- BLOCK cases (the four required + extra coverage) ----

test("BLOCK: not on main", async () => {
  const d = makeDeps({ branch: "wip/three-lines-snapshot" });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: dirty working tree", async () => {
  const d = makeDeps({ porcelain: " M server/x.ts\n?? scratch.ts" });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: local is behind origin/main", async () => {
  const d = makeDeps({ behind: "3" });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: .deploy-approve missing", async () => {
  const d = makeDeps({ approve: null });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: .deploy-approve empty / whitespace", async () => {
  const d = makeDeps({ approve: "   \n" });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: token mismatch (session-fabricated wrong token)", async () => {
  const d = makeDeps({ approve: "i-guessed-this" });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: DEPLOY_TOKEN env not set", async () => {
  const d = makeDeps({ env: { DEPLOY_TOKEN: "" } });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: tsc has errors", async () => {
  const d = makeDeps({ tscFail: true });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("BLOCK: tests fail", async () => {
  const d = makeDeps({ testFail: true });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

// ---- PASS cases ----

test("PASS: all gates green + token matches → reaches flyctl deploy + burns token", async () => {
  const d = makeDeps();
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(reachedDeploy(d), true);
  assert.equal(d._deleted, 1); // one-time token consumed exactly once
  assert.equal(d._errorLogDeleted, 1); // success cleans up the failure-capture log
});

test("PASS: the deploy command tee's full output to .deploy-last-error.log with pipefail", async () => {
  const d = makeDeps();
  await runGuard(d, {});
  const deployCmd = d._calls.find((c) => c.includes("flyctl deploy"));
  assert.ok(deployCmd, "deploy command was issued");
  assert.match(deployCmd, /tee \.deploy-last-error\.log/);
  assert.match(deployCmd, /pipefail/); // so a failed flyctl exit isn't masked by tee
});

test("BLOCK: flyctl deploy fails → returns 1, KEEPS error log, does NOT burn token", async () => {
  const d = makeDeps({ deployFail: true });
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), true); // it did attempt the deploy
  assert.equal(d._deleted, 0); // token NOT burned (kept for retry)
  assert.equal(d._errorLogDeleted, 0); // log KEPT so the monitor can read the failure
});

test("DRY-RUN: all gates green but does NOT deploy and KEEPS the token", async () => {
  const d = makeDeps();
  const code = await runGuard(d, { dryRun: true });
  assert.equal(code, 0);
  assert.equal(reachedDeploy(d), false);
  assert.equal(d._deleted, 0);
});

test("SKIP_DEPLOY_TESTS=1 skips vitest but still deploys when authorized", async () => {
  const d = makeDeps({ env: { DEPLOY_TOKEN: "good-token", SKIP_DEPLOY_TESTS: "1" } });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(d._calls.some((c) => c.includes("vitest")), false);
  assert.equal(reachedDeploy(d), true);
});

// ---- Wave1 Block A: ship 後自動煙霧 (deploySmoke) wiring ----

test("ship-smoke GREEN: LOCAL_SCRIPT_TOKEN unset → smoke() not called, output shows skip phrase, exit 0", async () => {
  const d = makeDeps(); // env.LOCAL_SCRIPT_TOKEN left unset by default
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(d._calls.includes("smoke()"), false);
  assert.ok(
    d._logs.some((l) => l.includes("LOCAL_SCRIPT_TOKEN") && l.includes("跳過 ship 後煙霧")),
    "expected a log line announcing the smoke skip",
  );
});

test("ship-smoke GREEN: LOCAL_SCRIPT_TOKEN set + smoke returns ok:true → exit 0, no failure text", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    smokeResult: {
      ok: true,
      arms: [
        { name: "customerList", ok: true, ms: 12, rowCount: 3 },
        { name: "guestList", ok: true, ms: 8, rowCount: 1 },
      ],
    },
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(d._calls.includes("smoke()"), true);
  assert.equal(
    d._errors.some((l) => l.includes("煙霧未全過")),
    false,
  );
});

// B1.2(Codex 6.6 P0)反向釘死:煙霧紅燈時,部署已發生但未通過驗證。輸出絕不可
// 建議 `flyctl releases rollback`(退回 v811 = 復活自動認列);必須改印 forward-fix
// 指引 + 機械可辨認字串 DEPLOYED_UNVERIFIED + 「不得回退 v811」。exit code 仍不變(0)。
test("ship-smoke RED (exit 0): smoke ok:false → NO rollback command; prints DEPLOYED_UNVERIFIED + forward-fix + 不得回退 v811", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    smokeResult: {
      ok: false,
      arms: [
        { name: "customerList", ok: true, ms: 10, rowCount: 2 },
        { name: "guestList", ok: false, ms: 5, error: "TypeError: boom" },
      ],
    },
  });
  const code = await runGuard(d, {});
  // deploy itself already succeeded before the smoke check runs — a smoke
  // failure is reported (red) but must NOT change the guard's exit code.
  assert.equal(code, 0);
  const allOut = [...d._errors, ...d._logs].join("\n");
  // failed arm name still surfaced.
  assert.ok(
    d._errors.some((l) => l.includes("guestList")),
    "expected the failed arm name in the error output",
  );
  // reverse assertion: the dangerous rollback command must be GONE.
  assert.ok(
    !allOut.includes("flyctl releases rollback"),
    "must NOT suggest `flyctl releases rollback` (reviving auto-recognition)",
  );
  assert.ok(!/rollback/.test(allOut), "must not mention rollback at all on the red path");
  // forward-fix directive + machine-recognizable marker + v811 prohibition present.
  assert.ok(d._errors.some((l) => l.includes("forward-fix")), "expected a forward-fix directive");
  assert.ok(
    d._errors.some((l) => l.includes("不得回退 v811")),
    "expected the '不得回退 v811' prohibition",
  );
  assert.ok(
    allOut.includes("DEPLOYED_UNVERIFIED"),
    "verification-red output must contain the machine-recognizable DEPLOYED_UNVERIFIED marker",
  );
  // and the final summary must NOT read as a clean success.
  assert.ok(
    !d._logs.some((l) => l.includes("deploy complete")),
    "must not print 'deploy complete' when verification failed",
  );
});

// B1.2(Codex 6.6 P0):/health 非 ok 是第二個「驗證紅」入口 —— 同樣走 forward-fix,
// 不建議 rollback,並印 DEPLOYED_UNVERIFIED(不得只印 deploy complete)。
test("health RED (exit 0): /health overall!='ok' → NO rollback; DEPLOYED_UNVERIFIED + forward-fix + 不得回退 v811", async () => {
  const d = makeDeps({
    healthResult: { overall: "degraded", checks: { db: { status: "fail" } } },
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0); // deploy already happened; verification-red doesn't flip exit code
  const allOut = [...d._errors, ...d._logs].join("\n");
  assert.ok(!allOut.includes("flyctl releases rollback"), "no rollback command on health-red");
  assert.ok(!/rollback/.test(allOut), "no rollback mention on health-red");
  assert.ok(allOut.includes("DEPLOYED_UNVERIFIED"), "health-red must print DEPLOYED_UNVERIFIED");
  assert.ok(d._errors.some((l) => l.includes("forward-fix")), "health-red must print forward-fix");
  assert.ok(
    d._errors.some((l) => l.includes("不得回退 v811")),
    "health-red must print '不得回退 v811'",
  );
  assert.ok(
    !d._logs.some((l) => l.includes("deploy complete")),
    "must not print 'deploy complete' when health verification failed",
  );
});

// 綠路徑對照:驗證全過時仍印 deploy complete、且完全不出現 DEPLOYED_UNVERIFIED。
test("verification GREEN: health ok + smoke ok → prints 'deploy complete', no DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    smokeResult: { ok: true, arms: [{ name: "customerList", ok: true }] },
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  const allOut = [...d._errors, ...d._logs].join("\n");
  assert.ok(d._logs.some((l) => l.includes("deploy complete")), "green path prints deploy complete");
  assert.ok(!allOut.includes("DEPLOYED_UNVERIFIED"), "green path must not print DEPLOYED_UNVERIFIED");
});

// ---- Wave2 塊 B: 閘 6.5 SQL 彩排 wiring ----

test("rehearsal PASS: rehearse ok → 通過 6.5,續往 token/deploy", async () => {
  const d = makeDeps(); // 預設 rehearse 回 ok
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(d._calls.includes("rehearse()"), true);
  assert.equal(reachedDeploy(d), true);
  assert.ok(
    d._logs.some((l) => l.includes("SQL 彩排通過")),
    "expected a pass line for the rehearsal gate",
  );
});

test("rehearsal BLOCK: EXPLAIN 失敗 → exit 1、不部署、列出失敗 key", async () => {
  const d = makeDeps({
    rehearseResult: {
      ok: false,
      total: 42,
      passed: 41,
      failures: [{ key: "adminCustomers.badQuery", source: "server/routers/adminCustomers.ts:512", error: "Unknown column 'x'" }],
    },
  });
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), false); // 擋在部署前
  assert.ok(
    d._errors.some((l) => l.includes("adminCustomers.badQuery")),
    "expected the failing entry key in the block message",
  );
});

test("rehearsal BLOCK: 通道失敗(flyctl 連不上)→ exit 1、附逃生口 SKIP_SQL_REHEARSAL", async () => {
  const d = makeDeps({
    rehearseResult: { ok: false, channelError: "flyctl ssh 通道失敗:connection refused", total: 42, passed: 0, failures: [] },
  });
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), false);
  assert.ok(
    d._errors.some((l) => l.includes("SKIP_SQL_REHEARSAL=1")),
    "channel failure must print the escape-hatch instruction",
  );
});

test("rehearsal BLOCK: orchestrator 起不來(tsx crash)→ exit 1、附逃生口", async () => {
  const d = makeDeps({ rehearseThrow: true });
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), false);
  assert.ok(
    d._errors.some((l) => l.includes("SKIP_SQL_REHEARSAL=1")),
    "startup failure must print the escape-hatch instruction",
  );
});

test("SKIP_SQL_REHEARSAL=1 跳過彩排(完全不呼叫 rehearse)但仍部署", async () => {
  const d = makeDeps({ env: { DEPLOY_TOKEN: "good-token", SKIP_SQL_REHEARSAL: "1" } });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(d._calls.includes("rehearse()"), false); // 完全沒被呼叫
  assert.equal(reachedDeploy(d), true);
  assert.ok(
    d._logs.some((l) => l.includes("SKIP_SQL_REHEARSAL=1")),
    "expected a skip announcement line",
  );
});

// ---- B1.2 塊 6.9: 外部審查閘(AI 交流索引 待傳/待裁定/退回)wiring ----
//
// 真實索引 00_索引.md 是 markdown 表格「| 日期 | 輪 | 去/回 | 摘要 | 檔案 | 狀態 |」。
// 閘只比對「狀態欄」(每列以 | 切割後最後一個非空 cell),不比對整行 —— 否則歷史列的
// 摘要欄字樣(如「證據保全狀態退回」)會讓已結案列永久命中、閘永久紅。下列 fixtures 一律
// 用表格列形式,marker 放在狀態欄才算未結。

// 表格 fixture 小工具:表頭 + 分隔列 + 資料列(status 為狀態欄)。
const idxTable = (...rows) =>
  "| 日期 | 輪次 | 方向 | 主題 | 檔案 | 狀態 |\n" +
  "|---|---|---|---|---|---|\n" +
  rows.map((r) => `| ${r.date ?? "2026-07-12"} | ${r.round ?? "6"} | ${r.dir ?? "回"} | ${r.summary ?? "主題"} | ${r.file ?? "Codex/2026-07-12.md"} | ${r.status} |`).join("\n") +
  "\n";

test("review-gate BLOCK: 狀態欄含 待裁定 → exit 1, 不部署, 列出命中行", async () => {
  const d = makeDeps({
    reviewIndex: idxTable({ summary: "運行證據複核(iCloud/migrator/A3)", status: "待傳待裁定" }),
  });
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), false); // 擋在 token/部署之前
  assert.ok(
    d._errors.some((l) => l.includes("待裁定") && l.includes("外部審查未結")),
    "expected the block message to name the unresolved review marker",
  );
});

test("review-gate BLOCK: 狀態欄含 ★待傳 → exit 1", async () => {
  const d = makeDeps({ reviewIndex: idxTable({ summary: "四異議全採+在飛證據清單", status: "★待傳" }) });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

test("review-gate BLOCK: 狀態欄含 退回 → exit 1", async () => {
  const d = makeDeps({ reviewIndex: idxTable({ summary: "Codex 第7輪前台重設計", status: "退回重做" }) });
  assert.equal(await runGuard(d, {}), 1);
  assert.equal(reachedDeploy(d), false);
});

// 對照 case a(本次缺陷回歸測試):摘要欄含「退回」但狀態欄乾淨(已結案)→ 不擋。
// 這正是真實索引 L21「證據保全狀態退回|已裁定(全採)」與 L34「…退回B1.2|已收裁定接受」
// 的形狀:整行比對會誤擋,狀態欄比對才正確放行。
test("review-gate PASS(回歸): 摘要欄含 退回 但狀態欄乾淨(已結案)→ 不擋、續往部署", async () => {
  const d = makeDeps({
    reviewIndex: idxTable(
      { round: "4.5", summary: "四項收斂+證據保全狀態退回", file: "Codex/2026-07-11.md", status: "已裁定(全採)" },
      { round: "6.6", summary: "unsafe rollback與錯誤oracle退回B1.2", status: "已收裁定接受" },
    ),
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(reachedDeploy(d), true);
  assert.ok(
    d._logs.some((l) => l.includes("外部審查索引無")),
    "摘要欄的『退回』不得觸發閘;狀態欄乾淨應過閘",
  );
});

// 對照 case b:同樣的字面 marker,一旦落在狀態欄就必須擋(與 case a 成對釘死語義)。
test("review-gate BLOCK(對照): marker 落在狀態欄(★待傳)→ 擋", async () => {
  const d = makeDeps({
    reviewIndex: idxTable({ round: "4", dir: "去", summary: "四異議全採+在飛證據清單", file: "Claude/2026-07-11.md", status: "★待傳" }),
  });
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), false);
});

test("review-gate BLOCK: index 檔案不存在(null)→ fail-closed exit 1 + 附逃生口", async () => {
  const d = makeDeps({ reviewIndex: null }); // 模擬桌面索引檔讀不到
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), false);
  assert.ok(
    d._errors.some((l) => l.includes("SKIP_REVIEW_GATE=1")),
    "missing-index fail-closed must print the escape-hatch instruction",
  );
});

test("review-gate SKIP: SKIP_REVIEW_GATE=1 → 略過(附風險警語)仍部署", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", SKIP_REVIEW_GATE: "1" },
    reviewIndex: null, // 即使索引讀不到,逃生口也放行
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(reachedDeploy(d), true);
  assert.ok(
    d._logs.some((l) => l.includes("SKIP_REVIEW_GATE=1")),
    "expected a skip announcement line with the risk note",
  );
});

test("review-gate PASS: 乾淨索引(無 待傳/待裁定/退回)→ 過閘、續往部署", async () => {
  const d = makeDeps(); // 預設 reviewIndex 乾淨
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.equal(reachedDeploy(d), true);
  assert.ok(
    d._logs.some((l) => l.includes("外部審查索引無")),
    "expected a pass line for the review gate",
  );
});
