import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvokeLLM, mockDb, selectChain, mockFollowMergePointer } = vi.hoisted(() => {
  const mockInvokeLLM = vi.fn();
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ insertId: 501 }]) }),
  };
  const mockFollowMergePointer = vi.fn(async (_db: unknown, id: number) => id);
  return { mockInvokeLLM, mockDb, selectChain, mockFollowMergePointer };
});

vi.mock("./llm", () => ({ invokeLLM: mockInvokeLLM }));
vi.mock("../db", () => ({ getDb: vi.fn().mockResolvedValue(mockDb) }));
vi.mock("./mergedProfile", () => ({ followMergePointer: mockFollowMergePointer }));
vi.mock("../../drizzle/schema", () => ({
  customerProfiles: {
    id: "id",
    email: "email",
    phone: "phone",
    createdAt: "createdAt",
  },
  customOrders: {
    id: "id",
    notes: "notes",
  },
  customerInteractions: {
    customerProfileId: "customerProfileId",
  },
  users: {
    id: "id",
    role: "role",
    email: "email",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ _op: "eq", args: a })),
  or: vi.fn((...a: unknown[]) => ({ _op: "or", args: a })),
  like: vi.fn((...a: unknown[]) => ({ _op: "like", args: a })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ _op: "sql", strings, values }),
    {},
  ),
}));
vi.mock("./logger", () => ({
  createChildLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));
vi.mock("../db/customOrder", () => ({
  generateOrderNumber: vi.fn().mockResolvedValue("ORD-2026-0099"),
}));

import {
  extractCaseFields,
  buildCaseImportPlan,
  importCaseFile,
  caseImportTraceMarker,
  escapeLikePattern,
  type CaseExtraction,
} from "./caseFileImport";
import { resolveOrIdentifyCustomer } from "../db/customerProfile";
import { getDb } from "../db";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(mockDb as any);
  mockDb.select.mockReturnValue(selectChain);
  selectChain.from.mockReturnThis();
  selectChain.where.mockReturnThis();
  selectChain.orderBy.mockReturnThis();
  selectChain.limit.mockResolvedValue([]);
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue([{ insertId: 501 }]),
  });
  mockFollowMergePointer.mockImplementation(async (_db: unknown, id: number) => id);
});

// ────────────────────────────────────────────────────────────────────────
// extractCaseFields — system prompt must exclude supplier contacts.
// ────────────────────────────────────────────────────────────────────────

