/**
 * Tests for the deploy guard. Uses Node's built-in test runner so it needs no
 * vitest config wiring:
 *
 *   node --test scripts/safe-deploy.test.mjs
 *
 * Every side effect is faked via the injected `deps`, so NOTHING here touches
 * real git / tsc / vitest / flyctl / the network. The "all green" case asserts
 * the guard *reaches* the flyctl call (recorded by the fake) without running it.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { runGuard } from "./safe-deploy.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_SHA = "aabbccddeeff00112233445566778899aabbccdd";

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
    // 1A0a build marker:host 端唯一 sha 真值源(Docker context 無 .git)
    if (cmd.includes("rev-parse HEAD")) return (state.headSha ?? DEFAULT_SHA) + "\n";
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
    // audit-chain-repair R5-2 — 機器一致性 + 鏈錨定 fakes。記 "machines()" /
    // "epochAnchor()" 呼叫標記,讓測試能斷言「token 未設 / 機器不一致時絕不錨定」。
    machines: () => {
      calls.push("machines()");
      return (
        state.machinesResult ?? [
          {
            state: "started",
            image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          },
        ]
      );
    },
    // R7-1:最新 release 物件 fake(真形狀:Status + ImageRef 全名 ref)
    releaseImage: () => {
      calls.push("releaseImage()");
      if (state.releaseImageThrow) throw new Error("no releases");
      return state.releaseImageResult ?? { Status: "complete", ImageRef: "registry.fly.io/packgo-travel:deployment-NEW" };
    },
    // R9-1:registry manifest HEAD fake —— 回「真形狀」原始回應(status line +
    // headers 全文),production 用共用純函式 parseRegistryDigestHeaders 解析。
    registryManifestHead: (repository, tag) => {
      calls.push(`registryManifestHead(${repository}:${tag})`);
      if (state.registryHeadThrow) throw new Error("curl failed");
      return (
        state.registryHeadResult ??
        "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ncontent-length: 856\r\ndocker-content-digest: sha256:" + "a".repeat(64) + "\r\ndate: Sun, 19 Jul 2026 21:00:00 GMT\r\n\r\n"
      );
    },
    epochAnchor: () => {
      calls.push("epochAnchor()");
      return (
        state.epochAnchorResult ?? {
          ensure: "written",
          verify: { ok: true, epochStartId: 1000, epochCount: 1, legacyRows: 337, anomalyCount: 0 },
          anchor: { id: 1000, rowHash: "a".repeat(64) },
        }
      );
    },
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

// ---- 1A0a build marker(finance plan v4.3 §3.2.9 / Codex 7-18 返工單 1)----

test("build marker: deploy 指令帶 --build-arg GIT_SHA=<host HEAD 完整 40-hex>(exact)", async () => {
  const d = makeDeps();
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  const deployCall = d._calls.find((c) => c.includes("flyctl deploy"));
  assert.ok(deployCall, "expected a flyctl deploy call");
  assert.ok(
    deployCall.includes(`--build-arg GIT_SHA=${DEFAULT_SHA}`),
    `deploy command must carry the exact approved HEAD sha; got: ${deployCall}`,
  );
});

test("build marker: dry-run 同步顯示 build-arg(Jeff 部署前可肉眼核 sha)", async () => {
  const d = makeDeps();
  const code = await runGuard(d, { dryRun: true });
  assert.equal(code, 0);
  assert.ok(
    d._logs.some((l) => l.includes(`--build-arg GIT_SHA=${DEFAULT_SHA}`)),
    "dry-run output must show the exact build-arg",
  );
});

test("build marker: sha 取自 host `git rev-parse HEAD`(Docker context 無 .git 仍產有效 marker 的契約)", async () => {
  const d = makeDeps();
  await runGuard(d, {});
  assert.ok(
    d._calls.some((c) => c.includes("git rev-parse HEAD")),
    "sha must come from host git — the build container has no .git (.dockerignore)",
  );
});

test("build marker: 非法 sha(如 'unknown')→ fail,不得進可部署 artifact", async () => {
  const d = makeDeps({ headSha: "unknown" });
  const code = await runGuard(d, {});
  assert.equal(code, 1);
  assert.equal(reachedDeploy(d), false);
});

// ---- 1A0a Docker build-marker 接線契約(Codex 7-18 P2-3)----
// 真正的產物契約:Docker context 無 .git,marker 必須靠 build-arg 注入。
// 這組讀 Dockerfile + vite.config.ts 斷言接線,刪 ARG/ENV GIT_SHA 或斷開 vite
// define 會使其中一條紅——不再只證 host git rev-parse。

test("Dockerfile: ARG GIT_SHA + ENV GIT_SHA 存在且在 `RUN pnpm build` 之前(container 無 .git,靠 build-arg)", () => {
  const df = readFileSync(join(ROOT, "Dockerfile"), "utf8");
  const argIdx = df.search(/ARG\s+GIT_SHA/);
  const envIdx = df.search(/ENV\s+GIT_SHA=\$GIT_SHA/);
  const buildIdx = df.search(/RUN\s+pnpm\s+build/);
  assert.ok(argIdx > -1, "Dockerfile must declare ARG GIT_SHA");
  assert.ok(envIdx > -1, "Dockerfile must set ENV GIT_SHA=$GIT_SHA");
  assert.ok(buildIdx > -1, "Dockerfile must RUN pnpm build");
  assert.ok(argIdx < buildIdx && envIdx < buildIdx, "GIT_SHA ARG/ENV must precede the Vite build");
});

test(".dockerignore excludes .git (證明 container 內 git rev-parse 不可用,marker 必須來自 build-arg)", () => {
  const di = readFileSync(join(ROOT, ".dockerignore"), "utf8");
  assert.match(di, /^\.git$/m, ".dockerignore must exclude .git");
});

test("vite.config.ts: __BUILD_SHA__ define 讀 process.env.GIT_SHA(build-arg → ENV → define 全鏈接上)", () => {
  const vc = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
  assert.match(vc, /__BUILD_SHA__/, "vite define must expose __BUILD_SHA__");
  assert.match(vc, /process\.env\.GIT_SHA/, "vite define must read process.env.GIT_SHA");
  // 空字串也要退 fallback(Docker ARG 預設 ""):不得用 `?? ` 讓 "" 漏成 marker
  assert.ok(!/process\.env\.GIT_SHA\s*\?\?/.test(vc), "must not use `?? ` (empty string would leak as marker); use `||`");
});

// ---- 1A0a 真產物契約(Codex 7-18 15:56 窄修 4)----------------------------
// 上面三條只讀檔;15:56 P2-1 的反例:註解掉 ARG/ENV 或把 marker 強制 unknown,
// regex 條可被繞過而 39/39 仍綠。本條做「實際無 .git context 的產物 build」:
//
// 1. 依 .dockerignore 把 working tree 複製成 Docker build context 模擬
//    (無 .git、無 node_modules、無 dist —— 與 remote builder 收到的 context 同構)。
// 2. 解析 Dockerfile:只有當 ARG GIT_SHA + ENV GIT_SHA=$GIT_SHA 以未註解形式存在
//    且在 RUN pnpm build 之前,GIT_SHA 才會像 --build-arg 一樣進入 build 環境。
//    → 註解/刪除 ARG 或 ENV ⇒ build 收不到 sha ⇒ bundle 無 sha ⇒ 本條紅。
// 3. 在 context 內跑 Dockerfile 同款 `pnpm build`,掃 dist/public 產物:
//    exact 40-hex HEAD sha 必須在 client bundle 內。
//    → vite 強制 unknown ⇒ sha 不在 bundle ⇒ 本條紅。
//
// 與真 Docker 的兩點誠實差異(本機/終驗沙箱無 Docker CLI):
// - node_modules 以 symlink 借用 host 安裝(容器內是 pnpm install;受測契約是
//   marker 注入鏈,不是依賴解析)。
// - build env 以 GIT_DIR=<ctx>/.git(已斷言不存在)+ GIT_CEILING_DIRECTORIES=
//   dirname(ctx) 封死 git repo 探索:ctx 內無 .git、GIT_DIR 指向不存在路徑、
//   ceiling 擋祖先向上逃逸(注意 ceiling 只擋「嚴格祖先」,設 ctx 自身是 no-op,
//   故必須設 dirname(ctx))。三層合起來 = 容器內「無任何 repo 可找」的忠實模擬,
//   即使 ctx 落在 EPERM fallback(node_modules/.cache,位於 host worktree 內)
//   或外層 shell 洩漏 GIT_DIR/GIT_WORK_TREE,vite 的 git fallback 也必然失敗。
// 負斷言用「sha 不在產物」表達:兩個指定突變(停用 ARG/ENV、強制 unknown)都
// 收斂成 sha 缺席;直接掃 "unknown" 字樣會誤中 minified 第三方碼,不承重。

test("真產物契約:無 .git context build 後 dist/public 含 exact HEAD sha(停用 ARG/ENV 或強制 unknown 必紅)", () => {
  const sha = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/, "host HEAD 必須是完整 40-hex(safe-deploy 的 sha 真值源)");

  // Dockerfile 接線決定 build env 是否拿得到 GIT_SHA(未註解行才算數)
  const dfLines = readFileSync(join(ROOT, "Dockerfile"), "utf8")
    .split("\n")
    .map((l) => l.trim());
  const argIdx = dfLines.findIndex((l) => /^ARG\s+GIT_SHA\b/.test(l));
  const envIdx = dfLines.findIndex((l) => /^ENV\s+GIT_SHA=\$GIT_SHA\b/.test(l));
  const buildIdx = dfLines.findIndex((l) => /^RUN\s+pnpm\s+build\b/.test(l));
  const wired =
    argIdx !== -1 && envIdx !== -1 && buildIdx !== -1 && argIdx < buildIdx && envIdx < buildIdx;

  // .dockerignore → 排除規則(rooted、* 不跨 /;略過 ! 重納入 —— 只會縮小 context,
  // 縮小不可能偽造 marker,fail-safe)
  const patterns = readFileSync(join(ROOT, ".dockerignore"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((p) => (p.endsWith("/") ? p.slice(0, -1) : p));
  const patRes = patterns.map(
    (p) =>
      new RegExp(
        "^" +
          p
            .split("/")
            .map((seg) =>
              seg
                .split("")
                .map((ch) => (ch === "*" ? "[^/]*" : ch === "?" ? "[^/]" : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
                .join(""),
            )
            .join("/") +
          "(/|$)",
      ),
  );
  const excluded = (rel) => patRes.some((re) => re.test(rel));

  // context 目錄:優先系統 temp;唯讀沙箱 EPERM 時退 node_modules/.cache(untracked,
  // 不污染 worktree)
  let ctx;
  try {
    ctx = mkdtempSync(join(tmpdir(), "packgo-docker-ctx-"));
  } catch {
    ctx = join(ROOT, "node_modules", ".cache", `packgo-docker-ctx-${process.pid}`);
    rmSync(ctx, { recursive: true, force: true });
    mkdirSync(ctx, { recursive: true });
  }

  try {
    cpSync(ROOT, ctx, {
      recursive: true,
      filter: (src) => {
        const rel = relative(ROOT, src).split(sep).join("/");
        if (rel === "") return true;
        return !excluded(rel);
      },
    });

    // context 必須真的無 .git —— 這是「marker 只能來自 build-arg」的前提
    assert.ok(!existsSync(join(ctx, ".git")), "Docker context 模擬不得含 .git");
    assert.ok(existsSync(join(ctx, "vite.config.ts")), "context 應含 build 所需源碼");

    // 容器內是 pnpm install;host 已裝好的 node_modules 直接借用(見上方誠實差異)
    symlinkSync(join(ROOT, "node_modules"), join(ctx, "node_modules"));

    execSync("pnpm build", {
      cwd: ctx,
      stdio: "pipe",
      timeout: 600_000,
      maxBuffer: 1 << 28,
      env: {
        ...process.env,
        // Dockerfile 接線斷了 ⇒ 模擬 --build-arg 傳了也到不了 build step
        GIT_SHA: wired ? sha : "",
        // 容器內無 repo 的三層忠實模擬(見上方註解):GIT_DIR 指向 ctx 內不存在
        // 的 .git(蓋掉外層任何 GIT_DIR/GIT_WORK_TREE 洩漏),ceiling 設父目錄
        // 擋祖先探索(設 ctx 自身無效 —— ceiling 只擋嚴格祖先)。
        GIT_DIR: join(ctx, ".git"),
        GIT_WORK_TREE: ctx,
        GIT_CEILING_DIRECTORIES: dirname(ctx),
      },
    });

    // 掃 client bundle(dist/public):exact sha 必須出現
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(js|mjs|html)$/.test(name) && readFileSync(p, "utf8").includes(sha)) hits.push(p);
      }
    };
    const clientOut = join(ctx, "dist", "public");
    assert.ok(existsSync(clientOut), "pnpm build 應產出 dist/public(client bundle)");
    walk(clientOut);
    assert.ok(
      hits.length >= 1,
      `client bundle 必須含 exact HEAD sha ${sha}(Dockerfile 接線 wired=${wired});` +
        "停用 ARG/ENV GIT_SHA 或把 vite marker 強制 unknown 都會在此紅",
    );
  } finally {
    // 先拆 symlink 再清目錄:絕不可跟進 symlink 動到真 node_modules
    try { unlinkSync(join(ctx, "node_modules")); } catch { /* 未建立時忽略 */ }
    rmSync(ctx, { recursive: true, force: true });
  }
});

