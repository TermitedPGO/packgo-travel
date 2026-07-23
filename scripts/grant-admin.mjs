#!/usr/bin/env node
/**
 * One-off helper: grant a user the `admin` role.
 *
 * Created 2026-05-22 because Jeff wants `support@packgoplay.com` to be
 * admin alongside `jeffhsieh09@gmail.com`. The googleAuth upsert only
 * auto-grants admin when `user.openId === ENV.ownerOpenId`, which is
 * locked to a single Google sub ID — so any second admin has to be set
 * directly in the DB.
 *
 * Safety:
 *   - Read-only first: prints the user row before changing anything.
 *   - Refuses if no matching row exists (won't create phantom users).
 *   - No-ops if already admin.
 *   - Writes an `adminAuditLog` row with action="manual_role_grant".
 *
 * audit-chain-repair R5-3(Codex 2026-07-19 裁定):本腳本是 adminAuditLog 的
 * live writer,舊版直接插 NULL-hash 列——epoch 後跑一次就讓 prod 鏈永久轉紅。
 * 改為與主 writer(server/_core/auditLog.ts)同口徑的鏈式寫入:
 *   - createdAt 截秒(MySQL 小數秒四捨五入;毫秒不歸零則 hash 與存值可差一秒)
 *   - tip 只取 rowHash 非 null 的最後一列(孤列不把鏈拉回 GENESIS)
 *   - canonical 欄位序逐字對齊 canonicalAuditRow(auditLog.ts)——不可重排
 *   - hash UPDATE 失敗重試一次,仍失敗留孤列並大聲報錯(fail-visible)
 * 寫入邏輯 export 供 scripts/grant-admin.test.mjs 承重;script 本體只在直接
 * 執行時跑(invokedDirectly guard,同 safe-deploy.mjs 範式)。
 *
 * Usage:
 *   set -a && source ~/.config/packgo-backup.env && set +a
 *   node scripts/grant-admin.mjs <email>
 *
 * Or pass DATABASE_URL inline:
 *   DATABASE_URL="..." node scripts/grant-admin.mjs <email>
 */

import mysql from "mysql2/promise";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 逐字對齊 server/_core/auditLog.ts canonicalAuditRow 的欄位序;不可重排。 */
export function canonicalAuditRowMjs(row) {
  const rawMs = row.createdAt instanceof Date ? row.createdAt.getTime() : new Date(row.createdAt).getTime();
  const createdAtIso = new Date(Math.floor(rawMs / 1000) * 1000).toISOString();
  return JSON.stringify({
    id: row.id,
    userId: row.userId,
    userEmail: row.userEmail,
    userRole: row.userRole,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    changes: row.changes,
    reason: row.reason,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    success: row.success,
    errorMessage: row.errorMessage,
    createdAt: createdAtIso,
  });
}

export function computeRowHashMjs(previousHash, canonicalRow) {
  return createHash("sha256").update(previousHash).update("|").update(canonicalRow).digest("hex");
}

/**
 * 鏈式寫一列 adminAuditLog(與主 writer 同語意)。conn 只需 execute()。
 * 回傳 { insertId, rowHash, hashed }:hashed=false 表示 UPDATE 兩次都失敗、
 * 留下孤列(verifier 會標 missing-hash)。
 */
export async function writeChainedAuditRow(conn, fields) {
  // Codex R6-3(P1-5):機械化獨占 —— 本工具拿不到 app 的 Redis 鎖域(CLI 只有
  // DATABASE_URL),改用兩層機械保證:
  //  (a) DB advisory lock GET_LOCK:排除其他腳本執行個體;拿不到直接 throw,
  //      不進 read-tip+insert(與主 writer 的 lock-miss 紀律同語意)。
  //  (b) 寫後 Y 叉偵測:同 previousHash 的列若不只本列,代表與 app 併發叉鏈,
  //      大聲報錯並回 forked:true(caller exit 1);verifier 亦會標 chain-broken,
  //      雙重 fail-visible。不是「靠註解要求別併發」,是寫完機械查證。
  const [lockRows] = await conn.execute("SELECT GET_LOCK('audit:tip:lock', 5) AS l");
  if (!Array.isArray(lockRows) || Number(lockRows[0]?.l) !== 1) {
    throw new Error("audit tip advisory lock unavailable — refusing to write (avoid Y-fork)");
  }
  try {
    return await writeChainedAuditRowLocked(conn, fields);
  } finally {
    // R10-2:RELEASE_LOCK 驗回傳(1=成功)。失敗記警告 —— 本工具是專用連線,
    // main 結束時 conn.end() 終止 session 即自動釋鎖,不會污染任何 pool;
    // 但如實記錄,不靜默。
    try {
      const [relRows] = await conn.execute("SELECT RELEASE_LOCK('audit:tip:lock') AS r");
      if (Number(relRows?.[0]?.r) !== 1) {
        console.error("[grant-admin] RELEASE_LOCK did not return 1 — lock will be freed when this dedicated session ends (conn.end)");
      }
    } catch (relErr) {
      console.error(`[grant-admin] RELEASE_LOCK failed: ${relErr?.message} — lock freed on session end (conn.end)`);
    }
  }
}

