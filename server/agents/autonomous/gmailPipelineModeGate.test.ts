/**
 * gmail-intake-ledger 切片1.5 (Codex 18 輪 §六 P0-3) — intakeMode fail-closed 硬閘旁路封死
 * 的 mode truth-table + source call-site guard.
 *
 * 背景:Codex 17 輪的 authoritative 硬閘只擋 orchestrator 前置一個呼叫點,直接讀呼叫圖後
 * 發現正式系統仍有可達旁路 —— 管理端 gmailRunNow、legacy pipeline 重讀 integration 後不再
 * 核 mode、feeder 本體與 sink 層無 gate、push worker 查不到 mode 以 legacy 兜底(fail-open)。
 * 本檔釘死修正後的姿態:
 *   1. runGmailPipeline / runGmailPipelineForMessageIds(poll / push 的 legacy 入口)重讀
 *      integration 後 mode=history → 在 buildGmailClient / ensureLabel / 任何副作用之前
 *      fail-closed return + 去重告警卡;legacy / shadow 照舊跑(shadow 保留 legacy 並行對照)。
 *   2. runDownstreamForLedgerMessage(下游 sink 層)在 authoritative gate=false 時,於任何
 *      receipt sniff / DB / label 副作用之前 throw(fail-closed);gate=true 才放行。
 *   3. source call-site guard:掃產線碼,runDownstreamForLedgerMessage / feedPendingDownstream
 *      的「呼叫點」只允許白名單檔案,擋未來新 caller 直接繞過硬閘。
 *
 * 重型 collaborator 在 import gmailPipeline 之前 mock(同 gmailPipeline.noise.test.ts 先例)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const redisSet = vi.fn();
vi.mock("../../redis", () => ({
  redis: { set: (...args: unknown[]) => redisSet(...args) },
  redisBullMQ: {},
  default: { set: (...args: unknown[]) => redisSet(...args) },
}));

const dbHolder: { db: unknown } = { db: null };
const getPendingExpenseByGmailMessageIdMock = vi.fn();
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => dbHolder.db),
  createPendingExpense: vi.fn(),
  getPendingExpenseByGmailMessageId: (...args: unknown[]) =>
    getPendingExpenseByGmailMessageIdMock(...args),
}));

const buildGmailClientMock = vi.fn(() => ({}));
const listUnreadMessagesMock = vi.fn(async () => [] as unknown[]);
const listHistoryMessageIdsMock = vi.fn();
const listMessagesByIdsMock = vi.fn(async () => [] as unknown[]);
const ensureLabelMock = vi.fn(async (_g: unknown, name: string) => `id-${name}`);
const applyLabelMock = vi.fn(async () => undefined);
const fetchRawAttachmentsMock = vi.fn(async () => [] as unknown[]);
const listThreadMessagesForFilingMock = vi.fn(async () => [] as unknown[]);
vi.mock("../../_core/gmail", () => ({
  buildGmailClient: (...args: unknown[]) => buildGmailClientMock(...(args as [])),
  listUnreadMessages: (...args: unknown[]) => listUnreadMessagesMock(...(args as [])),
  listMessagesByIds: (...args: unknown[]) => listMessagesByIdsMock(...(args as [])),
  listHistoryMessageIds: (...args: unknown[]) => listHistoryMessageIdsMock(...(args as [])),
  selectIngestableMessages: (summaries: Array<{ labels: string[] }>, processed: string, filter: string | null) =>
    summaries.filter((m) => !m.labels.includes(processed) && (!filter || m.labels.includes(filter))),
  ensureLabel: (...args: unknown[]) => ensureLabelMock(...(args as [never, string])),
  applyLabel: (...args: unknown[]) => applyLabelMock(...(args as [])),
  listThreadMessagesForFiling: (...args: unknown[]) => listThreadMessagesForFilingMock(...(args as [])),
  sendReplyInThread: vi.fn(),
  fetchRawAttachments: (...args: unknown[]) => fetchRawAttachmentsMock(...(args as [])),
}));

const detectReceiptMock = vi.fn(() => ({ isReceipt: false }));
const pickReceiptAttachmentMock = vi.fn(() => null);
vi.mock("../../_core/receiptExtractor", () => ({
  detectReceipt: (...args: unknown[]) => detectReceiptMock(...(args as [])),
  extractReceipt: vi.fn(async () => ({ needsReview: true, confidence: 0 })),
  pickReceiptAttachment: (...args: unknown[]) => pickReceiptAttachmentMock(...(args as [])),
}));

vi.mock("../../storage", () => ({ storagePut: vi.fn(async () => ({ key: "k" })) }));
vi.mock("./inquiryAgent", () => ({ runInquiryAgent: vi.fn(), DEFAULT_INQUIRY_POLICY: {} }));
vi.mock("./refundAgent", () => ({ runRefundAgent: vi.fn(), DEFAULT_REFUND_POLICY: {} }));
vi.mock("./autoSendGate", () => ({ evaluateAutoSend: vi.fn(() => ({ shouldSend: false })) }));
vi.mock("../../_core/threadFiling", () => ({ syncThreadToInteractions: vi.fn(async () => ({ inserted: 0, claimed: 0 })) }));
vi.mock("../../queue", () => ({ customerBackfillQueue: { add: vi.fn() } }));
vi.mock("../../_core/emailCustomerMatch", () => ({ linkProfileToUserByEmail: vi.fn() }));
vi.mock("../../_core/tourReferenceResolver", () => ({ resolveFromEmail: vi.fn(async () => ({ candidates: [], unknownCodes: [] })) }));
vi.mock("../../_core/errorFunnel", () => ({ reportFunnelError: vi.fn(async () => {}), wireWorkerFunnel: vi.fn() }));
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// P0-3 authoritative gate — controllable. Default TRUE so the mode tests (which do NOT
// consult the gate — they route on intakeMode) are unaffected; the sink-gate tests flip it.
const gateApproved = vi.fn(() => true);
vi.mock("../../services/gmailAuthoritativeGate", () => ({
  isGmailAuthoritativeApproved: () => gateApproved(),
}));

import {
  runGmailPipeline,
  runGmailPipelineForMessageIds,
  runDownstreamForLedgerMessage,
} from "./gmailPipeline";
import { gmailIntegration, agentPolicies } from "../../../drizzle/schema";

// ── fake DB (records inserts so we can assert the deduped fenced card) ─────────

function makeFakeDb(integ: Record<string, unknown> | null) {
  const inserted: Array<{ table: unknown; values: unknown }> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const rowsFor = (table: unknown): unknown[] => {
    if (table === gmailIntegration) return integ ? [integ] : [];
    if (table === agentPolicies) return [{ id: 1, version: 1, rules: "{}" }];
    return [];
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: () => ({ limit: async () => rowsFor(table), orderBy: () => ({ limit: async () => [] }) }),
      }),
    }),
    selectDistinct: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    update: () => ({ set: (vals: Record<string, unknown>) => ({ where: async () => { updateCalls.push(vals); } }) }),
    insert: (table: unknown) => ({
      values: async (vals: unknown) => {
        inserted.push({ table, values: vals });
        return [{ insertId: 1 }];
      },
    }),
  };
  return { db, inserted, updateCalls };
}

function integration(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    emailAddress: "support@packgoplay.com",
    isActive: 1,
    intakeMode: "legacy",
    lastHistoryId: "100",
    lastPollAt: new Date("2026-07-01T00:00:00Z"),
    messagesProcessed: 0,
    messagesFailed: 0,
    ...overrides,
  };
}

function fencedCards(inserted: Array<{ table: unknown; values: unknown }>) {
  return inserted.filter(
    (i) => i.table === agentMessagesTable && String((i.values as { body?: string }).body ?? "").includes("legacy_mode_fenced"),
  );
}
// agentMessages is imported lazily only to compare table identity in fencedCards.
import { agentMessages as agentMessagesTable } from "../../../drizzle/schema";

beforeEach(() => {
  redisSet.mockReset().mockResolvedValue("OK");
  buildGmailClientMock.mockClear();
  listUnreadMessagesMock.mockReset().mockResolvedValue([]);
  listHistoryMessageIdsMock.mockReset().mockResolvedValue({ messageIds: [], expired: false, latestHistoryId: "205" });
  listMessagesByIdsMock.mockReset().mockResolvedValue([]);
  ensureLabelMock.mockClear();
  applyLabelMock.mockReset().mockResolvedValue(undefined);
  detectReceiptMock.mockReset().mockReturnValue({ isReceipt: false });
  pickReceiptAttachmentMock.mockReset().mockReturnValue(null);
  getPendingExpenseByGmailMessageIdMock.mockReset().mockResolvedValue(null);
  gateApproved.mockReset().mockReturnValue(true);
});

// ── poll entry: runGmailPipeline × intakeMode ─────────────────────────────────

describe("runGmailPipeline (poll legacy entry) × intakeMode (Codex 18 §六.2)", () => {
  for (const mode of ["legacy", "shadow"] as const) {
    it(`${mode} → RUNS the legacy pipeline (side-effect entry reached: listUnreadMessages called)`, async () => {
      const { db } = makeFakeDb(integration({ intakeMode: mode }));
      dbHolder.db = db;

      const res = await runGmailPipeline(7);

      expect(res.ok).toBe(true);
      // it got PAST the mode gate into the side-effecting body.
      expect(buildGmailClientMock).toHaveBeenCalled();
      expect(listUnreadMessagesMock).toHaveBeenCalled();
    });
  }

  it("history → FAIL-CLOSED before any Gmail/DB/LLM side effect + one deduped fenced card", async () => {
    const { db, inserted } = makeFakeDb(integration({ intakeMode: "history" }));
    dbHolder.db = db;

    const res = await runGmailPipeline(7);

    expect(res).toMatchObject({ ok: true, totalProcessed: 0, totalFetched: 0, errors: [] });
    // NOT ONE side effect: no gmail client, no ensureLabel, no unread fetch.
    expect(buildGmailClientMock).not.toHaveBeenCalled();
    expect(ensureLabelMock).not.toHaveBeenCalled();
    expect(listUnreadMessagesMock).not.toHaveBeenCalled();
    // exactly one fenced alert card (redis NX dedup returned OK once).
    expect(fencedCards(inserted)).toHaveLength(1);
    expect(String((fencedCards(inserted)[0].values as { body: string }).body)).toContain("entry:poll");
  });

  it("history → the fenced card is DEDUPED (redis NX already set → no second card)", async () => {
    const { db, inserted } = makeFakeDb(integration({ intakeMode: "history" }));
    dbHolder.db = db;
    redisSet.mockResolvedValue(null); // key already present → skip the card

    const res = await runGmailPipeline(7);

    expect(res.totalProcessed).toBe(0);
    expect(buildGmailClientMock).not.toHaveBeenCalled();
    expect(fencedCards(inserted)).toHaveLength(0); // deduped away
  });
});

// ── push entry: runGmailPipelineForMessageIds × intakeMode ─────────────────────

describe("runGmailPipelineForMessageIds (push legacy entry) × intakeMode (Codex 18 §六.2)", () => {
  for (const mode of ["legacy", "shadow"] as const) {
    it(`${mode} → RUNS the legacy incremental ingest (listHistoryMessageIds called)`, async () => {
      const { db } = makeFakeDb(integration({ intakeMode: mode }));
      dbHolder.db = db;

      const res = await runGmailPipelineForMessageIds(7, "205");

      expect(res.ok).toBe(true);
      expect(buildGmailClientMock).toHaveBeenCalled();
      expect(listHistoryMessageIdsMock).toHaveBeenCalled();
    });
  }

  it("history → FAIL-CLOSED before any Gmail/DB side effect + fenced card (entry:push)", async () => {
    const { db, inserted } = makeFakeDb(integration({ intakeMode: "history" }));
    dbHolder.db = db;

    const res = await runGmailPipelineForMessageIds(7, "205");

    expect(res).toMatchObject({ ok: true, totalProcessed: 0 });
    expect(buildGmailClientMock).not.toHaveBeenCalled();
    expect(ensureLabelMock).not.toHaveBeenCalled();
    expect(listHistoryMessageIdsMock).not.toHaveBeenCalled();
    expect(fencedCards(inserted)).toHaveLength(1);
    expect(String((fencedCards(inserted)[0].values as { body: string }).body)).toContain("entry:push");
  });
});

// ── sink layer: runDownstreamForLedgerMessage × authoritative gate ─────────────

describe("runDownstreamForLedgerMessage (sink layer) × authoritative gate (Codex 18 §六.1)", () => {
  const msg = {
    id: "mr",
    threadId: "t-mr",
    from: "noreply@marriott.com",
    to: "support@packgoplay.com",
    subject: "receipt",
    body: "your receipt",
    receivedAt: new Date("2026-07-01T01:00:00Z"),
    labels: ["INBOX"],
    attachments: [],
  };
  const ctx = { gmail: {} as never, labelId: "L", fromEmail: "support@packgoplay.com", integrationId: 7 };

  it("gate CLOSED → throws BEFORE any side effect (detectReceipt never runs)", async () => {
    gateApproved.mockReturnValue(false);
    const { db } = makeFakeDb(integration({ intakeMode: "history" }));

    await expect(runDownstreamForLedgerMessage(db as never, msg, ctx)).rejects.toThrow(/fail-closed sink gate/);
    // proof the throw is BEFORE the receipt sniff / any I/O.
    expect(detectReceiptMock).not.toHaveBeenCalled();
    expect(applyLabelMock).not.toHaveBeenCalled();
  });

  it("gate OPEN → proceeds past the gate (receipt sniff runs, receipt path completes)", async () => {
    gateApproved.mockReturnValue(true);
    detectReceiptMock.mockReturnValue({ isReceipt: true });
    getPendingExpenseByGmailMessageIdMock.mockResolvedValue({ id: 99 }); // dedup → clean receipt return
    const { db } = makeFakeDb(integration({ intakeMode: "history" }));

    const out = await runDownstreamForLedgerMessage(db as never, msg, ctx);

    expect(detectReceiptMock).toHaveBeenCalled(); // gate let execution through
    expect(out).toMatchObject({ wasReceipt: true });
  });
});

// ── source call-site guard (掃產線碼:呼叫點只允許白名單檔案) ────────────────────

describe("source call-site guard: the ledger sinks are only CALLED from whitelisted files", () => {
  const serverDir = fileURLToPath(new URL("../../", import.meta.url)); // .../server/
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

  function collectServerTsFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "node_modules") continue;
          walk(p);
        } else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts") && !ent.name.endsWith(".spec.ts")) {
          out.push(p);
        }
      }
    };
    walk(serverDir);
    return out;
  }

  /** Files where a CALL to `name(` appears, EXCLUDING its own definition line and pure
   *  comment lines (imports / `typeof name` type positions have no `(` and never match). */
  function callSiteFiles(name: string): Set<string> {
    const callRe = new RegExp(`\\b${name}\\s*\\(`);
    const defRe = new RegExp(`function\\s+${name}\\b`);
    const files = new Set<string>();
    for (const file of collectServerTsFiles()) {
      const rel = relative(repoRoot, file).split("\\").join("/");
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const t = line.trimStart();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
        if (defRe.test(line)) continue; // the definition itself, not a call
        if (callRe.test(line)) {
          files.add(rel);
          break;
        }
      }
    }
    return files;
  }

  it("runDownstreamForLedgerMessage is called ONLY from the adapter (the gated ledger port)", () => {
    // The one caller is createDownstreamPort.process in gmailIntakeAdapters.ts, reached only
    // through feedPendingDownstream (which itself is authoritative-gated). Any new caller here
    // fails RED — forcing it through the gate rather than around it.
    expect([...callSiteFiles("runDownstreamForLedgerMessage")].sort()).toEqual([
      "server/services/gmailIntakeAdapters.ts",
    ]);
  });

  it("feedPendingDownstream is called ONLY from the engine's own runIntakeStages", () => {
    // runIntakeStages composes sync→gate→classify→feed; the feeder ALSO gates internally.
    // The adapter only references it in a `typeof` return-type position (no call).
    expect([...callSiteFiles("feedPendingDownstream")].sort()).toEqual([
      "server/services/gmailHistorySync.ts",
    ]);
  });
});
