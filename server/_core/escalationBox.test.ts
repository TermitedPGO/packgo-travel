/**
 * Tests for escalationBox — escalation 進今日待辦 (批1 m3b).
 *
 * Key invariants under test:
 *   - unread escalations are listed regardless of age (no silent date window)
 *     and read ones come along dimmed (read=true) for undo context.
 *   - who resolution degrades honestly: registered user → name + userId,
 *     guest profile → email label with userId=null, no profile → who=null.
 *   - classification parse never throws on drifted/malformed context JSON.
 *   - ack only ever touches messageType="escalation" rows, both directions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
// reply-attachments: gmail send + storage + interaction recorder are mocked so
// the happy-path attachment tests stay isolated. The real replyAttachments
// resolver runs (with these injected deps), exercising the inline/link split.
vi.mock("./gmail", () => ({
  buildGmailClient: vi.fn((integ: { emailAddress?: string }) => ({
    __gmail: true,
    __mailbox: integ?.emailAddress,
  })),
  sendReplyInThread: vi.fn(),
  threadExists: vi.fn(),
}));
vi.mock("../storage", () => ({
  storageGetBytes: vi.fn(),
  getSecureDocumentUrl: vi.fn(),
}));
vi.mock("./outboundInteraction", () => ({
  recordOutboundEmailInteraction: vi.fn(async () => {}),
}));
const { mockEnqueueRefresh } = vi.hoisted(() => ({
  mockEnqueueRefresh: vi.fn(),
}));
// A4 — fire-and-forget summary refresh must not pull the real BullMQ/Redis queue.
vi.mock("../queue", () => ({ enqueueCustomerSummaryRefresh: mockEnqueueRefresh }));

import { getDb } from "../db";
import {
  listEscalations,
  countUnreadEscalations,
  ackEscalation,
  parseEscalationClassification,
  parseEscalationReplyTarget,
  parseEscalationReplyContext,
  extractDraftFromBody,
  sendEscalationReply,
  parseResolvedTours,
  parseEscalationTripType,
} from "./escalationBox";
import { sendReplyInThread, threadExists } from "./gmail";
import { storageGetBytes, getSecureDocumentUrl } from "../storage";
import { recordOutboundEmailInteraction } from "./outboundInteraction";

const getDbMock = vi.mocked(getDb);
const sendReplyMock = vi.mocked(sendReplyInThread);
const threadExistsMock = vi.mocked(threadExists);
const getBytesMock = vi.mocked(storageGetBytes);
const getSecureUrlMock = vi.mocked(getSecureDocumentUrl);
const recordOutboundMock = vi.mocked(recordOutboundEmailInteraction);

/** Thenable drizzle-chain fake: every builder method returns itself and the
 *  whole chain resolves to `result` when awaited. set() captures its arg. */
function fakeChain(result: unknown, capture?: { set?: unknown }) {
  const p: any = {};
  for (const m of ["select", "from", "where", "orderBy", "limit", "update"]) {
    p[m] = () => p;
  }
  p.set = (arg: unknown) => {
    if (capture) capture.set = arg;
    return p;
  };
  p.then = (onOk: any, onErr: any) => Promise.resolve(result).then(onOk, onErr);
  return p;
}

/** db whose successive select()/update() calls resolve the queued results. */
function fakeDb(queue: unknown[], captures: Array<{ set?: unknown }> = []) {
  let i = 0;
  const next = () => fakeChain(queue[i] ?? [], captures[i++]);
  return { select: next, update: next } as any;
}

