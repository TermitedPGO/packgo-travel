// server/db/customerProfile.ts — shared customer-identity resolution.
//
// Extracted (2026-07-02, Phase1b batch case-file import) from the dedup logic
// that already lived inline in server/agents/autonomous/opsTools.ts's
// create_customer tool (lines ~1667-1714). That tool's rule is the baseline
// for ANY code path that might create a customerProfiles row from an
// email/phone pair — email OR phone must be non-empty, and a duplicate is
// found via exact-email OR normalized-phone match. Two call sites (the ops
// agent tool, and the new case-file batch importer) must never carry two
// slightly-different copies of this rule — drift here silently creates
// duplicate or wrongly-merged customer cards. See docs/features/
// customer-cockpit/design-phase1bc.md §共用基礎設施.
//
// NOTE: opsTools.ts's create_customer tool keeps its own copy of the dedup
// SELECT above (still intentionally not rewired to call resolveOrIdentifyCustomer
// — out of caution, that file's query behavior must not change). It DOES call
// this file's insertCustomerProfileSafely (2026-07-03, 任務7 對抗審查 P0) for the
// actual INSERT, same as every other customerProfiles insert site — see that
// function's own docstring below.

import { eq, or, sql } from "drizzle-orm";
import { customerProfiles, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { followMergePointer } from "../_core/mergedProfile";
import { redis } from "../redis";

type DrizzleDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * MySQL duplicate-key error code (mysql2 surfaces this on UNIQUE collision).
 * Second copy of the same 2-line check already living in
 * server/_core/stripeWebhookIdempotency.ts — this repo's established
 * convention for small cross-file checks (see normalizePhoneForMatch above)
 * rather than a shared util for something this small.
 */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: string; errno?: number };
  return anyErr.code === "ER_DUP_ENTRY" || anyErr.errno === 1062;
}

/**
 * Normalize a phone number for duplicate matching. Strips pure formatting
 * (spaces / dashes / parens / dots) so "510-333-1234", "(510) 333.1234" and
 * "5103331234" all collide. Leading "+" is kept: "+1510…" vs "510…" genuinely
 * differ and we'd rather miss a match than merge two different people.
 *
 * Mirrors server/agents/autonomous/opsTools.ts's normalizePhoneForMatch
 * verbatim — kept as a second copy (not re-exported) because opsTools.ts is
 * off-limits for behavior changes per task scope, but the two MUST stay
 * byte-for-byte identical. Any edit here needs the same edit there.
 */
export function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/[\s\-().]/g, "");
}

export type CustomerIdentityStatus =
  | "existing"
  | "creatable"
  | "blocked_no_identifier"
  | "blocked_registered_member";

export interface ResolvedCustomerIdentity {
  status: CustomerIdentityStatus;
  profileId?: number;
  matchedBy?: "email" | "phone";
  registeredUserId?: number;
}

/**
 * Resolve an {email, phone} pair against customerProfiles WITHOUT writing
 * anything. Same rule as create_customer: at least one of email/phone must
 * be non-empty, else blocked_no_identifier (this is intentional — a case with
 * no real contact info for the customer must not get a fabricated identity).
 * If either matches an existing row (email exact match OR normalized-phone
 * match), returns "existing" with the CANONICAL profileId (follows
 * mergedIntoProfileId pointers, same as create_customer's dedup does) plus
 * which field matched. Otherwise "creatable" — caller may insert a new row.
 *
 * Never throws on the "no DB" case — returns blocked_no_identifier only when
 * there is truly no identifier; a missing DB during a lookup is surfaced by
 * letting the caller's own try/catch handle it (this fn does its own
 * awaiting so an unavailable DB will reject like any other DB call site).
 */
