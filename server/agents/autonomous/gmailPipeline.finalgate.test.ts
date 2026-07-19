/**
 * Final canonical send chokepoint — PIPELINE-LEVEL regression
 * (Codex 16:02 P1-3, pdf-attachment-reliability batch-3).
 *
 * Proves, through runGmailPipelineForMessageIds → processOneEmail, that:
 *   1. After the Plus CTA append (real CTA copy, which deliberately carries
 *      Markdown ** and em dashes), the ACTUAL bodyText handed to
 *      sendReplyInThread is canonicalized (stripMarkdownForEmail) — same
 *      bytes the final gate scanned. (Attachment-free control — the only
 *      mail that still auto-sends.)
 *   2. ATTACHMENT MAIL NEVER AUTO-SENDS (Codex 12:01 §五.1/§五.4): under a
 *      fully OPEN policy (autoSendEnabled, shadow off, class allowed,
 *      autoSendBlockAttachments=false — the exact bypass Codex proved, now
 *      dead) and an agent that failed to escalate, all four shapes are
 *      blocked with the draft PRESERVED on the escalation card and
 *      shouldAutoReply=false:
 *        a. readable attachment + ordinary clean draft
 *        b. readable attachment + an UNKNOWN dangerous rewrite the matcher
 *           itself scores clean ("The attachment stumped our parser." —
 *           Codex 12:01 §三 proved this evades the classifier; the
 *           suspension blocks it anyway, which is the whole point)
 *        c. readable attachment + a known-ambiguous draft
 *        d. readable attachment + a known-unsafe draft (draft still kept —
 *           the matcher no longer destroys)
 *      Plus the non-readable sentinel shapes from earlier rounds, whose
 *      status reason must still surface.
 *
 * Heavy collaborators are mocked (same wiring family as gmailPipeline.lock /
 * .funnel tests); attachmentReplyGate + autoSendGate + stripMarkdownForEmail
 * + the real CTA copy run REAL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../redis", () => ({
  redis: { set: vi.fn(async () => "OK"), del: vi.fn(async () => 1) },
  redisBullMQ: {},
  default: { set: vi.fn(async () => "OK"), del: vi.fn(async () => 1) },
}));

// ── table-matched thenable db fake ──────────────────────────────────────
import {
  gmailIntegration,
  agentPolicies,
  interactionOutcomes,
  agentMessages,
} from "../../../drizzle/schema";

const OPEN_POLICY = {
  autoSendEnabled: true,
  autoSendShadowMode: false,
  autoSendClasses: ["new_inquiry"],
  autoSendMinConfidence: 90,
  autoSendDailyCap: 10,
  // The bypass Codex proved in 12:01 §三.3 — this key is now DEAD in
  // autoSendGate (attachments are a hard exclusion); the tests below prove
  // setting it false no longer opens anything.
  autoSendBlockAttachments: false,
  classifications: { new_inquiry: { minConfidence: 70, action: "draft_reply" } },
};

const INTEGRATION_ROW = {
  id: 7,
  emailAddress: "support@packgoplay.com",
  isActive: 1,
  lastPollAt: null,
  lastHistoryId: "100",
  messagesProcessed: 0,
  messagesFailed: 0,
};

function tableRows(table: unknown): unknown[] {
  if (table === gmailIntegration) return [INTEGRATION_ROW];
  if (table === agentPolicies)
    return [{ id: 1, version: 1, rules: JSON.stringify(OPEN_POLICY) }];
  if (table === interactionOutcomes) return [{ c: 0 }];
  return [];
}

function makeChain(): any {
  let rows: unknown[] = [];
  const chain: any = {};
  chain.from = (t: unknown) => {
    rows = tableRows(t);
    return chain;
  };
  for (const m of ["where", "leftJoin", "orderBy", "limit", "groupBy"]) {
    chain[m] = () => chain;
  }
  chain.then = (ok: any, err: any) => Promise.resolve(rows).then(ok, err);
  return chain;
}

/** Captured inserts so tests can assert the escalation CARD content (the
 *  draft must be preserved on it — Codex 12:01 §五.4). */
const capturedInserts: Array<{ table: unknown; values: any }> = [];
const fakeDb: any = {
  select: () => makeChain(),
  insert: (table: unknown) => ({
    values: (values: any) => {
      capturedInserts.push({ table, values });
      return Promise.resolve([{ insertId: 42 }]);
    },
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
};

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => fakeDb),
  createPendingExpense: vi.fn(),
  getPendingExpenseByGmailMessageId: vi.fn(),
}));