describe("extractCaseFields system prompt", () => {
  it("explicitly excludes supplier/vendor contact info from customer identity, with concrete examples", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "測試",
        customerEmail: null,
        customerPhone: null,
        destinationSummary: "測試行程",
        sellPriceUsd: null,
        paymentStatusText: null,
        keyDates: [],
        category: "general",
        warnings: [],
      }) } }],
    });
    await extractCaseFields("some markdown", "測試資料夾");
    expect(mockInvokeLLM).toHaveBeenCalledTimes(1);
    const callArgs = mockInvokeLLM.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === "system").content as string;
    // Must mention supplier/vendor exclusion explicitly, not just say "be careful".
    expect(systemMsg).toContain("供應商");
    expect(systemMsg).toContain("hsinyisu@liontravel.com");
    expect(systemMsg).toContain("ar.ec@uvbookings.com");
    expect(systemMsg).toContain("同業");
    // Must mention the cost-vs-sell-price exclusion explicitly.
    expect(systemMsg).toContain("supplierCost".length >= 0 ? "供應商成本" : "");
    expect(systemMsg).toContain("對外售價");
  });

  it("does not surface a supplier email as customerEmail — real fixture from 林朝安_新馬6日團 案件資料.md", async () => {
    const markdown = `
| 雄獅業務 | 蘇欣怡 Dolphin（02-87939000 #5431，hsinyisu@liontravel.com） |
| 收款方式 | Zelle（陳璽鎂 付款給 Jeff） |

## 三、報價與成本

| 項目 | 金額 |
|------|------|
| 雄獅團費（機票自理，2 位成人合計，INV E26000360） | US$1,080（成本，非對客售價） |
| 對客售價 | US$1,584（2 位合計） |
`;
    // Simulate a CORRECT LLM response (the thing we're testing is that our
    // prompt/schema/parsing pipeline doesn't itself corrupt or rubber-stamp
    // a bad answer — the LLM call itself is mocked, so this also documents
    // the expected-correct shape a well-behaved model should return).
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "林朝安",
        customerEmail: null,
        customerPhone: null,
        destinationSummary: "新馬6日團,雄獅代訂,已成團",
        sellPriceUsd: 1584,
        paymentStatusText: "已付清",
        keyDates: [{ label: "出發日", dateIso: "2026-07-16" }],
        category: "quote",
        warnings: ["找不到客人本人聯絡方式"],
      }) } }],
    });
    const result = await extractCaseFields(markdown, "林朝安_新馬6日團");
    expect(result).not.toBeNull();
    expect(result!.customerEmail).not.toBe("hsinyisu@liontravel.com");
    expect(result!.customerEmail).toBeNull();
    expect(result!.sellPriceUsd).toBe(1584);
    expect(result!.sellPriceUsd).not.toBe(1080);
  });

  it("does not surface a UV Zelle payment address as customerEmail — real fixture from 金宥_芝加哥尼加拉瀑布 案件資料.md", async () => {
    const markdown = `
| 對接人 | Sam大寶（金宥v北美T/S 群組） |
| Sam 角色 | 同業轉售（非單純介紹人）。他另出一份 +$100 直客版給自己的客人 |

## 五、付供應商時程（Zelle to Jupiter Legend Corporation）

Zelle 收款：ar.ec@uvbookings.com

### 利潤計算

| 對外售價（收 Sam） | $5,393（NT$172,600） |
| 付纵横 | -$4,075 |
| 毛利 | $1,318 |
`;
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: null,
        customerEmail: null,
        customerPhone: null,
        destinationSummary: "芝加哥+尼加拉瀑布5天包車遊,經 Sam 同業轉售",
        sellPriceUsd: null,
        paymentStatusText: "訂金已收,尾款待收",
        keyDates: [{ label: "出發日", dateIso: "2026-08-22" }],
        category: "quote",
        warnings: ["對外售價為台幣,未提供美金金額", "找不到客人本人聯絡方式,對接人 Sam 為同業非客人本人"],
      }) } }],
    });
    const result = await extractCaseFields(markdown, "金宥_芝加哥尼加拉瀑布");
    expect(result).not.toBeNull();
    expect(result!.customerEmail).not.toBe("ar.ec@uvbookings.com");
    expect(result!.customerEmail).toBeNull();
  });

  it("returns null when finish_reason is length", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "length", message: { content: "{" } }],
    });
    const result = await extractCaseFields("some content", "資料夾");
    expect(result).toBeNull();
  });

  it("returns null when LLM response is empty", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: "" } }],
    });
    const result = await extractCaseFields("some content", "資料夾");
    expect(result).toBeNull();
  });

  it("returns null (never throws) when invokeLLM rejects", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("network down"));
    const result = await extractCaseFields("some content", "資料夾");
    expect(result).toBeNull();
  });

  it("returns null for empty markdown without calling the LLM", async () => {
    const result = await extractCaseFields("   ", "資料夾");
    expect(result).toBeNull();
    expect(mockInvokeLLM).not.toHaveBeenCalled();
  });

  it("excludes Jeff's own phone from customerEmail/Phone — real fixture from David_中國行 案件資料.md (P0 regression: 對接人(客戶) cell mixes David + Jeff's number)", async () => {
    const markdown = `
| 對接人(客戶) | David(微信);Jeff +1 (510) 634-2307 |
| 供應商(地接) | E China Tours Inc.(品牌:發現中國美);EIN 33-2407070;聯絡 Sandy 周小姐 +86-18862688103 |
`;
    // System prompt must literally name Jeff's number/email as always-excluded.
    const callArgsCheck = { called: false };
    mockInvokeLLM.mockImplementationOnce(async (args: any) => {
      callArgsCheck.called = true;
      const systemMsg = args.messages.find((m: any) => m.role === "system").content as string;
      expect(systemMsg).toContain("+1 (510) 634-2307");
      expect(systemMsg).toContain("jeffhsieh09@gmail.com");
      return {
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
          customerName: "David",
          customerEmail: null,
          customerPhone: null, // only 微信 was given for David — no phone captured
          destinationSummary: "中國行,國際+國內機票+地接團體行程",
          sellPriceUsd: null,
          paymentStatusText: null,
          keyDates: [],
          category: "general",
          warnings: ["該格同時含 Jeff 本人聯絡方式,已排除", "找不到客人本人電話,僅有微信"],
        }) } }],
      };
    });
    const result = await extractCaseFields(markdown, "David_中國行");
    expect(callArgsCheck.called).toBe(true);
    expect(result).not.toBeNull();
    expect(result!.customerPhone).not.toBe("+1 (510) 634-2307");
    expect(result!.customerPhone).toBeNull();
  });

  it("system prompt instructs picking the whole-case total over a single line-item sell price when multiple legitimate sell-price candidates exist — real fixture from David_中國行 (機票 US$5,770 vs 陸地 US$7,196 vs 全案 US$12,836)", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "David",
        customerEmail: null,
        customerPhone: null,
        destinationSummary: "中國行,機票+地接兩段行程",
        sellPriceUsd: 12836,
        paymentStatusText: null,
        keyDates: [],
        category: "general",
        warnings: [],
      }) } }],
    });
    const callArgs = mockInvokeLLM;
    await extractCaseFields("dummy", "David_中國行");
    const systemMsg = callArgs.mock.calls[0][0].messages.find((m: any) => m.role === "system")
      .content as string;
    expect(systemMsg).toContain("全案對外總售價");
    expect(systemMsg).toContain("全案加總");
  });
});

