/**
 * Auth middleware — gates Express routes to logged-in users / admin.
 *
 * Mirrors the pattern used inline at server/_core/index.ts:420+ (invoice view
 * handler): pull JWT cookie → verify → lookup user → optionally check role.
 *
 * 2026-05-15 — extracted into reusable middlewares because four legacy
 * upload routers (avatar, tour image, PDF, general image) were mounted at
 * /api/* with zero authentication. Per SECURITY_AUDIT_2026_05_14.md P0
 * findings, anonymous attackers could drain R2 storage and pollute S3 key
 * namespaces under any tour.
 *
 * Two exports:
 *   - requireAuth  : any logged-in user (used by /upload-avatar — users
 *                    upload their own profile photo)
 *   - requireAdmin : strictly user.role === "admin" (used by the three
 *                    content-editing upload routers)
 *
 * Both attach the verified user to `req.authUser` for downstream handlers
 * to consume without a second DB lookup. Typed via the augmented Request
 * below.
 */

import type { NextFunction, Request, Response } from "express";
import { COOKIE_NAME } from "@shared/const";
import { verifyToken } from "../jwt";
import { getUserById } from "../db";
import { createChildLogger } from "./logger";
const log = createChildLogger({ module: "requireAdmin" });

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: number;
        email: string;
        role: string | null;
        name?: string | null;
      };
    }
  }
}

/**
 * Shared cookie → JWT → user lookup. Returns the user on success or
 * sends the appropriate 401/500 and returns null.
 */
async function authenticate(
  req: Request,
  res: Response
): Promise<Awaited<ReturnType<typeof getUserById>> | null> {
  try {
    const token = (req as any).cookies?.[COOKIE_NAME];
    if (!token) {
      res.status(401).json({ error: "Login required" });
      return null;
    }
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "Invalid or expired session" });
      return null;
    }
    const user = await getUserById(payload.userId);
    if (!user) {
      // Token was valid but user no longer exists (deleted). Treat as
      // unauthenticated rather than authorized.
      res.status(401).json({ error: "Account not found" });
      return null;
    }
    return user;
  } catch (err) {
    log.error({ err }, "[auth] middleware error");
    res.status(500).json({ error: "Authentication check failed" });
    return null;
  }
}

/** Allow any logged-in user. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;
  req.authUser = {
    id: user.id,
    email: user.email,
    role: user.role ?? null,
    name: user.name ?? null,
  };
  next();
}

/** Require user.role === "admin". */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = await authenticate(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    // Use 403 (not 404) — the client KNOWS the route exists; we don't
    // need to hide that fact from a logged-in non-admin user.
    res.status(403).json({ error: "Admin only" });
    return;
  }
  req.authUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name ?? null,
  };
  next();
}
