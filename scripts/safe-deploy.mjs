#!/usr/bin/env node
/**
 * safe-deploy.mjs — PACK&GO 部署前硬擋 (deploy guard)
 *
 * 唯一被授權的 prod 部署路徑。任何 session（含 AI）禁止直接呼叫 `flyctl deploy`。
 * 依序硬擋；任一不過即 console.error + exit(1) 拒絕部署。
 *
 *   pnpm deploy              # 真部署（需 Jeff 放 .deploy-approve 一次性 token）
 *   pnpm deploy --dry-run    # 跑完所有 gate，但不真的 flyctl deploy（吃自己的狗糧驗證用）
 *
 * Gate 順序：
 *   1. 分支必須是 main
 *   2. working tree 必須乾淨（擋掉 wip 半成品 / 未提交 migration）
 *   3. git fetch；本機不可落後 origin/main（避免推舊的）
 *   4. 列出這次 build 內的 migration（可見性）
 *   5. NODE_OPTIONS=--max-old-space-size=6144 tsc --noEmit 必須 0 錯
 *   6. vitest（SKIP_DEPLOY_TESTS=1 可略過，預設要跑）
 *   7. 人工授權鎖：讀 gitignored .deploy-approve，內容須等於 env DEPLOY_TOKEN，
 *      否則 BLOCK。session 無法自行湊出此 token，只有 Jeff 手動放檔才能解鎖一次部署。
 *      部署成功後刪除 .deploy-approve（一次性，用完即焚）。
 *
 * 全過 → flyctl deploy --remote-only -a packgo-travel → curl /health 驗 + 印版本號。
 *
 * 為了可測試 + 吃狗糧，所有副作用（git/tsc/vitest/flyctl/curl、檔案、輸出）都從
 * `deps` 注入。`runGuard(deps, { dryRun })` 回傳 exit code（0 成功 / 1 擋下），
 * CLI wrapper 用真實作再 process.exit。
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = "packgo-travel";
const HEALTH_URL = "https://packgoplay.com/health";
const APPROVE_FILE = ".deploy-approve";

const indent = (s) =>
  String(s)
    .split("\n")
    .map((l) => "    " + l)
    .join("\n");
const short = (e) => (e && e.message ? String(e.message).split("\n")[0] : String(e));

/** Constant-time-ish token compare; length mismatch short-circuits (acceptable here). */
function tokensMatch(a, b) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * The guard itself. Pure-ish: every side effect is on `deps`.
 * Returns 0 (deploy proceeded / dry-run clean) or 1 (blocked).
 */
export async function runGuard(deps, opts = {}) {
  try {
    return await guardInner(deps, opts);
  } catch (e) {
    // Fail-safe: any unexpected error blocks the deploy.
    deps.error(`\n⛔ DEPLOY BLOCKED: unexpected error — ${short(e)}`);
    return 1;
  }
}