// ────────────────────────────────────────────────────────────────────────
// resolveOrIdentifyCustomer — existing / creatable / blocked_no_identifier
// ────────────────────────────────────────────────────────────────────────

describe("resolveOrIdentifyCustomer", () => {
  it("blocked_no_identifier when both email and phone are null", async () => {
    const result = await resolveOrIdentifyCustomer({ email: null, phone: null });
    expect(result.status).toBe("blocked_no_identifier");
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("blocked_no_identifier when both are empty strings", async () => {
    const result = await resolveOrIdentifyCustomer({ email: "  ", phone: "" });
    expect(result.status).toBe("blocked_no_identifier");
  });

  it("creatable when email is given but no existing row matches", async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const result = await resolveOrIdentifyCustomer({ email: "new@example.com", phone: null });
    expect(result.status).toBe("creatable");
  });

  it("existing with matchedBy=email when a row matches by email", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 42, email: "found@example.com", phone: null }]);
    mockFollowMergePointer.mockResolvedValueOnce(42);
    const result = await resolveOrIdentifyCustomer({ email: "found@example.com", phone: null });
    expect(result.status).toBe("existing");
    expect(result.profileId).toBe(42);
    expect(result.matchedBy).toBe("email");
  });

  it("existing with matchedBy=phone when a row matches by normalized phone", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 43, email: null, phone: "(510) 333-1234" }]);
    mockFollowMergePointer.mockResolvedValueOnce(43);
    const result = await resolveOrIdentifyCustomer({ email: null, phone: "510-333-1234" });
    expect(result.status).toBe("existing");
    expect(result.profileId).toBe(43);
    expect(result.matchedBy).toBe("phone");
  });

  it("follows merge pointer to canonical profileId on a hit", async () => {
    selectChain.limit.mockResolvedValueOnce([{ id: 10, email: "old@example.com", phone: null }]);
    mockFollowMergePointer.mockResolvedValueOnce(99); // merged into 99
    const result = await resolveOrIdentifyCustomer({ email: "old@example.com", phone: null });
    expect(result.status).toBe("existing");
    expect(result.profileId).toBe(99);
  });

  it("2026-07-03 監工確認 — the dedup query does NOT filter out a merged-away (status=blocked) row: a hit on the source card still resolves to the canonical target via followMergePointer, never falls through to blocked_registered_member/creatable", async () => {
    // The row returned here carries status:"blocked" + mergedIntoProfileId set
    // (the exact shape of a card Jeff already merged away). The real query's
    // WHERE only tests email/phone equality — no `eq(customerProfiles.status, ...)`
    // or `isNull(mergedIntoProfileId)` guard exists anywhere in
    // resolveOrIdentifyCustomer — so a merged-away card sharing this email is
    // still a "hit", and followMergePointer (not this fn) is what walks it to
    // the live target. Regression this guards: someone "cleaning up" the dedup
    // WHERE to exclude blocked/merged rows would silently break every filing
    // entrance that relies on finding a merged-away card BY EMAIL to land on
    // its 0109 pointer.
    selectChain.limit.mockResolvedValueOnce([
      { id: 2730001, email: "merged-away@example.com", phone: null, status: "blocked", mergedIntoProfileId: 2760017 },
    ]);
    mockFollowMergePointer.mockResolvedValueOnce(2760017);
    const result = await resolveOrIdentifyCustomer({ email: "merged-away@example.com", phone: null });
    expect(result.status).toBe("existing");
    expect(result.profileId).toBe(2760017);
    expect(mockFollowMergePointer).toHaveBeenCalledWith(expect.anything(), 2730001);
  });

  it("blocked_registered_member when no customerProfiles dup exists but the email belongs to a registered users row — same guard as opsTools.ts create_customer", async () => {
    selectChain.limit
      .mockResolvedValueOnce([]) // customerProfiles dedup: no match
      .mockResolvedValueOnce([{ id: 77 }]); // users lookup: email is a registered member
    const result = await resolveOrIdentifyCustomer({ email: "member@example.com", phone: null });
    expect(result.status).toBe("blocked_registered_member");
    expect(result.registeredUserId).toBe(77);
  });

  it("creatable when email matches neither customerProfiles nor users", async () => {
    selectChain.limit
      .mockResolvedValueOnce([]) // customerProfiles dedup: no match
      .mockResolvedValueOnce([]); // users lookup: no match
    const result = await resolveOrIdentifyCustomer({ email: "nobody@example.com", phone: null });
    expect(result.status).toBe("creatable");
  });

  it("phone-only input skips the registered-member email guard (guard only applies to email, matching opsTools.ts)", async () => {
    selectChain.limit.mockResolvedValueOnce([]); // customerProfiles dedup: no match
    const result = await resolveOrIdentifyCustomer({ email: null, phone: "510-333-9999" });
    expect(result.status).toBe("creatable");
    expect(mockDb.select).toHaveBeenCalledTimes(1); // no extra users lookup fired
  });

  it("2026-07-03 對抗審查(任務7):normalizes a mixed-case email to lowercase before the dedup lookup, matching websiteIntake.ts's insert-time normalization", async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    await resolveOrIdentifyCustomer({ email: "Found@Example.COM", phone: null });
    // The eq() condition built for the dedup SELECT must carry the lowercased
    // email — otherwise a case-insensitive collation is the only thing saving
    // this from silently missing an existing row (or worse, creating a
    // duplicate profile) stored under different casing.
    const whereArg = JSON.stringify(selectChain.where.mock.calls[0][0]);
    expect(whereArg).toContain("found@example.com");
    expect(whereArg).not.toContain("Found@Example.COM");
  });

  it("2026-07-03 對抗審查:the registered-member users lookup also uses the lowercased email", async () => {
    selectChain.limit
      .mockResolvedValueOnce([]) // customerProfiles dedup: no match
      .mockResolvedValueOnce([{ id: 77 }]); // users lookup: registered member
    const result = await resolveOrIdentifyCustomer({ email: "Member@Example.COM", phone: null });
    expect(result.status).toBe("blocked_registered_member");
    const usersWhereArg = JSON.stringify(selectChain.where.mock.calls[1][0]);
    expect(usersWhereArg).toContain("member@example.com");
  });
});

