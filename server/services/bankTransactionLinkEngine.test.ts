/**
 * bankTransactionLinkEngine 純函式測試(F1 對帳引擎 塊A,2026-07-08)。
 *
 * 只測不需要 DB 的純函式,同本庫既有慣例(trustDeferralService.test.ts 只測
 * foldOutstandingTrust/decideDeferralSync 等純函式,不測 processTrustInflow
 * 這類 DB-touching orchestration)。DB-touching 的 processInboundTransaction /
 * createBankTransactionLink / scanUnlinkedInflows 本地無 DATABASE_URL 測不到,
 * 誠實列在 T6 已知限制。
 *
 * 2026-07-08 對抗審查後更新:findExactAmountCandidates 不再依時間窗預篩選
 * 訂單池(唯一/模糊判斷改成公司層級,見引擎檔案頭註解),改由新增的
 * isCandidateInWindow 獨立檢查「唯一候選是否可以 auto」;新增
 * decideTrustSyncLink(trust_sync 規則的純決策邏輯,原本零測試覆蓋的缺口)
 * 與 isKnownRefundVendorInflow 的紅綠例。
 */
import { describe, it, expect } from "vitest";
import {
  extractOrderRef,
  findExactAmountCandidates,
  isCandidateInWindow,
  decideTrustSyncLink,
  isKnownRefundVendorInflow,
  pendingClaimMinUsd,
  AllocationExceededError,
  wouldExceedAllocation,
  EXACT_AMOUNT_DATE_WINDOW_DAYS,
  type ExactAmountOrderCandidate,
} from "./bankTransactionLinkEngine";
import type { BankTransactionInput } from "./customOrderWatchdog";

describe("extractOrderRef — order_ref 規則(memo 含訂單編號)", () => {
  it("原始描述含 ORD-YYYY-NNNN → 抽出並補零到 4 碼", () => {
    expect(
      extractOrderRef({
        description: null,
        originalDescription: "ZELLE PAYMENT REF ORD-2026-42",
        paymentMetaReason: null,
      }),
    ).toBe("ORD-2026-0042");
  });

  it("Plaid payment_meta.reason 落點也要抓(BofA Zelle memo)", () => {
    expect(
      extractOrderRef({
        description: null,
        originalDescription: null,
        paymentMetaReason: "PACKAGE TRIP DEPOSIT ORD-2026-0007",
      }),
    ).toBe("ORD-2026-0007");
  });

  it("小寫也要吃(大小寫不拘)", () => {
    expect(
      extractOrderRef({ description: "ord-2026-0100", originalDescription: null, paymentMetaReason: null }),
    ).toBe("ORD-2026-0100");
  });

  it("找不到訂單編號 → null(誠實不猜)", () => {
    expect(
      extractOrderRef({ description: "ZELLE PAYMENT TO JOHN", originalDescription: null, paymentMetaReason: null }),
    ).toBeNull();
  });

  it("年份不足 4 碼不算(避免誤配 ORD-26-1 這種假格式)", () => {
    expect(
      extractOrderRef({ description: "ORD-26-0001", originalDescription: null, paymentMetaReason: null }),
    ).toBeNull();
  });
});

const orderBase = {
  status: "quoted",
  currency: "USD",
  depositPaidAt: null,
  balancePaidAt: null,
} as const;

describe("findExactAmountCandidates — 頭號地雷:Plaid 符號守門", () => {
  const order: ExactAmountOrderCandidate = {
    ...orderBase,
    id: 1,
    orderNumber: "ORD-2026-0001",
    title: "測試單",
    totalPrice: "1000.00",
    depositAmount: "300.00",
    balanceAmount: null,
    collectionSentAt: "2026-06-01T00:00:00Z",
    createdAt: "2026-05-01T00:00:00Z",
  };

  it("amount >= 0(出帳/零)一律不參與比對,不能把付供應商誤判成客人收款", () => {
    const outflow: BankTransactionInput = { id: 100, amount: "300.00", date: "2026-06-02", accountMask: null };
    const zero: BankTransactionInput = { id: 101, amount: "0", date: "2026-06-02", accountMask: null };
    expect(findExactAmountCandidates(outflow, [order])).toEqual([]);
    expect(findExactAmountCandidates(zero, [order])).toEqual([]);
  });

  it("amount < 0(入帳)且金額吻合唯一訂單 → 命中,candidateOrderIds 只有自己", () => {
    const inflow: BankTransactionInput = { id: 100, amount: "-300.00", date: "2026-06-02", accountMask: null };
    const findings = findExactAmountCandidates(inflow, [order]);
    expect(findings).toHaveLength(1);
    expect(findings[0].orderId).toBe(1);
    expect(findings[0].candidateOrderIds).toEqual([1]);
    expect(findings[0].legKind).toBe("deposit");
  });
});