const BASE_MSG = {
  agentName: "inquiry",
  title: "客訴 · mei@example.com · \"行程取消\"",
  body: "客人在抱怨,這種我不自己回,先讓你看過。\n\n客人想問:退費",
  priority: "high" as const,
  createdAt: new Date("2026-06-09T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseResolvedTours (m3)", () => {
  it("pulls resolvedTours + unknownTourCodes out of context", () => {
    const r = parseResolvedTours(
      JSON.stringify({
        resolvedTours: [
          { id: 5, title: "黃石深度", status: "active" },
          { id: 1, title: "美西草稿", status: "draft" },
        ],
        unknownTourCodes: ["YG7", "YL7"],
      }),
    );
    expect(r.resolvedTours).toEqual([
      { id: 5, title: "黃石深度", status: "active" },
      { id: 1, title: "美西草稿", status: "draft" },
    ]);
    expect(r.unknownTourCodes).toEqual(["YG7", "YL7"]);
  });

  it("empty arrays for old cards / malformed / missing fields", () => {
    expect(parseResolvedTours(null)).toEqual({ resolvedTours: [], unknownTourCodes: [] });
    expect(parseResolvedTours("not json")).toEqual({ resolvedTours: [], unknownTourCodes: [] });
    expect(parseResolvedTours(JSON.stringify({ classification: "complaint" }))).toEqual({
      resolvedTours: [],
      unknownTourCodes: [],
    });
  });

  it("drops malformed tour entries, keeps the good ones", () => {
    const r = parseResolvedTours(
      JSON.stringify({
        resolvedTours: [
          { id: 5, title: "好的" },
          { id: "nope", title: "壞的 id" },
          { title: "缺 id" },
          { id: 9, title: 123 },
        ],
        unknownTourCodes: ["YG7", "", 42],
      }),
    );
    expect(r.resolvedTours).toEqual([{ id: 5, title: "好的", status: "" }]);
    expect(r.unknownTourCodes).toEqual(["YG7"]);
  });
});

describe("parseEscalationTripType", () => {
  it("reads tripType out of context", () => {
    expect(parseEscalationTripType(JSON.stringify({ tripType: "custom_group" }))).toBe("custom_group");
    expect(parseEscalationTripType(JSON.stringify({ tripType: "join_scheduled" }))).toBe("join_scheduled");
  });
  it("treats unclear / missing / malformed as null (card hides it)", () => {
    expect(parseEscalationTripType(JSON.stringify({ tripType: "unclear" }))).toBeNull();
    expect(parseEscalationTripType(JSON.stringify({ classification: "complaint" }))).toBeNull();
    expect(parseEscalationTripType(null)).toBeNull();
    expect(parseEscalationTripType("not json")).toBeNull();
  });
});

describe("parseEscalationClassification", () => {
  it("reads classification out of valid context", () => {
    expect(
      parseEscalationClassification(
        JSON.stringify({ classification: "complaint", confidence: 40 }),
      ),
    ).toBe("complaint");
  });

  it("returns null on malformed / missing / non-string instead of throwing", () => {
    expect(parseEscalationClassification(null)).toBeNull();
    expect(parseEscalationClassification("not json")).toBeNull();
    expect(parseEscalationClassification(JSON.stringify({ severity: "high" }))).toBeNull();
    expect(
      parseEscalationClassification(JSON.stringify({ classification: 42 })),
    ).toBeNull();
    expect(parseEscalationClassification(JSON.stringify(["a"]))).toBeNull();
  });
});

describe("listEscalations", () => {
  it("returns [] when db unavailable", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await listEscalations()).toEqual([]);
  });

  it("merges unread + read rows and resolves who through profile → user", async () => {
    const unread = [
      {
        ...BASE_MSG,
        id: 1,
        context: JSON.stringify({ classification: "complaint" }),
        readByJeff: 0,
        relatedCustomerProfileId: 11,
      },
    ];
    const read = [
      {
        ...BASE_MSG,
        id: 2,
        agentName: "refund",
        context: JSON.stringify({ severity: "high" }),
        readByJeff: 1,
        relatedCustomerProfileId: 12,
      },
    ];
    const profiles = [
      { id: 11, userId: 7, email: "mei@example.com" },
      { id: 12, userId: null, email: "guest@example.com" },
    ];
    const userRows = [{ id: 7, name: "陳美玲" }];
    getDbMock.mockResolvedValue(fakeDb([unread, read, profiles, userRows]));

    const rows = await listEscalations();
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      id: 1,
      classification: "complaint",
      read: false,
      who: { label: "陳美玲", userId: 7 },
    });
    // refund-agent context has no classification field → null, never a throw;
    // guest profile keeps the email label but no jump target.
    expect(rows[1]).toMatchObject({
      id: 2,
      agentName: "refund",
      classification: null,
      read: true,
      who: { label: "guest@example.com", userId: null },
    });
  });

  it("returns who=null when the message has no customer profile", async () => {
    const unread = [
      {
        ...BASE_MSG,
        id: 3,
        context: null,
        readByJeff: 0,
        relatedCustomerProfileId: null,
      },
    ];
    getDbMock.mockResolvedValue(fakeDb([unread, []]));
    const rows = await listEscalations();
    expect(rows).toHaveLength(1);
    expect(rows[0].who).toBeNull();
    expect(rows[0].classification).toBeNull();
  });
});