// ---- audit-chain-repair R5-2:部署後鏈錨定契約 ----
// 錨定「絕不」在 startup;safe-deploy 證實所有機器同一新 release 後才打端點;
// token / 機器證明 / 端點回應任一缺 → DEPLOYED_UNVERIFIED,且該情況下不得錨定。

const anchorCalled = (d) => d._calls.includes("epochAnchor()");

test("epoch GREEN: token 設 + 機器一致 + 錨定全綠 → machines→epochAnchor 都跑,印首錨憑證,無 DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({ env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" } });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.ok(d._calls.includes("machines()"), "machines consistency proof ran");
  assert.ok(anchorCalled(d), "epoch anchor called");
  assert.ok(d._logs.some((l) => l.includes("首錨憑證") && l.includes("rowHash=" + "a".repeat(64))));
  assert.ok(!d._errors.some((l) => l.includes("鏈錨定") && l.includes("DEPLOYED_UNVERIFIED")));
});

test("epoch BLOCK: LOCAL_SCRIPT_TOKEN 未設 → 不錨定 + DEPLOYED_UNVERIFIED(不同於煙霧的軟跳過)", async () => {
  const d = makeDeps(); // token unset
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false);
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("鏈錨定無法執行")));
});

test("epoch BLOCK: 機器 image 不一致(rolling 未退場)→ 絕不呼叫錨定端點 + DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-OLD", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false, "must NOT anchor while old release machines are alive");
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("未全數以 immutable digest 綁定")));
});