export async function resolveOrIdentifyCustomer(params: {
  email: string | null;
  phone: string | null;
}): Promise<ResolvedCustomerIdentity> {
  // 2026-07-03 對抗審查(任務7 P2):.toLowerCase() 補在這裡,讓「查重」跟
  // websiteIntake.ts 的「建卡」用同一套大小寫正規化——原本這裡只 trim,
  // 建卡那邊卻 trim+lowercase,兩邊比對基準不一致,只是恰好被 DB 預設的
  // case-insensitive collation蓋住沒爆出來,不該依賴 collation 假設。
  const email = (params.email ?? "").trim().toLowerCase() || null;
  const phone = (params.phone ?? "").trim() || null;

  if (!email && !phone) {
    return { status: "blocked_no_identifier" };
  }

  const db = await getDb();
  if (!db) {
    // Local dev / no DATABASE_URL: cannot check for dupes, but we also must
    // not silently claim "creatable" against unknown state. Treat as blocked
    // so callers see an explicit reason rather than risking a duplicate
    // insert once run against the real DB.
    return { status: "blocked_no_identifier" };
  }

  const conds: any[] = [];
  if (email) conds.push(eq(customerProfiles.email, email));
  if (phone) {
    const normPhone = normalizePhoneForMatch(phone);
    conds.push(
      sql`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${customerProfiles.phone}, ' ', ''), '-', ''), '(', ''), ')', ''), '.', '') = ${normPhone}`,
    );
  }

  let [dup] = await db
    .select({ id: customerProfiles.id, email: customerProfiles.email, phone: customerProfiles.phone })
    .from(customerProfiles)
    .where(conds.length === 1 ? conds[0] : or(...conds))
    .orderBy(customerProfiles.createdAt)
    .limit(1);

  if (!dup) {
    // Registered-member guard — same rule as opsTools.ts's create_customer
    // (see that file's "email_exists_registered" comment): an email that
    // belongs to a `users` row must never spawn a guest customerProfiles
    // row. Without this, a batch import whose extracted customerEmail
    // happens to match a signed-up member's account email would create a
    // parallel guest card, splitting that member's history in two — the
    // exact failure mode create_customer's guard exists to prevent.
    if (email) {
      const [registered] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (registered) {
        return { status: "blocked_registered_member", registeredUserId: registered.id };
      }
    }
    return { status: "creatable" };
  }

  // Same merge-pointer follow as create_customer's dedup path — a hit on a
  // card that has since been merged away must resolve to the final card, or
  // this would silently write against a hidden/blocked profile.
  const canonicalId = await followMergePointer(db, dup.id);
  let matchedBy: "email" | "phone" = "email";
  if (email && dup.email && dup.email.toLowerCase() === email.toLowerCase()) {
    matchedBy = "email";
  } else if (phone && dup.phone) {
    const dupNorm = normalizePhoneForMatch(dup.phone);
    if (dupNorm === normalizePhoneForMatch(phone)) matchedBy = "phone";
  }

  return { status: "existing", profileId: canonicalId, matchedBy };
}

export interface SafeProfileInsertResult {
  profileId: number;
  /** true when a concurrent insert won a DB-level race and this call
   * recovered the winner's id instead of creating a duplicate row.
   *
   * IMPORTANT (2026-07-03 監工裁決): only userId has a real DB constraint
   * (uq_cp_user, migration 0064). email intentionally has NO unique index —
   * a merged-away card (0109 mergedIntoProfileId) keeps its original email so
   * every filing entrance can still find it by email and follow the pointer;
   * multiple cards sharing an email is a legitimate architectural state here,
   * not corruption. A UNIQUE(email) index was proposed and rejected for
   * exactly this reason (rejects existing data AND breaks every future
   * merge). So for conflictColumn:"email" this catch branch is currently
   * unreachable in practice (no constraint ever throws ER_DUP_ENTRY on
   * email) — kept as defense-in-depth / forward compatibility only. The
   * actual email-race defense is withCustomerIntakeLock below.
   */
  recoveredFromRace: boolean;
}

/**
 * Insert a new customerProfiles row, recovering gracefully if a concurrent
 * insert already won on `conflictColumn`. Every INSERT into customerProfiles
 * across this codebase should go through here instead of a bare
 * `db.insert(customerProfiles)` — for conflictColumn:"userId" (uq_cp_user)
 * this is a real, load-bearing fix; for conflictColumn:"email" see the
 * IMPORTANT note on SafeProfileInsertResult above.
 *
 * On a caught duplicate-key error, re-selects by `conflictColumn` (oldest
 * row wins, matching every other dedup site in this codebase) and follows
 * any 0109 merge pointer so the caller never gets handed a hidden/merged-away
 * id. NEVER silently swallows a non-duplicate-key error, and never guesses
 * when there's no identifier to recover by — both cases rethrow the original
 * error so the caller's own error handling (try/catch, TRPCError, etc.) sees
 * it exactly as before this helper existed.
 */
