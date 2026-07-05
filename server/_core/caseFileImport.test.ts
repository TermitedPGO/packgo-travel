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
    customerProfileId: "customerProfileId",
  },
  customerInteractions: {
    id: "id",
    customerProfileId: "customerProfileId",
    agentName: "agentName",
    content: "content",
  },
  users: {
    id: "id",
    role: "role",
    email: "email",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: unknown[]) => ({ _op: "eq", args: a })),
  and: vi.fn((...a: unknown[]) => ({ _op: "and", args: a })),
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
  formatKeyDatesForNotes,
  importCaseFile,
  repairCaseInteractions,
  caseImportTraceMarker,
  escapeLikePattern,
  LIKE_ESCAPE_CHAR,
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

  it("order.notes 帶 folder trace marker + 今天日期(dedup LIKE 靠它),keyDates 收進 notes", () => {
    const plan = buildCaseImportPlan(
      baseExtraction,
      { status: "creatable" },
      "林朝安_新馬6日團",
      "2026-07-02",
    );
    // trace marker 必須完整出現(dedup / repair 的 LIKE 靠它)。
    expect(plan.order.notes).toContain(caseImportTraceMarker("林朝安_新馬6日團"));
    expect(plan.order.notes).toContain("2026-07-02");
    // baseExtraction 的 keyDate(出發日 2026-07-16,晚於今天)收進 notes、標(未來)。
    expect(plan.order.notes).toContain("關鍵日期:出發日 2026-07-16(未來)");
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

  // ── v787 回爐:keyDates 是「事件」不是「往來/對話」,一律不得變成互動 ──
  it("Wu 真實形狀:多個未來 keyDate + 無對話段 → interactions=0(捏造回爐鎖)", () => {
    // Wu_家庭大團_2026 案:案件資料.md 只有「五、關鍵日期」(出發日 + 訂票死線),
    // 沒有任何對話紀錄段。舊版把這些捏造成 12 筆未來 inbound wechat 互動。
    const wuLike: CaseExtraction = {
      ...baseExtraction,
      keyDates: [
        { label: "台灣段出發", dateIso: "2026-12-19" },
        { label: "越南段出發", dateIso: "2026-12-31" },
        { label: "日本段出發", dateIso: "2027-01-05" },
        { label: "尾款截止", dateIso: "2026-07-11" },
      ],
    };
    const plan = buildCaseImportPlan(wuLike, { status: "creatable" }, "Wu_家庭大團_2026", "2026-07-05");
    // 核心斷言:沒有對話段 → 零互動,keyDates 永不成互動。
    expect(plan.interactions).toHaveLength(0);
    // 資料沒掉:keyDates 收進 notes 供參,未來的標(未來)。
    expect(plan.order.notes).toContain("台灣段出發 2026-12-19(未來)");
    expect(plan.order.notes).toContain("尾款截止 2026-07-11(未來)");
  });

  it("單一合法 keyDate 也不成互動(只進 notes,不當對話)", () => {
    const plan = buildCaseImportPlan(
      baseExtraction,
      { status: "creatable" },
      "林朝安_新馬6日團",
      "2026-07-02",
    );
    expect(plan.interactions).toHaveLength(0);
    expect(plan.order.notes).toContain("關鍵日期:出發日 2026-07-16(未來)");
  });

  it("escapeLikePattern escapes %, _ and the '!' escape char (NOT backslash — backslash in ESCAPE fails on MySQL/TiDB) so a folderName can't turn part of the marker into a wildcard", () => {
    // Escape char is '!', not backslash: `ESCAPE '\\'` emits SQL `ESCAPE '\'`
    // which parse-errors on MySQL/TiDB. Wildcards get an '!' prefix.
    expect(escapeLikePattern("100%放心團")).toBe("100!%放心團");
    expect(escapeLikePattern("A_B")).toBe("A!_B");
    // The real folder that broke prod — every underscore must be escaped so it
    // matches literally, not as a single-char wildcard.
    expect(escapeLikePattern("Wu_家庭大團_2026")).toBe("Wu!_家庭大團!_2026");
    // '!' itself is doubled so a folder literally containing '!' stays literal.
    expect(escapeLikePattern("急件!團")).toBe("急件!!團");
    // A raw backslash is left untouched — it is no longer special to us and
    // never reaches the ESCAPE clause, so no double-escaping quoting hazard.
    expect(escapeLikePattern("back\\slash")).toBe("back\\slash");
    expect(escapeLikePattern("正常資料夾")).toBe("正常資料夾");
  });

  it("formatKeyDatesForNotes:壞日期/缺年份/非法日/空 label 一律不進 notes(不猜);過去日不標未來", () => {
    const note = formatKeyDatesForNotes(
      [
        { label: "報價產出", dateIso: "2026-06-10" }, // 過去(相對 2026-07-02)
        { label: "出發日", dateIso: "2026-07-16" }, // 未來
        { label: "缺年份", dateIso: "6/10" }, // 丟
        { label: "壞字串", dateIso: "not-a-date" }, // 丟
        { label: "非法日", dateIso: "2026-02-30" }, // 丟(2 月無 30 日)
        { label: "", dateIso: "2026-08-01" }, // 空 label,丟
      ],
      "2026-07-02",
    );
    expect(note).toContain("報價產出 2026-06-10");
    expect(note).not.toContain("報價產出 2026-06-10(未來)"); // 過去日不標未來
    expect(note).toContain("出發日 2026-07-16(未來)");
    expect(note).not.toContain("6/10");
    expect(note).not.toContain("not-a-date");
    expect(note).not.toContain("2026-02-30");
    expect(note).not.toContain("2026-08-01"); // 空 label 那筆整筆丟
  });

  it("formatKeyDatesForNotes:沒有任何可收的 keyDate → 空字串;notes 就只有 marker 行", () => {
    expect(formatKeyDatesForNotes([], "2026-07-02")).toBe("");
    expect(formatKeyDatesForNotes([{ label: "x", dateIso: "壞" }], "2026-07-02")).toBe("");
    const plan = buildCaseImportPlan(
      { ...baseExtraction, keyDates: [] },
      { status: "creatable" },
      "資料夾",
      "2026-07-02",
    );
    expect(plan.order.notes).toBe("匯入自案件資料.md(資料夾),2026-07-02");
    expect(plan.interactions).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// repairCaseInteractions — 捏造互動回爐(刪除 + 按新規則重建=0)
// ────────────────────────────────────────────────────────────────────────

describe("repairCaseInteractions", () => {
  // 兩次 select():第 1 次訂單查詢(.limit → [order]),第 2 次互動目標查詢
  // (.where 直接 await → [rows]);外加 delete()。
  function setupRepairDb(opts: {
    order?: { id: number; profileId: number } | null;
    targets?: Array<{ id: number }>;
  }) {
    const orderRows = opts.order ? [opts.order] : [];
    const targetRows = opts.targets ?? [];
    const orderChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(orderRows),
    };
    const targetsChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(targetRows), // 直接 await,無 .limit
    };
    let selectCall = 0;
    mockDb.select.mockImplementation(() =>
      selectCall++ === 0 ? (orderChain as any) : (targetsChain as any),
    );
    const deleteWhere = vi.fn().mockResolvedValue(undefined);
    (mockDb as any).delete = vi.fn().mockReturnValue({ where: deleteWhere });
    return { deleteWhere };
  }

  it("dry_run:找到訂單 + N 筆捏造互動 → 出統計、附 sampleIds、rebuilt=0、不刪", async () => {
    const { deleteWhere } = setupRepairDb({
      order: { id: 6, profileId: 2760045 },
      targets: [{ id: 1380798 }, { id: 1380799 }, { id: 1380800 }],
    });
    const res = await repairCaseInteractions("Wu_家庭大團_2026", "dry_run");
    expect(res.status).toBe("dry_run");
    expect(res.orderId).toBe(6);
    expect(res.profileId).toBe(2760045);
    expect(res.foundInteractions).toBe(3);
    expect(res.rebuiltInteractions).toBe(0);
    expect(res.sampleIds).toEqual([1380798, 1380799, 1380800]);
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("confirm:刪除 N 筆捏造互動,rebuilt=0,只刪互動(不 delete 訂單/卡)", async () => {
    const { deleteWhere } = setupRepairDb({
      order: { id: 6, profileId: 2760045 },
      targets: [{ id: 1380798 }, { id: 1380799 }],
    });
    const res = await repairCaseInteractions("Wu_家庭大團_2026", "confirm");
    expect(res.status).toBe("repaired");
    expect(res.foundInteractions).toBe(2);
    expect(res.deletedInteractions).toBe(2);
    expect(res.rebuiltInteractions).toBe(0);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });

  it("找不到該案訂單(trace marker 不在任何 notes)→ not_found,不刪任何互動", async () => {
    const { deleteWhere } = setupRepairDb({ order: null, targets: [] });
    const res = await repairCaseInteractions("不存在的資料夾", "dry_run");
    expect(res.status).toBe("not_found");
    expect(res.foundInteractions).toBeUndefined();
    expect(deleteWhere).not.toHaveBeenCalled();
  });

  it("冪等:confirm 但已無捏造互動 → deleted=0,不呼叫 delete", async () => {
    const { deleteWhere } = setupRepairDb({
      order: { id: 6, profileId: 2760045 },
      targets: [], // 已被前一次 repair 清空
    });
    const res = await repairCaseInteractions("Wu_家庭大團_2026", "confirm");
    expect(res.status).toBe("repaired");
    expect(res.foundInteractions).toBe(0);
    expect(res.deletedInteractions).toBe(0);
    expect(deleteWhere).not.toHaveBeenCalled();
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

  it("confirm mode writes profile + order (no interactions — 摘要檔沒有對話段) on first call", async () => {
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
    // insert failed and was recovered, not retried. v787 回爐後互動恆為 0,故
    // insert 次數是 2(profile 失敗那次 + order),不再有 interaction insert。
    expect(mockDb.insert).toHaveBeenCalledTimes(2); // profile (failed) + order
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
    // Template is `${customOrders.notes} LIKE ${likePattern} ESCAPE ${LIKE_ESCAPE_CHAR}` —
    // values[0] is the interpolated `customOrders.notes` column ref,
    // values[1] is the actual LIKE pattern we escaped, values[2] is the
    // escape char (bound as a param, NOT a backslash string literal that
    // TiDB/MySQL would reject).
    expect(likeCall.values[1]).toBe(`%${escapeLikePattern(caseImportTraceMarker("100%放心團"))}%`);
    expect(likeCall.values[1]).toContain("100!%放心團");
    expect(likeCall.values[2]).toBe(LIKE_ESCAPE_CHAR);
    // Hard guard against the prod regression: no fragment of the emitted SQL
    // may contain a lone backslash-in-quotes ESCAPE literal.
    const joinedSql = (likeCall.strings as string[]).join("");
    expect(joinedSql).not.toContain("\\");
    expect(joinedSql).toContain("ESCAPE");
  });

  // Regression for the prod ER_PARSE_ERROR (2026-07-04, folder "Wu_家庭大團_2026"):
  // an underscore in the folder name must (a) not blow up the dedup SELECT, and
  // (b) match only its own literal marker, never wildcard-match another folder.
  it("underscore folder name (Wu_家庭大團_2026): dedup SELECT runs and the '_' is escaped literal, not a wildcard", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "Wu 家庭",
        customerEmail: null,
        customerPhone: "510-333-9999",
        destinationSummary: "台灣越南日本大團",
        sellPriceUsd: 50000,
        paymentStatusText: null,
        keyDates: [],
        category: "quote",
        warnings: [],
      }) } }],
    });
    selectChain.limit
      .mockResolvedValueOnce([]) // identity dedup (phone-only, skips users email guard)
      .mockResolvedValueOnce([]) // already-imported-by-folder check: no prior import
      .mockResolvedValueOnce([{ id: 1, role: "admin" }]); // admin user lookup
    const result = await importCaseFile(
      { folderName: "Wu_家庭大團_2026", markdown: "content" },
      "confirm",
    );
    // The dedup SELECT did not throw; the import proceeded to a real insert.
    expect(result.status).toBe("imported");

    const whereCalls = selectChain.where.mock.calls.map((c) => c[0]);
    const likeCall = whereCalls.find((c: any) => c?.strings?.some((s: string) => s.includes("ESCAPE")));
    expect(likeCall).toBeDefined();
    // Every underscore in the folder name is '!'-escaped so it matches
    // literally — a decoy folder "Wu-家庭大團-2026" (or any single char in the
    // '_' slots) must NOT satisfy this pattern.
    expect(likeCall.values[1]).toBe(
      `%${escapeLikePattern(caseImportTraceMarker("Wu_家庭大團_2026"))}%`,
    );
    expect(likeCall.values[1]).toContain("Wu!_家庭大團!_2026");
    // The raw, unescaped underscore form must NOT appear as a bare wildcard.
    expect(likeCall.values[1]).not.toContain("Wu_家庭大團_2026");
    expect(likeCall.values[2]).toBe(LIKE_ESCAPE_CHAR);
  });

  it("returns already_imported for an underscore folder when its marker is already present (idempotent re-confirm survives the escaping)", async () => {
    mockInvokeLLM.mockResolvedValueOnce({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        customerName: "Wu 家庭",
        customerEmail: null,
        customerPhone: "510-333-9999",
        destinationSummary: "台灣越南日本大團",
        sellPriceUsd: 50000,
        paymentStatusText: null,
        keyDates: [],
        category: "quote",
        warnings: [],
      }) } }],
    });
    selectChain.limit
      .mockResolvedValueOnce([]) // identity dedup (phone-only)
      .mockResolvedValueOnce([{ id: 77 }]); // already-imported check hits for this folder
    const result = await importCaseFile(
      { folderName: "Wu_家庭大團_2026", markdown: "content" },
      "confirm",
    );
    expect(result.status).toBe("already_imported");
    expect(result.orderId).toBe(77);
    expect(mockDb.insert).not.toHaveBeenCalled();
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