test("epoch BLOCK: 錨定端點回 verify.ok=false → DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "exists",
      verify: { ok: false, epochStartId: 1000, epochCount: 1, legacyRows: 337, anomalyCount: 2 },
      anchor: { id: 1000, rowHash: "aabb" },
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("鏈錨定/驗證未全綠")));
});

test("epoch BLOCK: epochCount=2(重錨警訊)→ DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "exists",
      verify: { ok: true, epochStartId: 2000, epochCount: 2, legacyRows: 400, anomalyCount: 0 },
      anchor: { id: 2000, rowHash: "ccdd" },
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("epochCount=2")));
});

test("epoch BLOCK: ensure=failed(錨列沒落地)→ DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "failed",
      verify: { ok: false, epochStartId: null, epochCount: 0, legacyRows: 0, anomalyCount: 287 },
      anchor: null,
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("ensure=failed")));
});

test("epoch DRY-RUN: 不部署也不錨定(machines/epochAnchor 都不跑)", async () => {
  const d = makeDeps({ env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" } });
  await runGuard(d, { dryRun: true });
  assert.equal(d._calls.includes("machines()"), false);
  assert.equal(anchorCalled(d), false);
});

// ---- R6-2:image 綁定 + 回應形狀嚴格判準 ----

test("epoch BLOCK(R6-2): 全部機器都是舊 image(old-only)→ 不錨定 + DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageResult: { Status: "complete", ImageRef: "registry.fly.io/packgo-travel:deployment-NEW" },
    machinesResult: [{ state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-OLD", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } }],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false, "old-only machines must never anchor");
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("未全數以 immutable digest 綁定")));
});

test("epoch BLOCK(R6-2): 新機 started + 舊機 stopping(過渡)→ 不錨定", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageResult: { Status: "complete", ImageRef: "registry.fly.io/packgo-travel:deployment-NEW" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
      { state: "stopping", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-OLD", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false, "transitional old machine must block anchoring");
});

test("epoch BLOCK(R6-2): releaseImage 取不到(fail-closed)→ 不錨定 + DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageThrow: true,
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false);
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("鏈錨定步驟失敗")));
});

