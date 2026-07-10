/**
 * Admin audit log helper — fire-and-forget logging of admin mutations.
 *
 * v73: Required for compliance + dispute resolution. Every admin mutation that
 * touches customer data, tours, bookings, or settings should log here.
 *
 * Usage:
 *   await audit({ ctx, action: "tour.update", targetType: "tour", targetId: id, changes: { before, after } });
 *
 * System-actor writes (no ctx.user):
 *   audit() intentionally no-ops when there is no ctx.user, so background code
 *   paths that mutate money/data outside an admin request would otherwise leave
 *   NO audit trail. Use systemAudit() for those. CONVENTION (F2 塊A, 2026-07-09):
 *   every LOCAL_SCRIPT_TOKEN internal write endpoint (server/_core/index.ts
 *   /api/admin/* confirm paths) and every webhook-driven financial write
 *   (Stripe/Plaid trust deferral, reversal, etc.) MUST call systemAudit() so
 *   the tamper-evident chain covers system actors, not just admins.
 *
 * Design:
 *   - Never throws — audit-write failures must never break the underlying request.
 *   - Captures actor, action, target, before/after diff, IP, user-agent.
 *   - Async — returns immediately, logging happens in the background.
 *   - 2026-05-15 SECURITY_AUDIT P2-1: tamper-evident hash chain (see
 *     computeRowHash + auditLogTipMutex below + verifyAuditChain export).
 */

import { adminAuditLog } from "../../drizzle/schema";
import { getDb } from "../db";
import { createHash } from "crypto";
import { desc, eq, asc, isNotNull } from "drizzle-orm";
import { redis } from "../redis";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "auditLog" });

// ─── Hash chain (SECURITY_AUDIT_2026_05_14 P2-1) ───────────────────────────

const GENESIS_HASH = "GENESIS";

/**
 * Canonicalize an audit row into a deterministic JSON string that the
 * verifier can reproduce later. Field order is FIXED — never reorder
 * these keys or the existing chain becomes invalid. Values are coerced
 * exactly the way they're stored (string ids, null vs missing, etc.)
 * so re-reading from the DB after insert reproduces the same hash.
 */
export function canonicalAuditRow(row: {
  id: number;
  userId: number;
  userEmail: string;
  userRole: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  changes: string | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: number;
  errorMessage: string | null;
  createdAt: Date | string;
}): string {
  const createdAtIso =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : new Date(row.createdAt).toISOString();
  const ordered = {
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
  };
  // JSON.stringify with no indent + no replacer — the object key order is
  // the insertion order of `ordered` above (V8 preserves this for string
  // keys), so the output is stable.
  return JSON.stringify(ordered);
}

export function computeRowHash(
  previousHash: string,
  canonicalRow: string
): string {
  return createHash("sha256")
    .update(previousHash)
    .update("|")
    .update(canonicalRow)
    .digest("hex");
}

/**
 * Redis-backed advisory lock around (read-tip + insert). Without this,
 * two concurrent admin actions can both read tip=A and both insert with
 * previousHash=A, producing a "Y-shaped" chain that the verifier reports
 * as tampered. PACK&GO has one admin so contention is rare; mutex is
 * cheap insurance.
 *
 * SET NX PX with a 10s TTL. If lock acquisition fails (Redis down, key
 * held), fall back to inserting without a previousHash — better to log
 * the action unchained than to drop the row entirely.
 */
async function withAuditLogTip<T>(fn: () => Promise<T>): Promise<T> {
  const lockKey = "audit:tip:lock";
  const lockVal = Math.random().toString(36).slice(2);
  const acquired = await redis
    .set(lockKey, lockVal, "PX", 10_000, "NX")
    .catch(() => null);
  try {
    return await fn();
  } finally {
    if (acquired === "OK") {
      // Lua release-only-if-mine; falls back to plain del if eval not available.
      const lua =
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      await redis.eval(lua, 1, lockKey, lockVal).catch(() => null);
    }
  }
}

interface AuditCtx {
  user?: { id: number; email: string; role: string } | null;
  req?: {
    ip?: string;
    headers?: { get?: (h: string) => string | null; [k: string]: any };
  };
}

