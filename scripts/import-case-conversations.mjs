#!/usr/bin/env node
/**
 * import-case-conversations.mjs — 批十一 塊C local desktop script.
 *
 * Scans ~/Desktop/Pack&Go/客人檔案/<folder>/來源/ for conversation-candidate
 * files (.txt / .md, e.g. dated message logs like David 的「出票進度與訊息.md」)
 * and sends them to POST /api/admin/import-case-conversations, which feeds each
 * through the existing chatLogImport pipeline (classifier decides what's really
 * a chat log; resolveEventDate drops future dates; person-match + dedup applied).
 * The structured 案件資料.md itself is NOT sent (it's not a conversation).
 *
 * Default = dry-run over every case folder that has a 來源/ subfolder. Nothing
 * is written unless you pass --confirm=<folderName> or --confirm-all.
 *
 * Usage:
 *   node scripts/import-case-conversations.mjs                    # dry-run all
 *   node scripts/import-case-conversations.mjs --confirm=David_中國行
 *   node scripts/import-case-conversations.mjs --confirm-all
 *
 * Config: PACKGO_API_BASE (default https://packgoplay.com);
 *   ~/.packgo/local-script-token (== server LOCAL_SCRIPT_TOKEN).
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CASE_FILES_ROOT = join(homedir(), "Desktop", "Pack&Go", "客人檔案");
const SOURCE_SUBFOLDER = "來源";
const TOKEN_PATH = join(homedir(), ".packgo", "local-script-token");
const API_BASE = process.env.PACKGO_API_BASE || "https://packgoplay.com";
const ENDPOINT = `${API_BASE}/api/admin/import-case-conversations`;
const CONVO_EXT = new Set([".txt", ".md"]);

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
    console.error(`找不到 token 檔案：${TOKEN_PATH}(mkdir -p ~/.packgo; echo TOKEN > ~/.packgo/local-script-token)`);
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
    if (existsSync(join(CASE_FILES_ROOT, entry.name, SOURCE_SUBFOLDER))) folders.push(entry.name);
  }
  folders.sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return folders;
}

function isConvoCandidate(name) {
  if (name.startsWith(".")) return false;
  const i = name.lastIndexOf(".");
  return i >= 0 && CONVO_EXT.has(name.slice(i).toLowerCase());
}

async function scanConvoFiles(folderName) {
  const dir = join(CASE_FILES_ROOT, folderName, SOURCE_SUBFOLDER);
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile() || !isConvoCandidate(e.name)) continue;
    files.push({ name: e.name, text: await readFile(join(dir, e.name), "utf8") });
  }
  return files;
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
  if (r.profileId) console.log(`  客人卡 #${r.profileId}${r.customerName ? `(${r.customerName})` : ""}`);
  if (typeof r.totalImported === "number") console.log(`  實際寫入互動:${r.totalImported}`);
  for (const f of r.files ?? []) {
    const cnt = typeof f.importedCount === "number" ? `${f.importedCount} 則` : "";
    const dr = f.dryRun ? "(預覽)" : "";
    const nv = f.unverifiedNoName ? " [未經名字驗證]" : "";
    console.log(`   - ${f.name}  →  ${f.status} ${cnt}${dr}${nv}${f.note ? `  (${f.note})` : ""}`);
  }
}

async function main() {
  const { confirmFolder, confirmAll } = parseArgs(process.argv.slice(2));
  const token = await readToken();
  if (!token) return;

  let folders = await findCaseFolders();
  if (folders.length === 0) return;
  if (confirmFolder) folders = folders.filter((f) => f === confirmFolder);
  if (confirmFolder && folders.length === 0) {
    console.error(`--confirm=${confirmFolder} 找不到對應資料夾(或它沒有 來源 子夾)`);
    process.exitCode = 1;
    return;
  }

  for (const folderName of folders) {
    const files = await scanConvoFiles(folderName);
    if (files.length === 0) {
      console.log(`\n=== ${folderName} — 來源/ 沒有 .txt/.md 對話候選檔 ===`);
      continue;
    }
    const mode = confirmAll || confirmFolder === folderName ? "confirm" : "dry_run";
    const result = await post(token, { mode, folderName, files });
    printResult(folderName, result);
  }
}

main().catch((err) => {
  console.error("import-case-conversations 失敗:", err);
  process.exitCode = 1;
});