describe("countUnreadEscalations", () => {
  it("returns 0 when db unavailable", async () => {
    getDbMock.mockResolvedValue(undefined as any);
    expect(await countUnreadEscalations()).toBe(0);
  });

  it("returns the COUNT(*) value", async () => {
    getDbMock.mockResolvedValue(fakeDb([[{ c: 4 }]]));
    expect(await countUnreadEscalations()).toBe(4);
  });
});

describe("ackEscalation", () => {
  it("throws when the message is missing", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]));
    await expect(ackEscalation(99, true)).rejects.toThrow("not found");
  });

  it("refuses to touch non-escalation messages", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 5, messageType: "observation" }]]),
    );
    await expect(ackEscalation(5, true)).rejects.toThrow(
      "not an escalation",
    );
  });

  it("handled=true marks read with a readAt timestamp", async () => {
    const captures: Array<{ set?: any }> = [{}, {}];
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 5, messageType: "escalation" }], []], captures),
    );
    const res = await ackEscalation(5, true);
    expect(res).toEqual({ id: 5, read: true });
    expect(captures[1].set.readByJeff).toBe(1);
    expect(captures[1].set.readAt).toBeInstanceOf(Date);
  });

  it("handled=false puts it back to unread and clears readAt", async () => {
    const captures: Array<{ set?: any }> = [{}, {}];
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 6, messageType: "escalation" }], []], captures),
    );
    const res = await ackEscalation(6, false);
    expect(res).toEqual({ id: 6, read: false });
    expect(captures[1].set.readByJeff).toBe(0);
    expect(captures[1].set.readAt).toBeNull();
  });
});

describe("parseEscalationReplyTarget (批9 m1)", () => {
  it("returns full target when context has the structured fields", () => {
    const ctx = JSON.stringify({
      classification: "complaint",
      gmailThreadId: "t-123",
      gmailMessageId: "m-456",
      customerEmail: "mei@example.com",
      subject: "行程取消",
      draftReply: "您好,關於退費…",
    });
    expect(parseEscalationReplyTarget(ctx)).toEqual({
      gmailThreadId: "t-123",
      gmailMessageId: "m-456",
      customerEmail: "mei@example.com",
      subject: "行程取消",
      draftReply: "您好,關於退費…",
    });
  });

  it("old rows without customerEmail degrade to null (view-only)", () => {
    const ctx = JSON.stringify({
      classification: "other",
      gmailThreadId: "t-123",
      gmailMessageId: "m-456",
    });
    expect(parseEscalationReplyTarget(ctx)).toBeNull();
  });

  it("missing gmailThreadId degrades to null", () => {
    const ctx = JSON.stringify({ customerEmail: "a@b.com" });
    expect(parseEscalationReplyTarget(ctx)).toBeNull();
  });

  it("bad JSON / null context degrade to null, never throw", () => {
    expect(parseEscalationReplyTarget("not json")).toBeNull();
    expect(parseEscalationReplyTarget(null)).toBeNull();
    expect(parseEscalationReplyTarget(JSON.stringify([1]))).toBeNull();
  });

  it("blank draftReply becomes null (dialog opens empty, still replyable)", () => {
    const ctx = JSON.stringify({
      gmailThreadId: "t-1",
      customerEmail: "a@b.com",
      draftReply: "   ",
    });
    const target = parseEscalationReplyTarget(ctx);
    expect(target).not.toBeNull();
    expect(target!.draftReply).toBeNull();
    expect(target!.subject).toBe("");
  });
});

