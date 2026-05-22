/**
 * Tests for server/gmailOAuth.ts — specifically the /api/admin/connect-gmail
 * endpoint added 2026-05-21 (Round 81 orphan fix; the legacy OfficeOverviewTab
 * Connect-Gmail UI never mounted after ChatsTab replaced it. ChatsTab grew
 * an inline Gmail panel the same day, and OfficeOverviewTab was deleted
 * 2026-05-22 — this endpoint stays as the canonical bookmark-able entry).
 *
 * Cases:
 *   1. No session cookie     → 401
 *   2. Non-admin session     → 401
 *   3. Admin session + happy → 302 to Google consent
 *   4. Admin session + auth-url build error → 500
 *
 * Strategy: capture the route handler `app.get("/api/admin/connect-gmail", h)`
 * registered against a fake Express app, then call `h(req, res)` with mock
 * request/response objects. Avoids supertest dep.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Express, Request, Response } from "express";

vi.mock("./_core/gmail", () => ({
  exchangeCodeForTokens: vi.fn(),
  getGmailAuthUrl: vi.fn(),
}));

vi.mock("./db", () => ({
  getUserById: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./jwt", () => ({
  verifyToken: vi.fn(),
}));

vi.mock("./_core/tokenCrypto", () => ({
  encryptToken: (s: string) => `enc:v1:${s}`,
}));

vi.mock("@shared/const", () => ({
  COOKIE_NAME: "app_session_id",
}));

import { initializeGmailOAuth } from "./gmailOAuth";
import { getGmailAuthUrl } from "./_core/gmail";
import { getUserById } from "./db";
import { verifyToken } from "./jwt";

const mockGetAuthUrl = vi.mocked(getGmailAuthUrl);
const mockGetUserById = vi.mocked(getUserById);
const mockVerifyToken = vi.mocked(verifyToken);

/** Capture route handlers registered against a fake Express app. */
function captureHandlers(): {
  handlers: Map<string, (req: Request, res: Response) => any>;
  app: Express;
} {
  const handlers = new Map<string, (req: Request, res: Response) => any>();
  const app = {
    get: (path: string, handler: (req: Request, res: Response) => any) => {
      handlers.set(path, handler);
    },
    // Other methods if needed
    use: () => {},
    post: () => {},
  } as unknown as Express;
  return { handlers, app };
}

/** Mock Response that records status / redirect / send calls. */
function makeRes() {
  const state: {
    status: number;
    body: string | null;
    redirectTo: string | null;
    redirectStatus: number | null;
  } = { status: 200, body: null, redirectTo: null, redirectStatus: null };
  const res = {
    status: (code: number) => {
      state.status = code;
      return res;
    },
    send: (body: any) => {
      state.body = typeof body === "string" ? body : JSON.stringify(body);
      return res;
    },
    redirect: (...args: any[]) => {
      // signature: redirect(url) or redirect(status, url)
      if (typeof args[0] === "number") {
        state.redirectStatus = args[0];
        state.redirectTo = args[1];
      } else {
        state.redirectStatus = 302;
        state.redirectTo = args[0];
      }
      return res;
    },
  } as unknown as Response;
  return { res, state };
}

function makeReq(cookies: Record<string, string> = {}) {
  return {
    cookies,
    headers: {},
    query: {},
  } as unknown as Request;
}

describe("GET /api/admin/connect-gmail", () => {
  let handler: (req: Request, res: Response) => any;

  beforeEach(() => {
    vi.clearAllMocks();
    const { handlers, app } = captureHandlers();
    initializeGmailOAuth(app);
    const h = handlers.get("/api/admin/connect-gmail");
    if (!h) throw new Error("Route /api/admin/connect-gmail not registered");
    handler = h;
  });

  it("returns 401 when no session cookie present", async () => {
    const { res, state } = makeRes();
    await handler(makeReq({}), res);
    expect(state.status).toBe(401);
    expect(state.body).toMatch(/admin login required/i);
    expect(mockGetAuthUrl).not.toHaveBeenCalled();
  });

  it("returns 401 when session belongs to non-admin user", async () => {
    mockVerifyToken.mockReturnValue({ userId: 7 } as any);
    mockGetUserById.mockResolvedValue({ id: 7, role: "user" } as any);

    const { res, state } = makeRes();
    await handler(makeReq({ app_session_id: "fake-token" }), res);

    expect(state.status).toBe(401);
    expect(mockGetAuthUrl).not.toHaveBeenCalled();
  });

  it("returns 302 redirect to Google when admin session valid", async () => {
    mockVerifyToken.mockReturnValue({ userId: 1 } as any);
    mockGetUserById.mockResolvedValue({ id: 1, role: "admin" } as any);
    mockGetAuthUrl.mockReturnValue(
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=test-client",
    );

    const { res, state } = makeRes();
    await handler(makeReq({ app_session_id: "admin-token" }), res);

    expect(state.redirectStatus).toBe(302);
    expect(state.redirectTo).toContain("accounts.google.com");
    expect(mockGetAuthUrl).toHaveBeenCalledWith("uid:1");
  });

  it("returns 500 when getGmailAuthUrl throws (missing OAuth creds)", async () => {
    mockVerifyToken.mockReturnValue({ userId: 1 } as any);
    mockGetUserById.mockResolvedValue({ id: 1, role: "admin" } as any);
    mockGetAuthUrl.mockImplementation(() => {
      throw new Error("GMAIL_OAUTH_CLIENT_ID not configured");
    });

    const { res, state } = makeRes();
    await handler(makeReq({ app_session_id: "admin-token" }), res);

    expect(state.status).toBe(500);
    expect(state.body).toMatch(/Failed to build Gmail auth URL/i);
  });
});
