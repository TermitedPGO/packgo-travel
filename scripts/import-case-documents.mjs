#!/usr/bin/env node
/**
 * import-case-documents.mjs — 批十一 塊A local desktop script.
 *
 * Scans ~/Desktop/Pack&Go/客人檔案/<folder>/{交付,來源}/ for real document
 * artifacts (PDF/Excel/Word/images) and sends them to
 * POST /api/admin/import-case-documents on the deployed server, which uploads
 * each to R2 (customer-docs/ prefix, NEVER reply-attachments/) and writes a
 * customerDocuments row tied to that case's order. .md/.txt/.DS_Store/隱藏檔 are
 * NOT sent (they're case working-notes handled by 塊B 教訓 / 塊C 對話, not
 * customer documents). LLM/DB/R2 all happen server-side, never locally.
 *
 * Default = dry-run over every case folder that has 交付/ or 來源/, printed as a
 * table. Nothing is uploaded unless you pass --confirm=<folderName> or
 * --confirm-all. Confirm uploads are chunked by size so no single request
 * exceeds the server's 10mb body limit.
 *
 * Usage:
 *   node scripts/import-case-documents.mjs                       # dry-run all
 *   node scripts/import-case-documents.mjs --confirm=金宥_芝加哥尼加拉瀑布
 *   node scripts/import-case-documents.mjs --confirm-all
 *
 * Config:
 *   PACKGO_API_BASE   env override (default https://packgoplay.com)
 *   ~/.packgo/local-script-token   plaintext bearer token (== server env
 *     LOCAL_SCRIPT_TOKEN, set via `fly secrets set`)
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CASE_FILES_ROOT = join(homedir(), "Desktop", "Pack&Go", "客人檔案");
const TOKEN_PATH = join(homedir(), ".packgo", "local-script-token");
const API_BASE = process.env.PACKGO_API_BASE || "https://packgoplay.com";
const ENDPOINT = `${API_BASE}/api/admin/import-case-documents`;
const SUBFOLDERS = ["交付", "來源"];
// ~6mb of raw bytes per confirm request → base64 ~8mb, under the 10mb express limit.
const CONFIRM_CHUNK_BYTES = 6 * 1024 * 1024;

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
        "請先建立這個檔案，內容是 LOCAL_SCRIPT_TOKEN 的值（跟 server 端 fly secrets 一樣）：",
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

/** Case folders that have at least one of 交付/ or 來源/. */
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
    const hasSub = SUBFOLDERS.some((s) => existsSync(join(CASE_FILES_ROOT, entry.name, s)));
    if (hasSub) folders.push(entry.name);
  }
  folders.sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return folders;
}

/** Read every file under 交付/ + 來源/ (buffers kept for confirm uploads). */
async function scanCaseFiles(folderName) {
  const files = [];
  for (const sub of SUBFOLDERS) {
    const dir = join(CASE_FILES_ROOT, folderName, sub);
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const buf = await readFile(join(dir, e.name));
      files.push({ subfolder: sub, name: e.name, sizeBytes: buf.length, _buf: buf });
    }
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

function printPlan(folderName, result) {
  console.log(`\n=== ${folderName} — ${result.status} ===`);
  if (result.warnings?.length) console.log(`  ⚠ ${result.warnings.join("; ")}`);
  if (result.orderId) console.log(`  訂單 #${result.orderId}｜客人卡 #${result.profileId}`);
  if (result.stats) {
    const s = result.stats;
    console.log(`  共 ${s.total} 檔:上傳 ${s.toUpload}｜已存在 ${s.skippedDuplicate}｜非文件跳過 ${s.skippedNotDocument}`);
  }
  if (typeof result.uploaded === "number") console.log(`  本次實際上傳:${result.uploaded}`);
  for (const p of result.plan ?? []) {
    const kb = (p.sizeBytes / 1024).toFixed(0);
    const tag = p.isInternalCost ? "[內部成本]" : "";
    console.log(`   - ${p.subfolder}/${p.name}  →  ${p.type} ${tag}  ${kb}KB  ${p.action}`);
  }
}

/** Chunk an array of files so each chunk's raw bytes ≤ CONFIRM_CHUNK_BYTES. */
function chunkBySize(files) {
  const chunks = [];
  let cur = [];
  let curBytes = 0;
  for (const f of files) {
    if (cur.length > 0 && curBytes + f.sizeBytes > CONFIRM_CHUNK_BYTES) {
      chunks.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(f);
    curBytes += f.sizeBytes;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function main() {
  const { confirmFolder, confirmAll } = parseArgs(process.argv.slice(2));
  const token = await readToken();
  if (!token) return;

  let folders = await findCaseFolders();
  if (folders.length === 0) return;
  if (confirmFolder) folders = folders.filter((f) => f === confirmFolder);
  if (confirmFolder && folders.length === 0) {
    console.error(`--confirm=${confirmFolder} 找不到對應資料夾(或它沒有 交付/來源 子夾)`);
    process.exitCode = 1;
    return;
  }

  for (const folderName of folders) {
    const files = await scanCaseFiles(folderName);
    const doConfirm = confirmAll || confirmFolder === folderName;

    if (!doConfirm) {
      // dry-run:只送 metadata(不帶 base64),拿整份計畫。
      const meta = files.map((f) => ({ subfolder: f.subfolder, name: f.name, sizeBytes: f.sizeBytes }));
      const result = await post(token, { mode: "dry_run", folderName, files: meta });
      printPlan(folderName, result);
      continue;
    }

    // confirm:只送需要上傳的檔(先 dry-run 拿計畫,再挑 action=upload),按大小分批帶 base64。
    const dry = await post(token, {
      mode: "dry_run",
      folderName,
      files: files.map((f) => ({ subfolder: f.subfolder, name: f.name, sizeBytes: f.sizeBytes })),
    });
    if (dry.status !== "dry_run") {
      printPlan(folderName, dry);
      continue;
    }
    const uploadNames = new Set((dry.plan ?? []).filter((p) => p.action === "upload").map((p) => p.name));
    const toUpload = files.filter((f) => uploadNames.has(f.name));
    if (toUpload.length === 0) {
      console.log(`\n=== ${folderName} — 沒有要上傳的新文件(全部已存在或非文件)===`);
      printPlan(folderName, dry);
      continue;
    }
    let totalUploaded = 0;
    let lastResult = null;
    for (const chunk of chunkBySize(toUpload)) {
      const payload = chunk.map((f) => ({
        subfolder: f.subfolder,
        name: f.name,
        sizeBytes: f.sizeBytes,
        base64: f._buf.toString("base64"),
      }));
      const result = await post(token, { mode: "confirm", folderName, files: payload });
      lastResult = result;
      if (result.status === "imported") totalUploaded += result.uploaded ?? 0;
      else {
        console.error(`  ⚠ ${folderName} chunk 失敗:${(result.warnings ?? []).join("; ")}`);
        break;
      }
    }
    console.log(`\n=== ${folderName} — confirm 完成,共上傳 ${totalUploaded} 檔 ===`);
    if (lastResult) printPlan(folderName, { ...lastResult, uploaded: totalUploaded });
  }
}

main().catch((err) => {
  console.error("import-case-documents 失敗:", err);
  process.exitCode = 1;
});
