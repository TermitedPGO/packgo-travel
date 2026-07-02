/**
 * 寄件人身分 pure helpers (2026-07-02) — G3 fixes share this file:
 *
 * ① isOwnEmail — 自家信箱防火牆。真實案例:jeffhsieh0909@gmail.com 寄的
 *    「Better way To survive」信被 processOneEmail 建成幽靈客人卡。自家
 *    gmail 地址不能進 KNOWN_NOISE_DOMAINS(擋整個 gmail.com 會誤殺所有
 *    gmail 客人),所以 profile 建檔層做 email 全字比對(case-insensitive)。
 * ② parseSenderName — 建檔帶 Gmail 顯示名。brand-new sender 的卡片要帶
 *    From header 的顯示名,但絕不能把 email 再存一次進 name 欄。
 * ③ dupRecoveryLookupId — ER_DUP_ENTRY 回復鍵(G3 review P2)。①讓自家信
 *    走 profileId undefined 路徑(row filed 到 profile 0),但 dup-key 回復
 *    以前 gate 在 `&& profileId` — undefined 直接 rethrow,label 前掛過一次
 *    的自家信變成每輪 poll 燒一次 LLM 的永久 failure loop。回復查詢 key
 *    必須跟 INSERT 寫的一致:(profileId ?? 0, externalId)。
 *
 * Heavy collaborators are mocked BEFORE importing gmailPipeline — same
 * pattern as gmailPipeline.noise.test.ts (module import must be side-effect
 * free; these tests only exercise pure exports).
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../redis", () => ({
  redis: { set: vi.fn() },
  redisBullMQ: {},
  default: { set: vi.fn() },
}));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  createPendingExpense: vi.fn(),
  getPendingExpenseByGmailMessageId: vi.fn(),
}));
vi.mock("../../_core/gmail", () => ({
  buildGmailClient: vi.fn(() => ({})),
  listUnreadMessages: vi.fn(async () => []),
  listMessagesByIds: vi.fn(async () => []),
  listHistoryMessageIds: vi.fn(async () => ({ messageIds: [] })),
  selectIngestableMessages: vi.fn(() => []),
  ensureLabel: vi.fn(),
  applyLabel: vi.fn(),
  sendReplyInThread: vi.fn(),
  fetchRawAttachments: vi.fn(async () => []),
  getThreadHistory: vi.fn(async () => []),
}));
vi.mock("../../_core/receiptExtractor", () => ({
  detectReceipt: vi.fn(() => ({ isReceipt: false })),
  extractReceipt: vi.fn(),
  pickReceiptAttachment: vi.fn(() => null),
}));
vi.mock("../../storage", () => ({ storagePut: vi.fn() }));
vi.mock("./inquiryAgent", () => ({
  runInquiryAgent: vi.fn(),
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

import { isOwnEmail, parseSenderName, dupRecoveryLookupId } from "./gmailPipeline";

// ── ① isOwnEmail — 自家地址絕不建客人卡 ─────────────────────────────────────

describe("isOwnEmail (自家信箱黑名單,exact-match、case-insensitive)", () => {
  it.each([
    "jeffhsieh09@gmail.com",
    "jeffhsieh0909@gmail.com",
    "support@packgoplay.com",
    // case-insensitive + trims (parseEmailAddress already lowercases, but the
    // guard must not depend on that)
    "JeffHsieh0909@Gmail.com",
    "  SUPPORT@PACKGOPLAY.COM  ",
  ])("blocks own address %s", (email) => {
    expect(isOwnEmail(email)).toBe(true);
  });

  it.each([
    "jane.doe@gmail.com",
    // 相似但不同的地址不誤殺 — exact match only
    "jeffhsieh09999@gmail.com",
    "jeffhsieh09@yahoo.com",
    "info@packgoplay.com",
  ])("lets customer address %s through", (email) => {
    expect(isOwnEmail(email)).toBe(false);
  });

  it("null / undefined / empty never match", () => {
    expect(isOwnEmail(null)).toBe(false);
    expect(isOwnEmail(undefined)).toBe(false);
    expect(isOwnEmail("")).toBe(false);
  });
});

// ── ② parseSenderName — 顯示名進 name 欄,email 永遠不進 ────────────────────

describe("parseSenderName (From header 顯示名)", () => {
  it("plain display name: Leslie Green <leslie@x.com>", () => {
    expect(parseSenderName("Leslie Green <leslie@x.com>")).toBe("Leslie Green");
  });

  it('RFC 5322 quoted name: "Green, Leslie" <leslie@x.com>', () => {
    expect(parseSenderName('"Green, Leslie" <leslie@x.com>')).toBe("Green, Leslie");
  });

  it("single-quoted name: 'Leslie Green' <leslie@x.com>", () => {
    expect(parseSenderName("'Leslie Green' <leslie@x.com>")).toBe("Leslie Green");
  });

  it("unicode Chinese name: 謝先生 <jeff@x.com>", () => {
    expect(parseSenderName("謝先生 <jeff@x.com>")).toBe("謝先生");
  });

  it('quoted Chinese name with space: "謝 太太" <mrs@x.com>', () => {
    expect(parseSenderName('"謝 太太" <mrs@x.com>')).toBe("謝 太太");
  });

  it("bare email (no display name) → undefined", () => {
    expect(parseSenderName("leslie@x.com")).toBeUndefined();
  });

  it("angle-only form <leslie@x.com> → undefined", () => {
    expect(parseSenderName("<leslie@x.com>")).toBeUndefined();
  });

  it("quotes-only empty name → undefined", () => {
    expect(parseSenderName('"" <leslie@x.com>')).toBeUndefined();
  });

  it("name == the email itself → undefined (never file a duplicated address as name)", () => {
    expect(parseSenderName("leslie@x.com <leslie@x.com>")).toBeUndefined();
  });

  it("name equals the email in DIFFERENT case → undefined", () => {
    expect(parseSenderName("LESLIE@X.COM <leslie@x.com>")).toBeUndefined();
  });

  it("name merely CONTAINS the email → undefined", () => {
    expect(parseSenderName('"leslie@x.com (Leslie)" <leslie@x.com>')).toBeUndefined();
  });

  it("name is email-shaped even if a different address → undefined", () => {
    expect(parseSenderName("other@y.com <leslie@x.com>")).toBeUndefined();
  });
});

// ── ③ dupRecoveryLookupId — dup-key 回復必須連 profile 0 路徑一起救 ─────────

describe("dupRecoveryLookupId (ER_DUP_ENTRY 回復鍵跟 INSERT 的 key 一致)", () => {
  const DUP = { code: "ER_DUP_ENTRY" };

  it("normal customer path: dup with a real profileId → look up under that id", () => {
    expect(dupRecoveryLookupId(DUP, 123)).toBe(123);
  });

  it("own-email path (the P2 regression): profileId undefined → 0, NOT rethrow", () => {
    // 實案:自家信 filed 到 profile 0 後 label 前掛掉 → 下一輪 poll 撞
    // uq_ci_profile_external(0, messageId)。以前 gate `&& profileId` 讓這裡
    // 回 rethrow,永久卡死;現在必須回 0 讓 caller 撈既有 row 繼續走。
    expect(dupRecoveryLookupId(DUP, undefined)).toBe(0);
  });

  it("profileId 0 (insertId missing 的防禦值) → 0, not rethrow", () => {
    expect(dupRecoveryLookupId(DUP, 0)).toBe(0);
  });

  it("non-dup DB errors always rethrow (null), regardless of profileId", () => {
    expect(dupRecoveryLookupId({ code: "ER_LOCK_DEADLOCK" }, 123)).toBeNull();
    expect(dupRecoveryLookupId({ code: "ER_LOCK_DEADLOCK" }, undefined)).toBeNull();
  });

  it("errors without a code / non-object errors → null (rethrow)", () => {
    expect(dupRecoveryLookupId(new Error("boom"), 123)).toBeNull();
    expect(dupRecoveryLookupId(null, 123)).toBeNull();
    expect(dupRecoveryLookupId(undefined, undefined)).toBeNull();
    expect(dupRecoveryLookupId("ER_DUP_ENTRY", 123)).toBeNull();
  });
});