describe("sendEscalationReply guards (批9 m1)", () => {
  it("unsupported message types are rejected honestly (digest)", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 7, messageType: "digest", context: null }]]),
    );
    const res = await sendEscalationReply(7, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("不支援");
  });

  it("observation rows ARE allowed (email-auto-reply m2 跟進更正) — only the missing target blocks", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([[{ id: 7, messageType: "observation", context: null }]]),
    );
    const res = await sendEscalationReply(7, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("Gmail"); // 缺收件資訊 fallback,而非類型拒絕
  });

  it("old row without reply target is rejected with the Gmail hint", async () => {
    getDbMock.mockResolvedValue(
      fakeDb([
        [
          {
            id: 8,
            messageType: "escalation",
            context: JSON.stringify({ classification: "other" }),
          },
        ],
      ]),
    );
    const res = await sendEscalationReply(8, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("Gmail");
  });

  it("missing message is rejected", async () => {
    getDbMock.mockResolvedValue(fakeDb([[]]));
    const res = await sendEscalationReply(999, "hello");
    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("找不到");
  });
});

describe("parseEscalationReplyContext (soft) + extractDraftFromBody (2026-06-13)", () => {
  it("soft parse 保留 gmailThreadId、customerEmail 可空(pre-fix 卡)", () => {
    const ctx = JSON.stringify({
      classification: "tour_comparison_request",
      gmailThreadId: "19eb9498aa36d669",
      gmailMessageId: "m-1",
      // 沒有 customerEmail、沒有 draftReply — 就是 prod 截圖那張卡的形狀
    });
    const c = parseEscalationReplyContext(ctx);
    expect(c).not.toBeNull();
    expect(c!.gmailThreadId).toBe("19eb9498aa36d669");
    expect(c!.customerEmail).toBeNull();
    expect(c!.draftReply).toBeNull();
  });

  it("strict 版對同一張卡回 null(印證舊行為:context-only 不可回)", () => {
    const ctx = JSON.stringify({ gmailThreadId: "t-1" });
    expect(parseEscalationReplyTarget(ctx)).toBeNull();
    expect(parseEscalationReplyContext(ctx)?.gmailThreadId).toBe("t-1");
  });

  it("soft parse 仍清 draftReply 的 markdown", () => {
    const ctx = JSON.stringify({
      gmailThreadId: "t-1",
      customerEmail: "a@b.com",
      draftReply: "關於 **差別**",
    });
    expect(parseEscalationReplyContext(ctx)!.draftReply).toBe("關於 差別");
  });

  it("批八 塊三 — replyAttachments 只留 reply-attachments/ 命名空間內、丟棄非法", () => {
    const ctx = JSON.stringify({
      gmailThreadId: "t-1",
      replyAttachments: [
        { key: "reply-attachments/9001/generated-1-deposit_receipt.pdf", filename: "訂金收據.pdf" },
        { key: "customer-docs/9001/passport.pdf", filename: "護照.pdf" }, // 命名空間外 → 丟
        { key: "reply-attachments/9001/x.pdf" }, // 缺 filename → 丟
        { filename: "無 key.pdf" }, // 缺 key → 丟
        "not-an-object",
      ],
    });
    const c = parseEscalationReplyContext(ctx);
    expect(c!.replyAttachments).toEqual([
      { key: "reply-attachments/9001/generated-1-deposit_receipt.pdf", filename: "訂金收據.pdf" },
    ]);
  });

  it("批八 塊三 — 沒有 replyAttachments 欄 → 空陣列", () => {
    const c = parseEscalationReplyContext(JSON.stringify({ gmailThreadId: "t-1" }));
    expect(c!.replyAttachments).toEqual([]);
  });

  it("extractDraftFromBody 從卡片 body 抽出建議回覆並清 markdown", () => {
    const body =
      "這封我歸成「行程比較」,超出我能自動處理的範圍。\n\n" +
      "客人想問:比較 YG7 和 YL7\n\n" +
      "---\n建議回覆(還沒送出,給你過目):\n" +
      "Jeff 您好,關於 **YG7 和 YL7** 的差別...";
    const draft = extractDraftFromBody(body);
    expect(draft).toContain("Jeff 您好");
    expect(draft).toContain("YG7 和 YL7 的差別");
    expect(draft).not.toContain("**");
    expect(draft).not.toContain("建議回覆");
  });

  it("extractDraftFromBody 吃舊版英文 \"Draft (供你參考,**未送出**):\" 格式", () => {
    const body =
      "Agent escalated because: classification=quote_request\n\n" +
      "客戶想要報價...\n\n---\n" +
      "Draft (供你參考,**未送出**):\n" +
      "Hi Jeff,\n\n謝謝您的來信!**請將行程內容**改格式重新提供。";
    const draft = extractDraftFromBody(body);
    expect(draft).toContain("Hi Jeff");
    expect(draft).toContain("請將行程內容");
    expect(draft).not.toContain("**");
    expect(draft).not.toContain("Draft (供你參考");
  });

  it("extractDraftFromBody 無 marker → null", () => {
    expect(extractDraftFromBody("沒有建議回覆段的內容")).toBeNull();
    expect(extractDraftFromBody(null)).toBeNull();
  });
});

