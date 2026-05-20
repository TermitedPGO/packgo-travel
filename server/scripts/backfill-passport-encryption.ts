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

import { eq, isNotNull, and, sql, asc, desc } from "drizzle-orm";
import {
  bookingParticipants,
  visaApplications,
  adminAuditLog,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { encryptToken, isEncrypted } from "../_core/tokenCrypto";
import { createChildLogger } from "../_core/logger";
import { captureException, initSentry } from "../_core/sentry";
import {
  canonicalAuditRow,
  computeRowHash,
} from "../_core/auditLog";

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
 * Write a single audit-log row marking that this backfill ran. Uses the
 * same canonical-row + hash-chain machinery as server/_core/auditLog.ts's
 * `audit()` helper so the verifier sees a clean chain across boundary
 * between human-triggered and system-triggered entries.
 *
 * Actor = system user (userId 0, role "system"). The auditLog schema
 * allows arbitrary integer userIds and string roles.
 */
async function writeAuditRow(result: BackfillResult): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const createdAt = new Date();
  const rowSansId = {
    userId: 0, // system actor
    userEmail: "system@packgo.local",
    userRole: "system",
    action: "passport_backfill_run",
    targetType: result.table,
    targetId: null,
    changes: JSON.stringify({
      rowCount: result.rowsProcessed,
      durationMs: result.durationMs,
      table: result.table,
    }),
    reason: null,
    ipAddress: null,
    userAgent: null,
    success: 1,
    errorMessage: null,
    createdAt,
  };

  // Read tip (chain head) BEFORE insert so we can chain correctly.
  const tip = await db
    .select({ rowHash: adminAuditLog.rowHash })
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.id))
    .limit(1);
  const previousHash = tip[0]?.rowHash ?? "GENESIS";

  const ins = await db.insert(adminAuditLog).values(rowSansId);
  const insertId = Number((ins as unknown as { insertId: number }[])[0]?.insertId ?? 0);
  if (!insertId) {
    log.warn({ result }, "[backfill] audit insert returned no id; row written unhashed");
    return;
  }
  const canonical = canonicalAuditRow({ id: insertId, ...rowSansId });
  const rowHash = computeRowHash(previousHash, canonical);
  await db
    .update(adminAuditLog)
    .set({ previousHash, rowHash })
    .where(eq(adminAuditLog.id, insertId));
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