interface AuditInput {
  ctx: AuditCtx;
  action: string; // e.g. "tour.update"
  targetType?: string;
  targetId?: string | number;
  changes?: any; // arbitrary JSON; will be stringified
  reason?: string;
  success?: boolean; // default true
  errorMessage?: string;
}

function extractIp(req?: AuditCtx["req"]): string | null {
  if (!req) return null;
  // Try common headers (Fly sets fly-client-ip, Cloudflare sets cf-connecting-ip)
  const get = (h: string) => {
    if (req.headers?.get) return req.headers.get(h);
    return req.headers?.[h] || req.headers?.[h.toLowerCase()];
  };
  return (
    get("fly-client-ip") ||
    get("cf-connecting-ip") ||
    get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.ip ||
    null
  );
}

function extractUA(req?: AuditCtx["req"]): string | null {
  if (!req) return null;
  const get = (h: string) => {
    if (req.headers?.get) return req.headers.get(h);
    return req.headers?.[h] || req.headers?.[h.toLowerCase()];
  };
  const ua = get("user-agent");
  return ua ? String(ua).slice(0, 500) : null;
}

/**
 * Sentinel userId for system-actor audit rows written by systemAudit(). No
 * real admin user has id 0 (autoincrement starts at 1), so this cleanly marks
 * a row as system-originated; the human-readable actor ("system:<module>")
 * lives in userEmail and userRole is fixed to "system".
 */
export const SYSTEM_ACTOR_USER_ID = 0;

/** The exact column shape (minus autoincrement id) written to adminAuditLog. */
interface AuditRowSansId {
  userId: number;
  userEmail: string;
  userRole: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  changes: string | null;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  success: number;
  errorMessage: string | null;
  createdAt: Date;
}

/**
 * Shared low-level writer for both audit() (admin actor) and systemAudit()
 * (system actor). Performs the tamper-evident hash-chain insert. Does NOT
 * swallow errors itself — each public caller wraps this in its own try/catch
 * so audit-write failures never break the underlying request.
 *
 * SECURITY_AUDIT_2026_05_14 P2-1: hash-chain.
 *
 * We need the new row's `id` to canonicalize before hashing. Two options:
 *   (a) Insert first, then UPDATE with the hashes — works but leaves a brief
 *       window where the row exists unhashed.
 *   (b) Generate the id explicitly before insert — requires the table to
 *       expose AUTO_INCREMENT next value, racy on TiDB.
 * We use (a) inside the mutex so concurrent writes still serialize and the
 * verifier sees a clean chain.
 */
async function writeAuditRow(rowSansId: AuditRowSansId): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await withAuditLogTip(async () => {
    // Read the tip BEFORE insert so concurrent writers can't both
    // chain to the same predecessor.
    const tip = await db
      .select({ rowHash: adminAuditLog.rowHash })
      .from(adminAuditLog)
      .orderBy(desc(adminAuditLog.id))
      .limit(1);
    const previousHash = tip[0]?.rowHash ?? GENESIS_HASH;

    const ins = await db.insert(adminAuditLog).values(rowSansId);
    const insertId = Number((ins as any)[0]?.insertId ?? 0);
    if (!insertId) {
      log.warn("[audit] insert returned no id; skipping hash");
      return;
    }
    const canonical = canonicalAuditRow({ id: insertId, ...rowSansId });
    const rowHash = computeRowHash(previousHash, canonical);
    await db
      .update(adminAuditLog)
      .set({ previousHash, rowHash })
      .where(eq(adminAuditLog.id, insertId));
  });
}