test("epoch BLOCK(R6-2): anchor 缺 id(malformed)→ DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "exists",
      verify: { ok: true, epochStartId: 1000, epochCount: 1, legacyRows: 337, anomalyCount: 0 },
      anchor: { rowHash: "a".repeat(64) }, // 缺 id
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("鏈錨定/驗證未全綠")));
});

test("epoch BLOCK(R6-2): anchor.id 與 epochStartId 不一致 → DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "exists",
      verify: { ok: true, epochStartId: 1000, epochCount: 1, legacyRows: 337, anomalyCount: 0 },
      anchor: { id: 999, rowHash: "a".repeat(64) },
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("anchorId=999")));
});

test("epoch BLOCK(R6-2): rowHash 非 64-hex → DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "exists",
      verify: { ok: true, epochStartId: 1000, epochCount: 1, legacyRows: 337, anomalyCount: 0 },
      anchor: { id: 1000, rowHash: "not-a-hash" },
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("hash64hex=false")));
});

test("epoch BLOCK(R6-2): epochStartId=null → DEPLOYED_UNVERIFIED(不因 anchor null 而放行)", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "written",
      verify: { ok: true, epochStartId: null, epochCount: 0, legacyRows: 0, anomalyCount: 0 },
      anchor: null,
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("鏈錨定/驗證未全綠")));
});