describe("sendEscalationReply with attachments (reply-attachments)", () => {
  const REPLYABLE_CTX = JSON.stringify({
    gmailThreadId: "t-1",
    gmailMessageId: "m-1",
    customerEmail: "jenny@example.com",
    subject: "行程詢問",
  });
  const msgRow = {
    id: 5,
    messageType: "escalation",
    context: REPLYABLE_CTX,
    relatedCustomerProfileId: null,
  };
  const integration = { emailAddress: "support@packgoplay.com", isActive: 1 };

  it("small file → loaded from R2 and passed inline to sendReplyInThread", async () => {
    const pdf = Buffer.from("%PDF small", "utf-8");
    getBytesMock.mockResolvedValue({
      bytes: pdf,
      mimeType: "application/pdf",
      contentLength: pdf.length,
    });
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "t-1",
    });
    // queue: [message row], [gmail integration], [update]
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration], []]));

    const res = await sendEscalationReply(5, "Jenny 您好,報價如附件。", [
      { key: "reply-attachments/7/q.pdf", filename: "報價單.pdf" },
    ]);

    expect(res.sent).toBe(true);
    expect(getBytesMock).toHaveBeenCalledWith("reply-attachments/7/q.pdf");
    const sendArg = sendReplyMock.mock.calls[0][1];
    expect(sendArg.attachments).toEqual([
      { filename: "報價單.pdf", mimeType: "application/pdf", content: pdf },
    ]);
    // small file → no download-link section appended to the body
    expect(sendArg.bodyText).toBe("Jenny 您好,報價如附件。");
    expect(getSecureUrlMock).not.toHaveBeenCalled();
  });

  it(">25MB → not attached; a download link is appended to the body instead", async () => {
    const huge = Buffer.alloc(20 * 1024 * 1024, 1); // ~26.7MB encoded > 25MB
    getBytesMock.mockResolvedValue({
      bytes: huge,
      mimeType: "application/pdf",
      contentLength: huge.length,
    });
    getSecureUrlMock.mockResolvedValue("https://r2/secure?sig=abc");
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "t-1",
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration], []]));

    const res = await sendEscalationReply(5, "您好,報價如下。", [
      { key: "reply-attachments/7/big.pdf", filename: "大報價.pdf" },
    ]);

    expect(res.sent).toBe(true);
    const sendArg = sendReplyMock.mock.calls[0][1];
    expect(sendArg.attachments).toBeUndefined(); // nothing inline
    expect(sendArg.bodyText).toContain("大報價.pdf: https://r2/secure?sig=abc");
    expect(sendArg.bodyText).toContain("下載連結");
  });

  it("a key outside reply-attachments/ aborts the send (never reaches Gmail)", async () => {
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration]]));

    const res = await sendEscalationReply(5, "您好", [
      { key: "customerDocuments/9/passport.jpg", filename: "passport.jpg" },
    ]);

    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("附件處理失敗");
    expect(sendReplyMock).not.toHaveBeenCalled();
    expect(getBytesMock).not.toHaveBeenCalled();
  });

  it("no attachments → behaves exactly as before (plain reply, no storage calls)", async () => {
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "t-1",
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration], []]));

    const res = await sendEscalationReply(5, "純文字回覆");

    expect(res.sent).toBe(true);
    const sendArg = sendReplyMock.mock.calls[0][1];
    expect(sendArg.attachments).toBeUndefined();
    expect(sendArg.bodyText).toBe("純文字回覆");
    expect(getBytesMock).not.toHaveBeenCalled();
  });
});