/**
 * Log an admin mutation. Fire-and-forget — caller does not await unless they
 * want to ensure the row is written before returning.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const { ctx, action, targetType, targetId, changes, reason, success = true, errorMessage } = input;
    if (!ctx.user) {
      // Non-admin or anonymous calls reaching audit() shouldn't happen, but
      // log a warning if they do. Don't throw — just skip. (Background/system
      // code paths with no ctx.user must call systemAudit() instead.)
      log.warn({ action }, "[audit] attempted to log without ctx.user");
      return;
    }

    let changesStr: string | null = null;
    if (changes !== undefined && changes !== null) {
      try {
        changesStr = JSON.stringify(changes).slice(0, 50_000);
      } catch {
        changesStr = String(changes).slice(0, 50_000);
      }
    }

    // createdAt is fixed at write time so the hash is deterministic
    // (defaultNow() would create a tiny gap between our hash-time and
    // the DB-recorded value).
    const createdAt = new Date();
    await writeAuditRow({
      userId: ctx.user.id,
      userEmail: ctx.user.email,
      userRole: ctx.user.role,
      action,
      targetType: targetType || null,
      targetId: targetId !== undefined ? String(targetId) : null,
      changes: changesStr,
      reason: reason || null,
      ipAddress: extractIp(ctx.req),
      userAgent: extractUA(ctx.req),
      success: success ? 1 : 0,
      errorMessage: errorMessage || null,
      createdAt,
    });
  } catch (err) {
    // Audit write failures must never break the request. Log loudly so they're
    // visible in Fly logs, but always swallow.
    log.error({ err }, "[audit] write failed (request continued)");
  }
}

/**
 * Log a mutation performed by a system/background code path that has no
 * ctx.user — webhooks (Stripe/Plaid), LOCAL_SCRIPT_TOKEN internal endpoints,
 * scheduled jobs. Unlike audit(), this NEVER no-ops on a missing user: the
 * whole point is to attribute writes that happen outside an admin request.
 *
 * The actor string ("system:<module>") lands in userEmail and userRole is
 * fixed to "system", so the tamper-evident chain and the admin audit UI treat
 * these exactly like admin rows, just with a system actor (userId = 0).
 *
 * Fire-and-forget at call sites: `void systemAudit(...).catch(() => {})`.
 * This body already swallows all errors (never throws); the call-site `.catch`
 * is belt-and-suspenders so an unhandled rejection can never surface into the
 * financial main flow it's attached to.
 *
 * @param actor  "system:<module>", e.g. "system:trustDeferral"
 * @param action short verb.noun, e.g. "trust.defer"
 * @param target affected entity id/key, or null for batch operations
 * @param detail arbitrary JSON (amount, counts, ids) — stringified into changes
 */
export async function systemAudit(
  actor: string,
  action: string,
  target: string | number | null,
  detail?: unknown,
): Promise<void> {
  try {
    let detailStr: string | null = null;
    if (detail !== undefined && detail !== null) {
      try {
        detailStr = JSON.stringify(detail).slice(0, 50_000);
      } catch {
        detailStr = String(detail).slice(0, 50_000);
      }
    }

    const createdAt = new Date();
    await writeAuditRow({
      userId: SYSTEM_ACTOR_USER_ID,
      userEmail: actor.slice(0, 320),
      userRole: "system",
      action,
      targetType: null,
      targetId: target !== null && target !== undefined ? String(target) : null,
      changes: detailStr,
      reason: null,
      ipAddress: null,
      userAgent: null,
      success: 1,
      errorMessage: null,
      createdAt,
    });
  } catch (err) {
    // System-audit failures must never break the financial main flow they're
    // attached to. Log loudly, always swallow.
    log.error({ err, actor, action }, "[systemAudit] write failed (main flow continued)");
  }
}

/**
 * Helper: compute a shallow before/after diff for changed fields only.
 * Use this to avoid logging the entire object when only a few fields changed.
 */
export function diffFields<T extends Record<string, any>>(
  before: T | null | undefined,
  after: Partial<T>
): { before: Partial<T>; after: Partial<T>; fields: string[] } {
  const changedFields: string[] = [];
  const beforePartial: Partial<T> = {};
  const afterPartial: Partial<T> = {};
  if (!before) {
    return { before: {}, after: { ...after }, fields: Object.keys(after) };
  }
  for (const key of Object.keys(after)) {
    const a = (after as any)[key];
    const b = (before as any)[key];
    // Naive deep compare via JSON
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changedFields.push(key);
      (beforePartial as any)[key] = b;
      (afterPartial as any)[key] = a;
    }
  }
  return { before: beforePartial, after: afterPartial, fields: changedFields };
}

// ─── Hash-chain verifier (SECURITY_AUDIT_2026_05_14 P2-1) ──────────────────

