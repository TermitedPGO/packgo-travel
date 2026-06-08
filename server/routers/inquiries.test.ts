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
// addMessage (admin) now delegates to the shared server/_core/inquiryReply
// helper, which dynamically `await import("../emailService")`. vi.mock
// intercepts the dynamic import so no real SendGrid/SMTP send happens.
vi.mock("../emailService", () => ({
  sendInquiryReply: vi.fn(),
}));

// The shared helper logs send failures via the pino logger (not console.*).
// Mock it so the failure path is assertable + no real Sentry/pretty init.
// vi.hoisted so the mock fn exists before the hoisted vi.mock factory runs.
const { loggerErrorMock } = vi.hoisted(() => ({ loggerErrorMock: vi.fn() }));
vi.mock("../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: loggerErrorMock,
    debug: vi.fn(),
  }),
}));

import { inquiriesRouter } from "./inquiries";
import * as db from "../db";
import { checkRateLimit } from "../rateLimit";
import { sendInquiryReply } from "../emailService";

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

// ---------------------------------------------------------------------------
// addMessage — admin reply emails the customer (PKG-1)
//
// When an ADMIN replies, the customer must actually receive the reply by
// email. The send is best-effort: a failure must NOT fail the mutation (the
// reply is already persisted), and only a *successful* admin send advances
// the thread to "replied". A customer posting to their own thread never
// triggers a send.
// ---------------------------------------------------------------------------
describe("inquiriesRouter.addMessage — admin reply emails the customer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeAdminContext() {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      user: { id: 1, role: "admin" },
      ip: "127.0.0.1",
    };
  }

  function makeCustomerContext() {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      // Owns the inquiry below (userId 99) so the ownership check passes.
      user: { id: 99, role: "user" },
      ip: "127.0.0.1",
    };
  }

  const inquiryRow = {
    id: 10,
    userId: 99,
    customerName: "王小姐",
    customerEmail: "customer@example.com",
    subject: "美西行程詢問",
    status: "new",
  };

  it("admin reply: sends the email, advances status to 'replied', returns emailSent=true", async () => {
    (db.getInquiryById as any).mockResolvedValue({ ...inquiryRow });
    (db.createInquiryMessage as any).mockResolvedValue({
      id: 500,
      inquiryId: 10,
      senderType: "admin",
      message: "我們已為您安排專人服務。",
    });
    (db.updateInquiry as any).mockResolvedValue({});
    (sendInquiryReply as any).mockResolvedValue(true);

    const caller = (inquiriesRouter as any).createCaller(makeAdminContext());
    const result = await caller.addMessage({
      inquiryId: 10,
      message: "我們已為您安排專人服務。",
    });

    // Sent with the inquiry's customer details + the admin's typed body.
    expect(sendInquiryReply).toHaveBeenCalledTimes(1);
    expect((sendInquiryReply as any).mock.calls[0][0]).toEqual({
      to: "customer@example.com",
      customerName: "王小姐",
      subject: "美西行程詢問",
      body: "我們已為您安排專人服務。",
      inquiryId: 10,
    });
    // A successful send advances the thread.
    expect(db.updateInquiry).toHaveBeenCalledWith(10, { status: "replied" });
    expect(result.emailSent).toBe(true);
  });

  it("send failure: never throws, leaves status untouched, returns emailSent=false", async () => {
    (db.getInquiryById as any).mockResolvedValue({ ...inquiryRow });
    (db.createInquiryMessage as any).mockResolvedValue({
      id: 501,
      inquiryId: 10,
      senderType: "admin",
      message: "回覆內容",
    });
    (db.updateInquiry as any).mockResolvedValue({});
    // SendGrid / SMTP blows up — the mutation must swallow it.
    (sendInquiryReply as any).mockRejectedValue(new Error("smtp down"));
    loggerErrorMock.mockClear();

    const caller = (inquiriesRouter as any).createCaller(makeAdminContext());
    // Resolves (does not throw) even though the send rejected.
    const result = await caller.addMessage({ inquiryId: 10, message: "回覆內容" });

    expect(sendInquiryReply).toHaveBeenCalledTimes(1);
    expect(result.emailSent).toBe(false);
    // A failed send must NOT advance the thread.
    expect(db.updateInquiry).not.toHaveBeenCalled();
    // The failure was logged via the shared helper's logger, not dropped.
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  it("customer posting to their own thread: no email is sent", async () => {
    (db.getInquiryById as any).mockResolvedValue({ ...inquiryRow });
    (db.createInquiryMessage as any).mockResolvedValue({
      id: 502,
      inquiryId: 10,
      senderType: "customer",
      message: "請問報價",
    });

    const caller = (inquiriesRouter as any).createCaller(makeCustomerContext());
    const result = await caller.addMessage({ inquiryId: 10, message: "請問報價" });

    expect(sendInquiryReply).not.toHaveBeenCalled();
    expect(db.updateInquiry).not.toHaveBeenCalled();
    expect(result.emailSent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// create — tour-page action area structured context (migration 0088)
//
// The redesigned tour page raises inquiries pre-seeded with which tour was
// being viewed (relatedTourId) + the fit-wizard answers (wizardAnswers JSON),
// while keeping name+email required and the per-IP rate limit unchanged.
// ---------------------------------------------------------------------------
describe("inquiriesRouter.create — tour-page structured context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (checkRateLimit as any).mockResolvedValue({ allowed: true });
    (db.createInquiry as any).mockResolvedValue({ id: 7, inquiryType: "general" });
  });

  function makeContext() {
    return {
      req: { headers: {}, socket: {} } as any,
      res: { cookie: () => {}, clearCookie: () => {} } as any,
      user: null,
      ip: "127.0.0.1",
    };
  }

  it("forwards relatedTourId + wizardAnswers + inquiryType to db.createInquiry", async () => {
    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.create({
      customerName: "王小明",
      customerEmail: "ming@example.com",
      customerPhone: "+1-555-0100",
      subject: "[報價] 北海道親子賞雪 5 日",
      message: "行程詢問: 北海道親子賞雪 5 日 (Tour #1234)",
      inquiryType: "custom_tour",
      relatedTourId: 1234,
      wizardAnswers: { people: "3-5", timeframe: "school_break", budget: "comfort" },
    });

    expect(db.createInquiry).toHaveBeenCalledTimes(1);
    const row = (db.createInquiry as any).mock.calls[0][0];
    expect(row.relatedTourId).toBe(1234);
    expect(row.wizardAnswers).toEqual({
      people: "3-5",
      timeframe: "school_break",
      budget: "comfort",
    });
    expect(row.inquiryType).toBe("custom_tour");
    expect(row.status).toBe("new");
  });

  it("defaults inquiryType to 'general' and omits tour context when not from a tour page", async () => {
    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.create({
      customerName: "Jane",
      customerEmail: "jane@example.com",
      subject: "General question",
      message: "Hello",
    });
    const row = (db.createInquiry as any).mock.calls[0][0];
    expect(row.inquiryType).toBe("general");
    expect(row.relatedTourId).toBeUndefined();
    expect(row.wizardAnswers).toBeUndefined();
  });

  it("rejects when rate limited (TOO_MANY_REQUESTS) without inserting", async () => {
    (checkRateLimit as any).mockResolvedValue({ allowed: false });
    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await expect(
      caller.create({
        customerName: "Bot",
        customerEmail: "bot@example.com",
        subject: "spam",
        message: "spam",
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(db.createInquiry).not.toHaveBeenCalled();
  });

  it("keeps name + email required (zod rejects empty name / bad email)", async () => {
    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await expect(
      caller.create({ customerName: "", customerEmail: "x@y.com", subject: "s", message: "m" }),
    ).rejects.toBeTruthy();
    await expect(
      caller.create({ customerName: "Ok", customerEmail: "not-an-email", subject: "s", message: "m" }),
    ).rejects.toBeTruthy();
    expect(db.createInquiry).not.toHaveBeenCalled();
  });
});
