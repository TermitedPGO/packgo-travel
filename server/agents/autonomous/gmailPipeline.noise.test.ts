/**
 * push 路徑 noreply 防火牆 (P2, 2026-07-01) — the 3-min poll's Gmail query is
 * `is:unread -from:noreply` (listUnreadMessages), so noreply notifications
 * never reach the pipeline via poll. The push path (runGmailPipelineForMessageIds)
 * only mirrored the label/INBOX gates and skipped `-from:noreply`; worse, the
 * isKnownNoise fallback treated the "noreply" pattern as a DOMAIN (matching
 * only `@noreply…` / `.noreply…`), so a localpart sender like
 * noreply@united.com could never match. Net effect with GMAIL_POLL_LABEL
 * unset: every noreply notification pushed via Pub/Sub entered the full
 * InquiryAgent pipeline seconds after arrival — one LLM chain burned per
 * email + a junk card in the office inbox.
 *
 * Covers: ① isNoreplySender (pure, shared by push firewall + isKnownNoise),
 * ② isKnownNoise localpart fix + unchanged legacy behavior, ③ the push path
 * dropping noreply senders BEFORE ingest while normal customer mail still
 * flows in.
 *
 * Heavy collaborators are mocked BEFORE importing gmailPipeline — same
 * pattern as gmailPipeline.lock.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redisSet = vi.fn();
vi.mock("../../redis", () => ({
  redis: { set: (...args: unknown[]) => redisSet(...args) },
  redisBullMQ: {},
  default: { set: (...args: unknown[]) => redisSet(...args) },
}));

// getDb returns whatever the current test placed in dbHolder.
const dbHolder: { db: unknown } = { db: null };
const getPendingExpenseByGmailMessageIdMock = vi.fn();
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => dbHolder.db),
  createPendingExpense: vi.fn(),
  getPendingExpenseByGmailMessageId: (...args: unknown[]) =>
    getPendingExpenseByGmailMessageIdMock(...args),
}));

const listHistoryMessageIdsMock = vi.fn();
const listMessagesByIdsMock = vi.fn();
const applyLabelMock = vi.fn();
vi.mock("../../_core/gmail", () => ({
  buildGmailClient: vi.fn(() => ({})),
  listUnreadMessages: vi.fn(async () => []),
  listMessagesByIds: (...args: unknown[]) => listMessagesByIdsMock(...args),
  listHistoryMessageIds: (...args: unknown[]) => listHistoryMessageIdsMock(...args),
  // Mirror the real (pure, unit-tested elsewhere) gate so the push flow works.
  selectIngestableMessages: (
    summaries: Array<{ labels: string[] }>,
    processedLabelId: string,
    filterLabelId: string | null,
  ) =>
    summaries.filter(
      (m) =>
        !m.labels.includes(processedLabelId) &&
        (!filterLabelId || m.labels.includes(filterLabelId)),
    ),
  ensureLabel: vi.fn(async (_gmail: unknown, name: string) => `id-${name}`),
  applyLabel: (...args: unknown[]) => applyLabelMock(...args),
  sendReplyInThread: vi.fn(),
  fetchRawAttachments: vi.fn(async () => []),
  getThreadHistory: vi.fn(async () => []),
}));

const detectReceiptMock = vi.fn();
vi.mock("../../_core/receiptExtractor", () => ({
  detectReceipt: (...args: unknown[]) => detectReceiptMock(...args),
  extractReceipt: vi.fn(async () => ({ needsReview: true, confidence: 0 })),
  pickReceiptAttachment: vi.fn(() => null),
}));

vi.mock("../../storage", () => ({ storagePut: vi.fn() }));
const runInquiryAgentMock = vi.fn();
vi.mock("./inquiryAgent", () => ({
  runInquiryAgent: (...args: unknown[]) => runInquiryAgentMock(...args),
  DEFAULT_INQUIRY_POLICY: {},
}));
vi.mock("./refundAgent", () => ({
  runRefundAgent: vi.fn(),
  DEFAULT_REFUND_POLICY: {},
}));
// Defensive mocks for modules processOneEmail dynamic-imports — keeps the
// module graph cheap if a test message ever reaches the InquiryAgent leg.
vi.mock("../../queue", () => ({
  customerBackfillQueue: { add: vi.fn() },
}));
vi.mock("../../_core/emailCustomerMatch", () => ({
  linkProfileToUserByEmail: vi.fn(),
}));
vi.mock("../../_core/tourReferenceResolver", () => ({
  resolveFromEmail: vi.fn(async () => ({ candidates: [], unknownCodes: [] })),
}));
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
// P0 hotfix (Ann 事故):收信失敗要浮一張 high 卡。spy notifyAgentMessage 驗 catch 有貼卡。
const notifyAgentMessageMock = vi.fn();
vi.mock("../../_core/agentNotify", () => ({
  notifyAgentMessage: (...args: unknown[]) => notifyAgentMessageMock(...args),
}));

import {
  isNoreplySender,
  isKnownNoise,
  isOwnEmail,
  runGmailPipelineForMessageIds,
} from "./gmailPipeline";
import { gmailIntegration, agentPolicies } from "../../../drizzle/schema";

// ── fakes ────────────────────────────────────────────────────────────────────

const integrationRow = {
  id: 7,
  emailAddress: "support@packgoplay.com",
  isActive: 1,
  lastHistoryId: "100",
  lastPollAt: new Date("2026-07-01T00:00:00Z"),
  messagesProcessed: 0,
  messagesFailed: 0,
};

/** Minimal chainable Drizzle stand-in — dispatches on the table object. */
function makeFakeDb() {
  const updateCalls: Array<Record<string, unknown>> = [];
  const rowsFor = (table: unknown): unknown[] => {
    if (table === gmailIntegration) return [integrationRow];
    if (table === agentPolicies) return [{ id: 1, version: 1, rules: "{}" }];
    return [];
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => rowsFor(table),
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(vals);
        },
      }),
    }),
    insert: () => ({ values: async () => [{ insertId: 1 }] }),
  };
  return { db, updateCalls };
}

