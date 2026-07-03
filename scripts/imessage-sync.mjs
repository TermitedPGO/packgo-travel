#!/usr/bin/env node
/**
 * imessage-sync.mjs — local desktop script, Phase1c iMessage/SMS desktop
 * sync (docs/features/customer-cockpit/design-phase1bc.md §Phase1c).
 *
 * Runs on Jeff's Mac (launchd, every 5 minutes — see
 * docs/features/customer-cockpit/imessage-sync-setup.md for the plist).
 * Reads ~/Library/Messages/chat.db (read-only) for new rows since the last
 * run, sends them to the deployed server for matching + filing into
 * customerInteractions. Nothing about chat.db content is ever written back
 * to it — this script never opens the DB for writing.
 *
 * ── PRIVACY HARD REQUIREMENT (Jeff, non-negotiable) ──────────────────────
 * Message TEXT for a phone number that is not a known customer must NEVER
 * leave this Mac. The design doc's literal wording ("本機只送電話對得上的
 * 完整內容") creates an ordering question worth spelling out explicitly,
 * because the matching logic (exact phone → customerProfiles row) lives in
 * the server's database, which this script has no direct access to:
 *
 *   Option ① — send text for every message, let the server decide what to
 *     persist. REJECTED. Even if the server only WRITES claimed messages to
 *     the DB, unclaimed message text would still have crossed the network
 *     and been visible to the server process/logs. That violates the literal
 *     requirement ("絕不送 text 內容" for unclaimed phones), not just its
 *     spirit.
 *   Option ② (CHOSEN) — two-step protocol:
 *     1. Call POST /api/admin/imessage-check-known-phones with the batch's
 *        distinct phone numbers (no message text). Server returns
 *        { knownPhones: string[] } — plain-text phone comparison against
 *        customerProfiles, same normalization as the main ingest match, but
 *        this endpoint returns ONLY which phones are known, never any
 *        content.
 *     2. Build the ingest payload: messages whose phone is in knownPhones
 *        get their real `text`; every other message gets `text: null`
 *        (content is set to null in memory before the array is ever passed
 *        to fetch — never conditionally redacted after serialization).
 *     3. POST /api/admin/imessage-ingest with that payload.
 *   This guarantees message content for an unclaimed phone never appears in
 *   any outbound HTTP request body from this Mac.
 *
 * ── chat.db schema (macOS Messages) — UNVERIFIED IN THIS ENVIRONMENT ────
 * This sandbox has no real chat.db to test against (Linux, no Messages.app).
 * The query below encodes my best understanding of the schema as of recent
 * macOS versions, but Jeff MUST verify column names against his actual
 * chat.db before trusting this in production (e.g. `sqlite3
 * ~/Library/Messages/chat.db ".schema message"`). Assumptions baked in:
 *   - `message` table: `ROWID` (int PK, monotonically increasing — used as
 *     the sync cursor), `date` (Apple-epoch int, see appleEpochToIso),
 *     `text` (nullable — modern iMessage attributedBody-only messages may
 *     have NULL `text`; this script skips those since there's nothing to
 *     sync), `is_from_me` (0/1 — 1 means outbound), `handle_id` (FK to
 *     `handle.ROWID`).
 *   - `handle` table: `ROWID`, `id` (the phone number or email string the
 *     conversation participant is identified by).
 *   - A message from Jeff himself (`is_from_me=1`) still joins to a `handle`
 *     row identifying who the conversation is WITH (the other party) — this
 *     is how Messages models it, but confirm on real data.
 *   - `guid` is used as the externalId (stable, unique per message, exists
 *     in every macOS Messages schema version encountered in documentation).
 * If actual columns differ, the SELECT below needs adjusting — the rest of
 * this script (cursor handling, epoch conversion, privacy gate, HTTP calls)
 * is independent of the exact query shape.
 *
 * ── Required dependency ──────────────────────────────────────────────────
 * This repo's package.json has no SQLite driver. Install one:
 *
 *   npm install --no-save better-sqlite3
 *
 * (or `pnpm add -w better-sqlite3` if Jeff wants it tracked in package.json —
 * left as --no-save here so this script doesn't silently modify the repo's
 * dependency tree; Jeff's call). This script checks for the module at
 * startup and prints that exact install command if it's missing, instead of
 * a raw stack trace.
 *
 * Usage:
 *   node scripts/imessage-sync.mjs
 *   (launchd invokes this on a 5-minute schedule; see setup doc)
 *
 * Config:
 *   PACKGO_API_BASE   env var override (default https://packgoplay.com)
 *   ~/.packgo/local-script-token       bearer token (shared with Phase1b's
 *     scripts/import-customer-cases.mjs — same file, same LOCAL_SCRIPT_TOKEN)
 *   ~/.packgo/imessage-sync-cursor.json   last-synced message.ROWID
 *   ~/.packgo/imessage-unclaimed.json     unclaimed phone + lastSeenAt +
 *     count (content NEVER stored here — see privacy note above)
 */

