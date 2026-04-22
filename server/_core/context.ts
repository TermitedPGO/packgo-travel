import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { verifyToken } from "../jwt";
import { COOKIE_NAME } from "@shared/const";
import * as db from "../db";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  ip: string; // Round 72: always populated (never undefined) — use "unknown" sentinel if extraction fails
};

/**
 * Extract the real client IP, accounting for Fly.io / Cloudflare / other proxies.
 *
 * Priority:
 *   1. Fly-Client-IP — set by Fly.io's edge. Most trustworthy in production.
 *   2. X-Forwarded-For — standard proxy header; take the leftmost (original client).
 *   3. req.socket.remoteAddress — direct connection fallback.
 *   4. "unknown" sentinel — when all else fails (should be rare).
 *
 * Round 72: TrpcContext never exposed `ip` before, so ai.chat was falling back
 * to `(ctx as any).ip ?? "unknown"` — which was ALWAYS "unknown", making the
 * per-IP rate limit effectively a single shared 60/hour bucket for all anonymous
 * traffic. This helper fixes that.
 */
export function getClientIp(req: Request): string {
  // Fly.io sets this and strips any client-supplied copy, so it's trustworthy.
  const flyIp = req.headers["fly-client-ip"];
  if (typeof flyIp === "string" && flyIp.length > 0) {
    return flyIp;
  }

  // Standard forwarded header — take leftmost (original client).
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  // Direct connection (dev, same-machine, etc.)
  const remote = req.socket?.remoteAddress;
  if (remote) return remote;

  return "unknown";
}

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    // Get token from cookie
    const token = opts.req.cookies?.[COOKIE_NAME];

    if (token) {
      // Verify JWT token
      const payload = verifyToken(token);

      if (payload) {
        // Get user from database
        user = await db.getUserById(payload.userId);
      }
    }
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    ip: getClientIp(opts.req),
  };
}
