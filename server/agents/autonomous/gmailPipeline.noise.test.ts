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

import {
  isNoreplySender,
  isKnownNoise,
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
