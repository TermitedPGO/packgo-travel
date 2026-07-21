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
 *   Example (fire-and-forget, belt-and-suspenders catch):
 *     void systemAudit("system:trustDeferral", "trust.defer", bookingId, { amount }).catch(() => {});
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
import { and, desc, eq, asc, isNotNull, sql } from "drizzle-orm";
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
  // audit-chain-repair D1:毫秒歸零(floor)再 canonical。createdAt 欄位是 TIMESTAMP
  // (秒級,schema.ts:2562);若 hash 含毫秒,驗證從 DB 重讀(ms=000)重算必不合——
  // 這正是 2026-07-19 prod 查核 285/286 列 row-modified 的根因。
  // 注意(自查 P2 更正):MySQL/TiDB 對小數秒是「四捨五入」不是截斷,所以單靠這裡
  // floor 不足以保證 round-trip —— 一致性依賴寫入口(audit()/systemAudit())先把
  // Date 截到整秒再存再 hash(存值與 hash 值同源,ms=0 時 floor 與進位無差)。任何
  // 繞過這兩個入口、帶毫秒直插 adminAuditLog 的寫入者(如一次性腳本)都必須自行
  // 截秒,否則 ms>=500 時約半數列會變 row-modified 假警報。秒級敏感度由測試釘。
  const rawMs =
    row.createdAt instanceof Date
      ? row.createdAt.getTime()
      : new Date(row.createdAt).getTime();
  const createdAtIso = new Date(Math.floor(rawMs / 1000) * 1000).toISOString();
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
 * SET NX PX with a 10s TTL.
 *
 * Codex R5-2/R6-2:未取得鎖**不得**進 read-tip+insert 的 critical section(舊
 * 行為是照跑完整 fn,併發下兩筆同 previousHash Y 叉)。現在:搶鎖五次、間隔
 * 150ms(良性併發等到序列化);仍拿不到 → 回 null,呼叫端改走「無鏈插入」
 * (不讀 tip、不算 hash,留孤列)——
 * 稽核列絕不丟,孤列被 verifier 標 missing-hash,fail-visible。
 * R10-4 更正:Redis TTL 超窗不再構成 Y 叉面 —— DB 共鎖(withDbTipLock)下
 * 第二個 writer 只會被序列化或落無鏈孤列,不可能兩筆 hashed 同前驅。
 */