test("epoch BLOCK(R6-2): 殘留異常(anomalyCount>0)→ DEPLOYED_UNVERIFIED", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    epochAnchorResult: {
      ensure: "exists",
      verify: { ok: true, epochStartId: 1000, epochCount: 1, legacyRows: 337, anomalyCount: 3 },
      anchor: { id: 1000, rowHash: "a".repeat(64) },
    },
  });
  await runGuard(d, {});
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("anomalies=3")));
});

// ---- R7-1:image identity 正規化五組 ----

test("R7-1 GREEN: 真實形狀 —— release ImageRef 帶 @sha256 後綴 + machine digest 相符 → 錨定執行", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageResult: { Status: "complete", ImageRef: "registry.fly.io/packgo-travel:deployment-NEW@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    // machines 預設:同 tag deployment-NEW、digest sha256:samedigest → 相符
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.ok(anchorCalled(d), "normalized identities must match and anchor");
  assert.ok(!d._errors.some((l) => l.includes("未全數以 immutable digest 綁定")));
});

test("R7-1 BLOCK: 同 digest 但 state=stopping 的機器 → 擋(同 image 過渡機不放行)", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
      { state: "stopping", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false, "same-digest transitional machine must still block");
  assert.ok(d._errors.some((l) => l.includes("未全數以 immutable digest 綁定")));
});

test("R7-1 BLOCK: unknown state 機器 → 擋", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
      { state: "replacing", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false);
});

test("R7-1 BLOCK: 舊 digest(release 帶 digest、machine digest 不符)→ 擋", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageResult: { Status: "complete", ImageRef: "registry.fly.io/packgo-travel:deployment-NEW@sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false);
});

test("R7-1 BLOCK: 最新 release 非 complete → fail-closed 擋(不錨定)", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageResult: { Status: "pending", ImageRef: "registry.fly.io/packgo-travel:deployment-NEW" },
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false);
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("鏈錨定步驟失敗")));
});

// ---- R8-1:immutable digest 綁定五組 ----

const D64A = "sha256:" + "a".repeat(64);
const D64B = "sha256:" + "b".repeat(64);