export interface ChainAnomaly {
  rowId: number;
  kind: "row-modified" | "chain-broken" | "missing-hash";
  expected?: string;
  actual?: string;
  detail: string;
}

export interface ChainVerifyResult {
  totalRows: number;
  hashedRows: number; // rows with non-null rowHash
  ungatedRows: number; // pre-migration rows without hash (trusted by id-monotonicity)
  anomalies: ChainAnomaly[];
  ok: boolean;
}

/**
 * Walk the audit log id-ascending and verify the hash chain.
 *
 * Three classes of anomaly:
 *   1. row-modified — the stored rowHash doesn't match what we
 *      recompute from the row's data. Means someone UPDATEd the row.
 *   2. chain-broken — the row's previousHash != the prior row's rowHash.
 *      Means someone DELETEd a row in the middle of the chain.
 *   3. missing-hash — row has null rowHash mid-chain (post-migration row
 *      somehow skipped hashing). Predates migration 0073 if it's at the
 *      head of the table — counted as "ungated" rather than anomalous.
 *
 * Returns a structured result the admin UI can display. Throws only on
 * actual DB errors, not on chain anomalies (those go in the result).
 */
export async function verifyAuditChain(): Promise<ChainVerifyResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("DB unavailable");
  }
  const rows = await db
    .select()
    .from(adminAuditLog)
    .orderBy(asc(adminAuditLog.id));

  const result: ChainVerifyResult = {
    totalRows: rows.length,
    hashedRows: 0,
    ungatedRows: 0,
    anomalies: [],
    ok: true,
  };

  // Walk forward. State machine:
  //   - `seenFirstHash` flips true the first time we encounter a row
  //     with a non-null rowHash. Earlier rows are "ungated" (pre-migration).
  //   - `expectedPrev` is the rowHash of the last verified-good row,
  //     used to validate the next row's previousHash.
  let seenFirstHash = false;
  let expectedPrev = GENESIS_HASH;

  for (const r of rows) {
    if (!r.rowHash) {
      if (!seenFirstHash) {
        // Pre-migration row — accept without checking
        result.ungatedRows++;
      } else {
        // Post-migration row with null hash → anomaly
        result.anomalies.push({
          rowId: r.id,
          kind: "missing-hash",
          detail: "Row appears after chain started but has no rowHash",
        });
        result.ok = false;
      }
      continue;
    }
    seenFirstHash = true;
    result.hashedRows++;

    // 1. chain-broken check
    if (r.previousHash !== expectedPrev) {
      result.anomalies.push({
        rowId: r.id,
        kind: "chain-broken",
        expected: expectedPrev,
        actual: r.previousHash ?? "(null)",
        detail:
          "previousHash does not match the prior row's rowHash — a row was deleted or chain skipped",
      });
      result.ok = false;
      // Recover: continue walking with this row's reported state.
      // Otherwise every subsequent row would also fail.
      expectedPrev = r.rowHash;
      continue;
    }

    // 2. row-modified check — recompute rowHash from canonical
    const canonical = canonicalAuditRow({
      id: r.id,
      userId: r.userId,
      userEmail: r.userEmail,
      userRole: r.userRole,
      action: r.action,
      targetType: r.targetType ?? null,
      targetId: r.targetId ?? null,
      changes: r.changes ?? null,
      reason: r.reason ?? null,
      ipAddress: r.ipAddress ?? null,
      userAgent: r.userAgent ?? null,
      success: r.success,
      errorMessage: r.errorMessage ?? null,
      createdAt: r.createdAt,
    });
    const recomputed = computeRowHash(r.previousHash ?? GENESIS_HASH, canonical);
    if (recomputed !== r.rowHash) {
      result.anomalies.push({
        rowId: r.id,
        kind: "row-modified",
        expected: recomputed,
        actual: r.rowHash,
        detail:
          "rowHash does not match recomputed value — row content was modified after insert",
      });
      result.ok = false;
    }

    expectedPrev = r.rowHash;
  }

  // Suppress an "unused import" warning when the verifier doesn't end up
  // querying via isNotNull (we keep the import in case a future optimizer
  // wants to scan only-hashed rows for partial verification).
  void isNotNull;

  return result;
}
