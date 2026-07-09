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
 *   5. tsc --noEmit 必須 0 錯（SKIP_TSC=1 可略過；TSC_HEAP_MB 可調 heap 上限，預設 6144）
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
const SMOKE_URL = "https://packgoplay.com/api/admin/deploy-smoke";
const APPROVE_FILE = ".deploy-approve";
// Full flyctl-deploy output is tee'd here when a deploy fails, so the failure
// can be read from a file (by the monitor / next session) instead of only
// living in Jeff's terminal scrollback. Deleted on a successful deploy.
// Gitignored (see .gitignore) — must never trip gate 2's clean-tree check.
const ERROR_LOG_FILE = ".deploy-last-error.log";

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

  // 5. tsc --noEmit, 0 errors (skippable on memory-constrained machines)
  log("[5/7] tsc --noEmit (0 errors)");
  if (env.SKIP_TSC === "1") {
    log("  ⚠ skipped (SKIP_TSC=1) — only use when tsbuildinfo is fresh & no .ts changes");
  } else {
    try {
      run("pnpm exec tsc --noEmit", {
        inherit: true,
        env: { ...env, NODE_OPTIONS: `--max-old-space-size=${env.TSC_HEAP_MB || "6144"}` },
      });
    } catch {
      return fail("TypeScript errors — fix before deploying");
    }
    ok("tsc clean");
  }

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

  // 6.5 — ship 前 SQL 彩排(對 prod TiDB 逐條 EXPLAIN,擋 raw-SQL parse/resolution 錯)。
  //   唯讀:flyctl ssh + base64 node、READ ONLY session、不新增 HTTP 端點。詳見
  //   scripts/sqlRehearsalGate.ts 與 server/_core/sqlRehearsal/。fail-closed:EXPLAIN 有錯
  //   或通道失敗都擋,通道失敗附逃生口。編號 6.5 是為了不動既有七閘語義(派工單硬性)。
  log("[6.5/7] SQL 彩排(prod TiDB EXPLAIN — 登記表逐條 parse/resolution)");
  if (env.SKIP_SQL_REHEARSAL === "1") {
    log("  ⚠ skipped (SKIP_SQL_REHEARSAL=1) — 這次部署沒做 raw-SQL parse 檢查(operator 自行判斷)");
  } else {
    let reh;
    try {
      reh = await deps.rehearse();
    } catch (e) {
      return fail(
        `SQL 彩排啟動失敗 — ${short(e)}\n` +
          `   逃生口:SKIP_SQL_REHEARSAL=1 pnpm ship(略過 SQL 彩排;此次不做 parse 檢查,風險自負)`,
      );
    }
    if (reh && reh.channelError) {
      return fail(
        `SQL 彩排通道失敗:${reh.channelError}\n` +
          `   逃生口:SKIP_SQL_REHEARSAL=1 pnpm ship(略過 SQL 彩排;風險自負)`,
      );
    }
    if (!reh || !reh.ok) {
      const fails = (reh && reh.failures) || [];
      const lines = fails.map((f) => `      ✗ ${f.key}  (${f.source})  ${f.error}`).join("\n");
      return fail(
        `SQL 彩排發現 ${fails.length} 條 EXPLAIN 失敗(parse/resolution)— 修正後再部署:\n${lines}`,
      );
    }
    ok(`SQL 彩排通過(${reh.passed}/${reh.total} 條 EXPLAIN-clean on prod TiDB)`);
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
    // tee → the FULL build+release output streams live to Jeff's terminal AND
    // is captured to ERROR_LOG_FILE (tee truncates, so the file always holds
    // THIS attempt's output, never an append of past runs). pipefail makes the
    // pipeline surface flyctl's non-zero exit — without it the pipeline status
    // is tee's, which is always 0, and a failed deploy would look like success.
    run(
      `set -o pipefail; flyctl deploy --remote-only -a ${APP} 2>&1 | tee ${ERROR_LOG_FILE}`,
      { inherit: true, shell: "/bin/bash" },
    );
  } catch {
    return fail(
      `flyctl deploy failed — prod unchanged; full output saved to ${ERROR_LOG_FILE} ` +
        `(read that file instead of scrolling the terminal); .deploy-approve kept for retry`,
    );
  }

  // Deploy succeeded → the captured log only exists to explain FAILURES, so
  // drop it; a leftover file would otherwise read as "last deploy failed".
  deps.deleteErrorLog();

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

  // Wave1 Block A — ship 後自動煙霧(deploySmoke)。跟上面的 health check 同一個
  // 語意:紅字告知,不擋部署(guardInner 這裡已經完成部署)。LOCAL_SCRIPT_TOKEN
  // 沒設時直接跳過(不擋),因為那代表這台機器 / CI 本來就沒配置這個 token。
  if (!env.LOCAL_SCRIPT_TOKEN) {
    log("\n⚠ LOCAL_SCRIPT_TOKEN 未設,跳過 ship 後煙霧(不擋部署)");
  } else {
    try {
      const smoke = deps.smoke();
      log(`\nship 後煙霧 → ok: ${smoke.ok}`);
      if (smoke.arms)
        for (const a of smoke.arms)
          log(
            `    ${a.ok ? "✓" : "✗"} ${a.name}${a.ms != null ? ` ${a.ms}ms` : ""}` +
              `${a.rowCount != null ? ` rows=${a.rowCount}` : ""}${a.error ? `  ${a.error}` : ""}`,
          );
      if (!smoke.ok) {
        const failed = (smoke.arms || []).filter((a) => !a.ok).map((a) => a.name);
        error(
          `  ⚠ 煙霧未全過(失敗臂:${failed.join(", ")})— 投查;rollback: flyctl releases rollback -a ${APP}`,
        );
      }
    } catch (e) {
      error(`  ⚠ 煙霧呼叫失敗: ${short(e)}`);
    }
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

  const errorLogPath = path.join(repoRoot, ERROR_LOG_FILE);

  const run = (cmd, opts = {}) =>
    execSync(cmd, {
      encoding: "utf8",
      stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      env: opts.env ?? process.env,
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
      // `set -o pipefail` (the deploy tee pipeline) is bash syntax; default
      // /bin/sh doesn't guarantee it. Callers that need it pass shell:"/bin/bash".
      ...(opts.shell ? { shell: opts.shell } : {}),
    });

  return {
    run,
    env: process.env,
    readApprove: () => (existsSync(approvePath) ? readFileSync(approvePath, "utf8") : null),
    deleteApprove: () => {
      if (existsSync(approvePath)) unlinkSync(approvePath);
    },
    deleteErrorLog: () => {
      if (existsSync(errorLogPath)) unlinkSync(errorLogPath);
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
    // 閘 6.5 — ship 前 SQL 彩排。跑 orchestrator(tsx):它做 flyctl ssh + prod TiDB
    // 逐條 EXPLAIN,把「唯一一行 JSON」印到 stdout,進度/遠端訊息走 stderr(直接顯示給
    // operator)。orchestrator 一律 exit 0(狀態編碼在 JSON),所以這裡 execSync 不會因
    // SQL 失敗而 throw;只有 tsx 本身起不來才 throw(閘那邊 catch 成「彩排啟動失敗」)。
    rehearse: () => {
      const out = String(
        execSync("pnpm exec tsx scripts/sqlRehearsalGate.ts", {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
          env: process.env,
          cwd: repoRoot,
          maxBuffer: 32 * 1024 * 1024,
        }),
      );
      // 對 stdout 外圍雜訊(理論上不該有)穩健:取第一個 { 到最後一個 } 之間解析。
      const a = out.indexOf("{");
      const b = out.lastIndexOf("}");
      if (a === -1 || b === -1 || b < a) {
        return { ok: false, channelError: `orchestrator 沒回 JSON(stdout: ${out.slice(0, 200)})`, total: 0, passed: 0, failures: [] };
      }
      return JSON.parse(out.slice(a, b + 1));
    },
    // Wave1 Block A — ship 後自動煙霧。token 絕不字串插值進 shell 指令(理論
    // shell-injection 風險);改用 execSync 的 env 傳遞 + shell 內 $VAR 語法取值,
    // 讓 shell 自己從自己的環境變數展開,JS 端組出的指令字串本身完全不含 token。
    smoke: () =>
      JSON.parse(
        String(
          run(`curl -s -m 20 -X POST -H "Authorization: Bearer $LOCAL_SCRIPT_TOKEN" ${SMOKE_URL}`, {
            env: process.env,
          }),
        ),
      ),
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