test("R8-1 GREEN: tag-only release → 權威解析 tag→digest,machines digest exact 相等 → 錨定", async () => {
  const d = makeDeps({ env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" } });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.ok(d._calls.some((c) => String(c).startsWith("registryManifestHead(packgo-travel:deployment-NEW")), "tag-only must resolve digest from registry authority");
  assert.ok(anchorCalled(d));
});

test("R8-1 BLOCK: tag-only 且解析出的 digest 與 machines 不符 → 擋(machines 彼此一致也不放行)", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    registryHeadResult: "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64B + "\r\n\r\n", // 權威(registry)說 B,machines 全是 A(彼此一致)
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false, "mutually-consistent but wrong digest must block");
  assert.ok(d._errors.some((l) => l.includes("未全數以 immutable digest 綁定")));
});

test("R8-1 BLOCK: tag-only 且 digest 解析不到 → fail-closed 擋", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    registryHeadThrow: true,
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false);
  assert.ok(d._errors.some((l) => l.includes("DEPLOYED_UNVERIFIED") && l.includes("鏈錨定步驟失敗")));
});

test("R8-1 BLOCK: malformed digest(sha256: 空值/非 64-hex)→ 擋", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: "sha256:" } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false, "sha256: empty digest must not pass");
});

test("R8-1 GREEN: tagless machine object(只有 registry/repository/digest,無 tag)→ digest 相符即合格,不 false-red", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", digest: D64A } },
    ],
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.ok(anchorCalled(d), "tagless-but-matching-digest machine must not false-red");
});

test("R8-1 BLOCK: mixed digest(一台 A 一台 B)→ 擋", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: D64A } },
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-NEW", digest: D64B } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false);
});

// ---- R9-1:parseRegistryDigestHeaders 真形狀 fixture(共用 production 純函式)----
import { parseRegistryDigestHeaders } from "./safe-deploy.mjs";

test("R9-1 parser: 真形狀 200 回應(HTTP/2 + OCI headers)→ 解析出 64-hex digest", () => {
  const fixture =
    "HTTP/2 200 \r\n" +
    "content-type: application/vnd.oci.image.index.v1+json\r\n" +
    "docker-distribution-api-version: registry/2.0\r\n" +
    "docker-content-digest: sha256:" + "9c".repeat(32) + "\r\n" +
    "content-length: 856\r\n" +
    "date: Sun, 19 Jul 2026 21:00:00 GMT\r\n\r\n";
  assert.equal(parseRegistryDigestHeaders(fixture), "sha256:" + "9c".repeat(32));
});

test("R9-1 parser: 401 未授權 → throw(fail-closed,不猜)", () => {
  const fixture = "HTTP/2 401 \r\nwww-authenticate: Basic realm=\"registry\"\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /not 200/);
});

test("R9-1 parser: 200 但缺 docker-content-digest → throw", () => {
  const fixture = "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /exactly one valid docker-content-digest/);
});

test("R9-1 parser: 307 redirect → throw(不跟隨,不接受非 200)", () => {
  const fixture = "HTTP/1.1 307 Temporary Redirect\r\nlocation: https://elsewhere/\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /not 200/);
});

test("R9-1 parser: digest 非 64-hex(截斷)→ throw", () => {
  const fixture = "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: sha256:abc123\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /exactly one valid docker-content-digest/);
});

// ---- R10-1:tag 大小寫保留 + parser terminal-block 嚴格化 ----

test("R10-1 GREEN: uppercase ULID tag(Fly 真形狀 deployment-01JHZ…)→ registry 查詢用原大小寫 tag", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageResult: { Status: "complete", ImageRef: "registry.fly.io/packgo-travel:deployment-01JHZXK7M9QRSTUVWX" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-01JHZXK7M9QRSTUVWX", digest: D64A } },
    ],
  });
  const code = await runGuard(d, {});
  assert.equal(code, 0);
  assert.ok(
    d._calls.includes("registryManifestHead(packgo-travel:deployment-01JHZXK7M9QRSTUVWX)"),
    `exact-case tag must reach registry; calls=${d._calls.filter((c) => String(c).startsWith("registry"))}`,
  );
  assert.ok(anchorCalled(d));
});

