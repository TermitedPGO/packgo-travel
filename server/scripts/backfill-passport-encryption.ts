/**
 * One-shot batched backfill: re-encrypt every plaintext passportNumber
 * in `bookingParticipants` + `visaApplications` using the AES-256-GCM
 * envelope from `server/_core/tokenCrypto.ts`.
 *
 * Run AFTER migration 0078 + Module 1.8 code lands:
 *   fly ssh console -C "pnpm tsx server/scripts/backfill-passport-encryption.ts"
 *
 * Idempotent. The script filters
 *     WHERE passportNumber IS NOT NULL AND passportNumber NOT LIKE 'enc:v1:%'
 * so re-running on a partially-completed state continues exactly where it
 * left off; rows already encrypted are skipped.
 *
 * Each batch is 100 rows with a 100ms pause between batches so we don't
 * thrash the prod DB during the backfill. ~50-200 rows total expected at
 * Wave 1; the whole run should finish in well under a minute.
 *
 * Audit-log entry per table: writes a `passport_backfill_run` row into
 * `adminAuditLog` with `{rowCount, durationMs}` in `changes` so the
 * verifier chain stays consistent and the run is forensically traceable.
 * Actor is the system user (userId 0, role "system") — auditLog
 * canonicalRow doesn't constrain those values, only that they be present.
 *
 * Exit code:
 *   0 — success (all rows processed or already encrypted)
 *   1 — any batch failed; Sentry has the exception
 */

import { eq, isNotNull, and, sql, asc } from "drizzle-orm";
import {
  bookingParticipants,
  visaApplications,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { encryptToken, isEncrypted } from "../_core/tokenCrypto";
import { createChildLogger } from "../_core/logger";
import { captureException, initSentry } from "../_core/sentry";
import { systemAuditStrict } from "../_core/auditLog";

const log = createChildLogger({ module: "backfillPassportEncryption" });

const BATCH_SIZE = 100;
const SLEEP_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BackfillResult {
  table: string;
  rowsProcessed: number;
  durationMs: number;
}

/**
 * Encrypt a single batch of plaintext rows for a given table. Returns the
 * number of rows updated in this call.
 */
async function processBookingParticipantsBatch(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find plaintext rows: passport NOT NULL and missing the 'enc:v1:' prefix.
  // We can't express "NOT LIKE 'enc:v1:%'" directly in Drizzle's typed API
  // cleanly so we use a raw SQL fragment.
  const rows = await db
    .select({ id: bookingParticipants.id, passportNumber: bookingParticipants.passportNumber })
    .from(bookingParticipants)
    .where(
      and(
        isNotNull(bookingParticipants.passportNumber),
        sql`${bookingParticipants.passportNumber} NOT LIKE 'enc:v1:%'`
      )
    )
    .orderBy(asc(bookingParticipants.id))
    .limit(BATCH_SIZE);

  if (rows.length === 0) return 0;

  let processed = 0;
  for (const row of rows) {
    if (!row.passportNumber) continue;
    // Defensive: skip if already encrypted (shouldn't happen given WHERE clause)
    if (isEncrypted(row.passportNumber)) continue;
    const ciphertext = encryptToken(row.passportNumber);
    await db
      .update(bookingParticipants)
      .set({ passportNumber: ciphertext })
      .where(eq(bookingParticipants.id, row.id));
    processed += 1;
  }
  return processed;
}

async function processVisaApplicationsBatch(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({ id: visaApplications.id, passportNumber: visaApplications.passportNumber })
    .from(visaApplications)
    .where(
      sql`${visaApplications.passportNumber} NOT LIKE 'enc:v1:%'`
    )
    .orderBy(asc(visaApplications.id))
    .limit(BATCH_SIZE);

  if (rows.length === 0) return 0;

  let processed = 0;
  for (const row of rows) {
    if (isEncrypted(row.passportNumber)) continue;
    const ciphertext = encryptToken(row.passportNumber);
    await db
      .update(visaApplications)
      .set({ passportNumber: ciphertext })
      .where(eq(visaApplications.id, row.id));
    processed += 1;
  }
  return processed;
}

async function backfillTable(
  tableName: "bookingParticipants" | "visaApplications",
  batchFn: () => Promise<number>
): Promise<BackfillResult> {
  const start = Date.now();
  let total = 0;
  for (let safetyCounter = 0; safetyCounter < 10_000; safetyCounter += 1) {
    const n = await batchFn();
    total += n;
    if (n === 0) break;
    log.info({ table: tableName, batchRows: n, total }, "[backfill] batch complete");
    await sleep(SLEEP_MS);
  }
  const durationMs = Date.now() - start;
  return { table: tableName, rowsProcessed: total, durationMs };
}

/**
 * Write a single audit-log row marking that this backfill ran.
 *
 * Codex R6-3(writers 真閉合):不再自帶 clone —— 改走主通道 systemAuditStrict
 * (server/_core/auditLog.ts):同一 Redis tip-lock 鎖域、同 canonical、同截秒、
 * 同 payload retry。與 app 併發不再可能 Y 叉(同鎖序列化);環境無 Redis 時
 * 主通道自動降級為無鏈孤列+大聲報錯(fail-visible),本工具照實回報。
 */
async function writeAuditRow(result: BackfillResult): Promise<void> {
  const receipt = await systemAuditStrict(
    "system:passportBackfill",
    "passport_backfill_run",
    null,
    { rowCount: result.rowsProcessed, durationMs: result.durationMs, table: result.table },
    { targetType: result.table },
  );
  if (!receipt.hashed) {
    log.error({ insertId: receipt.insertId }, "[backfill] audit row left unhashed (verifier will flag missing-hash)");
  }
}

async function main(): Promise<void> {
  initSentry();
  log.info({}, "[backfill] starting passport encryption backfill");

  try {
    const participantsResult = await backfillTable(
      "bookingParticipants",
      processBookingParticipantsBatch
    );
    log.info(
      {
        table: participantsResult.table,
        rowsProcessed: participantsResult.rowsProcessed,
        durationMs: participantsResult.durationMs,
      },
      "[backfill] bookingParticipants complete"
    );
    await writeAuditRow(participantsResult);

    const visaResult = await backfillTable(
      "visaApplications",
      processVisaApplicationsBatch
    );
    log.info(
      {
        table: visaResult.table,
        rowsProcessed: visaResult.rowsProcessed,
        durationMs: visaResult.durationMs,
      },
      "[backfill] visaApplications complete"
    );
    await writeAuditRow(visaResult);

    log.info(
      {
        bookingParticipants: participantsResult.rowsProcessed,
        visaApplications: visaResult.rowsProcessed,
      },
      "[backfill] all tables complete — exiting 0"
    );
    process.exit(0);
  } catch (err) {
    log.error({ err }, "[backfill] fatal error — exiting 1");
    captureException(err, { tags: { script: "backfill-passport-encryption" } });
    process.exit(1);
  }
}

// Run when invoked directly (not when imported by tests).
// `import.meta.url` resolves to a file:// URL when run via tsx; `process.argv[1]`
// is the absolute filesystem path. URL-compare via the path component.
const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  void main();
}

// Exports for testing.
export {
  processBookingParticipantsBatch,
  processVisaApplicationsBatch,
  backfillTable,
  writeAuditRow,
  main,
};