function makeMsg(id: string, from: string) {
  return {
    id,
    threadId: `t-${id}`,
    from,
    to: "support@packgoplay.com",
    subject: `subject-${id}`,
    body: "body text",
    receivedAt: new Date("2026-07-01T01:00:00Z"),
    labels: ["INBOX"],
    attachments: [],
  };
}

beforeEach(() => {
  redisSet.mockReset().mockResolvedValue("OK");
  listHistoryMessageIdsMock.mockReset();
  listMessagesByIdsMock.mockReset();
  applyLabelMock.mockReset().mockResolvedValue(undefined);
  detectReceiptMock.mockReset().mockReturnValue({ isReceipt: false });
  getPendingExpenseByGmailMessageIdMock.mockReset().mockResolvedValue(null);
  runInquiryAgentMock.mockReset();
  notifyAgentMessageMock.mockReset().mockResolvedValue(undefined);
  dbHolder.db = makeFakeDb().db;
});

// ── ① shared pure noreply check ──────────────────────────────────────────────

describe("isNoreplySender (localpart noreply/no-reply/no_reply, case-insensitive)", () => {
  it.each([
    "noreply@united.com",
    "no-reply@delta.com",
    "no_reply@ana.co.jp",
    "NoReply@United.com",
    "United Airlines MileagePlus <noreply@united.com>",
    "noreply-payments@stripe.com",
  ])("blocks %s", (from) => {
    expect(isNoreplySender(from)).toBe(true);
  });

  it.each([
    "jane.doe@gmail.com",
    "Lisa Chen <lisa@example.com>",
    // display name contains "noreply" but the actual localpart is a human —
    // must NOT overblock (poll parity is about the sender address).
    "Noreply Fanclub <jane@gmail.com>",
    // "reply" alone is not noreply-class
    "reply@customer.com",
    // noreply in the DOMAIN is not a noreply LOCALPART (deliberately narrow)
    "booking@noreply-hotels.com",
  ])("lets %s through", (from) => {
    expect(isNoreplySender(from)).toBe(false);
  });
});

