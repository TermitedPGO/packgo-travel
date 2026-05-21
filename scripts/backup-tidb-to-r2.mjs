#!/usr/bin/env node
/**
 * Daily TiDB → Cloudflare R2 external backup.
 *
 * Purpose: Pocket-OS-style worst-case insurance. TiDB Cloud has its own
 * 7-30 day backups, but those are IN the TiDB account — if the account is
 * compromised (or some agent mutates them), backups go with it.
 *
 * This script dumps the prod DB to a local temp file, gzips it, and
 * uploads to a SEPARATE R2 bucket (`packgo-backups`) with a SEPARATE
 * R2 token that has write-only access to that bucket. No agent has the
 * token. Recovery path: Jeff downloads from R2, restores manually.
 *
 * Recommended cron: 03:00 UTC daily (= 11:00 Taipei = 20:00 PT prev day).
 * Retention: 30 days (cron deletes older objects via R2 lifecycle rule
 * on the bucket — set in CF dashboard, not here).
 *
 * REQUIRED ENV (set as Fly secrets on a scheduled machine, OR run from
 * Jeff's Mac via launchd):
 *   DATABASE_URL                   — read-only user preferred but admin works
 *   BACKUP_R2_ACCESS_KEY_ID        — separate from R2_ACCESS_KEY_ID
 *   BACKUP_R2_SECRET_ACCESS_KEY    — separate token, scope=packgo-backups bucket only
 *   BACKUP_R2_ENDPOINT             — https://<account>.r2.cloudflarestorage.com
 *   BACKUP_R2_BUCKET               — packgo-backups
 *
 * Usage:
 *   node scripts/backup-tidb-to-r2.mjs
 *
 * Or with explicit env:
 *   DATABASE_URL=... BACKUP_R2_BUCKET=... node scripts/backup-tidb-to-r2.mjs
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const execAsync = promisify(exec);

const REQUIRED_ENV = [
  "DATABASE_URL",
  "BACKUP_R2_ACCESS_KEY_ID",
  "BACKUP_R2_SECRET_ACCESS_KEY",
  "BACKUP_R2_ENDPOINT",
  "BACKUP_R2_BUCKET",
];

function fatal(msg) {
  console.error(`[backup] FATAL: ${msg}`);
  process.exit(1);
}

function checkEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    fatal(`missing env vars: ${missing.join(", ")}`);
  }
}

function parseMySqlUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || "4000",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

async function runMysqldump(connection, outputPath) {
  const { host, port, user, password, database } = connection;
  // --single-transaction: consistent snapshot without table locks (InnoDB)
  // --quick: don't buffer rows in memory
  // --skip-lock-tables: no LOCK TABLES (TiDB doesn't support all flavors)
  // --hex-blob: binary-safe encoding for BLOB columns (passport encryption)
  // --no-tablespaces: skip privilege we may not have on TiDB Cloud
  // --set-gtid-purged=OFF: skip GTID stuff (TiDB ignores it)
  const args = [
    "--single-transaction",
    "--quick",
    "--skip-lock-tables",
    "--hex-blob",
    "--no-tablespaces",
    "--default-character-set=utf8mb4",
    "--routines",
    "--triggers",
    "--events",
    `--host=${host}`,
    `--port=${port}`,
    `--user=${user}`,
    `--password=${password}`,
    database,
  ];

  const cmd = `mysqldump ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`;

  console.log("[backup] starting mysqldump...");
  const startedAt = Date.now();
  const child = exec(cmd, { maxBuffer: 1024 * 1024 * 1024 }); // 1GB buffer

  const write = createWriteStream(outputPath);
  child.stdout?.pipe(write);

  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += d.toString();
  });

  await new Promise((resolve, reject) => {
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`mysqldump exit ${code}: ${stderr}`));
      } else {
        resolve();
      }
    });
    write.on("error", reject);
  });

  const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
  const stats = await stat(outputPath);
  console.log(
    `[backup] mysqldump done in ${dur}s, ${(stats.size / 1024 / 1024).toFixed(2)} MB`,
  );
}

async function gzipFile(inputPath, outputPath) {
  console.log("[backup] gzipping...");
  const startedAt = Date.now();
  await pipeline(
    createReadStream(inputPath),
    createGzip({ level: 9 }),
    createWriteStream(outputPath),
  );
  const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
  const stats = await stat(outputPath);
  console.log(
    `[backup] gzip done in ${dur}s, ${(stats.size / 1024 / 1024).toFixed(2)} MB (compressed)`,
  );
}

async function uploadToR2(filePath, key) {
  const client = new S3Client({
    region: "auto",
    endpoint: process.env.BACKUP_R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.BACKUP_R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.BACKUP_R2_SECRET_ACCESS_KEY,
    },
  });

  console.log(`[backup] uploading to r2://${process.env.BACKUP_R2_BUCKET}/${key}`);
  const startedAt = Date.now();
  const body = await readFile(filePath);
  await client.send(
    new PutObjectCommand({
      Bucket: process.env.BACKUP_R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: "application/gzip",
      Metadata: {
        "backup-source": "tidb-mysqldump",
        "backup-script-version": "1.0",
        "backup-host": process.env.HOSTNAME || "unknown",
      },
    }),
  );
  const dur = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[backup] upload done in ${dur}s`);
}

async function main() {
  checkEnv();

  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const tmpDump = join(tmpdir(), `packgo-${ts}.sql`);
  const tmpGz = join(tmpdir(), `packgo-${ts}.sql.gz`);
  const r2Key = `daily/${ts.slice(0, 10)}/packgo-${ts}.sql.gz`;

  try {
    const conn = parseMySqlUrl(process.env.DATABASE_URL);
    await runMysqldump(conn, tmpDump);
    await gzipFile(tmpDump, tmpGz);
    await uploadToR2(tmpGz, r2Key);

    console.log(`[backup] SUCCESS — r2://${process.env.BACKUP_R2_BUCKET}/${r2Key}`);
    process.exit(0);
  } catch (err) {
    console.error("[backup] FAILED:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    // best-effort cleanup
    await Promise.allSettled([
      unlink(tmpDump).catch(() => {}),
      unlink(tmpGz).catch(() => {}),
    ]);
  }
}

main();