/**
 * 2026-07-02 multi-account routing — prod 實錄:客人的信在 support@ 的
 * mailbox,舊 code limit(1) 抓到另一個帳號,送信炸 "Requested entity was
 * not found" 兩次而 UI 靜默。這組測資鎖:thread 屬於誰就從誰寄、單帳號
 * 不 probe、全都不是就誠實列出查過的帳號且絕不叫 Gmail 寄。
 */
describe("sendEscalationReply multi-account routing (2026-07-02)", () => {
  const REPLYABLE_CTX = JSON.stringify({
    gmailThreadId: "thread-support",
    gmailMessageId: "m-1",
    customerEmail: "jenny@example.com",
    subject: "行程詢問",
  });
  const msgRow = {
    id: 9,
    messageType: "escalation",
    context: REPLYABLE_CTX,
    relatedCustomerProfileId: null,
  };
  const jeffAcct = { id: 1, emailAddress: "jeffhsieh09@gmail.com", isActive: 1 };
  const supportAcct = {
    id: 2,
    emailAddress: "support@packgoplay.com",
    isActive: 1,
  };

  it("thread lives in the SECOND account → probes in order and sends from it", async () => {
    // jeff's mailbox doesn't have the thread; support does.
    threadExistsMock.mockImplementation(async (gmail: any) =>
      gmail.__mailbox === supportAcct.emailAddress,
    );
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "thread-support",
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [jeffAcct, supportAcct], []]));

    const res = await sendEscalationReply(9, "您好");

    expect(res.sent).toBe(true);
    expect(threadExistsMock).toHaveBeenCalledTimes(2);
    const sendArg = sendReplyMock.mock.calls[0][1];
    expect(sendArg.fromEmail).toBe("support@packgoplay.com");
    const sendGmail = sendReplyMock.mock.calls[0][0] as any;
    expect(sendGmail.__mailbox).toBe("support@packgoplay.com");
  });

  it("first account owns it → exactly ONE probe (previous default stays cheap)", async () => {
    threadExistsMock.mockResolvedValue(true);
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "thread-support",
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [jeffAcct, supportAcct], []]));

    const res = await sendEscalationReply(9, "您好");

    expect(res.sent).toBe(true);
    expect(threadExistsMock).toHaveBeenCalledTimes(1);
    expect(sendReplyMock.mock.calls[0][1].fromEmail).toBe(
      "jeffhsieh09@gmail.com",
    );
  });

  it("single active account → NO probe at all (zero extra API calls)", async () => {
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "thread-support",
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [supportAcct], []]));

    const res = await sendEscalationReply(9, "您好");

    expect(res.sent).toBe(true);
    expect(threadExistsMock).not.toHaveBeenCalled();
  });

  it("no account owns the thread → honest error naming BOTH accounts, Gmail never called", async () => {
    threadExistsMock.mockResolvedValue(false);
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [jeffAcct, supportAcct]]));

    const res = await sendEscalationReply(9, "您好");

    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("jeffhsieh09@gmail.com");
    expect(res.errorMessage).toContain("support@packgoplay.com");
    expect(sendReplyMock).not.toHaveBeenCalled();
  });

  it("one account's probe dies (invalid_grant) but the other owns it → still sends", async () => {
    threadExistsMock.mockImplementation(async (gmail: any) => {
      if (gmail.__mailbox === jeffAcct.emailAddress)
        throw new Error("invalid_grant");
      return true;
    });
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "thread-support",
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [jeffAcct, supportAcct], []]));

    const res = await sendEscalationReply(9, "您好");

    expect(res.sent).toBe(true);
    expect(sendReplyMock.mock.calls[0][1].fromEmail).toBe(
      "support@packgoplay.com",
    );
  });

  it("owner unfindable because a probe died with invalid_grant → error mentions reconnect", async () => {
    threadExistsMock.mockImplementation(async (gmail: any) => {
      if (gmail.__mailbox === supportAcct.emailAddress)
        throw new Error("invalid_grant");
      return false;
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [jeffAcct, supportAcct]]));

    const res = await sendEscalationReply(9, "您好");

    expect(res.sent).toBe(false);
    expect(res.errorMessage).toContain("support@packgoplay.com");
    expect(res.errorMessage).toContain("重新連接");
    expect(sendReplyMock).not.toHaveBeenCalled();
  });
});

