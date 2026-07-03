#!/usr/bin/env node
/**
 * import-customer-cases.mjs — local desktop script, Phase1b batch case-file
 * import (docs/features/customer-cockpit/design-phase1bc.md).
 *
 * Scans ~/Desktop/Pack&Go/客人檔案/<folder>/案件資料.md, sends each one to
 * POST /api/admin/import-case-file on the deployed server (LLM extraction +
 * DB writes happen server-side, never locally). Default mode is a full
 * dry-run over every folder, printed as a table. Nothing is written to the
 * database unless you explicitly pass --confirm=<folderName> or
 * --confirm-all.
 *
 * Usage:
 *   node scripts/import-customer-cases.mjs                 # dry-run all
 *   node scripts/import-customer-cases.mjs --confirm=林朝安_新馬6日團
 *   node scripts/import-customer-cases.mjs --confirm-all
 *
 * Config:
 *   PACKGO_API_BASE   env var override (default https://packgoplay.com)
 *   ~/.packgo/local-script-token   plaintext file holding the bearer token
 *     (matches server env var LOCAL_SCRIPT_TOKEN — set via `fly secrets set`)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CASE_FILES_ROOT = join(homedir(), "Desktop", "Pack&Go", "客人檔案");
const CASE_FILE_NAME = "案件資料.md";
const TOKEN_PATH = join(homedir(), ".packgo", "local-script-token");
const API_BASE = process.env.PACKGO_API_BASE || "https://packgoplay.com";
const ENDPOINT = `${API_BASE}/api/admin/import-case-file`;

function parseArgs(argv) {
  let confirmFolder = null;
  let confirmAll = false;
  for (const arg of argv) {
    if (arg === "--confirm-all") {
      confirmAll = true;
    } else if (arg.startsWith("--confirm=")) {
      confirmFolder = arg.slice("--confirm=".length);
    }
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
        "請先建立這個檔案，內容是 LOCAL_SCRIPT_TOKEN 的值（跟 server 端 fly secrets 設的要一樣）：",
        "",
        "  mkdir -p ~/.packgo",
        "  echo '你的token字串' > ~/.packgo/local-script-token",
        "  chmod 600 ~/.packgo/local-script-token",
        "",
        "如果還沒設定 server 端的 secret，先跑：",
        "",
        "  flyctl secrets set LOCAL_SCRIPT_TOKEN=$(openssl rand -hex 32) -a packgo-travel",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return null;
  }
  const raw = await readFile(TOKEN_PATH, "utf8");
  const token = raw.trim();
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
    if (existsSync(mdPath)) {
      folders.push({ folderName: entry.name, mdPath });
    }
  }
  folders.sort((a, b) => a.folderName.localeCompare(b.folderName, "zh-Hant"));
  return folders;
}

async function callImportEndpoint(token, { folderName, markdown, mode }) {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mode, folderName, markdown }),
    });
    const bodyText = await res.text();
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { error: `non-JSON response (HTTP ${res.status}): ${bodyText.slice(0, 200)}` };
    }
    if (!res.ok) {
      return { status: "error", warnings: [body.error || `HTTP ${res.status}`] };
    }
    return body;
  } catch (err) {
    return { status: "error", warnings: [`request failed: ${err.message}`] };
  }
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

function printTable(rows) {
  const cols = [
    { key: "folderName", label: "資料夾", width: 28 },
    { key: "status", label: "狀態", width: 20 },
    { key: "sellPrice", label: "售價(USD)", width: 12 },
    { key: "warnings", label: "警告", width: 50 },
  ];
  const pad = (s, w) => {
    const str = String(s ?? "");
    // Rough width accounting for CJK double-width chars so columns stay
    // roughly aligned in a monospace terminal.
    let visualLen = 0;
    for (const ch of str) visualLen += /[一-鿿　-〿＀-￯]/.test(ch) ? 2 : 1;
    const padLen = Math.max(0, w - visualLen);
    return str + " ".repeat(padLen);
  };
  const headerLine = cols.map((c) => pad(c.label, c.width)).join(" | ");
  console.log(headerLine);
  console.log("-".repeat(headerLine.length));
  for (const row of rows) {
    const line = cols
      .map((c) => pad(truncate(String(row[c.key] ?? ""), c.width), c.width))
      .join(" | ");
    console.log(line);
  }
}

async function main() {
  const { confirmFolder, confirmAll } = parseArgs(process.argv.slice(2));
  const token = await readToken();
  if (!token) return;

  const folders = await findCaseFolders();
  if (folders.length === 0) {
    console.log("沒有找到任何案件資料.md，結束。");
    return;
  }

  console.log(`找到 ${folders.length} 個案件資料夾，端點：${ENDPOINT}`);
  if (confirmAll) {
    console.log("模式：--confirm-all（將對所有資料夾寫入 DB）");
  } else if (confirmFolder) {
    console.log(`模式：--confirm=${confirmFolder}（只確認這一個資料夾）`);
  } else {
    console.log("模式：dry-run（預覽，不寫入 DB）");
  }
  console.log("");

  // When --confirm=<folder> is given, only that one folder needs a live
  // call — skip fetching/calling the endpoint for every other folder
  // entirely (no point dry-running 14 folders just to confirm 1).
  const targetFolders =
    confirmFolder && !confirmAll
      ? folders.filter((f) => f.folderName === confirmFolder)
      : folders;

  if (confirmFolder && !confirmAll && targetFolders.length === 0) {
    console.error(`找不到資料夾「${confirmFolder}」（或裡面沒有 案件資料.md）`);
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const { folderName, mdPath } of targetFolders) {
    const markdown = await readFile(mdPath, "utf8");
    const shouldConfirmThis = confirmAll || confirmFolder === folderName;
    const mode = shouldConfirmThis ? "confirm" : "dry_run";

    const result = await callImportEndpoint(token, { folderName, markdown, mode });
    const sellPrice =
      result?.plan?.order?.totalPrice != null ? result.plan.order.totalPrice : "-";
    const warnings = Array.isArray(result?.warnings) ? result.warnings.join("; ") : "";

    rows.push({
      folderName,
      status: result?.status || "error",
      sellPrice,
      warnings,
    });
  }

  printTable(rows);

  const blockedCount = rows.filter((r) => r.status === "blocked_no_identifier").length;
  const blockedMemberCount = rows.filter((r) => r.status === "blocked_registered_member").length;
  const errorCount = rows.filter((r) => r.status === "error").length;
  console.log("");
  console.log(
    `合計 ${rows.length} 筆；blocked_no_identifier: ${blockedCount}；` +
      `blocked_registered_member: ${blockedMemberCount}；error: ${errorCount}`,
  );
  if (blockedMemberCount > 0) {
    console.log(
      "有案件的客人 email 已經是註冊會員帳號 — 這幾筆不會自動建訪客卡，" +
        "請直接在後台客人清單搜尋這個會員手動處理。",
    );
  }
  if (!confirmAll && !confirmFolder) {
    console.log("");
    console.log("這是 dry-run，沒有寫入任何資料。");
    console.log("要真的寫入，請加參數：--confirm=<資料夾名稱> 或 --confirm-all");
  }
}

main().catch((err) => {
  console.error("執行失敗（非預期錯誤）：", err.message);
  process.exitCode = 1;
});
