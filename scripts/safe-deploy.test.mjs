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
    deleteApprove: () => {
      deleted++;
    },
    deleteErrorLog: () => {
      errorLogDeleted++;
    },
    listMigrations: () => ["0086_supplier_cost", "0087_booking_consent"],
    health: () => ({ overall: "ok", checks: { db: { status: "ok", latencyMs: 1 } } }),
    log: () => {},
    error: () => {},
    _calls: calls,
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
