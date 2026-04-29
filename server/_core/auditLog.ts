/**
 * Admin audit log helper — fire-and-forget logging of admin mutations.
 *
 * v73: Required for compliance + dispute resolution. Every admin mutation that
 * touches customer data, tours, bookings, or settings should log here.
 *
 * Usage:
 *   await audit({ ctx, action: "tour.update", targetType: "tour", targetId: id, changes: { before, after } });
 *
 * Design:
 *   - Never throws — audit-write failures must never break the underlying request.
 *   - Captures actor, action, target, before/after diff, IP, user-agent.
 *   - Async — returns immediately, logging happens in the background.
 */

import { adminAuditLog } from "../../drizzle/schema";
import { getDb } from "../db";

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
 * Log an admin mutation. Fire-and-forget — caller does not await unless they
 * want to ensure the row is written before returning.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const { ctx, action, targetType, targetId, changes, reason, success = true, errorMessage } = input;
    if (!ctx.user) {
      // Non-admin or anonymous calls reaching audit() shouldn't happen, but
      // log a warning if they do. Don't throw — just skip.
      console.warn(`[audit] attempted to log without ctx.user: action=${action}`);
      return;
    }
    const db = await getDb();
    if (!db) return;

    let changesStr: string | null = null;
    if (changes !== undefined && changes !== null) {
      try {
        changesStr = JSON.stringify(changes).slice(0, 50_000);
      } catch {
        changesStr = String(changes).slice(0, 50_000);
      }
    }

    await db.insert(adminAuditLog).values({
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
    });
  } catch (err) {
    // Audit write failures must never break the request. Log loudly so they're
    // visible in Fly logs, but always swallow.
    console.error("[audit] write failed (request continued):", (err as Error)?.message);
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