// ── ② isKnownNoise localpart bug fix (+ legacy behavior unchanged) ──────────

describe("isKnownNoise", () => {
  it("blocks noreply@united.com (P2 bug: the 'noreply' pattern only did domain matching, so a noreply LOCALPART never matched)", () => {
    expect(isKnownNoise("noreply@united.com")).toBe(true);
  });

  it("blocks the display-name form: United Airlines <noreply@united.com>", () => {
    expect(isKnownNoise("United Airlines <noreply@united.com>")).toBe(true);
  });

  it.each(["no-reply@delta.com", "NO_REPLY@marketing.example.com"])(
    "blocks noreply-class variant %s",
    (from) => {
      expect(isKnownNoise(from)).toBe(true);
    },
  );

  // legacy behavior must be unchanged (poll path relies on it)
  it("still blocks known noise domains (someone@marriott.com)", () => {
    expect(isKnownNoise("someone@marriott.com")).toBe(true);
  });
  it("still blocks localpart-prefix patterns with @ (alerts@stripe.com)", () => {
    expect(isKnownNoise("alerts@stripe.com")).toBe(true);
  });
  it("still lets a real customer through (jane.doe@gmail.com)", () => {
    expect(isKnownNoise("jane.doe@gmail.com")).toBe(false);
  });
  it("still lets an unknown business sender through (info@smalltouroperator.com)", () => {
    expect(isKnownNoise("info@smalltouroperator.com")).toBe(false);
  });
});

// ── ③ push path firewall (GMAIL_POLL_LABEL unset — the failure scenario) ────

describe("runGmailPipelineForMessageIds — noreply firewall (poll parity)", () => {
  it("a pushed noreply notification never enters ingest (no receipt pass, no LLM, no label — exactly like the poll's -from:noreply)", async () => {
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-noreply"],
      latestHistoryId: "200",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([
      makeMsg("m-noreply", "United Airlines MileagePlus <noreply@united.com>"),
    ]);

    const result = await runGmailPipelineForMessageIds(7, "205");

    // Never entered ingestFreshMessages: the receipt pass (its first gate)
    // was never consulted, no InquiryAgent, no per-message lock, no label.
    expect(detectReceiptMock).not.toHaveBeenCalled();
    expect(runInquiryAgentMock).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
    expect(applyLabelMock).not.toHaveBeenCalled();
    expect(result.totalFetched).toBe(0);
    expect(result.totalProcessed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("still advances lastHistoryId when everything pushed was noreply (never re-diffs the same window)", async () => {
    const { db, updateCalls } = makeFakeDb();
    dbHolder.db = db;
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-noreply"],
      latestHistoryId: "200",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([
      makeMsg("m-noreply", "noreply@united.com"),
    ]);

    await runGmailPipelineForMessageIds(7, "205");

    expect(updateCalls.some((u) => u.lastHistoryId === "200")).toBe(true);
  });

  it("a normal customer email pushed at the same time still flows into ingest", async () => {
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-noreply", "m-cust"],
      latestHistoryId: "201",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([
      makeMsg("m-noreply", "noreply@united.com"),
      makeMsg("m-cust", "Lisa Chen <lisa@example.com>"),
    ]);
    // Short-circuit the customer message down the (cheap, deterministic)
    // receipt-dedup leg: detectReceipt says receipt, dedup says already
    // queued → ingest labels it and stops. Proves it passed the firewall.
    detectReceiptMock.mockReturnValue({ isReceipt: true });
    getPendingExpenseByGmailMessageIdMock.mockResolvedValue({ id: 99 });

    const result = await runGmailPipelineForMessageIds(7, "206");

    // Only the customer message reached ingest.
    expect(detectReceiptMock).toHaveBeenCalledTimes(1);
    expect(detectReceiptMock).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "subject-m-cust" }),
    );
    expect(applyLabelMock).toHaveBeenCalledTimes(1);
    expect(applyLabelMock).toHaveBeenCalledWith(
      expect.anything(),
      "m-cust",
      "id-PACKGO_AI_PROCESSED",
    );
    expect(result.errors).toEqual([]);
  });
});