async function withAuditLogTip<T>(fn: () => Promise<T>): Promise<T | null> {
  const lockKey = "audit:tip:lock";
  const lockVal = Math.random().toString(36).slice(2);
  let acquired: string | null = null;
  // R6-2:重試帶等待(5 次,間隔 150ms)——良性併發(另一寫入正持鎖)要能
  // 等到序列化,而不是立刻退化成無鏈孤列;孤列沒人回填 hash,epoch 後一次
  // 良性碰撞就把鏈打紅到人工介入。只有 Redis 真的掛/長期被占才走無鏈路徑。
  for (let attempt = 0; attempt < 5 && acquired !== "OK"; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150));
    acquired = await redis.set(lockKey, lockVal, "PX", 10_000, "NX").catch(() => null);
  }
  if (acquired !== "OK") return null;
  try {
    return await fn();
  } finally {
    // Lua release-only-if-mine; falls back to plain del if eval not available.
    const lua =
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
    await redis.eval(lua, 1, lockKey, lockVal).catch(() => null);
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
/**
 * Codex R6-1:writeAuditRow 的可證身分核心。回傳本次寫入的確切
 * {insertId, rowHash, hashed};insert 失敗會 throw(由外層 writeAuditRow /
 * strict caller 各自決定吞或不吞)。ensure 一類需要「證明本次那一列落地」的
 * caller 用它,不再從吞錯的 systemAudit 推測成功。
 */
export interface AuditWriteReceipt {
  insertId: number;
  rowHash: string | null;
  hashed: boolean;
}

/**
 * Codex R8-2/R9-2/R10-2:app 與 grant-admin 進同一實際互斥域 —— MySQL advisory
 * lock GET_LOCK('audit:tip:lock'),app 端在 Redis NX 之內以 db.transaction 釘住
 * 一條 session 持鎖(advisory lock 只要求 acquire/release 同 session;受保護
 * 讀寫照常走 pool)。錯誤路徑一律 fail-closed(R9-2 更正舊注釋:**沒有**
 * Redis-only 裸跑退路):
 *   - fn 結果:已持雙鎖執行成功(或 fn 完成後 COMMIT 才炸 → 保留結果)
 *   - "db-lock-timeout":DB 鎖等 3s 未得 → caller 走無鏈孤列
 *   - "db-lock-unavailable":transaction 缺失 / BEGIN / GET_LOCK 層錯誤 →
 *     caller 走無鏈孤列(fail-visible),絕不無鎖重跑鏈式寫
 *   - fn 自己 throw:原樣上拋,fn 至多執行一次
 * R10-2:RELEASE_LOCK 必須回 1;throw/0/NULL = 這條 pool session 可能長駐帶鎖
 * (MySQL 明定 GET_LOCK 不隨 commit/rollback 釋放)→ 記 error 並以
 * KILL CONNECTION_ID() 終止污染 session(不放回 pool);KILL 也失敗則記
 * CRITICAL(fail-visible,verifier 會在後續孤列上顯紅)。
 */
async function withDbTipLock<T>(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  fn: () => Promise<T>,
): Promise<T | "db-lock-timeout" | "db-lock-unavailable"> {
  const tdb = db as unknown as { transaction?: <R>(f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<R>) => Promise<R> };
  // Codex R9-2:任何鎖層錯誤一律 fail-closed —— 絕不在釋鎖/無鎖狀態下重跑
  // hashed writer(那正是 delayed-app Y 叉的復活路徑)。三種結局:
  //   fn 結果       = 已持雙鎖執行成功(或 fn 完成後 COMMIT 才炸 —— 受保護
  //                   讀寫走 pool,空 tx 的 commit 失敗不影響已落地的寫,回結果)
  //   "db-lock-timeout"     = 鎖等 3s 未得 → caller 走無鏈孤列
  //   "db-lock-unavailable" = transaction 缺失 / BEGIN / GET_LOCK 層錯誤 →
  //                           caller 同樣走無鏈孤列(fail-visible),不裸跑鏈式寫
  //   fn 自己 throw = 原樣上拋(絕不重跑;fn 至多執行一次)
  if (typeof tdb.transaction !== "function") {
    log.error("[audit] db.transaction unavailable — refusing chained write (unchained fallback)");
    return "db-lock-unavailable";
  }
  let fnStarted = false;
  let fnCompleted = false;
  let fnResult: T | "db-lock-timeout" = "db-lock-timeout";
  try {
    await tdb.transaction(async (tx) => {
      const got = await tx.execute(sql`SELECT GET_LOCK('audit:tip:lock', 3) AS l`);
      const rows = Array.isArray(got) ? (got as unknown[])[0] : got;
      const l = Array.isArray(rows) ? (rows[0] as { l?: unknown })?.l : (rows as { l?: unknown })?.l;
      if (Number(l ?? 0) !== 1) {
        fnResult = "db-lock-timeout";
        fnCompleted = true;
        return;
      }
      fnStarted = true;
      try {
        fnResult = await fn();
        fnCompleted = true;
      } finally {
        // R10-2:RELEASE_LOCK 必須回 1。throw/0/NULL = session 可能長駐帶鎖
        // (GET_LOCK 不隨 commit/rollback 釋放,只能成功 release 或終止 session;
        // pool 會把這條連線放回去,之後所有 writer 都 timeout 產孤列)。
        // fail-closed:記 error + KILL CONNECTION_ID() 終止污染 session,
        // 不讓它回 pool;KILL 也失敗記 CRITICAL(fail-visible)。
        let released = false;
        try {
          const rel = await tx.execute(sql`SELECT RELEASE_LOCK('audit:tip:lock') AS r`);
          const relRows = Array.isArray(rel) ? (rel as unknown[])[0] : rel;
          const r = Array.isArray(relRows) ? (relRows[0] as { r?: unknown })?.r : (relRows as { r?: unknown })?.r;
          released = Number(r ?? 0) === 1;
        } catch {
          released = false;
        }
        if (!released) {
          log.error("[audit] RELEASE_LOCK did not return 1 — killing poisoned session (must not return to pool)");
          try {
            await tx.execute(sql`KILL CONNECTION_ID()`);
          } catch (killErr) {
            log.error(
              { err: killErr },
              "[audit] CRITICAL: failed to kill poisoned session — a pooled connection may hold audit:tip:lock; subsequent writers will time out to unchained rows (verifier red)",
            );
          }
        }
      }
    });
  } catch (err) {
    if (fnCompleted) {
      // fn 已成功、只有 COMMIT 層炸:受保護讀寫在 pool 上早已落地,回結果。
      log.warn({ err }, "[audit] tx commit failed after protected section completed — result kept");
      return fnResult;
    }
    if (fnStarted) throw err; // fn 自己的錯誤:上拋,絕不重跑
    log.error({ err }, "[audit] DB advisory lock layer failed — refusing chained write (unchained fallback)");
    return "db-lock-unavailable";
  }
  return fnResult;
}

async function writeAuditRowCore(rowSansId: AuditRowSansId): Promise<AuditWriteReceipt> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");

  const receipt = await withAuditLogTip(async (): Promise<AuditWriteReceipt | "db-lock-timeout" | "db-lock-unavailable"> =>
    withDbTipLock(db, async (): Promise<AuditWriteReceipt> => {
    // Read the tip BEFORE insert so concurrent writers can't both
    // chain to the same predecessor.
    // audit-chain-repair D2:tip 只認 rowHash 非 null 的列 —— 兩階段寫入的孤列
    // (insert 成功、hash update 失敗,如 prod rowId 630001)不再把下一筆拉回
    // GENESIS(prod rowId 660001 型鏈斷的根因)。verifier 對孤列標 missing-hash
    // 後 expectedPrev 不動,與此語意天然相容:孤列被標,鏈本身不斷。
    const tip = await db
      .select({ rowHash: adminAuditLog.rowHash })
      .from(adminAuditLog)
      .where(isNotNull(adminAuditLog.rowHash))
      .orderBy(desc(adminAuditLog.id))
      .limit(1);
    const previousHash = tip[0]?.rowHash ?? GENESIS_HASH;

    const ins = await db.insert(adminAuditLog).values(rowSansId);
    const insertId = Number((ins as any)[0]?.insertId ?? 0);
    if (!insertId) {
      log.warn("[audit] insert returned no id; skipping hash");
      return { insertId: 0, rowHash: null, hashed: false };
    }
    const canonical = canonicalAuditRow({ id: insertId, ...rowSansId });
    const rowHash = computeRowHash(previousHash, canonical);
    // audit-chain-repair D3:hash UPDATE 失敗重試一次;仍失敗留孤列(比丟列好)
    // 並大聲記錄。孤列會被 verifier 標 missing-hash;epoch 之後出現 = ok 轉 false
    // = 真訊號(修復前整條鏈本來就紅,這訊號是雜訊)。
    const setHashes = () =>
      db
        .update(adminAuditLog)
        .set({ previousHash, rowHash })
        .where(eq(adminAuditLog.id, insertId));
    try {
      await setHashes();
    } catch (firstErr) {
      log.warn({ err: firstErr, insertId }, "[audit] hash update failed; retrying once");
      try {
        await setHashes();
      } catch (retryErr) {
        log.error(
          { err: retryErr, insertId },
          "[audit] hash update failed twice — row left unhashed (verifier will flag missing-hash)",
        );
        return { insertId, rowHash, hashed: false };
      }
    }
    return { insertId, rowHash, hashed: true };
    }),
  );

  // Codex R5-2/R8-2:搶不到鎖(Redis 五次重試後,或 DB advisory lock 等 3s
  // 未得)→ 不進 critical section,改插無鏈孤列:不讀 tip(避免 Y 叉)、不算
  // hash。稽核列不丟;孤列被 verifier 標 missing-hash,fail-visible。
  if (receipt === null || receipt === "db-lock-timeout" || receipt === "db-lock-unavailable") {
    log.error(
      { reason: receipt === null ? "redis-lock" : receipt },
      "[audit] tip lock unavailable — inserting unchained row (verifier will flag missing-hash)",
    );
    const ins = await db.insert(adminAuditLog).values(rowSansId);
    const insertId = Number((ins as any)[0]?.insertId ?? 0);
    return { insertId, rowHash: null, hashed: false };
  }
  return receipt;
}