import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();
const CHAT_DB_PATH = join(HOME, "Library", "Messages", "chat.db");
const PACKGO_DIR = join(HOME, ".packgo");
const TOKEN_PATH = join(PACKGO_DIR, "local-script-token");
const CURSOR_PATH = join(PACKGO_DIR, "imessage-sync-cursor.json");
const UNCLAIMED_PATH = join(PACKGO_DIR, "imessage-unclaimed.json");
const LOG_PATH = join(PACKGO_DIR, "imessage-sync.log");

const API_BASE = process.env.PACKGO_API_BASE || "https://packgoplay.com";
const CHECK_PHONES_ENDPOINT = `${API_BASE}/api/admin/imessage-check-known-phones`;
const INGEST_ENDPOINT = `${API_BASE}/api/admin/imessage-ingest`;

// Server-side hard cap is 500 per request (see server/_core/index.ts) — batch
// under that so a large backlog after downtime doesn't 400 the whole run.
const BATCH_SIZE = 400;

// ── Apple epoch conversion (mirrors server/_core/appleEpoch.ts's logic —
// duplicated here, not imported, because this is a plain Node script that
// runs standalone on Jeff's Mac with no access to the TS build; the two
// MUST stay equivalent. See that file for the full rationale.) ────────────
const APPLE_EPOCH_OFFSET_SECONDS = new Date("2001-01-01T00:00:00Z").getTime() / 1000; // 978307200
const MIN_PLAUSIBLE_YEAR = 2015;
const MAX_PLAUSIBLE_YEAR = 2035;

function yearOfUnixSeconds(unixSeconds) {
  return new Date(unixSeconds * 1000).getUTCFullYear();
}
function isPlausibleYear(unixSeconds) {
  if (!Number.isFinite(unixSeconds)) return false;
  const year = yearOfUnixSeconds(unixSeconds);
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR;
}
function appleEpochToIso(rawValue) {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    throw new Error(`appleEpochToIso: rawValue must be a finite number, got ${String(rawValue)}`);
  }
  if (rawValue === 0) {
    return new Date(APPLE_EPOCH_OFFSET_SECONDS * 1000).toISOString();
  }
  const asNanoUnixSeconds = APPLE_EPOCH_OFFSET_SECONDS + rawValue / 1e9;
  if (isPlausibleYear(asNanoUnixSeconds)) {
    return new Date(asNanoUnixSeconds * 1000).toISOString();
  }
  const asSecUnixSeconds = APPLE_EPOCH_OFFSET_SECONDS + rawValue;
  if (isPlausibleYear(asSecUnixSeconds)) {
    return new Date(asSecUnixSeconds * 1000).toISOString();
  }
  throw new Error(`appleEpochToIso: could not resolve rawValue=${rawValue} to a plausible date`);
}

async function logLine(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    await mkdir(PACKGO_DIR, { recursive: true });
    await appendFile(LOG_PATH, line);
  } catch {
    // best-effort logging only
  }
  console.log(msg);
}

