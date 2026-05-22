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
 * Usage:
 *   set -a && source ~/.config/packgo-backup.env && set +a
 *   node scripts/grant-admin.mjs <email>
 *
 * Or pass DATABASE_URL inline:
 *   DATABASE_URL="..." node scripts/grant-admin.mjs <email>
 */

import mysql from "mysql2/promise";

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

// Parse mysql:// URL into options (TiDB uses TLS on port 4000).
const u = new URL(url);
const config = {
  host: u.hostname,
  port: Number(u.port || 4000),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  database: u.pathname.replace(/^\//, ""),
  ssl: { rejectUnauthorized: true },
};

const conn = await mysql.createConnection(config);

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

  // 4. Audit log entry (NULL hash — predates chain for ad-hoc ops; matches
  // the schema comment on pre-migration rows).
  const changes = JSON.stringify({
    before: { role: oldRole },
    after: { role: "admin" },
    note: "scripts/grant-admin.mjs",
  });
  await conn.execute(
    `INSERT INTO adminAuditLog
       (userId, userEmail, userRole, action, targetType, targetId, changes, reason, ipAddress, userAgent, success)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      target.id,
      EMAIL,
      "admin",
      "manual_role_grant",
      "user",
      String(target.id),
      changes,
      `Granted admin to ${EMAIL} via scripts/grant-admin.mjs (CLI). See ENV.ownerOpenId is locked to a single Google sub; this is the documented 2nd-admin path.`,
      "127.0.0.1",
      "scripts/grant-admin.mjs",
      1,
    ],
  );
  console.log("[grant-admin] audit log entry written");
  console.log("[grant-admin] DONE");
} finally {
  await conn.end();
}