/** 舊語意薄 wrapper:呼叫端(audit/systemAudit)自帶 try/catch 吞錯。 */
async function writeAuditRow(rowSansId: AuditRowSansId): Promise<void> {
  await writeAuditRowCore(rowSansId);
}

/**
 * Codex R6-1/R6-3:嚴格版 systemAudit —— 不吞錯、回傳本次寫入的確切收據。
 * 兩類 caller:
 *   1. ensureAuditChainEpoch:需要證明「本次 epoch 列」落地(不得由吞錯通道推測)。
 *   2. backfill-passport-encryption:改走本函式 = 與主 writer 同一 Redis 鎖域、
 *      同 canonical、同 retry(R6-3 writers 真閉合)。
 * 失敗會 throw;caller 自行決定重試/報錯。
 */
export async function systemAuditStrict(
  actor: string,
  action: string,
  target: string | number | null,
  detail?: unknown,
  opts?: { targetType?: string | null },
): Promise<AuditWriteReceipt> {
  let detailStr: string | null = null;
  if (detail !== undefined && detail !== null) {
    try {
      detailStr = JSON.stringify(detail).slice(0, 50_000);
    } catch {
      detailStr = String(detail).slice(0, 50_000);
    }
  }
  const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
  return writeAuditRowCore({
    userId: SYSTEM_ACTOR_USER_ID,
    userEmail: actor.slice(0, 320),
    userRole: "system",
    action,
    targetType: opts?.targetType ?? null,
    targetId: target !== null && target !== undefined ? String(target) : null,
    changes: detailStr,
    reason: null,
    ipAddress: null,
    userAgent: null,
    success: 1,
    errorMessage: null,
    createdAt,
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
    // audit-chain-repair D1:截秒 —— 存的值與 hash 的值同源,且與 TIMESTAMP(0) round-trip。
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
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

    // audit-chain-repair D1:截秒(同 audit(),見上)。
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
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
  hashedRows: number; // rows with non-null rowHash (epoch 起算,epoch 存在時)
  ungatedRows: number; // pre-migration rows without hash (trusted by id-monotonicity)
  /** audit-chain-repair D4:epoch 之前的列數(毫秒丟失〔四捨五入非截斷〕缺陷時代,保留原樣不驗、不算異常)。 */
  legacyRows: number;
  /** 最後一筆 epochStart 列的 id;無 epoch 列時 null(維持全表走查)。 */
  epochStartId: number | null;
  /** R10-4 更正口徑:表內 epochStart 錨列(rowHash 非 null)總數。錨定走
   *  post-deploy endpoint(非 startup),正常恰一;>1 即重錨警訊 —— UI 紅色
   *  警示、safe-deploy 判 DEPLOYED_UNVERIFIED,並應與外存首錨憑證比對。 */
  epochCount: number;
  anomalies: ChainAnomaly[];
  ok: boolean;
}

/**
 * audit-chain-repair D4:鏈重錨標記 action。
 *
 * 2026-07-19 prod 查核證實鏈自 migration 0073 起天生驗不過(hash 用毫秒級
 * Date、TIMESTAMP(0) 存儲丟失毫秒(MySQL/TiDB 為四捨五入非截斷),重讀重算
 * 必不合;285/286 列 row-modified)。
 * 歷史列不重寫(重算 hash 只能證明「今天算過」,重寫稽核表本身是 tamper-evident
 * 的反面);以最後一筆 epochStart 列把缺陷時代誠實分段:之前 = legacyRows 保留
 * 原樣,之後 = 修復後口徑,鏈必須全綠。錨定**不在 startup**(R5-2/R7-1):
 * 由 safe-deploy 在證實所有機器綁定本次 release 後,呼叫 LOCAL_SCRIPT_TOKEN
 * 端點 /api/admin/audit-chain-epoch 觸發 ensureAuditChainEpoch(endpoint-only;
 * app 內建通道寫入,非人工改 prod 資料)。錨列應恰一:epochCount!==1 時
 * safe-deploy 判 DEPLOYED_UNVERIFIED、UI 顯紅色重錨警示 —— 沒有「雙錨無害」。
 */
export const AUDIT_CHAIN_EPOCH_ACTION = "auditChain.epochStart";

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

  // audit-chain-repair D4:找最後一筆 epochStart(rowHash 非 null 者)。存在時,
  // 之前的列全計 legacyRows(缺陷時代,保留原樣不驗);從 epoch 列起驗。
  // epoch 列自身驗 row-modified(由修復後 code 寫,必須綠);其 previousHash 指向
  // legacy 尾列的 stored hash,作為走查起點如實採用(pre-epoch 不追溯)。
  let epochStartId: number | null = null;
  let epochCount = 0;
  for (const r of rows) {
    if (r.action === AUDIT_CHAIN_EPOCH_ACTION && r.rowHash) {
      epochStartId = r.id;
      epochCount++;
    }
  }

  const result: ChainVerifyResult = {
    totalRows: rows.length,
    hashedRows: 0,
    ungatedRows: 0,
    legacyRows: 0,
    epochStartId,
    epochCount,
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
    // D4:epoch 之前的列 → legacy,不驗不算異常。走到 epoch 列時,以其自身
    // previousHash 為起點(chain-broken 檢查對 epoch 列自身恆過,row-modified 照驗)。
    if (epochStartId !== null && r.id < epochStartId) {
      result.legacyRows++;
      continue;
    }
    if (epochStartId !== null && r.id === epochStartId) {
      seenFirstHash = true;
      expectedPrev = r.previousHash ?? GENESIS_HASH;
    }
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

  return result;
}

/**
 * audit-chain-repair D5(R12-4 最終口徑):一次性鏈重錨,**endpoint-only** ——
 * 只由 safe-deploy 在證實所有機器綁定本次 release 後,經 LOCAL_SCRIPT_TOKEN
 * 端點 /api/admin/audit-chain-epoch 觸發;不在 startup、不在 boot。
 *
 * 最後一次 epoch attempt 有效 → exists;無效/不存在 → 經 systemAuditStrict 補寫
 * 並以確切 insertId 重查證實(app 內建通道,非人工改 prod 資料;生效唯一途徑 =
 * Jeff pnpm ship)。錨列應恰一:epochCount!==1 時 safe-deploy 判
 * DEPLOYED_UNVERIFIED、UI 紅色重錨警示 —— 沒有「多錨無害」。
 * epoch 後再出現異常,ok 轉 false 是真訊號 —— 不自動再錨,重錨是需要人裁定的
 * 例外事件。
 */
export async function ensureAuditChainEpoch(): Promise<"written" | "exists" | "skipped" | "failed"> {
  const db = await getDb();
  if (!db) return "skipped";
  // Codex R5-1:判準是「最後一次 epoch attempt」,不是「任意有效舊錨」。
  // 反例(R5 裁定可重現):writer A 寫出有效錨 → writer B 寫 epoch 但 hash 雙敗
  // 成孤列 → 若只查任意有效錨,B 的 re-query 看見 A 誤回 written、之後永回
  // exists,而 verifier 以 A 為錨、B 是錨後孤列 → ok 永紅、永不自癒。
  // 正確語意:取 id 最大的 epoch attempt(不論有無 hash);其 hash 有效才算
  // exists;無效(孤列)→ 補寫;寫後必證實「基準 id 之後的最後 attempt」有效
  // 才回 written。有效性判準與 verifier 完全一致:JS truthy(null 與空字串
  // 都不算 —— 不用 SQL IS NOT NULL,避免空字串被 ensure 當錨、被 verifier
  // 排除的分歧)。
  const lastAttempt = () =>
    db
      .select({ id: adminAuditLog.id, rowHash: adminAuditLog.rowHash })
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, AUDIT_CHAIN_EPOCH_ACTION))
      .orderBy(desc(adminAuditLog.id))
      .limit(1);
  const before = await lastAttempt();
  if (before.length > 0 && before[0].rowHash) return "exists";
  // Codex R6-1:成功身分不得由吞錯通道推測。改用 systemAuditStrict 取得本次
  // 寫入的確切 insertId,再以 eq(id) 重查「就是這一列」的 rowHash truthy 才回
  // written。R5 的「重查最後 attempt」仍可被競爭假陽性打穿:writer 是
  // INSERT(rowHash=null) 後對同一 id 補 hash —— before 看見孤錨 id 8,別的
  // writer 隨後把 id 8 補上 hash,本次 INSERT 失敗且被吞,after 重查同一個
  // id 8 已 truthy → 誤回 written。確切 id 語意下,本次 insert 失敗 → throw →
  // failed,別人補好的列輪不到本次充數。
  let receipt: AuditWriteReceipt;
  try {
    receipt = await systemAuditStrict("system:auditChain", AUDIT_CHAIN_EPOCH_ACTION, null, {
      reason: "timestamp precision-loss (rounding) design flaw repair — chain re-anchor (docs/features/audit-chain-repair)",
      evidenceRef: "PACKGO_AI交流/網站專案/財務篇/Claude/evidence-20260719-auditchain-raw.txt",
    });
  } catch (err) {
    log.error({ err }, "[auditChain] epoch anchor write failed");
    return "failed";
  }
  if (!receipt.insertId) return "failed";
  // 寫後以確切 id 重查:本次那一列的 hash 必須真的落在 DB(不信記憶體收據,
  // 與 clientBoot durable-ack 同一套「查得到才算」口徑)。
  const persisted = await db
    .select({ rowHash: adminAuditLog.rowHash })
    .from(adminAuditLog)
    .where(eq(adminAuditLog.id, receipt.insertId))
    .limit(1);
  return persisted.length > 0 && !!persisted[0].rowHash ? "written" : "failed";
}