async function writeChainedAuditRowLocked(conn, fields) {
  // createdAt 截秒:存值與 hash 值同源(見檔頭 R5-3 說明)。
  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  const row = {
    userId: fields.userId,
    userEmail: fields.userEmail,
    userRole: fields.userRole,
    action: fields.action,
    targetType: fields.targetType ?? null,
    targetId: fields.targetId ?? null,
    changes: fields.changes ?? null,
    reason: fields.reason ?? null,
    ipAddress: fields.ipAddress ?? null,
    userAgent: fields.userAgent ?? null,
    success: fields.success ?? 1,
    errorMessage: fields.errorMessage ?? null,
    createdAt,
  };

  // tip:只認 rowHash 非 null 的最後一列(D2 同步)。
  const [tipRows] = await conn.execute(
    "SELECT rowHash FROM adminAuditLog WHERE rowHash IS NOT NULL ORDER BY id DESC LIMIT 1",
  );
  const previousHash = (Array.isArray(tipRows) && tipRows[0]?.rowHash) || "GENESIS";

  const [ins] = await conn.execute(
    `INSERT INTO adminAuditLog
       (userId, userEmail, userRole, action, targetType, targetId, changes, reason, ipAddress, userAgent, success, errorMessage, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.userId, row.userEmail, row.userRole, row.action, row.targetType, row.targetId,
      row.changes, row.reason, row.ipAddress, row.userAgent, row.success, row.errorMessage, row.createdAt,
    ],
  );
  const insertId = Number(ins?.insertId ?? 0);
  if (!insertId) {
    console.error("[grant-admin] audit insert returned no id — row left unhashed");
    return { insertId: 0, rowHash: null, hashed: false };
  }

  // 寫 hash(同 payload 重試一次;仍失敗留孤列、大聲報錯,fail-visible)。
  const writeHashes = async (prev, hash) => {
    const setHashes = () =>
      conn.execute("UPDATE adminAuditLog SET previousHash = ?, rowHash = ? WHERE id = ?", [
        prev, hash, insertId,
      ]);
    try {
      await setHashes();
    } catch (e1) {
      console.error(`[grant-admin] hash update failed; retrying once: ${e1?.message}`);
      await setHashes(); // 第二次仍失敗會 throw 給 caller
    }
  };

  let currentPrev = previousHash;
  let rowHash = computeRowHashMjs(currentPrev, canonicalAuditRowMjs({ id: insertId, ...row }));
  try {
    await writeHashes(currentPrev, rowHash);
  } catch (e2) {
    console.error(
      `[grant-admin] hash update failed twice — row ${insertId} left unhashed (verifier will flag missing-hash): ${e2?.message}`,
    );
    return { insertId, rowHash, hashed: false, forked: false };
  }

  // R9-2 更新:app writer 現在也取同名 DB advisory lock(auditLog.ts
  // withDbTipLock),與本工具**同一實際鎖域** —— 正常路徑下 delayed-app 交錯
  // 已被共鎖排除。以下收斂迴圈保留為縱深防禦(app 端鎖層錯誤走無鏈孤列的
  // 極端情況、或歷史孤列被自癒補 hash 時,自己的列自己修):
  // 重讀「id < 本列的最後有 hash 列」,前驅變了就重算重寫自己的 hash,直到
  // 連續一輪穩定(上限 5 輪,輪間 150ms 讓競爭者落地)。自己的列自己修;
  // 修不到的鏡像情況(別列在我們之後仍鏈同一前驅)由最終 fork 偵測抓出,
  // forked:true → caller exit 1,fail-closed,絕不靜默留 Y 叉。
  for (let round = 0; round < 5; round++) {
    const [priorRows] = await conn.execute(
      "SELECT rowHash FROM adminAuditLog WHERE id < ? AND rowHash IS NOT NULL ORDER BY id DESC LIMIT 1",
      [insertId],
    );
    const expectedPrev = (Array.isArray(priorRows) && priorRows[0]?.rowHash) || "GENESIS";
    if (expectedPrev === currentPrev) break; // 前驅穩定,收斂完成
    currentPrev = expectedPrev;
    rowHash = computeRowHashMjs(currentPrev, canonicalAuditRowMjs({ id: insertId, ...row }));
    try {
      await writeHashes(currentPrev, rowHash);
    } catch (e3) {
      console.error(`[grant-admin] re-chain update failed twice: ${e3?.message}`);
      return { insertId, rowHash, hashed: false, forked: false };
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // 最終 Y 叉偵測:除本列外還有別列鏈到同一個前驅(鏡像競爭,我們無權改
  // 別人的列)→ forked:true,caller exit 1;verifier 亦標 chain-broken。
  const [forkRows] = await conn.execute(
    "SELECT COUNT(*) AS n FROM adminAuditLog WHERE previousHash = ? AND id != ?",
    [currentPrev, insertId],
  );
  const forked = Number(forkRows?.[0]?.n ?? 0) > 0;
  if (forked) {
    console.error(
      `[grant-admin] Y-fork detected: another row also chains previousHash=${String(currentPrev).slice(0, 12)}… — verifier will flag chain-broken`,
    );
  }
  return { insertId, rowHash, hashed: true, forked };
}

/**
 * Codex R6-3(P1-4):連線設定必須固定 UTC client timezone(timezone:"Z")。
 * canonical hash 用 UTC ISO;mysql2 預設用本機時區序列化 Date —— PDT 機器上
 * 同一個 Date 的 canonical 是 19:34:56Z、送進 SQL 卻是 12:34:56,app/verifier
 * 以 UTC 重讀立即 row-modified。exported 供測試釘住。
 */
export function buildConnConfig(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 4000),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: true },
    timezone: "Z",
  };
}

async function main() {
  const EMAIL = process.argv[2];
  if (!EMAIL) {
    console.error("Usage: node scripts/grant-admin.mjs <email>");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[grant-admin] DATABASE_URL not set in env");
    process.exit(2);
  }

  const conn = await mysql.createConnection(buildConnConfig(url));

  try {
    // 1. Locate the row.
    const [rows] = await conn.execute(
      "SELECT id, email, name, role, openId, googleId, createdAt FROM users WHERE email = ? LIMIT 2",
      [EMAIL],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      console.error(`[grant-admin] no user with email=${EMAIL}`);
      console.error("→ sign in via Google OAuth at least once first, then re-run.");
      process.exit(1);
    }
    if (rows.length > 1) {
      console.error(`[grant-admin] multiple users with email=${EMAIL} — aborting (manual review)`);
      console.error(JSON.stringify(rows, null, 2));
      process.exit(1);
    }
    const target = rows[0];
    console.log("[grant-admin] target user:");
    console.log(
      `  id=${target.id} role=${target.role ?? "(null)"} name=${target.name ?? ""} openId=${target.openId ?? "(null)"} createdAt=${target.createdAt?.toISOString?.() ?? target.createdAt}`,
    );

    if (target.role === "admin") {
      console.log("[grant-admin] already admin — no-op.");
      process.exit(0);
    }

    // 2. Update.
    const oldRole = target.role;
    const [updateResult] = await conn.execute(
      "UPDATE users SET role = 'admin' WHERE id = ? AND email = ?",
      [target.id, EMAIL],
    );
    console.log(`[grant-admin] update affected ${updateResult.affectedRows} row(s)`);

    // 3. Verify.
    const [verifyRows] = await conn.execute(
      "SELECT id, role FROM users WHERE id = ? LIMIT 1",
      [target.id],
    );
    const newRole = Array.isArray(verifyRows) && verifyRows[0] ? verifyRows[0].role : null;
    if (newRole !== "admin") {
      console.error(`[grant-admin] verify failed: role still ${newRole}`);
      process.exit(1);
    }
    console.log(`[grant-admin] verified: role ${oldRole ?? "(null)"} → admin`);

    // 4. Audit log entry — 鏈式寫入(R5-3,見檔頭)。
    const changes = JSON.stringify({
      before: { role: oldRole },
      after: { role: "admin" },
      note: "scripts/grant-admin.mjs",
    });
    const audit = await writeChainedAuditRow(conn, {
      userId: target.id,
      userEmail: EMAIL,
      userRole: "admin",
      action: "manual_role_grant",
      targetType: "user",
      targetId: String(target.id),
      changes,
      reason: `Granted admin to ${EMAIL} via scripts/grant-admin.mjs (CLI). See ENV.ownerOpenId is locked to a single Google sub; this is the documented 2nd-admin path.`,
      ipAddress: "127.0.0.1",
      userAgent: "scripts/grant-admin.mjs",
      success: 1,
    });
    console.log(
      `[grant-admin] audit log entry written (id=${audit.insertId}, hashed=${audit.hashed})`,
    );
    if (audit.forked) {
      console.error("[grant-admin] concurrent fork detected — role change stands, but audit chain needs review; exiting 1");
      process.exit(1);
    }
    console.log("[grant-admin] DONE");
  } finally {
    await conn.end();
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`[grant-admin] fatal: ${e?.message}`);
    process.exit(1);
  });
}