// ────────────────────────────────────────────────────────────────────────
// buildCaseImportPlan — pure function
// ────────────────────────────────────────────────────────────────────────

describe("buildCaseImportPlan", () => {
  const baseExtraction: CaseExtraction = {
    customerName: "林朝安",
    customerEmail: null,
    customerPhone: null,
    destinationSummary: "新馬6日團",
    sellPriceUsd: 1584,
    paymentStatusText: "已付清",
    keyDates: [{ label: "出發日", dateIso: "2026-07-16" }],
    category: "quote",
    warnings: [],
  };

  it("profileAction=reuse when identity is existing", () => {
    const plan = buildCaseImportPlan(
      baseExtraction,
      { status: "existing", profileId: 7, matchedBy: "email" },
      "林朝安_新馬6日團",
      "2026-07-02",
    );
    expect(plan.profileAction).toBe("reuse");
    expect(plan.profileId).toBe(7);
  });

  it("profileAction=create when identity is creatable", () => {
    const plan = buildCaseImportPlan(
      baseExtraction,
      { status: "creatable" },
      "林朝安_新馬6日團",
      "2026-07-02",
    );
    expect(plan.profileAction).toBe("create");
    expect(plan.profileId).toBeUndefined();
  });

  it("order.notes includes the folder name as a trace marker plus today's date", () => {
    const plan = buildCaseImportPlan(
      baseExtraction,
      { status: "creatable" },
      "林朝安_新馬6日團",
      "2026-07-02",
    );
    expect(plan.order.notes).toBe("匯入自案件資料.md(林朝安_新馬6日團),2026-07-02");
    expect(plan.order.notes).toContain(caseImportTraceMarker("林朝安_新馬6日團"));
  });

  it("order.totalPrice carries the sell price straight through, never a cost figure", () => {
    const plan = buildCaseImportPlan(
      baseExtraction,
      { status: "creatable" },
      "林朝安_新馬6日團",
      "2026-07-02",
    );
    expect(plan.order.totalPrice).toBe(1584);
  });

  it("keyDates with a valid full ISO date become an interaction row", () => {
    const plan = buildCaseImportPlan(
      baseExtraction,
      { status: "creatable" },
      "林朝安_新馬6日團",
      "2026-07-02",
    );
    expect(plan.interactions).toHaveLength(1);
    expect(plan.interactions[0].createdAt.getFullYear()).toBe(2026);
    expect(plan.interactions[0].createdAt.getMonth()).toBe(6); // July = index 6
    expect(plan.interactions[0].createdAt.getDate()).toBe(16);
  });

  it("skips keyDates missing a year (e.g. '7/16' fragment slipped through)", () => {
    const extraction: CaseExtraction = {
      ...baseExtraction,
      keyDates: [{ label: "出發日", dateIso: "7/16" }],
    };
    const plan = buildCaseImportPlan(extraction, { status: "creatable" }, "資料夾", "2026-07-02");
    expect(plan.interactions).toHaveLength(0);
  });

  it("skips keyDates with a malformed dateIso string", () => {
    const extraction: CaseExtraction = {
      ...baseExtraction,
      keyDates: [{ label: "出發日", dateIso: "not-a-date" }],
    };
    const plan = buildCaseImportPlan(extraction, { status: "creatable" }, "資料夾", "2026-07-02");
    expect(plan.interactions).toHaveLength(0);
  });

  it("skips keyDates with an invalid calendar day (e.g. 2026-02-30)", () => {
    const extraction: CaseExtraction = {
      ...baseExtraction,
      keyDates: [{ label: "壞日期", dateIso: "2026-02-30" }],
    };
    const plan = buildCaseImportPlan(extraction, { status: "creatable" }, "資料夾", "2026-07-02");
    expect(plan.interactions).toHaveLength(0);
  });

  it("escapeLikePattern escapes %, _ and \\ so a folderName can't turn part of the marker into a wildcard", () => {
    expect(escapeLikePattern("100%放心團")).toBe("100\\%放心團");
    expect(escapeLikePattern("A_B")).toBe("A\\_B");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("正常資料夾")).toBe("正常資料夾");
  });

  it("keeps valid dates and drops invalid ones within the same keyDates array", () => {
    const extraction: CaseExtraction = {
      ...baseExtraction,
      keyDates: [
        { label: "好日期", dateIso: "2026-07-16" },
        { label: "壞日期", dateIso: "6/10" },
      ],
    };
    const plan = buildCaseImportPlan(extraction, { status: "creatable" }, "資料夾", "2026-07-02");
    expect(plan.interactions).toHaveLength(1);
    expect(plan.interactions[0].content).toContain("好日期");
  });
});