export async function insertCustomerProfileSafely(
  db: DrizzleDb,
  values: Record<string, unknown>,
  conflictColumn: "email" | "userId" = "email",
): Promise<SafeProfileInsertResult> {
  try {
    const res = await db.insert(customerProfiles).values(values as any);
    const insertId =
      (res as unknown as [{ insertId?: number }])?.[0]?.insertId ?? (res as any)?.insertId;
    if (!insertId) throw new Error("[customerProfile] insert returned no insertId");
    return { profileId: Number(insertId), recoveredFromRace: false };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
    const keyValue = values[conflictColumn];
    if (keyValue == null) throw err; // no identifier to recover by — surface the original error

    const [winner] = await db
      .select({ id: customerProfiles.id })
      .from(customerProfiles)
      .where(
        conflictColumn === "email"
          ? eq(customerProfiles.email, keyValue as string)
          : eq(customerProfiles.userId, keyValue as number),
      )
      .orderBy(customerProfiles.createdAt)
      .limit(1);
    if (!winner) throw err; // shouldn't happen — surface the original error rather than guessing

    const canonicalId = await followMergePointer(db, winner.id);
    return { profileId: canonicalId, recoveredFromRace: true };
  }
}

// ── Redis per-email intake lock (2026-07-03 監工裁決) ───────────────────────
//
// The actual defense against the customerProfiles race: customerProfiles.email
// cannot carry a UNIQUE index (see SafeProfileInsertResult's IMPORTANT note
// above — 0109's merge design requires a merged-away card to keep its email
// so filing entrances can still find it and follow the pointer; multiple
// cards sharing an email is architecturally legitimate here). So the fix has
// to happen BEFORE the write, not be caught after it: serialize concurrent
// find-or-create calls for the same email with a Redis lock so only one
// caller is ever inside the resolveOrIdentifyCustomer→insert critical section
// for a given email at a time.
//
// Mirrors two existing patterns rather than inventing a third:
//   - server/_core/auditLog.ts's withAuditLogTip — SET NX + a random lockVal +
//     Lua compare-and-delete release (never delete a lock we no longer own,
//     e.g. after our own TTL expired and someone else acquired it).
//   - server/agents/autonomous/gmailPipeline.ts's processWithMessageLock —
//     fail-open on a Redis error (a blip must never block a real customer;
//     an occasional duplicate beats a dropped submission).
// Differs from both on CONTENTION (lock held by someone else, not a Redis
// error): gmailPipeline just skips (fine — the label re-gates next poll) and
// auditLog just barrels through unprotected (fine — worst case is an
// unchained audit row). Website intake must always return a real profileId,
// so it can't skip; instead this waits briefly for the holder (a find-or-
// create critical section is a couple of fast SELECT/INSERTs, not an LLM
// chain) then lets the caller's own fn() — which always starts with a fresh
// resolveOrIdentifyCustomer — re-check current state once before proceeding.

const INTAKE_LOCK_TTL_SECONDS = 30;
const INTAKE_LOCK_CONTENTION_WAIT_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` with a best-effort exclusive lock on `email` (normalized by the
 * caller — same value used for the resolveOrIdentifyCustomer lookup inside
 * fn). Always runs fn exactly once. Never throws on its own account — a
 * Redis error fails open (runs fn unprotected); a contended lock waits once
 * then runs fn anyway (fn's own fresh identity check is what actually
 * decides existing-vs-creatable, not this wrapper).
 */
export async function withCustomerIntakeLock<T>(
  email: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockKey = `intake-lock:${email}`;
  const lockVal = Math.random().toString(36).slice(2);
  let acquired = false;
  try {
    const ok = await redis.set(lockKey, lockVal, "EX", INTAKE_LOCK_TTL_SECONDS, "NX");
    acquired = ok === "OK";
  } catch {
    // Redis unavailable — fail-open, proceed unprotected.
    acquired = false;
  }
  if (!acquired) {
    // Either contended (someone else holds it) or Redis errored — either way
    // a short wait gives a genuine holder a chance to finish (and release)
    // before fn()'s own fresh SELECT runs, without blocking forever.
    await sleep(INTAKE_LOCK_CONTENTION_WAIT_MS);
  }
  try {
    return await fn();
  } finally {
    if (acquired) {
      // Lua release-only-if-mine: never delete a lock we no longer own
      // (e.g. our own TTL already expired and a new caller acquired it).
      const lua =
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
      await redis.eval(lua, 1, lockKey, lockVal).catch(() => {});
    }
  }
}
