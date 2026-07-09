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
  // Real notifyOwner() resolves `true` on delivery success — default the
  // mock to match so tests that don't care about the notify outcome don't
  // accidentally exercise the failure branch. See _core/notification.ts:
  // it NEVER rejects (SMTP errors / missing config are swallowed internally
  // and turned into a `false` resolve), so `false`, not a rejection, is the
  // realistic failure shape.
  notifyOwner: vi.fn(() => Promise.resolve(true)),
}));
// Wave1 收尾補丁 — createEmergency's notifyOwner failure catch reports to the
// error funnel (see server/_core/errorFunnel.ts). Mocked so the failure path
// is assertable without touching the real dedup/DB logic.
vi.mock("../_core/errorFunnel", () => ({
  reportFunnelError: vi.fn(() => Promise.resolve()),
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

// customer-cockpit 任務7(2026-07-03)— 網站渠道進場 fire-and-forget hook。
// Mocked so tests can assert it's CALLED with the right args without touching
// a real DB (the hook itself is unit-tested separately in websiteIntake.test.ts).
const { mockEnsureProfile, mockRecordInteraction } = vi.hoisted(() => ({
  mockEnsureProfile: vi.fn(),
  mockRecordInteraction: vi.fn(),
}));
vi.mock("../_core/websiteIntake", () => ({
  ensureCustomerProfileForWebsiteContact: mockEnsureProfile,
  recordWebsiteInteraction: mockRecordInteraction,
}));

import { inquiriesRouter } from "./inquiries";
import * as db from "../db";
import { checkRateLimit } from "../rateLimit";
import { sendInquiryReply } from "../emailService";
import { notifyOwner } from "../_core/notification";
import { reportFunnelError } from "../_core/errorFunnel";

/** Flush the fire-and-forget `void (async () => {...})()` microtask chain
 *  before asserting — the mutation returns before that IIFE settles. */
async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

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

  it("customer-cockpit 任務7a: also ensures a customerProfile + records the inbound interaction", async () => {
    (db.createInquiry as any).mockResolvedValue({ id: 43, inquiryType: "emergency" });
    mockEnsureProfile.mockResolvedValue(777);

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.createEmergency({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      customerPhone: "+1-555-0100",
      currentLocation: "Reykjavík",
      severity: "passport",
      message: "Lost passport at hotel, need urgent help.",
    });
    await flushMicrotasks();

    expect(mockEnsureProfile).toHaveBeenCalledWith({
      userId: null,
      email: "jane@example.com",
      phone: "+1-555-0100",
      name: "Jane Doe",
    });
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 777,
        direction: "inbound",
        agentName: "website_inquiry",
      }),
    );
  });

  // Wave1 收尾補丁 — 接線點 1/5: notifyOwner 失敗時報進錯誤漏斗
  // (server/routers/inquiries.ts createEmergency 的 notifyOwner().then/.catch)。
  //
  // 2026-07 審查三 P0 修復:notifyOwner() 真實行為是「永不 reject」——
  // SMTP 失敗 / EMAIL_USER 或 EMAIL_PASSWORD 未設定都在內部被吞掉、
  // resolve(false)(見 _core/notification.ts)。原本這裡只測 mockRejectedValue,
  // 對「Gmail 帳密過期 / SMTP 掛掉 / OWNER_EMAIL 打錯」這個最可能發生的場景
  // 是死代碼,因為那個場景走的是 resolve(false) 不是 reject。
  // 兩條路徑都要測:resolve(false) 是真實會發生的路徑,reject 是防禦性路徑
  // (萬一未來 notifyOwner 改成會 throw)。
  it("notifyOwner resolves false (真實 SMTP 失敗 / 未設定的形狀): reports to the error funnel with source 'fail-open:inquiries:emergencyOwnerNotifyFailed', still returns the inquiry (never blocks the customer response)", async () => {
    (db.createInquiry as any).mockResolvedValue({ id: 99, inquiryType: "emergency" });
    (notifyOwner as any).mockResolvedValue(false);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    const result = await caller.createEmergency({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      customerPhone: "+1-555-0100",
      currentLocation: "Reykjavík",
      severity: "medical",
      message: "Need urgent help.",
    });
    await flushMicrotasks();

    // Original behavior unchanged: the mutation still resolves with the
    // created inquiry — a notifyOwner failure must never surface to the caller.
    expect(result).toEqual({ id: 99, inquiryType: "emergency" });
    // console.error logging fires for the resolve(false) path too.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[inquiries.createEmergency] notifyOwner failed:",
      expect.any(Error),
    );
    expect(reportFunnelError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:inquiries:emergencyOwnerNotifyFailed",
        context: { inquiryId: 99 },
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("notifyOwner rejects (defensive path, not notifyOwner's real behavior today): still reports to the error funnel, still returns the inquiry", async () => {
    (db.createInquiry as any).mockResolvedValue({ id: 100, inquiryType: "emergency" });
    (notifyOwner as any).mockRejectedValue(new Error("sendgrid down"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    const result = await caller.createEmergency({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      customerPhone: "+1-555-0100",
      currentLocation: "Reykjavík",
      severity: "medical",
      message: "Need urgent help.",
    });
    await flushMicrotasks();

    expect(result).toEqual({ id: 100, inquiryType: "emergency" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[inquiries.createEmergency] notifyOwner failed:",
      expect.any(Error),
    );
    expect(reportFunnelError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "fail-open:inquiries:emergencyOwnerNotifyFailed",
        context: { inquiryId: 100 },
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("notifyOwner resolves true (delivery succeeded): does NOT report to the error funnel", async () => {
    (db.createInquiry as any).mockResolvedValue({ id: 101, inquiryType: "emergency" });
    (notifyOwner as any).mockResolvedValue(true);

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.createEmergency({
      customerName: "Jane Doe",
      customerEmail: "jane@example.com",
      customerPhone: "+1-555-0100",
      currentLocation: "Reykjavík",
      severity: "medical",
      message: "Need urgent help.",
    });
    await flushMicrotasks();

    expect(reportFunnelError).not.toHaveBeenCalled();
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

  it("customer-cockpit 任務7b: customer's own follow-up message ensures a profile + records an inbound interaction", async () => {
    (db.getInquiryById as any).mockResolvedValue({ ...inquiryRow });
    (db.createInquiryMessage as any).mockResolvedValue({
      id: 503,
      inquiryId: 10,
      senderType: "customer",
      message: "請問報價",
    });
    mockEnsureProfile.mockResolvedValue(888);

    const caller = (inquiriesRouter as any).createCaller(makeCustomerContext());
    await caller.addMessage({ inquiryId: 10, message: "請問報價" });
    await flushMicrotasks();

    expect(mockEnsureProfile).toHaveBeenCalledWith({
      userId: 99,
      email: "customer@example.com",
      phone: null,
      name: "王小姐",
    });
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 888,
        direction: "inbound",
        content: "請問報價",
        // 2026-07-03 監工確認修復(同 create procedure 那條)— contentSummary
        // 不再只放主旨,補上這則留言本文,不然時間軸只看得到「站內留言:美西
        // 行程詢問」看不出客人這則到底問了什麼。
        contentSummary: "站內留言:請問報價",
        agentName: "website_inquiry_message",
      }),
    );
  });

  it("2026-07-03 監工確認修復:addMessage 的 contentSummary 本文也截在前 120 字(跟 create procedure 同一套規則)", async () => {
    (db.getInquiryById as any).mockResolvedValue({ ...inquiryRow });
    (db.createInquiryMessage as any).mockResolvedValue({
      id: 505,
      inquiryId: 10,
      senderType: "customer",
      message: "x".repeat(200),
    });
    mockEnsureProfile.mockResolvedValue(888);
    const longMessage = "x".repeat(200);

    const caller = (inquiriesRouter as any).createCaller(makeCustomerContext());
    await caller.addMessage({ inquiryId: 10, message: longMessage });
    await flushMicrotasks();

    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        contentSummary: `站內留言:${longMessage.slice(0, 120)}`,
      }),
    );
  });

  it("customer-cockpit 任務7b: admin's reply in addMessage does NOT go through the website-intake hook (already handled by sendAdminInquiryReply's own outbound recording)", async () => {
    (db.getInquiryById as any).mockResolvedValue({ ...inquiryRow });
    (db.createInquiryMessage as any).mockResolvedValue({
      id: 504,
      inquiryId: 10,
      senderType: "admin",
      message: "回覆內容",
    });
    (db.updateInquiry as any).mockResolvedValue({});
    (sendInquiryReply as any).mockResolvedValue(true);

    const caller = (inquiriesRouter as any).createCaller(makeAdminContext());
    await caller.addMessage({ inquiryId: 10, message: "回覆內容" });
    await flushMicrotasks();

    expect(mockEnsureProfile).not.toHaveBeenCalled();
    expect(mockRecordInteraction).not.toHaveBeenCalled();
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

  it("customer-cockpit 任務7a: ensures a customerProfile + records the inbound interaction after a successful create", async () => {
    mockEnsureProfile.mockResolvedValue(123);

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.create({
      customerName: "王小明",
      customerEmail: "ming@example.com",
      customerPhone: "+1-555-0100",
      subject: "行程詢問",
      message: "請問報價",
    });
    await flushMicrotasks();

    expect(mockEnsureProfile).toHaveBeenCalledWith({
      userId: null,
      email: "ming@example.com",
      phone: "+1-555-0100",
      name: "王小明",
    });
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId: 123,
        direction: "inbound",
        content: "行程詢問\n\n請問報價",
        // 2026-07-03 監工確認修復 — contentSummary 不再只放 subject(prod 實例:
        // 時間軸只顯示「客製旅遊」看不出客人問了什麼),補上訊息本文前120字。
        contentSummary: "行程詢問:請問報價",
        agentName: "website_inquiry",
      }),
    );
  });

  it("2026-07-03 監工確認修復:contentSummary 是「主題+訊息本文前120字」,不是只有主題(避免時間軸只看到分類、看不出客人實際問了什麼)", async () => {
    mockEnsureProfile.mockResolvedValue(456);
    const longMessage = "x".repeat(200);

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.create({
      customerName: "陳先生",
      customerEmail: "chen@example.com",
      subject: "客製旅遊",
      message: longMessage,
    });
    await flushMicrotasks();

    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        contentSummary: `客製旅遊:${longMessage.slice(0, 120)}`,
      }),
    );
    // full form text still goes into content, unabridged
    expect(mockRecordInteraction).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `客製旅遊\n\n${longMessage}`,
      }),
    );
  });

  it("customer-cockpit 任務7a: when ensureCustomerProfileForWebsiteContact returns null (blocked/no DB), never calls recordWebsiteInteraction (honest skip, not a crash)", async () => {
    mockEnsureProfile.mockResolvedValue(null);

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    await caller.create({
      customerName: "Jane",
      customerEmail: "jane@example.com",
      subject: "General question",
      message: "Hello",
    });
    await flushMicrotasks();

    expect(mockRecordInteraction).not.toHaveBeenCalled();
  });

  it("customer-cockpit 任務7a: a website-intake failure never breaks the inquiry mutation itself", async () => {
    mockEnsureProfile.mockRejectedValue(new Error("boom"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const caller = (inquiriesRouter as any).createCaller(makeContext());
    const result = await caller.create({
      customerName: "Jane",
      customerEmail: "jane@example.com",
      subject: "General question",
      message: "Hello",
    });
    await flushMicrotasks();

    expect(result).toEqual({ id: 7, inquiryType: "general" });
    consoleErrorSpy.mockRestore();
  });
});