// ── ④ A1 own-email firewall short-circuits BEFORE the LLM (2026-07-03) ──────
//
// isOwnEmail used to only stop processOneEmail from building a customer card;
// the email still fell through to runInquiryAgent and burned a full LLM
// classification chain (decision was thrown away, profileId stayed
// undefined). This must now be filtered at the SAME step as isKnownNoise —
// before processOneEmail is ever called — while the receipt pass (which runs
// earlier, on `fresh`, regardless of sender) keeps working: Jeff forwards
// bank receipts to his own inbox and that must not regress.

describe("own-email firewall (isOwnEmail short-circuits before runInquiryAgent)", () => {
  it("isOwnEmail still recognizes the owner addresses (sanity, mirrors gmailPipeline.sender.test.ts)", () => {
    expect(isOwnEmail("jeffhsieh09@gmail.com")).toBe(true);
    expect(isOwnEmail("support@packgoplay.com")).toBe(true);
    expect(isOwnEmail("jane.doe@gmail.com")).toBe(false);
  });

  it("a non-receipt email from jeffhsieh09@gmail.com never reaches runInquiryAgent, but still gets labeled processed", async () => {
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-own"],
      latestHistoryId: "300",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([
      makeMsg("m-own", "Jeff Hsieh <jeffhsieh09@gmail.com>"),
    ]);
    detectReceiptMock.mockReturnValue({ isReceipt: false });

    const result = await runGmailPipelineForMessageIds(7, "301");

    // Receipt pass DOES run (it operates on `fresh` before any sender
    // filter) — proves the own-email gate sits AFTER the receipt check, not
    // instead of it.
    expect(detectReceiptMock).toHaveBeenCalledTimes(1);
    // But the LLM classification never runs, and no per-message lock/insert
    // path is touched — the email is filtered out before processOneEmail.
    expect(runInquiryAgentMock).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
    // Still labeled PACKGO_AI_PROCESSED so it doesn't reappear next poll —
    // same treatment as known-noise senders.
    expect(applyLabelMock).toHaveBeenCalledWith(
      expect.anything(),
      "m-own",
      "id-PACKGO_AI_PROCESSED",
    );
    expect(result.totalFetched).toBe(0);
    expect(result.totalProcessed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("a receipt-shaped email from jeffhsieh09@gmail.com still queues into pendingExpenses (Jeff forwards bank receipts to himself)", async () => {
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-own-receipt"],
      latestHistoryId: "302",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([
      makeMsg("m-own-receipt", "Jeff Hsieh <jeffhsieh09@gmail.com>"),
    ]);
    detectReceiptMock.mockReturnValue({ isReceipt: true });
    getPendingExpenseByGmailMessageIdMock.mockResolvedValue(null); // not yet queued

    const result = await runGmailPipelineForMessageIds(7, "303");

    // Receipt path is untouched by the own-email firewall — it must still
    // process and label normally, never reaching the noise/own-email filter
    // (that filter only sees `nonReceipt`).
    expect(detectReceiptMock).toHaveBeenCalledTimes(1);
    expect(runInquiryAgentMock).not.toHaveBeenCalled();
    expect(result.totalReceipts).toBe(1);
    expect(applyLabelMock).toHaveBeenCalledWith(
      expect.anything(),
      "m-own-receipt",
      "id-PACKGO_AI_PROCESSED",
    );
    expect(result.errors).toEqual([]);
  });

  it("a normal customer email pushed alongside an own-email still flows into the LLM pipeline (own-email gate doesn't overblock)", async () => {
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-own", "m-cust"],
      latestHistoryId: "304",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([
      makeMsg("m-own", "jeffhsieh09@gmail.com"),
      makeMsg("m-cust", "Lisa Chen <lisa@example.com>"),
    ]);
    detectReceiptMock.mockReturnValue({ isReceipt: false });
    // Short-circuit the customer message via the per-message lock path so we
    // don't need to stand up the full processOneEmail DB graph: acquiring
    // the lock will fail closed against redisSet's mock resolution — simplest
    // is to just assert runInquiryAgent WAS invoked for the customer message
    // without needing it to complete successfully.
    runInquiryAgentMock.mockRejectedValue(new Error("stop-after-invoked"));

    const result = await runGmailPipelineForMessageIds(7, "305");

    expect(runInquiryAgentMock).toHaveBeenCalledTimes(1);
    // own-email message never reached the LLM, but the customer one did —
    // and failed inside processOneEmail (our stub throws), which the ingest
    // loop counts as totalFailed, not a silent drop.
    expect(result.totalFailed).toBe(1);
  });
});

// ── ⑤ 收信失敗不再靜默(P0 hotfix, Ann Yuan 事故)— pipeline-throw 整合測 ────────
// Ann 的信歸檔了但 LLM 分類/摘要/收件匣卡三樣靜默跳過:runInquiryAgent 那步 throw,
// 落到 ingestFreshMessages 的 caller catch,原本只 totalFailed++/log、對 Jeff 完全靜默。
// 這個整合測跑「真實客人的信在分類這步 throw」的完整 push 路徑,證明:除了計入失敗,
// 一定貼一張 high 優先 intake-failure 卡(含寄件人/主旨/gmail messageId),不再靜默。
describe("ingestFreshMessages — 分類 throw 時貼 high intake-failure 卡(不再靜默)", () => {
  it("客人信的 LLM 分類 throw → totalFailed++ 且貼一張 high 卡,含寄件人/主旨/messageId", async () => {
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-ann"],
      latestHistoryId: "400",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([makeMsg("m-ann", "Ann Yuan <ayuan@axt.com>")]);
    detectReceiptMock.mockReturnValue({ isReceipt: false });
    // 模擬 Ann 事故:LLM 分類這步掛掉(在 interaction insert 之前)。
    runInquiryAgentMock.mockRejectedValue(new Error("classification LLM 500"));

    const result = await runGmailPipelineForMessageIds(7, "401");

    // 不再靜默:計入失敗 + 真的貼了一張卡。
    expect(result.totalFailed).toBe(1);
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
    const card = notifyAgentMessageMock.mock.calls[0][0] as {
      agentName: string;
      messageType: string;
      priority: string;
      title: string;
      body: string;
    };
    expect(card.priority).toBe("high");
    expect(card.messageType).toBe("alert");
    expect(card.agentName).toBe("gmail-intake");
    expect(card.title).toContain("Ann Yuan <ayuan@axt.com>");
    expect(card.body).toContain("subject-m-ann"); // 主旨
    expect(card.body).toContain("m-ann"); // gmail messageId
    expect(card.body).toContain("classification LLM 500"); // 錯誤原文
  });

  it("貼卡本身失敗也不影響其餘:notifyAgentMessage reject → 仍 totalFailed=1、不炸", async () => {
    listHistoryMessageIdsMock.mockResolvedValue({
      messageIds: ["m-ann2"],
      latestHistoryId: "402",
      expired: false,
    });
    listMessagesByIdsMock.mockResolvedValue([makeMsg("m-ann2", "Ann Yuan <ayuan@axt.com>")]);
    detectReceiptMock.mockReturnValue({ isReceipt: false });
    runInquiryAgentMock.mockRejectedValue(new Error("classification LLM 500"));
    notifyAgentMessageMock.mockRejectedValue(new Error("agentMessages insert down"));

    const result = await runGmailPipelineForMessageIds(7, "403");

    expect(result.totalFailed).toBe(1);
    expect(notifyAgentMessageMock).toHaveBeenCalledTimes(1);
  });
});
