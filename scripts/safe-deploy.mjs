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
 *   6.5 SQL 彩排（Wave2）：對 prod TiDB 逐條 EXPLAIN 登記表 SQL，擋 raw-SQL parse/resolution
 *       錯（唯讀:flyctl ssh + blob 走 stdin,不新增端點）。fail-closed;通道失敗附逃生口
 *       `SKIP_SQL_REHEARSAL=1 pnpm ship`。詳見 scripts/sqlRehearsalGate.ts。
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
// audit-chain-repair R5-2:部署後鏈錨定端點(所有機器證實同一新 release 後才打)
const EPOCH_URL = "https://packgoplay.com/api/admin/audit-chain-epoch";

/**
 * Codex R9-1:tag→digest 的權威解析純函式。輸入是對 Fly registry v2 API 的
 * manifest HEAD 請求原始回應(status line + headers 全文)——與 Machines 完全
 * 無關的獨立來源(registry 本體),綁定 exact release tag。要求:
 *   - 回應必須是 200(401/404/307 等一律 throw,fail-closed)
 *   - 必須有 docker-content-digest 標頭且為 exact sha256:64-hex
 * export 供測試以真形狀 fixture 驗證(不是 fake resolver oracle)。
 */
export function parseRegistryDigestHeaders(headersText) {
  const text = String(headersText ?? "");
  // Codex R10-1:proxy 環境下 curl -sI 會輸出多個 header block(CONNECT 200 →
  // origin 回應)。只認「最後一個 HTTP block」= terminal origin response;
  // 該 block 必須 200、manifest media type 合法、digest 恰好一個。
  // R13-1:block 保持 raw(**不得先 trim** —— trim 會吞掉尾端「純 SP/HTAB」的
  // obs-fold continuation,讓折行藏頭騙過 cardinality)。obs-fold 檢查對 raw
  // 行做:首行之後任何以空白/tab 開頭的行(含整行只有空白)一律 throw,之後
  // 才做 status/Content-Type/digest 檢查。
  const blocks = text
    .split(/\r?\n\r?\n/)
    .filter((b) => /^HTTP\//i.test(b));
  if (blocks.length === 0) throw new Error("registry response has no HTTP header block");
  const terminal = blocks[blocks.length - 1];
  const rawLines = terminal.split(/\r?\n/);
  if (rawLines.slice(1).some((l) => /^[ \t]/.test(l))) {
    throw new Error("registry response contains obs-fold header continuation — rejected (fail-closed)");
  }
  const statusLine = rawLines[0] ?? "";
  if (!/^HTTP\/[\d.]+\s+200\b/i.test(statusLine)) {
    throw new Error(`registry manifest HEAD terminal response not 200: "${statusLine.slice(0, 60)}"`);
  }
  // R11-1:Content-Type 必須「恰好一個」且屬 manifest allowlist —— 重複(相同或
  // 衝突、合法在前或在後)一律拒,不容歧義回應假綠(fail-closed cardinality)。
  const cts = [...terminal.matchAll(/^content-type:\s*([^\r\n;]+)/gim)].map((m) => m[1].trim().toLowerCase());
  const MANIFEST_TYPES = [
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.oci.image.index.v1+json",
  ];
  if (cts.length !== 1) {
    throw new Error(`registry response must carry exactly one content-type header (got ${cts.length})`);
  }
  if (!MANIFEST_TYPES.includes(cts[0])) {
    throw new Error(`registry response content-type is not a manifest media type: "${cts[0] || "(missing)"}"`);
  }
  // digest 必須恰好一個(重複/衝突一律拒)
  const digests = [...terminal.matchAll(/^docker-content-digest:\s*(\S+)\s*$/gim)].map((m) => m[1].toLowerCase());
  const valid = digests.filter((d) => /^sha256:[0-9a-f]{64}$/.test(d));
  if (digests.length !== 1 || valid.length !== 1) {
    throw new Error(`registry response must carry exactly one valid docker-content-digest (got ${digests.length})`);
  }
  return valid[0];
}
const APPROVE_FILE = ".deploy-approve";
// Full flyctl-deploy output is tee'd here when a deploy fails, so the failure
// can be read from a file (by the monitor / next session) instead of only
// living in Jeff's terminal scrollback. Deleted on a successful deploy.
// Gitignored (see .gitignore) — must never trip gate 2's clean-tree check.
const ERROR_LOG_FILE = ".deploy-last-error.log";
// B1.2(Codex 6.6 P0)外部審查閘:本 release 相關的 AI 交流審查若還有「待傳/待裁定/
// 退回」未結,不得進 token 閘(6.7 §六流程教訓:未結審查就部署會把未裁定的東西上線)。
// 讀桌面的 AI 交流索引;fail-closed(讀不到也擋),逃生口 SKIP_REVIEW_GATE=1。
const REVIEW_INDEX_PATH = "/Users/jeff/Desktop/PACKGO_AI交流/00_索引.md";
// 命中任一即擋:★待傳(還沒交給 Jeff 傳)、待裁定(等 Jeff/外部裁決)、退回(被打回重做)。
const REVIEW_BLOCK_MARKERS = ["★待傳", "待裁定", "退回"];

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
 * 6.9 外部審查閘的命中判定 —— 只比對 markdown 表格的「狀態欄」。
 *
 * 為什麼不整行比對:真實索引 00_索引.md 是「| 日期 | 輪 | 去/回 | 摘要 | 檔案 | 狀態 |」
 * 表格,歷史列的「摘要」欄常含「證據保全狀態退回」「unsafe rollback與錯誤oracle退回B1.2」
 * 這類字樣,但那些列的狀態欄其實是「已裁定/已收裁定接受」= 已結案。整行比對會讓這些
 * 已結案歷史列永久命中 → 閘永久紅 → 逃生口 SKIP_REVIEW_GATE 變常態 = 閘失效。
 * 改為只看狀態欄即根治:未結的審查其狀態欄才會真的是 ★待傳/待裁定/退回。
 *
 * 規則:狀態欄 = 每列以 | 切割後「最後一個非空 cell」。非表格行(trim 後不以 | 開頭)
 * 不比對;表頭列(狀態=「狀態」,不含 marker 故自然不命中)與分隔列(|---|---|,狀態
 * cell 全為 - : 空白)跳過。狀態欄含任一 marker 才算命中。
 * 回傳 [{ n: 1-based 行號, l: 原始行文 }],供 fail 訊息照舊列行號與行文。
 */
export function reviewGateHits(idx) {
  const hits = [];
  const lines = String(idx).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line.startsWith("|")) continue; // 非表格資料列(敘述/標題/引言)不比對
    const cells = line.split("|").map((c) => c.trim());
    let status = "";
    for (let k = cells.length - 1; k >= 0; k--) {
      if (cells[k] !== "") {
        status = cells[k];
        break;
      }
    }
    if (status === "") continue; // 全空列
    if (/^[-:\s]+$/.test(status)) continue; // 分隔列 |---|---|(含對齊冒號)
    if (REVIEW_BLOCK_MARKERS.some((m) => status.includes(m))) {
      hits.push({ n: i + 1, l: raw });
    }
  }
  return hits;
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

  // 1A0a build marker(finance plan v4.3 §3.2.9):部署 image 的 __BUILD_SHA__
  // 一律 = 本次已核准 HEAD 的完整 40-hex sha,經 --build-arg 傳入(Docker context
  // 無 .git,container 內取不到;host 端這裡是唯一真值源)。非法 sha 直接 fail,
  // 禁止 "unknown" 進可部署 artifact。
  const gitSha = gtrim("git rev-parse HEAD");
  if (!/^[0-9a-f]{40}$/.test(gitSha)) {
    return fail(`git rev-parse HEAD returned invalid sha: '${gitSha}'`);
  }

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

  // 6.9 — 外部審查閘(B1.2 Codex 6.6 P0)。放 token 閘之前:本 release 相關的 AI 交流
  //   審查若仍有「★待傳/待裁定/退回」未結,先結案再部署,不得直接進人工授權鎖。
  //   讀桌面 AI 交流索引;fail-closed(讀不到=擋)。逃生口 SKIP_REVIEW_GATE=1(附風險
  //   警語)。編號 6.9 是為了不動既有七閘「/7」語義(同 6.5 SQL 彩排的慣例)。
  log("[6.9/7] 外部審查閘(AI 交流索引 待傳/待裁定/退回 未結即擋)");
  if (env.SKIP_REVIEW_GATE === "1") {
    log(
      "  ⚠ skipped (SKIP_REVIEW_GATE=1) — 略過外部審查閘;你正在明知未確認 AI 交流索引" +
        "(待傳/待裁定/退回)的情況下部署,風險自負",
    );
  } else {
    const idx = deps.readReviewIndex();
    if (idx == null) {
      return fail(
        `外部審查索引讀不到(${REVIEW_INDEX_PATH})— fail-closed 擋部署(無法確認審查已結)。\n` +
          `   逃生口:SKIP_REVIEW_GATE=1 pnpm ship(略過外部審查閘;風險自負)`,
      );
    }
    const hitLines = reviewGateHits(idx);
    if (hitLines.length > 0) {
      const listed = hitLines.map(({ n, l }) => `      L${n}: ${l.trim().slice(0, 120)}`).join("\n");
      return fail(
        `外部審查未結 — AI 交流索引仍有 待傳/待裁定/退回 標記,先結案再部署:\n${listed}\n` +
          `   逃生口:SKIP_REVIEW_GATE=1 pnpm ship(明知未結仍部署;風險自負)`,
      );
    }
    ok(`外部審查索引無 待傳/待裁定/退回(${REVIEW_BLOCK_MARKERS.join("/")})`);
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

  // ---- all gates green (1–7 + 6.5 SQL 彩排) ----
  const deployCmd = `flyctl deploy --remote-only -a ${APP} --build-arg GIT_SHA=${gitSha}`;

  if (dryRun) {
    log("\n✅ [DRY-RUN] all gates passed (含 6.5 SQL 彩排). Would now run:");
    log(`     ${deployCmd}`);
    log("   then: consume .deploy-approve, curl /health, print version.");
    log("   (dry-run: nothing deployed, .deploy-approve left intact)");
    return 0;
  }

  log(`\n🚀 all gates green — deploying: ${deployCmd}`);
  try {
    // tee → the FULL build+release output streams live to Jeff's terminal AND
    // is captured to ERROR_LOG_FILE (tee truncates, so the file always holds
    // THIS attempt's output, never an append of past runs). pipefail makes the
    // pipeline surface flyctl's non-zero exit — without it the pipeline status
    // is tee's, which is always 0, and a failed deploy would look like success.
    run(
      `set -o pipefail; ${deployCmd} 2>&1 | tee ${ERROR_LOG_FILE}`,
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

  // 上線後驗證(health / 煙霧)紅燈時,部署已經發生 —— 這不是「還沒部署」的可退狀態。
  // B1.2(Codex 6.6 P0):絕不建議 `flyctl releases rollback`。退回 v811 會把「信託自動
  // 認列」裝回去(v812 才上線的財務停止線是為了擋掉它)。驗證紅 = forward-fix,不是回退。
  let verificationFailed = false;

  // post-deploy health check
  try {
    const h = deps.health();
    log(`\n/health → overall: ${h.overall}`);
    if (h.checks)
      for (const [k, v] of Object.entries(h.checks))
        log(`    ${k}: ${v.status}${v.latencyMs != null ? ` ${v.latencyMs}ms` : ""}`);
    if (h.overall !== "ok") {
      verificationFailed = true;
      error(
        `  ⛔ DEPLOYED_UNVERIFIED — /health 非 ok。部署已發生但驗證未通過;` +
          `不得回退 v811(退回 v811 會復活自動認列,重裝已被財務停止線擋掉的行為);` +
          `保留財務停止線,立即 forward-fix。`,
      );
    }
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
        verificationFailed = true;
        const failed = (smoke.arms || []).filter((a) => !a.ok).map((a) => a.name);
        error(
          `  ⛔ DEPLOYED_UNVERIFIED — 煙霧未全過(失敗臂:${failed.join(", ")})。` +
            `部署已發生但驗證未通過;不得回退 v811(退回 v811 會復活自動認列);` +
            `保留財務停止線,立即 forward-fix。`,
        );
      }
    } catch (e) {
      error(`  ⚠ 煙霧呼叫失敗: ${short(e)}`);
    }
  }

  // audit-chain-repair R5-2 — 部署後鏈錨定。順序有硬性理由:Fly rolling 會先啟
  // 新機再停舊機,startup 錨定會讓舊 release 的舊口徑寫入落在新錨之後,立即污染
  // post-epoch 段。所以:(1) 先以 flyctl machines list --json 證實所有 started
  // 機器都跑同一個 image(release 全退場證明,不用 sleep 充數);(2) 才打
  // LOCAL_SCRIPT_TOKEN 保護的錨定端點;(3) 端點回的 verify 必須 ok 且
  // epochCount=1 才算綠。token / machines 證明 / 端點 / 驗證任一缺 →
  // DEPLOYED_UNVERIFIED(1A0b 不得開)。首錨 {id,rowHash} 印出供 repo 外封存。
  if (!env.LOCAL_SCRIPT_TOKEN) {
    verificationFailed = true;
    error("  ⛔ DEPLOYED_UNVERIFIED — LOCAL_SCRIPT_TOKEN 未設,鏈錨定無法執行;1A0b 不得開。");
  } else {
    try {
      // Codex R7-1:release 與 machine 的 image 身分必須正規化到同一 immutable
      // identity 再比對,且機械證實選中的是本次 complete release。
      // - release(flyctl releases --json 最新一筆):必須 Status=complete;
      //   ImageRef 形如 "registry.fly.io/packgo-travel:deployment-XXXX"(可能帶
      //   "@sha256:…" 後綴)。
      // - machine(flyctl machines list --json):image_ref 是物件
      //   {registry, repository, tag, digest}。
      // 比對規則:machine 全名 ref(registry/repository:tag,lowercase)===
      // release ref(去 digest 後綴,lowercase);release 若帶 digest 則 machine
      // digest 也必須相等;所有回傳機器一律 state==="started"(stopping/
      // unknown/過渡機即擋,同 image 也不放行);全機 digest 唯一且為 sha256:。
      // Codex R8-1:期望 digest 必須來自本次 exact release/deploy artifact 的
      // 合法 64-hex;tag-only release 必須解析到 digest,取不到即紅(fail-closed,
      // 絕不拿「machines 彼此一致」充當 release 綁定)。
      const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
      // Codex R10-1:tag 保留原大小寫(Fly 的 deployment-<ULID> tag 含大寫;OCI
      // tag 大小寫敏感,registry <reference> 必須用原 tag)。只正規化 registry/
      // repository(host/path 大小寫不敏感)與 digest(hex)。
      const parseRef = (raw) => {
        let s = String(raw);
        let digest = null;
        const at = s.indexOf("@sha256:");
        if (at !== -1) {
          digest = s.slice(at + 1).toLowerCase();
          s = s.slice(0, at);
        }
        const colon = s.lastIndexOf(":");
        const path = colon === -1 ? s : s.slice(0, colon);
        const tag = colon === -1 ? "" : s.slice(colon + 1); // 原大小寫
        return { path: path.toLowerCase(), tag, ref: `${path.toLowerCase()}:${tag}`, digest };
      };
      const release = deps.releaseImage();
      const relStatus = String(release?.Status ?? release?.status ?? "").toLowerCase();
      if (relStatus !== "complete") {
        throw new Error(`latest release status is "${relStatus || "?"}" — not complete`);
      }
      const rawRef = release?.ImageRef ?? release?.image_ref ?? release?.imageRef;
      if (!rawRef) throw new Error("latest release has no image ref");
      const rel = parseRef(rawRef);
      let expectedDigest = rel.digest;
      if (!expectedDigest) {
        // R9-1:tag-only → 問 registry 本體(與 Machines 無關的獨立權威):
        // 以本次 release 的 exact repository:tag 對 registry v2 API 做 manifest
        // HEAD,由共用純函式解析 docker-content-digest。取不到即 throw →
        // DEPLOYED_UNVERIFIED。絕不從 machines 同源資料推 digest。
        // repository 用正規化 path、tag 用**原大小寫**(R10-1:ULID tag 含大寫)
        const repository = rel.path.replace(/^registry\.fly\.io\//, "");
        const tag = rel.tag;
        if (!repository || !tag) throw new Error(`cannot split repository:tag from ${rel.ref}`);
        expectedDigest = parseRegistryDigestHeaders(deps.registryManifestHead(repository, tag));
      }
      expectedDigest = String(expectedDigest ?? "").toLowerCase();
      if (!DIGEST_RE.test(expectedDigest)) {
        throw new Error(`cannot resolve a valid immutable digest for release ${rel.ref.slice(0, 48)}…`);
      }
      const machines = deps.machines();
      const all = Array.isArray(machines) ? machines : [];
      const bad = all.filter((m) => {
        if (m?.state !== "started") return true;
        const ir = m?.image_ref ?? {};
        const digest = String(ir.digest ?? "").toLowerCase();
        if (!DIGEST_RE.test(digest) || digest !== expectedDigest) return true; // 主判準:immutable digest exact 相等
        // tag 為 optional(Fly Machines API image_ref 可無 tag);有 tag 才另比:
        // registry/repository 正規化比對、tag 保留原大小寫 exact 比對(R10-1)
        if (ir.tag != null) {
          const mPath = `${ir.registry}/${ir.repository}`.toLowerCase();
          if (mPath !== rel.path || String(ir.tag) !== rel.tag) return true;
        }
        return false;
      });
      if (all.length === 0 || bad.length > 0) {
        verificationFailed = true;
        error(
          `  ⛔ DEPLOYED_UNVERIFIED — 機器未全數以 immutable digest 綁定本次 complete release` +
            `(machines=${all.length}, 不合格=${bad.length},` +
            ` expectedDigest=${expectedDigest.slice(0, 20)}…);未錨定,1A0b 不得開。`,
        );
      } else {
        log(`\n  機器一致性:${all.length} 台全部 started 且 digest=${expectedDigest.slice(0, 20)}…(本次 release ${rel.ref.slice(0, 48)}…)`);
        const anchor = deps.epochAnchor();
        const v = anchor?.verify;
        log(
          `  鏈錨定 → ensure: ${anchor?.ensure} / ok: ${v?.ok} / epochCount: ${v?.epochCount}` +
            ` / epochStartId: ${v?.epochStartId} / legacyRows: ${v?.legacyRows} / anomalies: ${v?.anomalyCount}`,
        );
        // Codex R6-2(P1-3):回應形狀嚴格判準 —— 缺 id、id 不合、非 64-hex、
        // epochStartId null、殘留異常,全部擋。
        const ensureOk = anchor?.ensure === "written" || anchor?.ensure === "exists";
        const idOk =
          Number.isInteger(v?.epochStartId) && v.epochStartId > 0 &&
          Number.isInteger(anchor?.anchor?.id) && anchor.anchor.id === v.epochStartId;
        const hashOk = typeof anchor?.anchor?.rowHash === "string" && /^[0-9a-f]{64}$/.test(anchor.anchor.rowHash);
        if (!ensureOk || v?.ok !== true || v?.epochCount !== 1 || v?.anomalyCount !== 0 || !idOk || !hashOk) {
          verificationFailed = true;
          error(
            "  ⛔ DEPLOYED_UNVERIFIED — 鏈錨定/驗證未全綠" +
              `(ensure=${anchor?.ensure}, ok=${v?.ok}, epochCount=${v?.epochCount},` +
              ` anomalies=${v?.anomalyCount}, epochStartId=${v?.epochStartId},` +
              ` anchorId=${anchor?.anchor?.id}, hash64hex=${hashOk});1A0b 不得開。`,
          );
        } else {
          log(`  首錨憑證(封存到 repo 外 evidence 檔核對用):id=${anchor.anchor.id} rowHash=${anchor.anchor.rowHash}`);
        }
      }
    } catch (e) {
      verificationFailed = true;
      error(`  ⛔ DEPLOYED_UNVERIFIED — 鏈錨定步驟失敗:${short(e)};1A0b 不得開。`);
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

  if (verificationFailed) {
    // 驗證(health / 煙霧)紅燈:部署已發生但未通過上線驗證。機械可辨認字串
    // DEPLOYED_UNVERIFIED 讓 monitor / 下一個 session 明確識別此態,絕不印
    // 「deploy complete」把未驗證誤導成成功。禁止回退 v811(會復活自動認列)。
    error(
      "\n⛔ DEPLOYED_UNVERIFIED — 部署已發生但上線驗證未通過。" +
        "不得回退 v811(退回會復活自動認列);保留財務停止線,立即 forward-fix。",
    );
  } else {
    log("\n✅ deploy complete.");
  }
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
    // 6.9 外部審查閘:讀桌面 AI 交流索引原文(不存在回 null → 閘 fail-closed 擋)。
    readReviewIndex: () =>
      existsSync(REVIEW_INDEX_PATH) ? readFileSync(REVIEW_INDEX_PATH, "utf8") : null,
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
    // audit-chain-repair R5-2/R6-2 — 機器綁定本次 release image 的證明 + 鏈錨定。
    // token 同 smoke 範式:shell 內 $VAR 展開,指令字串不含 token。
    machines: () => JSON.parse(String(run(`flyctl machines list -a ${APP} --json`))),
    // 本次 deploy 的最新 release 物件(R7-1:上層驗 Status=complete 並正規化
    // ImageRef;缺欄位/非 complete 一律 throw → DEPLOYED_UNVERIFIED,fail-closed)。
    releaseImage: () => {
      const rel = JSON.parse(String(run(`flyctl releases -a ${APP} --json`)));
      const latest = Array.isArray(rel) ? rel[0] : null;
      if (!latest) throw new Error("flyctl releases --json returned no releases");
      return latest;
    },
    // R9-1:對 Fly registry v2 API 做 manifest HEAD(獨立於 Machines 的權威)。
    // token 經 flyctl auth token 取得後只進子行程 env($FLY_TOKEN 展開),指令
    // 字串與 log 均不含 token(同 LOCAL_SCRIPT_TOKEN 範式)。回傳原始回應
    // (status line + headers),由共用純函式 parseRegistryDigestHeaders 解析。
    registryManifestHead: (repository, tag) => {
      const token = String(run(`flyctl auth token`)).trim();
      return String(
        run(
          `curl -sI -H "Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json" -u "x:$FLY_TOKEN" https://registry.fly.io/v2/${repository}/manifests/${tag}`,
          { env: { ...process.env, FLY_TOKEN: token } },
        ),
      );
    },
    epochAnchor: () =>
      JSON.parse(
        String(
          run(`curl -s -m 20 -X POST -H "Authorization: Bearer $LOCAL_SCRIPT_TOKEN" ${EPOCH_URL}`, {
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