test("R10-1 BLOCK: machine tag 與 release tag 大小寫不同(不同 tag)→ 擋", async () => {
  const d = makeDeps({
    env: { DEPLOY_TOKEN: "good-token", LOCAL_SCRIPT_TOKEN: "script-token" },
    releaseImageResult: { Status: "complete", ImageRef: "registry.fly.io/packgo-travel:deployment-01JHZABC" },
    machinesResult: [
      { state: "started", image_ref: { registry: "registry.fly.io", repository: "packgo-travel", tag: "deployment-01jhzabc", digest: D64A } },
    ],
  });
  await runGuard(d, {});
  assert.equal(anchorCalled(d), false, "case-mismatched tag is a different OCI tag — must block");
});

test("R10-1 parser: proxy CONNECT 200 + origin 401 → 只認 terminal block,throw", () => {
  const fixture =
    "HTTP/1.1 200 Connection established\r\n\r\n" +
    "HTTP/2 401 \r\nwww-authenticate: Basic realm=\"registry\"\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /terminal response not 200/);
});

test("R10-1 parser: proxy CONNECT 200 + origin 200 合法 → 取 terminal digest", () => {
  const fixture =
    "HTTP/1.1 200 Connection established\r\n\r\n" +
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64A + "\r\n\r\n";
  assert.equal(parseRegistryDigestHeaders(fixture), D64A);
});

test("R10-1 parser: 兩個衝突 digest → throw(必須恰好一個)", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\n" +
    "docker-content-digest: " + D64A + "\r\ndocker-content-digest: " + D64B + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /exactly one valid/);
});

test("R10-1 parser: text/html + digest → throw(media type 不是 manifest)", () => {
  const fixture = "HTTP/2 200 \r\ncontent-type: text/html\r\ndocker-content-digest: " + D64A + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /not a manifest media type/);
});

// ---- R11-1:Content-Type cardinality ----

test("R11-1 parser: 重複衝突 Content-Type(合法在前 + text/html 在後)→ throw", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ncontent-type: text/html\r\ndocker-content-digest: " + D64A + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /exactly one content-type/);
});

test("R11-1 parser: 重複衝突 Content-Type(text/html 在前 + 合法在後)→ throw", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: text/html\r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64A + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /exactly one content-type/);
});

test("R11-1 parser: 重複相同 Content-Type → 一樣拒(cardinality 恰一)", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64A + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /exactly one content-type/);
});

// ---- R12-1:obs-fold framing ----

test("R12-1 parser: mixed-case header 名(Content-Type/Docker-Content-Digest)→ 綠", () => {
  const fixture =
    "HTTP/2 200 \r\nContent-Type: application/vnd.oci.image.index.v1+json\r\nDocker-Content-Digest: " + D64A + "\r\n\r\n";
  assert.equal(parseRegistryDigestHeaders(fixture), D64A);
});

test("R12-1 parser: folded value(值折行)→ 拒", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\n \tfolded-part\r\ndocker-content-digest: " + D64A + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /obs-fold/);
});

test("R12-1 parser: obs-fold 藏第二 Content-Type → 拒(不得假綠)", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\n content-type: text/html\r\ndocker-content-digest: " + D64A + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /obs-fold/);
});

test("R12-1 parser: obs-fold 藏第二 digest → 拒", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64A + "\r\n docker-content-digest: " + D64B + "\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /obs-fold/);
});

// ---- R13-1:raw framing(不得 trim 吞尾端純空白折行)----

test("R13-1 parser: terminal 尾端純 SP continuation → 拒(trim 不得吞掉)", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64A + "\r\n \r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /obs-fold/);
});

test("R13-1 parser: terminal 尾端純 HTAB continuation → 拒", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64A + "\r\n\t\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /obs-fold/);
});

test("R13-1 parser: 尾端 SP+HTAB continuation → 拒", () => {
  const fixture =
    "HTTP/2 200 \r\ncontent-type: application/vnd.oci.image.index.v1+json\r\ndocker-content-digest: " + D64A + "\r\n \t\r\n\r\n";
  assert.throws(() => parseRegistryDigestHeaders(fixture), /obs-fold/);
});
