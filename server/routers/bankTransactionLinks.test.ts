/**
 * bankTransactionLinks router 測試(F1 對帳引擎 塊A,2026-07-08;F3 塊B 擴充 2026-07-10)。
 * 蓋:procedure surface、listPending 過濾(只留 pending_claim)、pendingSummary
 * Redis 快取(命中不掃 / miss 回填 / single-flight / redis 掛 fail-open)、
 * claim 寫入 + auditLog 斷言 + 快取失效、unlink 寫入 + auditLog + NOT_FOUND、
 * summarizeAutoLinked 純函式、claim 輸入驗證、超額分配轉 BAD_REQUEST。
 *
 * Mock collaborators BEFORE importing the router(vi.mock hoisted)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above the whole file — a class declared at
// module top-level here would throw "Cannot access before initialization"
// if referenced inside the factory, so it's declared INSIDE the factory.
vi.mock("../services/bankTransactionLinkEngine", () => {
  class FakeAllocationExceededError extends Error {
    constructor(bankTransactionId: number, existing: number, incoming: number, cap: number) {
      super(`bankTransactionId ${bankTransactionId}: existing $${existing} + new $${incoming} exceeds $${cap}`);
      this.name = "AllocationExceededError";
    }
  }
  return {
    scanUnlinkedInflows: vi.fn(async () => []),
    processInboundTransaction: vi.fn(),
    createBankTransactionLink: vi.fn(async () => ({ id: 999 })),
    AllocationExceededError: FakeAllocationExceededError,
  };
});
vi.mock("../_core/auditLog", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("../_core/errorFunnel", () => ({ reportFunnelError: vi.fn(async () => {}) }));
// pendingSummary 借用 runBackfillDryRun(唯讀彙總)—— mock 掉,只驗真相列要的
// count/totalAmount 直通,且是 dry-run(不寫路徑)。
vi.mock("../services/bankTransactionLinkBackfill", () => ({
  runBackfillDryRun: vi.fn(async () => ({
    totalScanned: 0,
    autoLinkedByRule: {},
    autoLinkedTotal: 0,
    pendingCount: 0,
    pendingTotalAmount: 0,
    pendingItems: [],
  })),
}));
// Redis:預設全 miss(get→null)。個別測試覆寫模擬命中 / 故障。
// ping/on 是 import 鏈副作用要的(claim zod 枚舉 import accountingAgent →
// llm → llmCache 會在模組載入時 redis.ping())。
vi.mock("../redis", () => ({
  redis: {
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    ping: vi.fn(async () => "PONG"),
    on: vi.fn(),
  },
}));
// DB:預設不可用(唯讀 query fail-open 回空)。unlink 測試覆寫成 fake chain。
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));

import { bankTransactionLinksRouter, summarizeAutoLinked } from "./bankTransactionLinks";
import { audit } from "../_core/auditLog";
import { runBackfillDryRun } from "../services/bankTransactionLinkBackfill";
import { redis } from "../redis";
import { getDb } from "../db";
import {
  scanUnlinkedInflows,
  processInboundTransaction,
  createBankTransactionLink,
  AllocationExceededError,
} from "../services/bankTransactionLinkEngine";

function adminCtx() {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    ip: "127.0.0.1",
  };
}
const caller = () => (bankTransactionLinksRouter as any).createCaller(adminCtx());

const emptyDryRun = {
  totalScanned: 0,
  autoLinkedByRule: {},
  autoLinkedTotal: 0,
  pendingCount: 0,
  pendingTotalAmount: 0,
  pendingItems: [],
};

beforeEach(() => vi.clearAllMocks());

describe("surface", () => {
  it("exposes exactly the 7 procedures (4 read + claim/batchClaim/unlink write)", () => {
    const procs = Object.keys((bankTransactionLinksRouter as any)._def.procedures).sort();
    expect(procs).toEqual([
      "batchClaim",
      "claim",
      "listAutoLinked",
      "listPending",
      "pendingSummary",
      "searchClaimTargets",
      "unlink",
    ]);
  });
});

describe("listPending — 只留 dry-run 判定為 pending_claim 的入帳", () => {
  it("三筆入帳,dry-run 結果分別是 linked/pending_claim/already_handled → 只回傳 pending_claim 那筆", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([
      { id: 1, amount: "-500.00", date: "2026-06-01", remainingAmount: 500 },
      { id: 2, amount: "-80.00", date: "2026-06-02", remainingAmount: 80 },
      { id: 3, amount: "-30.00", date: "2026-06-03", remainingAmount: 30 },
    ]);
    (processInboundTransaction as any).mockImplementation(async (id: number) => {
      if (id === 1) return { status: "linked", rule: "exact_amount", link: {}, linkId: 10 };
      if (id === 2) return { status: "pending_claim", candidates: [{ orderId: 7, orderNumber: "ORD-2026-0007", title: "台灣團", legKind: "deposit", matchedAmount: 80 }] };
      return { status: "already_handled", existingAllocated: 30 };
    });

    const out = await caller().listPending({ limit: 10 });
    expect(out.items).toHaveLength(1);
    expect(out.items[0].bankTransactionId).toBe(2);
    expect(out.items[0].amount).toBe(80);
    expect(out.items[0].candidates).toEqual([
      { orderId: 7, orderNumber: "ORD-2026-0007", title: "台灣團", legKind: "deposit", matchedAmount: 80 },
    ]);
  });

  it("2026-07-08 對抗審查 P1 修復:顯示的是剩餘未分配金額(remainingAmount),不是原始交易總額", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([
      { id: 5, amount: "-100.00", date: "2026-06-01", remainingAmount: 20 }, // 已部分認領 $80,剩 $20
    ]);
    (processInboundTransaction as any).mockResolvedValue({ status: "pending_claim", candidates: [] });
    const out = await caller().listPending({});
    expect(out.items[0].amount).toBe(20);
  });

  it("dry-run 呼叫時帶 { dryRun: true }(唯讀,不能真的寫入)", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([{ id: 1, amount: "-500.00", date: "2026-06-01", remainingAmount: 500 }]);
    (processInboundTransaction as any).mockResolvedValue({ status: "pending_claim", candidates: [] });
    await caller().listPending({});
    expect(processInboundTransaction).toHaveBeenCalledWith(1, { dryRun: true });
  });

  it("分頁:掃滿一頁(=limit)→ nextCursor 指向最後一筆掃到的列,hasMore=true", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([
      { id: 30, amount: "-500.00", date: "2026-06-03", remainingAmount: 500 },
      { id: 20, amount: "-300.00", date: "2026-06-02", remainingAmount: 300 },
    ]);
    (processInboundTransaction as any).mockResolvedValue({ status: "pending_claim", candidates: [] });
    const out = await caller().listPending({ limit: 2 });
    expect(scanUnlinkedInflows).toHaveBeenCalledWith({ limit: 2, cursor: null });
    expect(out.hasMore).toBe(true);
    // nextCursor = 最後掃到的列(#20),即使它是/不是 pending 都以掃描列為準
    expect(out.nextCursor).toEqual({ date: "2026-06-02", id: 20 });
  });

  it("分頁:不足一頁 → hasMore=false、nextCursor=null(背帳掃完)", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([
      { id: 30, amount: "-500.00", date: "2026-06-03", remainingAmount: 500 },
    ]);
    (processInboundTransaction as any).mockResolvedValue({ status: "pending_claim", candidates: [] });
    const out = await caller().listPending({ limit: 10 });
    expect(out.hasMore).toBe(false);
    expect(out.nextCursor).toBeNull();
  });

  it("分頁:空頁(掃不到任何列)→ items 空、hasMore=false、nextCursor=null", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([]);
    const out = await caller().listPending({ limit: 10 });
    expect(out.items).toEqual([]);
    expect(out.hasMore).toBe(false);
    expect(out.nextCursor).toBeNull();
  });

  it("分頁:帶 cursor 進來會原樣傳給 scanUnlinkedInflows(續掃更舊)", async () => {
    (scanUnlinkedInflows as any).mockResolvedValue([]);
    await caller().listPending({ limit: 200, cursor: { date: "2026-05-01", id: 88 } });
    expect(scanUnlinkedInflows).toHaveBeenCalledWith({ limit: 200, cursor: { date: "2026-05-01", id: 88 } });
  });
});

describe("pendingSummary — 真相列「待認領」彙總(唯讀 + Redis 快取)", () => {
  it("快取 miss:直通 runBackfillDryRun 的 pendingCount / pendingTotalAmount,並回填快取 TTL 300s", async () => {
    (runBackfillDryRun as any).mockResolvedValueOnce({
      ...emptyDryRun,
      totalScanned: 373,
      autoLinkedByRule: { small_inflow: 53 },
      autoLinkedTotal: 53,
      pendingCount: 320,
      pendingTotalAmount: 447732,
    });
    const out = await caller().pendingSummary();
    expect(out).toEqual({ count: 320, totalAmount: 447732 });
    expect(redis.set).toHaveBeenCalledWith(
      "financeCockpit:pendingSummary:v1",
      JSON.stringify({ count: 320, totalAmount: 447732 }),
      "EX",
      300,
    );
  });

  it("快取命中:回快取值,完全不跑全量掃描", async () => {
    (redis.get as any).mockResolvedValueOnce(JSON.stringify({ count: 320, totalAmount: 447732 }));
    const out = await caller().pendingSummary();
    expect(out).toEqual({ count: 320, totalAmount: 447732 });
    expect(runBackfillDryRun).not.toHaveBeenCalled();
  });

  it("single-flight:並發兩個 poll 同時 miss,只跑一次全量掃描,兩邊拿同一份", async () => {
    (runBackfillDryRun as any).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10)); // 人工延遲讓兩個 call 重疊
      return { ...emptyDryRun, pendingCount: 7, pendingTotalAmount: 700 };
    });
    const [a, b] = await Promise.all([caller().pendingSummary(), caller().pendingSummary()]);
    expect(a).toEqual({ count: 7, totalAmount: 700 });
    expect(b).toEqual({ count: 7, totalAmount: 700 });
    expect(runBackfillDryRun).toHaveBeenCalledTimes(1);
  });

  it("redis 掛掉:fail-open 直接算,不擋真相列", async () => {
    (redis.get as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    (redis.set as any).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    (runBackfillDryRun as any).mockResolvedValueOnce({
      ...emptyDryRun,
      pendingCount: 3,
      pendingTotalAmount: 15422,
    });
    const out = await caller().pendingSummary();
    expect(out).toEqual({ count: 3, totalAmount: 15422 });
  });

  it("唯讀:走 dry-run 彙總,不觸發 confirm 寫路徑(不建卡、不留審計)", async () => {
    (runBackfillDryRun as any).mockResolvedValueOnce({ ...emptyDryRun });
    await caller().pendingSummary();
    expect(runBackfillDryRun).toHaveBeenCalledTimes(1);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("listAutoLinked / searchClaimTargets — 唯讀 fail-open", () => {
  it("db 不可用:listAutoLinked 回空形狀(不炸)", async () => {
    const out = await caller().listAutoLinked({});
    expect(out).toEqual({ items: [], summary: { count: 0, totalAmount: 0 } });
  });

  it("db 不可用:searchClaimTargets 回空 orders(不炸)", async () => {
    const out = await caller().searchClaimTargets({ q: "王" });
    expect(out).toEqual({ orders: [] });
  });
});

describe("summarizeAutoLinked — 已自動處理彙總純函式", () => {
  it("加總 amountAllocated(decimal 字串),count = 列數", () => {
    expect(
      summarizeAutoLinked([
        { amountAllocated: "3100.00" },
        { amountAllocated: "6150.00" },
        { amountAllocated: "4200.50" },
      ]),
    ).toEqual({ count: 3, totalAmount: 13450.5 });
  });
  it("空列表回 0;爛值當 0 不 NaN", () => {
    expect(summarizeAutoLinked([])).toEqual({ count: 0, totalAmount: 0 });
    expect(summarizeAutoLinked([{ amountAllocated: "bad" }])).toEqual({ count: 1, totalAmount: 0 });
  });
});

describe("claim — 人工認領,錢的真相寫入路徑", () => {
  it("認領到 custom_order → 呼叫 createBankTransactionLink(claimedBy='jeff') 並留 auditLog + 失效彙總快取", async () => {
    const result = await caller().claim({
      bankTransactionId: 42,
      targetType: "custom_order",
      targetId: 7,
      amountAllocated: 300,
    });
    expect(result).toEqual({ id: 999 });
    expect(createBankTransactionLink).toHaveBeenCalledWith(
      expect.objectContaining({
        bankTransactionId: 42,
        targetType: "custom_order",
        targetId: 7,
        amountAllocated: 300,
        matchMethod: "manual",
        matchConfidence: 100,
        claimedBy: "jeff",
      }),
    );
    expect(audit).toHaveBeenCalledTimes(1);
    const auditArg = (audit as any).mock.calls[0][0];
    expect(auditArg.action).toBe("bankTransactionLink.claim");
    expect(auditArg.targetType).toBe("bankTransaction");
    expect(auditArg.targetId).toBe(42);
    expect(auditArg.changes).toEqual(
      expect.objectContaining({ linkId: 999, targetType: "custom_order", targetId: 7, amountAllocated: 300 }),
    );
    // F3 塊B:認領後主動失效 pendingSummary 快取,真相列不滯後
    expect(redis.del).toHaveBeenCalledWith("financeCockpit:pendingSummary:v1");
  });

  it("認領到 category → categoryCode 必填,缺就 BAD_REQUEST 且不寫入不留審計", async () => {
    await expect(
      caller().claim({ bankTransactionId: 42, targetType: "category", amountAllocated: 50 }),
    ).rejects.toThrow(/categoryCode/);
    expect(createBankTransactionLink).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("認領到 custom_order 缺 targetId → BAD_REQUEST", async () => {
    await expect(
      caller().claim({ bankTransactionId: 42, targetType: "custom_order", amountAllocated: 50 }),
    ).rejects.toThrow(/targetId/);
  });

  it("超額分配(AllocationExceededError)轉成 BAD_REQUEST,不是 500,且不留審計", async () => {
    (createBankTransactionLink as any).mockRejectedValueOnce(
      new (AllocationExceededError as any)(42, 80, 30, 100),
    );
    await expect(
      caller().claim({ bankTransactionId: 42, targetType: "category", categoryCode: "transfer", amountAllocated: 30 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("F3 塊C 小修:categoryCode server 端鎖 SCHEDULE_C_MAP 枚舉,枚舉外值(舊 owner_transfer / 自由文字)被 zod 擋", async () => {
    for (const bad of ["owner_transfer", "interest", "other", "free text"]) {
      await expect(
        caller().claim({ bankTransactionId: 42, targetType: "category", categoryCode: bad as any, amountAllocated: 30 }),
      ).rejects.toThrow(); // zod 輸入驗證,連 handler 都進不去
    }
    expect(createBankTransactionLink).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("batchClaim — 多筆一次認領(Jeff 手動勾選的批次化,非自動)", () => {
  it("三筆同類批次 → 逐筆 createBankTransactionLink(claimedBy='jeff')+ 逐筆 audit 不合併,失效快取一次", async () => {
    const out = await caller().batchClaim({
      items: [
        { bankTransactionId: 11, targetType: "category", categoryCode: "income_booking", amountAllocated: 100 },
        { bankTransactionId: 12, targetType: "category", categoryCode: "income_booking", amountAllocated: 200 },
        { bankTransactionId: 13, targetType: "category", categoryCode: "income_booking", amountAllocated: 300 },
      ],
    });
    expect(out.successCount).toBe(3);
    expect(out.failCount).toBe(0);
    expect(out.results).toEqual([
      { bankTransactionId: 11, ok: true, linkId: 999 },
      { bankTransactionId: 12, ok: true, linkId: 999 },
      { bankTransactionId: 13, ok: true, linkId: 999 },
    ]);
    // 逐筆落稽核:三筆 = 三條 audit,不合併成一條
    expect(createBankTransactionLink).toHaveBeenCalledTimes(3);
    expect(audit).toHaveBeenCalledTimes(3);
    expect((audit as any).mock.calls.every((c: any[]) => c[0].action === "bankTransactionLink.claim")).toBe(true);
    // 稽核逐筆記各自的 bankTransactionId
    expect((audit as any).mock.calls.map((c: any[]) => c[0].targetId)).toEqual([11, 12, 13]);
    // 快取只失效一次(批次收尾),不是每筆一次
    expect(redis.del).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalledWith("financeCockpit:pendingSummary:v1");
  });

  it("部分失敗:中間一筆超額 → 其餘照常成功,失敗那筆回報 error,不中止批次", async () => {
    (createBankTransactionLink as any)
      .mockResolvedValueOnce({ id: 501 })
      .mockRejectedValueOnce(new (AllocationExceededError as any)(12, 80, 300, 100))
      .mockResolvedValueOnce({ id: 503 });
    const out = await caller().batchClaim({
      items: [
        { bankTransactionId: 11, targetType: "category", categoryCode: "income_booking", amountAllocated: 100 },
        { bankTransactionId: 12, targetType: "category", categoryCode: "income_booking", amountAllocated: 300 },
        { bankTransactionId: 13, targetType: "category", categoryCode: "income_booking", amountAllocated: 300 },
      ],
    });
    expect(out.successCount).toBe(2);
    expect(out.failCount).toBe(1);
    expect(out.results[0]).toEqual({ bankTransactionId: 11, ok: true, linkId: 501 });
    expect(out.results[1].ok).toBe(false);
    expect(out.results[1].bankTransactionId).toBe(12);
    expect(out.results[1].error).toMatch(/exceeds/);
    expect(out.results[2]).toEqual({ bankTransactionId: 13, ok: true, linkId: 503 });
    // 成功筆的稽核仍逐筆落(2 條);失敗筆不落稽核
    expect(audit).toHaveBeenCalledTimes(2);
    // 有成功筆 → 失效快取一次
    expect(redis.del).toHaveBeenCalledTimes(1);
  });

  it("跨欄位驗證逐筆生效:category 缺 categoryCode 這筆失敗、其餘成功", async () => {
    const out = await caller().batchClaim({
      items: [
        { bankTransactionId: 11, targetType: "custom_order", targetId: 7, amountAllocated: 100 },
        { bankTransactionId: 12, targetType: "category", amountAllocated: 200 }, // 缺 categoryCode
      ],
    });
    expect(out.successCount).toBe(1);
    expect(out.failCount).toBe(1);
    expect(out.results[1].ok).toBe(false);
    expect(out.results[1].error).toMatch(/categoryCode/);
  });

  it("全數失敗 → 不失效快取(沒有任何真相變動)", async () => {
    (createBankTransactionLink as any).mockRejectedValue(new (AllocationExceededError as any)(11, 80, 300, 100));
    const out = await caller().batchClaim({
      items: [
        { bankTransactionId: 11, targetType: "category", categoryCode: "income_booking", amountAllocated: 300 },
      ],
    });
    expect(out.successCount).toBe(0);
    expect(out.failCount).toBe(1);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("枚舉外 categoryCode 被 zod 擋在 handler 外(整批拒絕,連 performClaim 都進不去)", async () => {
    await expect(
      caller().batchClaim({
        items: [{ bankTransactionId: 11, targetType: "category", categoryCode: "free text" as any, amountAllocated: 30 }],
      }),
    ).rejects.toThrow();
    expect(createBankTransactionLink).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("unlink — 人工撤銷 link(對帳明細層複查動作)", () => {
  const linkRow = {
    id: 55,
    bankTransactionId: 42,
    targetType: "custom_order",
    targetId: 7,
    categoryCode: null,
    amountAllocated: "300.00",
    matchMethod: "auto:exact_amount",
    claimedBy: "system",
    note: null,
  };

  /** thenable 假 db chain:任何 builder 方法回自身,await 得 rows。 */
  function fakeDb(selectRows: any[]) {
    const deleted: any[] = [];
    const chain = (rows: any[]) => {
      const c: any = {};
      for (const m of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
        c[m] = vi.fn(() => c);
      }
      c.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
      return c;
    };
    return {
      db: {
        select: vi.fn(() => chain(selectRows)),
        delete: vi.fn(() => {
          deleted.push(true);
          return chain([]);
        }),
      },
      deleted,
    };
  }

  it("存在的 link → 刪除 + auditLog(unlink,含原 link 明細)+ 失效彙總快取", async () => {
    const { db, deleted } = fakeDb([linkRow]);
    (getDb as any).mockResolvedValueOnce(db);

    const out = await caller().unlink({ linkId: 55, note: "對錯單,撤銷重認" });
    expect(out).toEqual({ ok: true, bankTransactionId: 42 });
    expect(deleted).toHaveLength(1);

    expect(audit).toHaveBeenCalledTimes(1);
    const auditArg = (audit as any).mock.calls[0][0];
    expect(auditArg.action).toBe("bankTransactionLink.unlink");
    expect(auditArg.targetType).toBe("bankTransaction");
    expect(auditArg.targetId).toBe(42);
    expect(auditArg.changes).toEqual(
      expect.objectContaining({
        linkId: 55,
        targetType: "custom_order",
        targetId: 7,
        amountAllocated: "300.00",
        matchMethod: "auto:exact_amount",
        note: "對錯單,撤銷重認",
      }),
    );
    expect(redis.del).toHaveBeenCalledWith("financeCockpit:pendingSummary:v1");
  });

  it("不存在的 link → NOT_FOUND,不刪不留審計", async () => {
    const { db, deleted } = fakeDb([]);
    (getDb as any).mockResolvedValueOnce(db);
    await expect(caller().unlink({ linkId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deleted).toHaveLength(0);
    expect(audit).not.toHaveBeenCalled();
  });
});