/**
 * 2026-07-03 customer-cockpit Phase6 A4 — "summary card still shows the
 * 21-hours-old state after replying". A successful send must fire-and-forget
 * enqueueCustomerSummaryRefresh(profileId) so the card recomputes instead of
 * waiting for the 02:00 nightly cron.
 */
describe("sendEscalationReply summary refresh (Phase6 A4)", () => {
  const REPLYABLE_CTX = JSON.stringify({
    gmailThreadId: "t-1",
    gmailMessageId: "m-1",
    customerEmail: "jenny@example.com",
    subject: "行程詢問",
  });
  const msgRow = {
    id: 5,
    messageType: "escalation",
    context: REPLYABLE_CTX,
    relatedCustomerProfileId: null,
  };
  const integration = { emailAddress: "support@packgoplay.com", isActive: 1 };

  beforeEach(() => {
    sendReplyMock.mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "x",
      threadId: "t-1",
    });
  });

  it("successful send enqueues a summary refresh for the outbound interaction's profile", async () => {
    recordOutboundMock.mockResolvedValue({
      recorded: true,
      interactionId: 501,
      customerProfileId: 42,
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration], []]));

    const res = await sendEscalationReply(5, "您好,已經處理好了");

    expect(res.sent).toBe(true);
    expect(mockEnqueueRefresh).toHaveBeenCalledTimes(1);
    expect(mockEnqueueRefresh).toHaveBeenCalledWith(42);
  });

  it("F5: 把 target 的 gmailThreadId 傳給外寄記錄器(讓外寄回信沿 thread 繼承 customOrderId)", async () => {
    recordOutboundMock.mockResolvedValue({
      recorded: true,
      interactionId: 601,
      customerProfileId: 44,
      customOrderId: 77,
    });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration], []]));

    const res = await sendEscalationReply(5, "您好,行程已排好");

    expect(res.sent).toBe(true);
    // F5 wiring:escalationBox 必須把回信 thread 傳下去,recordOutboundEmailInteraction
    // 才有辦法沿同 thread 既有歸屬繼承 customOrderId(與 inbound 規則①對稱)。
    expect(recordOutboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ gmailThreadId: "t-1" }),
    );
  });

  it("no customerProfileId (recording failed) → refresh is skipped, send still succeeds", async () => {
    recordOutboundMock.mockResolvedValue({ recorded: false });
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration], []]));

    const res = await sendEscalationReply(5, "您好");

    expect(res.sent).toBe(true);
    expect(mockEnqueueRefresh).not.toHaveBeenCalled();
  });

  it("refresh enqueue throwing never breaks the already-sent result (fire-and-forget)", async () => {
    recordOutboundMock.mockResolvedValue({
      recorded: true,
      interactionId: 502,
      customerProfileId: 43,
    });
    mockEnqueueRefresh.mockRejectedValueOnce(new Error("redis down"));
    getDbMock.mockResolvedValue(fakeDb([[msgRow], [integration], []]));

    const res = await sendEscalationReply(5, "您好");

    expect(res.sent).toBe(true);
    expect(mockEnqueueRefresh).toHaveBeenCalledWith(43);
  });
});
