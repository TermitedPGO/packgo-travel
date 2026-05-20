/**
 * Tests for the inquiries sub-router.
 *
 * History:
 *   - Phase 4C extraction (2026-05-19): structural smoke covering the
 *     9 procedures originally at server/routers.ts L3850-4141.
 *   - v2 Wave 1 · Module 1.7 (2026-05-20): migration 0077 lands —
 *     "emergency" is now a first-class enum on inquiryType. The
 *     `inquiryType: "emergency" as "other"` cast in createEmergency has
 *     been removed. Added behavioral test verifying the row sent to
 *     db.createInquiry uses inquiryType: "emergency".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock collaborators BEFORE importing the router so the router picks
// up the mocked modules at construction time.
vi.mock("../db", () => ({
  createInquiry: vi.fn(),
  getAllInquiries: vi.fn(),
  getInquiryById: vi.fn(),
  updateInquiry: vi.fn(),
  getInquiryMessages: vi.fn(),
  createInquiryMessage: vi.fn(),
}));
vi.mock("../rateLimit", () => ({
  checkRateLimit: vi.fn(),
}));
vi.mock("../_core/notification", () => ({
  notifyOwner: vi.fn(() => Promise.resolve()),
}));

import { inquiriesRouter } from "./inquiries";
import * as db from "../db";
import { checkRateLimit } from "../rateLimit";

describe("inquiriesRouter (Phase 4C extraction)", () => {
  it("exposes all 9 procedures from the pre-split source", () => {
    const procs = Object.keys((inquiriesRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      [
        "list",
        "getById",
        "translate",
        "create",
        "createEmergency",
        "updateStatus",
        "update",
        "getMessages",
        "addMessage",
      ].sort(),
    );
  });
});

describe("inquiriesRouter.createEmergency — migration 0077 behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
  });

  /**
   * Builds a minimal tRPC context for invoking publicProcedure
   * mutations via createCaller. Only the fields createEmergency reads
   * (`ip`, optional `user`) need to be populated.
   */
  function makeContext() {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      user: null,
      ip: "127.0.0.1",
    };
  }

  it("persists inquiryType: 'emergency' (no more 'other' cast)", async () => {
    (db.createInquiry as any).mockResolvedValue({
      id: 42,
      inquiryType: "emergency",
    });

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.createEmergency({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      customerPhone: "+1-555-0100",
      currentLocation: "Reykjavík",
      severity: "passport",
      message: "Lost passport at hotel, need urgent help.",
    });

    expect(db.createInquiry).toHaveBeenCalledTimes(1);
    const rowArg = (db.createInquiry as any).mock.calls[0][0];
    expect(rowArg.inquiryType).toBe("emergency");
    // Subject prefix unchanged — backfill in migration 0077 depends on it.
    expect(rowArg.subject).toMatch(/^\[緊急 · /);
  });
});