// ────────────────────────────────────────────────────────────────────────
// importCaseFile — the DB-touching coordinator
// ────────────────────────────────────────────────────────────────────────

describe("importCaseFile", () => {
  function mockGoodExtraction() {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "測試客人",
        customerEmail: "customer@example.com",
        customerPhone: null,
        destinationSummary: "測試行程",
        sellPriceUsd: 1000,
        paymentStatusText: "已付清",
        keyDates: [{ label: "出發日", dateIso: "2026-08-01" }],
        category: "quote",
        warnings: [],
      }) } }],
    });
  }

  it("dry_run does not write to DB", async () => {
    mockGoodExtraction();
    selectChain.limit
      .mockResolvedValueOnce([]) // customerProfiles dedup: no existing dup
      .mockResolvedValueOnce([]); // users registered-member lookup: no match
    const result = await importCaseFile({ folderName: "測試資料夾", markdown: "content" }, "dry_run");
    expect(result.status).toBe("creatable");
    expect(result.plan).toBeDefined();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("confirm mode writes profile + order + interactions on first call", async () => {
    mockGoodExtraction();
    // 1st select: resolveOrIdentifyCustomer customerProfiles dedup → no match
    // 2nd select: resolveOrIdentifyCustomer users registered-member lookup → no match
    selectChain.limit
      .mockResolvedValueOnce([]) // identity dedup
      .mockResolvedValueOnce([]) // registered-member lookup
      .mockResolvedValueOnce([]) // already-imported-by-folder check
      .mockResolvedValueOnce([{ id: 1, role: "admin" }]); // admin user lookup
    const result = await importCaseFile({ folderName: "測試資料夾", markdown: "content" }, "confirm");
    expect(result.status).toBe("imported");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("confirm mode: a concurrent request wins the customerProfiles insert race — reuses the winner's id instead of erroring out or double-creating (2026-07-03 任務7 對抗審查 P0)", async () => {
    mockGoodExtraction();
    const dupErr = Object.assign(new Error("Duplicate entry 'customer@example.com' for key 'uq_cp_email'"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });
    mockDb.insert.mockImplementationOnce(() => ({
      values: vi.fn().mockRejectedValueOnce(dupErr),
    }));
    selectChain.limit
      .mockResolvedValueOnce([]) // identity dedup: no match → "creatable"
      .mockResolvedValueOnce([]) // registered-member lookup: no match
      .mockResolvedValueOnce([]) // already-imported-by-folder check
      .mockResolvedValueOnce([{ id: 909 }]) // insertCustomerProfileSafely's race-recovery re-select
      .mockResolvedValueOnce([{ id: 1, role: "admin" }]); // admin user lookup
    const result = await importCaseFile({ folderName: "測試資料夾race", markdown: "content" }, "confirm");
    expect(result.status).toBe("imported");
    expect(result.profileId).toBe(909);
    // never a second customerProfiles row from this call — the loser's own
    // insert failed and was recovered, not retried.
    expect(mockDb.insert).toHaveBeenCalledTimes(3); // profile (failed) + order + interaction(s)
  });

  it("already-imported LIKE query uses the escaped marker with an ESCAPE clause (folderName containing % or _ must not wildcard-match unrelated orders)", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "測試客人",
        customerEmail: null,
        customerPhone: "510-333-0000",
        destinationSummary: "測試行程",
        sellPriceUsd: 1000,
        paymentStatusText: null,
        keyDates: [],
        category: "quote",
        warnings: [],
      }) } }],
    });
    selectChain.limit
      .mockResolvedValueOnce([]) // identity dedup (phone-only, no users lookup)
      .mockResolvedValueOnce([{ id: 55 }]); // already-imported-by-folder check hits
    await importCaseFile({ folderName: "100%放心團", markdown: "content" }, "confirm");
    // Find the `where` call whose sql template contains "ESCAPE" (the
    // already-imported check) and assert its interpolated value is the
    // escaped pattern, not the raw folderName.
    const whereCalls = selectChain.where.mock.calls.map((c) => c[0]);
    const likeCall = whereCalls.find((c: any) => c?.strings?.some((s: string) => s.includes("ESCAPE")));
    expect(likeCall).toBeDefined();
    // Template is `${customOrders.notes} LIKE ${likePattern} ESCAPE '\\'` —
    // values[0] is the interpolated `customOrders.notes` column ref,
    // values[1] is the actual LIKE pattern we escaped.
    expect(likeCall.values[1]).toBe(`%${escapeLikePattern(caseImportTraceMarker("100%放心團"))}%`);
    expect(likeCall.values[1]).toContain("100\\%放心團");
  });

  it("blocked_registered_member short-circuits before any write, in both dry_run and confirm", async () => {
    mockGoodExtraction();
    selectChain.limit
      .mockResolvedValueOnce([]) // customerProfiles dedup: no match
      .mockResolvedValueOnce([{ id: 77 }]); // users lookup: registered member
    const result = await importCaseFile({ folderName: "測試資料夾", markdown: "content" }, "confirm");
    expect(result.status).toBe("blocked_registered_member");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("confirm called twice on same folderName returns already_imported and does not insert again", async () => {
    mockGoodExtraction();
    selectChain.limit
      .mockResolvedValueOnce([]) // identity dedup (customerProfiles)
      .mockResolvedValueOnce([]) // registered-member lookup (users): no match
      .mockResolvedValueOnce([{ id: 55 }]); // already-imported-by-folder check hits
    const result = await importCaseFile({ folderName: "測試資料夾", markdown: "content" }, "confirm");
    expect(result.status).toBe("already_imported");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns error (never throws) when the LLM call throws", async () => {
    mockInvokeLLM.mockRejectedValueOnce(new Error("boom"));
    const result = await importCaseFile({ folderName: "測試資料夾", markdown: "content" }, "dry_run");
    expect(result.status).toBe("error");
  });

  it("blocked_no_identifier in dry_run when extraction has no email/phone", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "無聯絡方式客人",
        customerEmail: null,
        customerPhone: null,
        destinationSummary: "測試行程",
        sellPriceUsd: 500,
        paymentStatusText: null,
        keyDates: [],
        category: "general",
        warnings: ["找不到客人本人聯絡方式"],
      }) } }],
    });
    const result = await importCaseFile({ folderName: "無聯絡資料夾", markdown: "content" }, "dry_run");
    expect(result.status).toBe("blocked_no_identifier");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