async function loadBetterSqlite3() {
  try {
    const mod = await import("better-sqlite3");
    return mod.default || mod;
  } catch {
    console.error(
      [
        "",
        "缺少必要套件：better-sqlite3",
        "",
        "請先安裝（在專案根目錄執行）：",
        "",
        "  npm install --no-save better-sqlite3",
        "",
        "安裝後重新執行這支腳本。",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return null;
  }
}

async function readToken() {
  if (!existsSync(TOKEN_PATH)) {
    console.error(
      [
        "",
        `找不到 token 檔案：${TOKEN_PATH}`,
        "",
        "跟 Phase1b 的 import-customer-cases.mjs 共用同一份，請參考",
        "docs/features/customer-cockpit/imessage-sync-setup.md 設定。",
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

async function readCursor() {
  if (!existsSync(CURSOR_PATH)) return 0;
  try {
    const raw = await readFile(CURSOR_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Number.isFinite(parsed.lastRowId) ? parsed.lastRowId : 0;
  } catch {
    return 0;
  }
}

async function writeCursor(lastRowId) {
  await mkdir(PACKGO_DIR, { recursive: true });
  await writeFile(CURSOR_PATH, JSON.stringify({ lastRowId, updatedAt: new Date().toISOString() }, null, 2));
}

async function loadUnclaimed() {
  if (!existsSync(UNCLAIMED_PATH)) return {};
  try {
    return JSON.parse(await readFile(UNCLAIMED_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** Record unclaimed phones — phone + lastSeenAt + count ONLY, never content. */
async function recordUnclaimed(phones, occurredAtIsoByPhone) {
  if (phones.length === 0) return;
  const store = await loadUnclaimed();
  for (const phone of phones) {
    const existing = store[phone] || { count: 0, lastSeenAt: null };
    existing.count += 1;
    const occurredAt = occurredAtIsoByPhone.get(phone);
    if (occurredAt && (!existing.lastSeenAt || occurredAt > existing.lastSeenAt)) {
      existing.lastSeenAt = occurredAt;
    }
    store[phone] = existing;
  }
  await mkdir(PACKGO_DIR, { recursive: true });
  await writeFile(UNCLAIMED_PATH, JSON.stringify(store, null, 2));
}

/**
 * Read new rows from chat.db since `sinceRowId`, opened read-only so
 * Messages.app is never locked out. See header comment for schema
 * assumptions that are UNVERIFIED against a real database in this
 * environment.
 */
function readNewMessages(db, sinceRowId) {
  // is_from_me: 1 = outbound (Jeff sent it), 0 = inbound.
  // handle.id: the phone number (or email, for iMessage-via-email — those
  // rows won't match any customerProfiles.phone and will correctly end up
  // in unclaimedPhones).
  const stmt = db.prepare(`
    SELECT
      message.ROWID      AS rowId,
      message.guid        AS guid,
      message.date         AS date,
      message.text          AS text,
      message.is_from_me     AS isFromMe,
      handle.id                AS handleId
    FROM message
    LEFT JOIN handle ON handle.ROWID = message.handle_id
    WHERE message.ROWID > ?
    ORDER BY message.ROWID ASC
  `);
  return stmt.all(sinceRowId);
}

async function callCheckKnownPhones(token, phones) {
  if (phones.length === 0) return [];
  const res = await fetch(CHECK_PHONES_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phones }),
  });
  if (!res.ok) {
    throw new Error(`check-known-phones HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  return Array.isArray(body.knownPhones) ? body.knownPhones : [];
}

async function callIngest(token, messages) {
  const res = await fetch(INGEST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages }),
  });
  const bodyText = await res.text();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`ingest non-JSON response (HTTP ${res.status}): ${bodyText.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`ingest HTTP ${res.status}: ${body.error || bodyText.slice(0, 200)}`);
  }
  return body;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const betterSqlite3 = await loadBetterSqlite3();
  if (!betterSqlite3) return;

  if (!existsSync(CHAT_DB_PATH)) {
    console.error(
      [
        "",
        `找不到 chat.db：${CHAT_DB_PATH}`,
        "",
        "確認：1) 這台 Mac 有登入 iMessage 且訊息已同步 2) 執行這支腳本的",
        "程式（Terminal / node）已在 系統設定 → 隱私權與安全性 → 完整磁碟",
        "取用權限 加入。詳見 docs/features/customer-cockpit/imessage-sync-setup.md",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const token = await readToken();
  if (!token) return;

  const cursor = await readCursor();
  let db;
  try {
    // readonly: true — never write to chat.db, never risk locking
    // Messages.app out of its own database.
    db = new betterSqlite3(CHAT_DB_PATH, { readonly: true, fileMustExist: true });
  } catch (err) {
    console.error(
      [
        "",
        `無法開啟 chat.db（唯讀模式）：${err.message}`,
        "",
        "最常見原因：缺少「完整磁碟取用權限」。詳見",
        "docs/features/customer-cockpit/imessage-sync-setup.md",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  let rawRows;
  try {
    rawRows = readNewMessages(db, cursor);
  } finally {
    db.close();
  }

  if (rawRows.length === 0) {
    await logLine("no new messages since last cursor");
    return;
  }

  // Convert epoch + build IngestMessage skeletons. Skip (log, don't abort)
  // rows with unresolvable timestamps or no handle/phone.
  const candidates = [];
  let maxRowId = cursor;
  let skipped = 0;
  for (const row of rawRows) {
    maxRowId = Math.max(maxRowId, row.rowId);
    if (!row.handleId) {
      skipped++;
      continue; // no participant identifier — nothing to match against
    }
    if (row.text == null) {
      skipped++;
      continue; // e.g. attributedBody-only / reaction-only rows — nothing to sync
    }
    let occurredAtIso;
    try {
      occurredAtIso = appleEpochToIso(row.date);
    } catch (err) {
      await logLine(`skip rowId=${row.rowId}: ${err.message}`);
      skipped++;
      continue;
    }
    candidates.push({
      externalId: row.guid,
      phone: row.handleId,
      direction: row.isFromMe ? "outbound" : "inbound",
      text: row.text,
      occurredAtIso,
    });
  }

  if (candidates.length === 0) {
    await writeCursor(maxRowId);
    await logLine(`processed ${rawRows.length} rows, 0 sendable (${skipped} skipped), cursor advanced to ${maxRowId}`);
    return;
  }

  // ── Privacy gate: ask the server which phones are known BEFORE sending
  // any text. See header comment "Option ②". ──────────────────────────────
  const distinctPhones = Array.from(new Set(candidates.map((c) => c.phone)));
  let knownPhones = [];
  try {
    for (const phoneBatch of chunk(distinctPhones, BATCH_SIZE)) {
      const known = await callCheckKnownPhones(token, phoneBatch);
      knownPhones.push(...known);
    }
  } catch (err) {
    console.error(`check-known-phones 呼叫失敗，本次不同步（游標不前進）：${err.message}`);
    process.exitCode = 1;
    return;
  }
  const knownSet = new Set(knownPhones);

  // Track the latest occurredAtIso seen per phone across ALL candidates (not
  // just the locally-unknown subset) — recordUnclaimed() below is keyed off
  // whatever the SERVER reports as unclaimedPhones in the ingest response,
  // which is not guaranteed to be the exact same set as knownSet's complement
  // (e.g. a phone the local check called "known" could still come back
  // unclaimed from the ingest endpoint on a DB blip). Building this map from
  // every candidate, regardless of isKnown, guarantees a lastSeenAt entry
  // exists for any phone the server later reports unclaimed.
  const occurredAtIsoByPhone = new Map();
  for (const c of candidates) {
    const prior = occurredAtIsoByPhone.get(c.phone);
    if (!prior || c.occurredAtIso > prior) occurredAtIsoByPhone.set(c.phone, c.occurredAtIso);
  }

  // Build the final payload: text is set to null in memory for any phone
  // NOT in knownSet, BEFORE it is ever placed into the array passed to
  // fetch/JSON.stringify. This is the enforcement point for the privacy
  // requirement.
  const payload = candidates.map((c) => {
    const isKnown = knownSet.has(c.phone);
    return {
      externalId: c.externalId,
      phone: c.phone,
      direction: c.direction,
      text: isKnown ? c.text : null,
      occurredAtIso: c.occurredAtIso,
    };
  });

  let totalClaimed = 0;
  let totalErrors = 0;
  const allUnclaimedPhones = new Set();
  try {
    for (const batch of chunk(payload, BATCH_SIZE)) {
      const result = await callIngest(token, batch);
      totalClaimed += result.claimed || 0;
      totalErrors += result.errors || 0;
      for (const p of result.unclaimedPhones || []) allUnclaimedPhones.add(p);
    }
  } catch (err) {
    console.error(`ingest 呼叫失敗，本次不前進游標：${err.message}`);
    process.exitCode = 1;
    return;
  }

  // Cursor only advances after a successful ingest call — a failed run gets
  // retried in full next time rather than silently losing messages.
  await writeCursor(maxRowId);
  await recordUnclaimed(Array.from(allUnclaimedPhones), occurredAtIsoByPhone);

  await logLine(
    `processed ${rawRows.length} rows (${skipped} skipped) → claimed=${totalClaimed} ` +
      `unclaimedPhones=${allUnclaimedPhones.size} errors=${totalErrors}, cursor=${maxRowId}`,
  );
}

main().catch(async (err) => {
  console.error("執行失敗（非預期錯誤）：", err.message);
  await logLine(`FATAL: ${err.stack || err.message}`);
  process.exitCode = 1;
});
