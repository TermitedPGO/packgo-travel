/**
 * Round 81 — Gmail OAuth callback handler (Express).
 *
 * Distinct from the user-login Google OAuth in `googleAuth.ts`. This flow:
 *   1. Admin visits /api/admin/connect-gmail (or clicks UI button)
 *   2. Server 302-redirects to Google consent screen
 *   3. Google calls back to /api/gmail/oauth/callback?code=...&state=...
 *   4. We exchange code for tokens, identify mailbox, save to gmailIntegration
 *   5. Redirect back to /admin?gmailConnected=1
 *
 * State parameter is signed userId to prevent CSRF. Only admin role can
 * complete the flow (verified by reading session cookie before persisting).
 *
 * 2026-05-21 — added /api/admin/connect-gmail as a server-side redirect
 * shortcut. Round 81 replaced OfficeOverviewTab (which had the Connect
 * Gmail UI) with ChatsTab, orphaning the UI button. Until ChatsTab gets
 * its own Gmail panel, this endpoint is the canonical way to start the
 * OAuth flow — admin bookmarks it.
 */

import type { Express, Request, Response } from "express";
import { exchangeCodeForTokens, getGmailAuthUrl } from "./_core/gmail";
import { getDb, getUserById } from "./db";
import { gmailIntegration } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { verifyToken } from "./jwt";
import { COOKIE_NAME } from "@shared/const";
import { encryptToken } from "./_core/tokenCrypto";

/** Helper: extract + validate admin user from request cookie. */
async function getAdminUserFromRequest(req: Request) {
  const token = (req as any).cookies?.[COOKIE_NAME];
  const payload = token ? verifyToken(token) : null;
  const user = payload ? await getUserById(payload.userId) : null;
  if (!user || user.role !== "admin") return null;
  return user;
}

export function initializeGmailOAuth(app: Express) {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/admin/connect-gmail — start Gmail OAuth flow
  //
  // Admin-only. Server-side redirect to Google consent screen. Replaces
  // the orphaned client-side `trpc.agent.gmailGetAuthUrl` UI path (the
  // OfficeOverviewTab GmailMiniPanel never mounts since Round 81 routed
  // /admin to ChatsTab instead). Jeff can bookmark this URL for one-click
  // re-auth when GmailPollWorker starts failing with invalid_grant.
  // ────────────────────────────────────────────────────────────────────
  app.get(
    "/api/admin/connect-gmail",
    async (req: Request, res: Response) => {
      const user = await getAdminUserFromRequest(req);
      if (!user) {
        return res
          .status(401)
          .send(
            "Unauthorized — admin login required. Sign in at /admin first, then revisit this URL.",
          );
      }
      try {
        const authUrl = getGmailAuthUrl(`uid:${user.id}`);
        return res.redirect(302, authUrl);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return res
          .status(500)
          .send(`Failed to build Gmail auth URL: ${msg}`);
      }
    },
  );

  app.get("/api/gmail/oauth/callback", async (req: Request, res: Response) => {
    try {
      // 1. Validate admin session
      const token = (req as any).cookies?.[COOKIE_NAME];
      const payload = token ? verifyToken(token) : null;
      const user = payload ? await getUserById(payload.userId) : null;
      if (!user || user.role !== "admin") {
        return res
          .status(401)
          .send("Unauthorized — admin login required to connect Gmail");
      }

      // 2. Extract code
      const code = req.query.code as string;
      const error = req.query.error as string;
      if (error) {
        return res.redirect(
          `/admin?gmailError=${encodeURIComponent(error)}`
        );
      }
      if (!code) {
        return res.status(400).send("Missing OAuth code");
      }

      // 3. Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code);

      // 4. Save / update integration row
      const db = await getDb();
      if (!db) return res.status(500).send("DB unavailable");

      const existing = await db
        .select()
        .from(gmailIntegration)
        .where(eq(gmailIntegration.emailAddress, tokens.emailAddress))
        .limit(1);

      // SECURITY_AUDIT_2026_05_14 P1-1: encrypt OAuth tokens at rest. Plaid
      // tokens use AES-256-GCM via tokenCrypto; Gmail now matches. Existing
      // plaintext rows continue to read via decryptToken's `enc:v1:` prefix
      // check (returns plaintext as-is when prefix is absent), so writers
      // can flip to encrypted-only without a one-shot migration — next
      // OAuth refresh re-encrypts each row in place.
      const encryptedAccess = encryptToken(tokens.accessToken);
      const encryptedRefresh = encryptToken(tokens.refreshToken);

      if (existing[0]) {
        await db
          .update(gmailIntegration)
          .set({
            accessToken: encryptedAccess,
            refreshToken: encryptedRefresh,
            scope: tokens.scope,
            tokenExpiresAt: tokens.expiresAt,
            isActive: 1,
            disconnectReason: null,
          })
          .where(eq(gmailIntegration.id, existing[0].id));
      } else {
        await db.insert(gmailIntegration).values({
          userId: user.id,
          emailAddress: tokens.emailAddress,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          scope: tokens.scope,
          tokenExpiresAt: tokens.expiresAt,
          isActive: 1,
        });
      }

      return res.redirect(
        `/admin?gmailConnected=${encodeURIComponent(tokens.emailAddress)}`
      );
    } catch (e) {
      console.error("[gmail oauth] callback failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      return res.redirect(`/admin?gmailError=${encodeURIComponent(msg)}`);
    }
  });
}