async function guardInner(deps, opts) {
  const { run, env, log, error } = deps;
  const dryRun = !!opts.dryRun;
  const fail = (msg) => {
    error(`\n⛔ DEPLOY BLOCKED: ${msg}`);
    return 1;
  };
  const ok = (msg) => log(`  ✓ ${msg}`);
  const gtrim = (cmd) => String(run(cmd)).trim();

  log(`🔒 safe-deploy guard — PACK&GO prod (${APP})${dryRun ? "  [DRY-RUN]" : ""}`);

  // 1. branch must be main
  log("\n[1/7] branch must be main");
  const branch = gtrim("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main") return fail(`on '${branch}', but deploy is only allowed from 'main'`);
  ok("on main");

  // 2. working tree must be clean
  log("[2/7] working tree must be clean");
  const porcelain = gtrim("git status --porcelain");
  if (porcelain) return fail(`uncommitted changes / untracked files present:\n${indent(porcelain)}`);
  ok("working tree clean");

  // 3. fetch + must not be behind origin/main
  log("[3/7] sync with origin/main (must not be behind)");
  try {
    run("git fetch origin");
  } catch (e) {
    return fail(`git fetch failed: ${short(e)}`);
  }
  let behind;
  let ahead;
  try {
    behind = gtrim("git rev-list --count HEAD..origin/main");
    ahead = gtrim("git rev-list --count origin/main..HEAD");
  } catch (e) {
    return fail(`could not compare with origin/main: ${short(e)}`);
  }
  if (behind !== "0")
    return fail(
      `local main is ${behind} commit(s) behind origin/main — pull/rebase first (refusing to deploy stale code)`,
    );
  ok(`not behind origin/main${ahead !== "0" ? `  (⚠ ${ahead} unpushed commit(s) ahead — these WILL be deployed)` : ""}`);

  // 4. migrations in this build (visibility only — not a gate)
  log("[4/7] migrations in this build (drizzle migrator applies any pending at release_command)");
  const migs = deps.listMigrations();
  if (!migs.length) {
    log("  (could not read drizzle/meta/_journal.json — verify migrations manually)");
  } else {
    log(`  ${migs.length} migration(s) in journal; latest:`);
    for (const t of migs.slice(-6)) log(`    • ${t}`);
  }

  // 5. tsc --noEmit, 0 errors
  log("[5/7] tsc --noEmit (0 errors)");
  try {
    run("pnpm exec tsc --noEmit", {
      inherit: true,
      env: { ...env, NODE_OPTIONS: "--max-old-space-size=6144" },
    });
  } catch {
    return fail("TypeScript errors — fix before deploying");
  }
  ok("tsc clean");

  // 6. vitest (skippable, but default runs)
  log("[6/7] vitest");
  if (env.SKIP_DEPLOY_TESTS === "1") {
    log("  ⚠ skipped (SKIP_DEPLOY_TESTS=1)");
  } else {
    try {
      run("pnpm exec vitest run", { inherit: true });
    } catch {
      return fail("tests failed — fix before deploying");
    }
    ok("tests passed");
  }

  // 7. human authorization lock — the part a session cannot fabricate
  log("[7/7] human authorization lock (.deploy-approve must equal env DEPLOY_TOKEN)");
  const raw = deps.readApprove();
  if (raw == null)
    return fail(`${APPROVE_FILE} not found — Jeff must place a one-time token to authorize this deploy`);
  const fileTok = String(raw).trim();
  if (!fileTok) return fail(`${APPROVE_FILE} is empty`);
  const envTok = String(env.DEPLOY_TOKEN ?? "").trim();
  if (!envTok) return fail("DEPLOY_TOKEN env var not set (Jeff supplies it at deploy time)");
  if (!tokensMatch(fileTok, envTok)) return fail(`${APPROVE_FILE} does not match DEPLOY_TOKEN`);
  ok("authorized by Jeff (one-time token matched)");

  // ---- all 7 gates green ----
  if (dryRun) {
    log("\n✅ [DRY-RUN] all 7 gates passed. Would now run:");
    log(`     flyctl deploy --remote-only -a ${APP}`);
    log("   then: consume .deploy-approve, curl /health, print version.");
    log("   (dry-run: nothing deployed, .deploy-approve left intact)");
    return 0;
  }

  log(`\n🚀 all gates green — deploying: flyctl deploy --remote-only -a ${APP}`);
  try {
    run(`flyctl deploy --remote-only -a ${APP}`, { inherit: true });
  } catch {
    return fail("flyctl deploy failed — prod unchanged; .deploy-approve kept for retry");
  }

  // burn the one-time token (only after a successful deploy)
  deps.deleteApprove();
  log(`\n  ✓ deployed; ${APPROVE_FILE} consumed (one-time token burned)`);

  // post-deploy health check
  try {
    const h = deps.health();
    log(`\n/health → overall: ${h.overall}`);
    if (h.checks)
      for (const [k, v] of Object.entries(h.checks))
        log(`    ${k}: ${v.status}${v.latencyMs != null ? ` ${v.latencyMs}ms` : ""}`);
    if (h.overall !== "ok")
      error(`  ⚠ health NOT ok — investigate; rollback with: flyctl releases rollback -a ${APP}`);
  } catch (e) {
    error(`  ⚠ post-deploy health check failed: ${short(e)}`);
  }

  // print deployed version
  try {
    const rel = String(run(`flyctl releases -a ${APP}`));
    const m = rel.match(/v(\d+)/);
    log(`\n  deployed version: ${m ? "v" + m[1] : "(unknown — check `flyctl releases`)"}`);
  } catch {
    /* non-fatal */
  }

  log("\n✅ deploy complete.");
  return 0;
}

/** Real implementations of every injected side effect. */
function makeRealDeps() {
  const repoRoot = String(
    execSync("git rev-parse --show-toplevel", { encoding: "utf8" }),
  ).trim();
  const approvePath = path.join(repoRoot, APPROVE_FILE);

  const run = (cmd, opts = {}) =>
    execSync(cmd, {
      encoding: "utf8",
      stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      env: opts.env ?? process.env,
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });

  return {
    run,
    env: process.env,
    readApprove: () => (existsSync(approvePath) ? readFileSync(approvePath, "utf8") : null),
    deleteApprove: () => {
      if (existsSync(approvePath)) unlinkSync(approvePath);
    },
    listMigrations: () => {
      try {
        const j = JSON.parse(
          readFileSync(path.join(repoRoot, "drizzle", "meta", "_journal.json"), "utf8"),
        );
        return (j.entries ?? []).map((e) => e.tag);
      } catch {
        return [];
      }
    },
    health: () => JSON.parse(String(run(`curl -s -m 20 ${HEALTH_URL}`))),
    log: (...a) => console.log(...a),
    error: (...a) => console.error(...a),
  };
}

// CLI entry — only when invoked directly (not when imported by the test).
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const dryRun = process.argv.includes("--dry-run") || process.env.SAFE_DEPLOY_DRY_RUN === "1";
  runGuard(makeRealDeps(), { dryRun })
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error("safe-deploy crashed:", e);
      process.exit(1);
    });
}