const sendReplyInThreadMock = vi.fn();
const listMessagesByIdsMock = vi.fn();
vi.mock("../../_core/gmail", () => ({
  buildGmailClient: vi.fn(() => ({})),
  listUnreadMessages: vi.fn(async () => []),
  listMessagesByIds: (...a: unknown[]) => listMessagesByIdsMock(...a),
  listHistoryMessageIds: vi.fn(async () => ({
    messageIds: ["m1"],
    latestHistoryId: "101",
    expired: false,
  })),
  selectIngestableMessages: vi.fn((msgs: unknown[]) => msgs),
  ensureLabel: vi.fn(async () => "label-processed"),
  applyLabel: vi.fn(async () => {}),
  sendReplyInThread: (...a: unknown[]) => sendReplyInThreadMock(...a),
  fetchRawAttachments: vi.fn(async () => []),
  getThreadHistory: vi.fn(async () => []),
}));
vi.mock("../../_core/receiptExtractor", () => ({
  detectReceipt: vi.fn(() => ({ isReceipt: false })),
  extractReceipt: vi.fn(),
  pickReceiptAttachment: vi.fn(() => null),
}));
vi.mock("../../storage", () => ({ storagePut: vi.fn() }));

const runInquiryAgentMock = vi.fn();
vi.mock("./inquiryAgent", () => ({
  runInquiryAgent: (...a: unknown[]) => runInquiryAgentMock(...a),
  DEFAULT_INQUIRY_POLICY: {},
}));
vi.mock("./refundAgent", () => ({
  runRefundAgent: vi.fn(),
  DEFAULT_REFUND_POLICY: {},
}));
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("../../_core/errorFunnel", () => ({
  reportFunnelError: () => Promise.resolve(),
}));
// dynamic imports inside processOneEmail — permissive no-op fakes
vi.mock("../../_core/agentNotify", () => ({
  notifyAgentMessage: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("../../_core/customerMerge", () => ({
  resolveCanonicalForFiling: vi.fn(async (_db: unknown, id: number) => id),
}));
vi.mock("../../db/customerProfile", () => ({
  insertCustomerProfileSafely: vi.fn(async () => ({ id: 9, created: true })),
}));
vi.mock("../../queue", () => ({
  customerBackfillQueue: { add: vi.fn() },
  enqueueCustomerSummaryRefresh: vi.fn(async () => {}),
}));
vi.mock("../../_core/emailCustomerMatch", () => ({
  linkProfileToUserByEmail: vi.fn(async () => {}),
}));
vi.mock("../../_core/tourReferenceResolver", () => ({
  resolveFromEmail: vi.fn(async () => ({ candidates: [], unknownCodes: [] })),
}));
vi.mock("../skills/dispatcher", () => ({
  dispatchAndPersistFromInquiry: vi.fn(async () => ({ kind: "skipped", reason: "test" })),
}));
vi.mock("../../_core/llm", () => ({
  invokeLLM: vi.fn(async () => ({ choices: [] })),
}));
// CTA append: force the "appended" branch with the REAL CTA copy so the
// pipeline regression exercises the actual Markdown/em-dash bytes.
vi.mock("../../_core/repurchaseCta", async () => {
  const actual = await vi.importActual<typeof import("../../_core/repurchaseCta")>(
    "../../_core/repurchaseCta",
  );
  return {
    ...actual,
    maybeAppendUpgradeCta: vi.fn(async (args: { draftReply: string; language?: string }) => ({
      draftReply:
        args.draftReply + actual.buildUpgradeCta(args.language, "https://packgoplay.com"),
      appended: true,
      reason: "appended",
    })),
  };
});

import { runGmailPipelineForMessageIds } from "./gmailPipeline";
import { classifyAttachmentReply } from "./attachmentReplyGate";
import { stripMarkdownForEmail } from "../../_core/plainTextReply";
import { buildUpgradeCta } from "../../_core/repurchaseCta";

const BASE_DECISION = {
  classification: "new_inquiry",
  intent: "行程諮詢",
  urgency: "normal",
  sentiment: "neutral",
  tripType: "unclear",
  extractedRequirements: {},
  shouldAutoReply: true,
  shouldEscalate: false,
  escalationReason: undefined,
  draftReply: "您好,行程建議如下,詳情我們再約時間討論。",
  draftLanguage: "zh-TW",
  expectedLanguage: "zh" as const,
  extractedCustomer: {},
  confidence: 96,
  reasoning: "stub",
};

const baseMsg = (attachments: unknown[]) => ({
  id: "m1",
  messageId: "rfc-m1@x",
  threadId: "t1",
  from: "Leslie Green <leslie@example.com>",
  to: "support@packgoplay.com",
  subject: "十月行程請教",
  body: "您好,想請教十月的行程安排。",
  receivedAt: new Date(1750000000000),
  labels: ["INBOX"],
  attachments,
});

describe("final canonical send chokepoint — pipeline regression (Codex 16:02 P1-3)", () => {
  beforeEach(() => {
    sendReplyInThreadMock.mockReset().mockResolvedValue({
      ok: true,
      dryRun: false,
      messageId: "sent-1",
    });
    listMessagesByIdsMock.mockReset();
    runInquiryAgentMock.mockReset();
  });

  it("CTA path: the ACTUAL sent body is canonicalized — no **, no em dash, exact stripMarkdownForEmail bytes", async () => {
    listMessagesByIdsMock.mockResolvedValue([baseMsg([])]);
    runInquiryAgentMock.mockResolvedValue({ ...BASE_DECISION });

    await runGmailPipelineForMessageIds(7);

    expect(sendReplyInThreadMock).toHaveBeenCalledTimes(1);
    const sent = sendReplyInThreadMock.mock.calls[0][1] as { bodyText: string };
    const expectedCanonical = stripMarkdownForEmail(
      BASE_DECISION.draftReply + buildUpgradeCta("zh-TW", "https://packgoplay.com"),
    );
    expect(sent.bodyText).toBe(expectedCanonical);
    expect(sent.bodyText).toContain("PACK&GO Plus");
    expect(sent.bodyText).not.toContain("**");
    expect(sent.bodyText).not.toMatch(/[—–―‒]/);
  });

  it("inline-sentinel attachment + fully OPEN policy + agent that failed to escalate → STILL no send", async () => {
    listMessagesByIdsMock.mockResolvedValue([
      baseMsg([
        {
          filename: "small.pdf",
          mimeType: "application/pdf",
          kind: "pdf",
          sizeBytes: 1234,
          text: "",
          parseStatus: "not_processed",
          parseError: "inline part kept as sentinel",
        },
      ]),
    ]);
    // Simulated agent-gate regression: the agent says everything is fine.
    capturedInserts.length = 0;
    runInquiryAgentMock.mockResolvedValue({ ...BASE_DECISION, shouldEscalate: false });

    const result = await runGmailPipelineForMessageIds(7);

    expect(sendReplyInThreadMock).not.toHaveBeenCalled();
    expect(result.totalEscalated).toBeGreaterThan(0);
    // Codex 13:20 P2-1.3 — the card must actually SAY what is wrong: the
    // filename, the parse status, and the human-readable manual-work reason.
    const card = capturedInserts.find((i) => i.table === agentMessages);
    expect(card).toBeTruthy();
    expect(String(card!.values.body)).toContain("small.pdf");
    expect(String(card!.values.body)).toContain("not_processed");
    expect(String(card!.values.body)).toContain("讀不出來");
    const ctx = JSON.parse(String(card!.values.context));
    expect(ctx.attachments).toEqual([
      expect.objectContaining({ filename: "small.pdf", parseStatus: "not_processed" }),
    ]);
  });

  it("zero-byte / nameless attachment (parseStatus 'empty' — the shape the fixed collector emits, Codex 17:40 P1-1) + fully OPEN policy → STILL no send", async () => {
    capturedInserts.length = 0;
    listMessagesByIdsMock.mockResolvedValue([
      baseMsg([
        {
          // What collectAttachmentParts + hydration now produce for a
          // named zero-byte or noname Content-Disposition attachment:
          // existence preserved, bytes absent.
          filename: "(未命名附件 application/pdf)",
          mimeType: "application/pdf",
          kind: "unknown",
          sizeBytes: 0,
          text: "",
          parseStatus: "empty",
        },
      ]),
    ]);
    // Agent-gate regression simulated: agent claims all is fine.
    runInquiryAgentMock.mockResolvedValue({ ...BASE_DECISION, shouldEscalate: false });

    const result = await runGmailPipelineForMessageIds(7);

    expect(sendReplyInThreadMock).not.toHaveBeenCalled();
    expect(result.totalEscalated).toBeGreaterThan(0);
    // Codex 13:20 P2-1.3 — filename + status + human reason on the card.
    const card = capturedInserts.find((i) => i.table === agentMessages);
    expect(card).toBeTruthy();
    expect(String(card!.values.body)).toContain("(未命名附件 application/pdf)");
    expect(String(card!.values.body)).toContain("empty");
    expect(String(card!.values.body)).toContain("讀不出來");
    const ctx = JSON.parse(String(card!.values.context));
    expect(ctx.attachments).toEqual([
      expect.objectContaining({
        filename: "(未命名附件 application/pdf)",
        parseStatus: "empty",
      }),
    ]);
  });

  it("empty canonical draft is never auto-sent — falls to the human path (batch-3 adversarial)", async () => {
    listMessagesByIdsMock.mockResolvedValue([baseMsg([])]);
    runInquiryAgentMock.mockResolvedValue({ ...BASE_DECISION, draftReply: "" });

    await runGmailPipelineForMessageIds(7);

    expect(sendReplyInThreadMock).not.toHaveBeenCalled();
  });

  // ── Codex 12:01 §五.4 — the four attachment-suspension shapes. Fully OPEN
  // policy, blockAttachments=false, agent refusing to escalate: attachment
  // mail must still never reach sendReplyInThread, and the escalation card
  // must carry the PRESERVED draft (建議回覆 block, not a drop note). ──
  const READABLE_ATT = {
    filename: "trip.pdf",
    mimeType: "application/pdf",
    kind: "pdf",
    sizeBytes: 1234,
    text: "Day 1 city tour",
    parseStatus: "ok",
  };
  // Each fixture's classifier verdict is ASSERTED inside its test so the
  // name never overstates coverage (Codex 13:20 P2-1.4 — the previous
  // "known-ambiguous" fixture was actually clean: the leading "details"
  // resolved the pronoun to a non-file antecedent).
  const SUSPENSION_CASES: ReadonlyArray<{
    name: string;
    draft: string;
    verdict: "clean" | "ambiguous" | "unsafe";
  }> = [
    {
      name: "a. ordinary clean draft",
      draft: "您好,行程建議如下,詳情我們再約時間討論。",
      verdict: "clean",
    },
    {
      // Codex 12:01 §三 proved this exact sentence evades the classifier
      // (verdict clean). The suspension blocks it anyway — the send decision
      // is no longer language-dependent.
      name: "b. UNKNOWN dangerous rewrite the matcher scores clean",
      draft: "The attachment stumped our parser.",
      verdict: "clean",
    },
    {
      name: "c. known-ambiguous draft",
      draft: "Can you send it again?",
      verdict: "ambiguous",
    },
    {
      name: "d. known-unsafe draft (draft still preserved, never dropped)",
      draft: "您的附件我們無法解析,請重新上傳一次。",
      verdict: "unsafe",
    },
  ];
  for (const c of SUSPENSION_CASES) {
    it(`readable attachment + ${c.name} + fully OPEN policy → NO send, full draft on the card, shouldAutoReply=false`, async () => {
      capturedInserts.length = 0;
      // fixture honesty: the advisory classifier's verdict on the raw draft
      // is exactly what the case name claims.
      expect(classifyAttachmentReply(c.draft).verdict).toBe(c.verdict);

      listMessagesByIdsMock.mockResolvedValue([baseMsg([{ ...READABLE_ATT }])]);
      // Keep the SAME decision object reference — the pipeline mutates it, so
      // we can exact-assert the post-run escalation state (Codex P2-1.2).
      const decision = {
        ...BASE_DECISION,
        draftReply: c.draft,
        shouldEscalate: false, // agent-gate regression simulated
        shouldAutoReply: true, // and it even asked to auto-reply
      };
      runInquiryAgentMock.mockResolvedValue(decision);

      const result = await runGmailPipelineForMessageIds(7);

      expect(sendReplyInThreadMock).not.toHaveBeenCalled();
      expect(result.totalEscalated).toBeGreaterThan(0);
      expect(decision.shouldEscalate).toBe(true);
      expect(decision.shouldAutoReply).toBe(false);

      // FULL canonical draft on the card — exact equality, not a prefix
      // (Codex P2-1.1): the pipeline appends the real CTA, so expected is
      // stripMarkdownForEmail(draft + CTA) — the same bytes a send would use.
      const expectedCanonical = stripMarkdownForEmail(
        c.draft + buildUpgradeCta(BASE_DECISION.draftLanguage, "https://packgoplay.com"),
      );
      const card = capturedInserts.find((i) => i.table === agentMessages);
      expect(card).toBeTruthy();
      expect(String(card!.values.body)).toContain("建議回覆");
      expect(String(card!.values.body)).toContain(expectedCanonical);
      expect(String(card!.values.body)).not.toContain("這封沒有附草稿");
      expect(JSON.parse(String(card!.values.context)).draftReply).toBe(expectedCanonical);
    });
  }

  it("attachment-free mail still auto-sends (the suspension is scoped to attachments)", async () => {
    listMessagesByIdsMock.mockResolvedValue([baseMsg([])]);
    runInquiryAgentMock.mockResolvedValue({ ...BASE_DECISION });

    await runGmailPipelineForMessageIds(7);

    expect(sendReplyInThreadMock).toHaveBeenCalledTimes(1);
  });
});