describe("findExactAmountCandidates — 公司層級判斷(不先按時間窗篩選訂單池)", () => {
  const nearOrder: ExactAmountOrderCandidate = {
    ...orderBase,
    id: 1,
    orderNumber: "ORD-2026-0001",
    title: "窗內單",
    totalPrice: "500.00",
    depositAmount: null,
    balanceAmount: null,
    collectionSentAt: "2026-06-01T00:00:00Z",
    createdAt: null,
  };
  const farOrder: ExactAmountOrderCandidate = {
    ...nearOrder,
    id: 2,
    orderNumber: "ORD-2026-0002",
    title: "窗外單(仍未收款,金額一樣吻合)",
    collectionSentAt: "2026-05-01T00:00:00Z", // 交易日往前推超過 7 天
  };

  it("2026-07-08 對抗審查 P1 修復:窗內窗外各一張同金額未收款訂單 → 兩張都算候選(不因窗外單而被藏起來)", () => {
    const txn: BankTransactionInput = { id: 200, amount: "-500.00", date: "2026-06-05", accountMask: null };
    const findings = findExactAmountCandidates(txn, [nearOrder, farOrder]);
    expect(findings).toHaveLength(2);
    expect(findings[0].candidateOrderIds.sort()).toEqual([1, 2]);
    // 公司層級判斷下這是模糊情境(2 個真候選),不是「唯一」——舊版時間窗預篩選
    // 會把 farOrder 排除,讓這裡誤判成 findings.length===1 的假唯一。
  });

  it("只有一張訂單存在(另一張窗外單不存在於資料庫)→ 才是真正的唯一候選", () => {
    const txn: BankTransactionInput = { id: 200, amount: "-500.00", date: "2026-06-05", accountMask: null };
    const findings = findExactAmountCandidates(txn, [nearOrder]);
    expect(findings).toHaveLength(1);
    expect(findings[0].candidateOrderIds).toEqual([1]);
  });
});

describe("isCandidateInWindow — 唯一候選是否可以 auto 的獨立時間窗檢查", () => {
  const order: ExactAmountOrderCandidate = {
    ...orderBase,
    id: 1,
    orderNumber: "ORD-2026-0001",
    title: "測試單",
    totalPrice: "500.00",
    depositAmount: null,
    balanceAmount: null,
    collectionSentAt: "2026-06-01T00:00:00Z",
    createdAt: null,
  };

  it("交易日在 collectionSentAt ±7 天內 → true", () => {
    expect(isCandidateInWindow(1, [order], "2026-06-05")).toBe(true); // +4 天
  });

  it("超過 7 天窗口 → false", () => {
    expect(isCandidateInWindow(1, [order], "2026-06-20")).toBe(false); // +19 天
  });

  it("collectionSentAt 缺 → 退回 createdAt", () => {
    const o2: ExactAmountOrderCandidate = { ...order, id: 2, collectionSentAt: null, createdAt: "2026-06-01T00:00:00Z" };
    expect(isCandidateInWindow(2, [o2], "2026-06-05")).toBe(true);
  });

  it("collectionSentAt 與 createdAt 都缺 → false(誠實不猜錨點)", () => {
    const o3: ExactAmountOrderCandidate = { ...order, id: 3, collectionSentAt: null, createdAt: null };
    expect(isCandidateInWindow(3, [o3], "2026-06-05")).toBe(false);
  });

  it("找不到該 orderId → false", () => {
    expect(isCandidateInWindow(999, [order], "2026-06-05")).toBe(false);
  });

  it("交易日期本身壞掉 → false", () => {
    expect(isCandidateInWindow(1, [order], "not-a-date")).toBe(false);
  });

  it("預設窗口常數是 7 天(供 UI/文件核對)", () => {
    expect(EXACT_AMOUNT_DATE_WINDOW_DAYS).toBe(7);
  });
});

describe("decideTrustSyncLink — trust_sync 純決策邏輯(2026-07-08 對抗審查補測)", () => {
  it("查無列(null)→ 不 link", () => {
    expect(decideTrustSyncLink(null)).toBeNull();
  });

  it("有 bookingId 且未撤銷 → 回傳 booking link,matchMethod='auto:trust_sync'", () => {
    const result = decideTrustSyncLink({ bookingId: 42, reversedAt: null, amount: "500.00", matchConfidence: 90 });
    expect(result).toEqual({
      targetType: "booking",
      targetId: 42,
      categoryCode: null,
      amountAllocated: 500,
      matchMethod: "auto:trust_sync",
      matchConfidence: 90,
    });
  });

  it("bookingId 為 null(未配對)→ 不 link", () => {
    expect(decideTrustSyncLink({ bookingId: null, reversedAt: null, amount: "500.00", matchConfidence: 0 })).toBeNull();
  });

  it("2026-07-08 對抗審查 P1:已撤銷(reversedAt 非 null)的配對,即使 bookingId 還在,也不 link", () => {
    expect(
      decideTrustSyncLink({ bookingId: 42, reversedAt: new Date("2026-06-01"), amount: "500.00", matchConfidence: 90 }),
    ).toBeNull();
    expect(
      decideTrustSyncLink({ bookingId: 42, reversedAt: "2026-06-01T00:00:00Z", amount: "500.00", matchConfidence: 90 }),
    ).toBeNull();
  });
});

