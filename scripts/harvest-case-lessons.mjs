#!/usr/bin/env node
/**
 * harvest-case-lessons.mjs — 批十一 塊B local desktop script.
 *
 * Scans ~/Desktop/Pack&Go/客人檔案/<folder>/案件資料.md and sends each to
 * POST /api/admin/harvest-case-lessons, which parses the「經驗/踩坑/風險注意」
 * sections, LLM-de-identifies them (指代化,不寫客人真名), and writes each into
 * caseLearnings (sourceFolder-idempotent, incl. blocked no-order cases). LLM +
 * DB happen server-side. dry_run only lists candidates (no LLM burn); confirm
 * de-identifies + writes.
 *
 * Default = dry-run over every case folder. Nothing is written unless you pass
 * --confirm=<folderName> or --confirm-all.
 *
 * Usage:
 *   node scripts/harvest-case-lessons.mjs                        # dry-run all
 *   node scripts/harvest-case-lessons.mjs --confirm=金宥_芝加哥尼加拉瀑布
 *   node scripts/harvest-case-lessons.mjs --confirm-all
 *
 * Config: PACKGO_API_BASE (default https://packgoplay.com);
 *   ~/.packgo/local-script-token (== server LOCAL_SCRIPT_TOKEN).
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CASE_FILES_ROOT = join(homedir(), "Desktop", "Pack&Go", "客人檔案");
const CASE_FILE_NAME = "案件資料.md";
const TOKEN_PATH = join(homedir(), ".packgo", "local-script-token");
const API_BASE = process.env.PACKGO_API_BASE || "https://packgoplay.com";
const ENDPOINT = `${API_BASE}/api/admin/harvest-case-lessons`;

function parseArgs(argv) {
  let confirmFolder = null;
  let confirmAll = false;
  for (const arg of argv) {
    if (arg === "--confirm-all") confirmAll = true;
    else if (arg.startsWith("--confirm=")) confirmFolder = arg.slice("--confirm=".length);
  }
  return { confirmFolder, confirmAll };
}

async function readToken() {
  if (!existsSync(TOKEN_PATH)) {
    console.error(
      [
        "",
        `找不到 token 檔案：${TOKEN_PATH}`,
        "",
        "  mkdir -p ~/.packgo",
        "  echo '你的token字串' > ~/.packgo/local-script-token",
        "  chmod 600 ~/.packgo/local-script-token",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return null;
  }
  const token = (await readFile(TOKEN_PATH, "utf8")).trim();
  if (!token) {
    console.error(`token 檔案是空的：${TOKEN_PATH}`);
    process.exitCode = 1;
    return null;
  }
  return token;
}

async function findCaseFolders() {
  if (!existsSync(CASE_FILES_ROOT)) {
    console.error(`找不到案件資料夾：${CASE_FILES_ROOT}`);
    process.exitCode = 1;
    return [];
  }
  const entries = await readdir(CASE_FILES_ROOT, { withFileTypes: true });
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const mdPath = join(CASE_FILES_ROOT, entry.name, CASE_FILE_NAME);
    if (existsSync(mdPath)) folders.push({ folderName: entry.name, mdPath });
  }
  folders.sort((a, b) => a.folderName.localeCompare(b.folderName, "zh-Hant"));
  return folders;
}

async function post(token, body) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (!res.ok) return { status: "error", warnings: [json.error || `HTTP ${res.status}`] };
      return json;
    } catch {
      return { status: "error", warnings: [`non-JSON HTTP ${res.status}: ${text.slice(0, 200)}`] };
    }
  } catch (err) {
    return { status: "error", warnings: [`request failed: ${err.message}`] };
  }
}

function printResult(folderName, r) {
  console.log(`\n=== ${folderName} — ${r.status} ===`);
  if (r.warnings?.length) console.log(`  ⚠ ${r.warnings.join("; ")}`);
  const meta = [];
  if (r.caseType) meta.push(`總類 ${r.caseType}`);
  if (r.destination) meta.push(`目的地 ${r.destination}`);
  if (r.sourceOrderId) meta.push(`單 #${r.sourceOrderId}`);
  else if (r.status !== "already_harvested") meta.push("無訂單(blocked)");
  if (meta.length) console.log(`  ${meta.join("｜")}`);
  if (typeof r.candidateCount === "number") console.log(`  候選教訓:${r.candidateCount}`);
  if (typeof r.written === "number") console.log(`  實際寫入:${r.written}`);
  for (const c of r.candidates ?? []) console.log(`   - ${c}`);
}

async function main() {
  const { confirmFolder, confirmAll } = parseArgs(process.argv.slice(2));
  const token = await readToken();
  if (!token) return;

  let folders = await findCaseFolders();
  if (folders.length === 0) return;
  if (confirmFolder) folders = folders.filter((f) => f.folderName === confirmFolder);
  if (confirmFolder && folders.length === 0) {
    console.error(`--confirm=${confirmFolder} 找不到對應的案件資料.md`);
    process.exitCode = 1;
    return;
  }

  for (const { folderName, mdPath } of folders) {
    const markdown = await readFile(mdPath, "utf8");
    const mode = confirmAll || confirmFolder === folderName ? "confirm" : "dry_run";
    const result = await post(token, { mode, folderName, markdown });
    printResult(folderName, result);
  }
}

main().catch((err) => {
  console.error("harvest-case-lessons 失敗:", err);
  process.exitCode = 1;
});