describe("isKnownRefundVendorInflow — 已知供應商退款 descriptor(避免誤配客人訂單)", () => {
  it("United Airlines 退款描述 → 命中", () => {
    expect(isKnownRefundVendorInflow("UNITED AIRLINES REFUND")).toBe(true);
  });

  it("Lion Travel 退款描述 → 命中", () => {
    expect(isKnownRefundVendorInflow("zelle from us lion travel refund")).toBe(true);
  });

  it("真客人 Zelle 入帳(不含任何已知供應商字樣)→ 不命中", () => {
    expect(isKnownRefundVendorInflow("zelle payment to ann for tour deposit")).toBe(false);
  });
});

describe("pendingClaimMinUsd — 待認領門檻(env 可調)", () => {
  const ORIGINAL = process.env.BANK_TXN_PENDING_CLAIM_MIN_USD;

  it("未設定 env → 預設 100", () => {
    delete process.env.BANK_TXN_PENDING_CLAIM_MIN_USD;
    expect(pendingClaimMinUsd()).toBe(100);
  });

  it("env 設有效數字 → 採用該值", () => {
    process.env.BANK_TXN_PENDING_CLAIM_MIN_USD = "50";
    expect(pendingClaimMinUsd()).toBe(50);
    process.env.BANK_TXN_PENDING_CLAIM_MIN_USD = ORIGINAL;
  });

  it("env 是壞值(負數/非數字)→ 退回預設 100", () => {
    process.env.BANK_TXN_PENDING_CLAIM_MIN_USD = "-5";
    expect(pendingClaimMinUsd()).toBe(100);
    process.env.BANK_TXN_PENDING_CLAIM_MIN_USD = "not-a-number";
    expect(pendingClaimMinUsd()).toBe(100);
    process.env.BANK_TXN_PENDING_CLAIM_MIN_USD = ORIGINAL;
  });
});

describe("AllocationExceededError — 超額分配拒收訊息", () => {
  it("訊息含 bankTransactionId、既有/新增/上限三個金額", () => {
    const err = new AllocationExceededError(42, 80, 30, 100);
    expect(err.message).toContain("42");
    expect(err.message).toContain("80.00");
    expect(err.message).toContain("30.00");
    expect(err.message).toContain("100.00");
    expect(err.name).toBe("AllocationExceededError");
  });
});

describe("wouldExceedAllocation — 分配上限守門(F1 塊D 回爐 2026-07-09,真實數字邊界紅綠例)", () => {
  // 綠例:允許(不超額)
  it("空帳,首次認領剛好等於全額 → 不超額(邊界 =,不是 <)", () => {
    expect(wouldExceedAllocation(0, 100, 100)).toBe(false);
  });
  it("拆兩單剛好加滿全額 → 不超額", () => {
    expect(wouldExceedAllocation(60, 40, 100)).toBe(false);
  });
  it("落在容差內的浮點超出(100.005 <= 100 + 0.01)→ 視為不超額", () => {
    expect(wouldExceedAllocation(0, 100.005, 100)).toBe(false);
  });
  it("零金額交易、零分配 → 不超額", () => {
    expect(wouldExceedAllocation(0, 0, 0)).toBe(false);
  });

  // 紅例:拒收(超額)
  it("已滿額後再加一分錢 → 超額拒收", () => {
    expect(wouldExceedAllocation(100, 1, 100)).toBe(true);
  });
  it("首次認領就超過全額(超出容差)→ 超額拒收", () => {
    expect(wouldExceedAllocation(0, 100.02, 100)).toBe(true);
  });
  it("既有部分分配 + 新增合計爆表 → 超額拒收", () => {
    expect(wouldExceedAllocation(70, 40, 100)).toBe(true);
  });

  it("容差邊界:剛好超過 cap+epsilon 一點點 → 拒收(釘死用的是 > 不是 >=)", () => {
    // 100 + 0.01 = 100.01 是允許上限;100.0100001 應該拒收
    expect(wouldExceedAllocation(0, 100.02, 100, 0.01)).toBe(true);
    expect(wouldExceedAllocation(0, 100.01, 100, 0.01)).toBe(false);
  });
});
