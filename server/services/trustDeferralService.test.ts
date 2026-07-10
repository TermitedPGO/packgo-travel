/**
 * Unit tests for foldOutstandingTrust — the pure outstanding-trust summation
 * core (M5, 2026-05-28).
 *
 * CST §17550 reconciliation: outstanding = sum(amount) of deferred rows that
 * are NOT yet recognized and NOT reversed. unmatched = the subset with no
 * linked bookingId (deposits Jeff still has to attach to a trip). The DB query
 * lives in computeOutstandingTrust; this fold is the testable money math.
 */
import { describe, it, expect } from "vitest";
import {
  foldOutstandingTrust,
  effectiveCategory,
  shouldHaveDeferral,
  decideDeferralSync,
  computeExpectedRecognitionDate,
  isAnyTrustDeferralEnabled,
  isRecognitionDue,
  type TrustDeferredRowLike,
} from "./trustDeferralService";

describe("isAnyTrustDeferralEnabled — F1 塊B (2026-07-08) 對抗審查 P1 修復:認列/查詢路徑要看任一 flag", () => {
  const ORIGINAL_PLAID = process.env.PLAID_TRUST_DEFERRAL_ENABLED;
  const ORIGINAL_STRIPE = process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
  const restore = () => {
    if (ORIGINAL_PLAID === undefined) delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
    else process.env.PLAID_TRUST_DEFERRAL_ENABLED = ORIGINAL_PLAID;
    if (ORIGINAL_STRIPE === undefined) delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
    else process.env.STRIPE_TRUST_DEFERRAL_ENABLED = ORIGINAL_STRIPE;
  };

  it("兩個 flag 都 off → false", () => {
    delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
    delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
    expect(isAnyTrustDeferralEnabled()).toBe(false);
    restore();
  });

  it("只有 PLAID on → true(既有行為不變)", () => {
    process.env.PLAID_TRUST_DEFERRAL_ENABLED = "true";
    delete process.env.STRIPE_TRUST_DEFERRAL_ENABLED;
    expect(isAnyTrustDeferralEnabled()).toBe(true);
    restore();
  });

  it("只有 STRIPE on(PLAID 維持預設 off,最可能發生的裁示組合)→ true", () => {
    delete process.env.PLAID_TRUST_DEFERRAL_ENABLED;
    process.env.STRIPE_TRUST_DEFERRAL_ENABLED = "true";
    expect(isAnyTrustDeferralEnabled()).toBe(true);
    restore();
  });

  it("兩個都 on → true", () => {
    process.env.PLAID_TRUST_DEFERRAL_ENABLED = "true";
    process.env.STRIPE_TRUST_DEFERRAL_ENABLED = "true";
    expect(isAnyTrustDeferralEnabled()).toBe(true);
    restore();
  });
});

describe("computeExpectedRecognitionDate — F1 塊B (2026-07-08) 抽出的純函式,供 Plaid 與 Stripe-direct 兩條路徑共用", () => {
  it("出發日在早鳥窗口外(預設 30 天)→ 認列日 = 出發日(+ offset,預設 0)", () => {
    // 訂金 2026-01-01,出發 2026-06-01,遠超過 30 天早鳥窗口。
    expect(computeExpectedRecognitionDate("2026-06-01", "2026-01-01")).toBe("2026-06-01");
  });

  it("出發日在早鳥窗口內(<=30 天)→ 認列日改成訂金收款日,避免跨年度歸屬問題", () => {
    // 訂金 2026-12-20,出發 2027-01-05(16 天,短前置期)。
    expect(computeExpectedRecognitionDate("2027-01-05", "2026-12-20")).toBe("2026-12-20");
  });

  it("剛好等於 30 天早鳥窗口邊界 → 走短前置期(收款日)分支(<=,不是 <)", () => {
    // 30 天整:2026-01-01 收款,2026-01-31 出發。
    expect(computeExpectedRecognitionDate("2026-01-31", "2026-01-01")).toBe("2026-01-01");
  });

  it("31 天(剛好超過窗口)→ 走出發日分支", () => {
    expect(computeExpectedRecognitionDate("2026-02-01", "2026-01-01")).toBe("2026-02-01");
  });
});

describe("foldOutstandingTrust — outstanding + unmatched", () => {
  it("sums all rows into totalOutstanding and counts rows", () => {
    const rows: TrustDeferredRowLike[] = [
      { amount: "1000", bookingId: 11 },
      { amount: "2500", bookingId: 12 },
      { amount: "408", bookingId: null },
    ];
    const r = foldOutstandingTrust(rows);
    expect(r.totalOutstanding).toBe(3908);
    expect(r.rowCount).toBe(3);
  });

  it("flags rows without a bookingId as unmatched (needs Jeff to link)", () => {
    const rows: TrustDeferredRowLike[] = [
      { amount: "1000", bookingId: 11 }, // matched
      { amount: "408", bookingId: null }, // unmatched
      { amount: "200" }, // unmatched (undefined bookingId)
    ];
    const r = foldOutstandingTrust(rows);
    expect(r.unmatchedCount).toBe(2);
    expect(r.unmatchedTotal).toBe(608);
    // matched portion is the remainder
    expect(r.totalOutstanding - r.unmatchedTotal).toBe(1000);
  });

  it("handles string and number amounts, tolerates garbage as 0", () => {
    const rows: TrustDeferredRowLike[] = [
      { amount: 500, bookingId: 1 },
      { amount: "1500.50", bookingId: 2 },
      { amount: null, bookingId: 3 },
      { amount: "not-a-number", bookingId: 4 },
    ];
    const r = foldOutstandingTrust(rows);
    expect(r.totalOutstanding).toBeCloseTo(2000.5, 2);
    expect(r.rowCount).toBe(4);
    expect(r.unmatchedCount).toBe(0);
  });

  it("empty ledger is all zeros", () => {
    const r = foldOutstandingTrust([]);
    expect(r).toEqual({
      totalOutstanding: 0,
      rowCount: 0,
      unmatchedCount: 0,
      unmatchedTotal: 0,
    });
  });
});

// ─── §17550 認列時點 —— 單一函式紅綠(F2 塊B,2026-07-10)────────────────────
//
// 三條 §17550 紅綠中的前兩條(出發前不可認列/出發後可認列)釘在這裡;
// 第三條(認列後才可轉出)釘在 trustTransferDetection.test.ts 的
// isTransferBackfillEligible / matchPairsToDeferrals。CPA 答覆回來只調
// computeExpectedRecognitionDate 的參數或 isRecognitionDue 的比較式,不動結構。

describe("isRecognitionDue — §17550 認列時點(單一判定函式)", () => {
  it("紅:出發前(認列日在未來)不可認列", () => {
    expect(isRecognitionDue("2026-08-01", "2026-07-10")).toBe(false);
  });

  it("綠:出發後(認列日已過)可認列", () => {
    expect(isRecognitionDue("2026-07-01", "2026-07-10")).toBe(true);
  });

  it("綠:認列日當天(邊界,<= 不是 <)可認列", () => {
    expect(isRecognitionDue("2026-07-10", "2026-07-10")).toBe(true);
  });

  it("紅:認列日缺值(算不出出發日)一律不可認列", () => {
    expect(isRecognitionDue(null, "2026-07-10")).toBe(false);
    expect(isRecognitionDue(undefined, "2026-07-10")).toBe(false);
    expect(isRecognitionDue("", "2026-07-10")).toBe(false);
  });
});

// ─── Manual-override deferral sync (2026-05-29 gap fix) ──────────────────────
//
// The agent path calls processTrustInflow when it classifies a trust inflow as
// income_booking. The manual override path (plaidRouter.transactionUpdate) used
// to skip the deferral ledger entirely, so a hand-marked trust deposit got
// counted as income immediately (CST §17550 violation for long-lead bookings).
// These pure helpers decide whether the override needs to create / reverse /
// leave the deferred row. The trust-account + inflow + row-existence guards
// live in the DB layer, so these only model category/exclude INTENT.

describe("effectiveCategory — Jeff override wins, else agent", () => {
  it("uses Jeff's override when it is a non-empty string", () => {
    expect(effectiveCategory("transfer", "income_booking")).toBe("transfer");
  });
  it("falls back to the agent category when override is empty string", () => {
    // Clearing the override ("") must NOT erase a still-valid agent call.
    expect(effectiveCategory("", "income_booking")).toBe("income_booking");
  });
  it("falls back to the agent category when override is null", () => {
    expect(effectiveCategory(null, "expense_office")).toBe("expense_office");
  });
  it("is null when neither is set", () => {
    expect(effectiveCategory(null, null)).toBeNull();
    expect(effectiveCategory("", undefined)).toBeNull();
  });
});

describe("shouldHaveDeferral — defer iff income_booking AND not excluded", () => {
  it("true for income_booking, not excluded", () => {
    expect(
      shouldHaveDeferral({ effectiveCategory: "income_booking", excluded: false })
    ).toBe(true);
  });
  it("false when excluded even if income_booking", () => {
    expect(
      shouldHaveDeferral({ effectiveCategory: "income_booking", excluded: true })
    ).toBe(false);
  });
  it("false for any other category", () => {
    expect(
      shouldHaveDeferral({ effectiveCategory: "transfer", excluded: false })
    ).toBe(false);
    expect(
      shouldHaveDeferral({ effectiveCategory: null, excluded: false })
    ).toBe(false);
  });
});

describe("decideDeferralSync — create / reverse / noop", () => {
  const enabled = true;
  const notBooking = { effectiveCategory: "other_review", excluded: false };
  const booking = { effectiveCategory: "income_booking", excluded: false };

  it("noop when the feature flag is off, regardless of the flip", () => {
    const r = decideDeferralSync({ enabled: false, before: notBooking, after: booking });
    expect(r.action).toBe("noop");
  });

  it("create when effective category becomes income_booking", () => {
    const r = decideDeferralSync({ enabled, before: notBooking, after: booking });
    expect(r.action).toBe("create");
  });

  it("reverse when moving away from income_booking", () => {
    const r = decideDeferralSync({ enabled, before: booking, after: notBooking });
    expect(r.action).toBe("reverse");
  });

  it("reverse when an income_booking txn gets excluded", () => {
    const r = decideDeferralSync({
      enabled,
      before: booking,
      after: { effectiveCategory: "income_booking", excluded: true },
    });
    expect(r.action).toBe("reverse");
  });

  it("create when an excluded income_booking txn is un-excluded", () => {
    const r = decideDeferralSync({
      enabled,
      before: { effectiveCategory: "income_booking", excluded: true },
      after: booking,
    });
    expect(r.action).toBe("create");
  });

  it("noop when booking-ness does not change (both booking)", () => {
    expect(decideDeferralSync({ enabled, before: booking, after: booking }).action).toBe("noop");
  });

  it("noop when booking-ness does not change (both non-booking)", () => {
    expect(
      decideDeferralSync({ enabled, before: notBooking, after: notBooking }).action
    ).toBe("noop");
  });

  it("clearing Jeff's override but agent still says income_booking → noop (keeps the row)", () => {
    // The tricky case: Jeff had marked income_booking, agent also said
    // income_booking. Jeff clears his override (""). Effective category stays
    // income_booking via the agent, so the deferred row must be KEPT.
    const before = {
      effectiveCategory: effectiveCategory("income_booking", "income_booking"),
      excluded: false,
    };
    const after = {
      effectiveCategory: effectiveCategory("", "income_booking"),
      excluded: false,
    };
    expect(decideDeferralSync({ enabled, before, after }).action).toBe("noop");
  });

  it("clearing Jeff's income_booking override when agent disagreed → reverse", () => {
    // Jeff marked income_booking over an agent other_review. Clearing the
    // override drops the effective category back to other_review → reverse.
    const before = {
      effectiveCategory: effectiveCategory("income_booking", "other_review"),
      excluded: false,
    };
    const after = {
      effectiveCategory: effectiveCategory("", "other_review"),
      excluded: false,
    };
    expect(decideDeferralSync({ enabled, before, after }).action).toBe("reverse");
  });
});

// ─── F2 塊D:認列期收入(LA 曆日歸屬)─────────────────────────────────────────
import { sumRecognizedInPeriodLA, type RecognizedRowLike } from "./trustDeferralService";

describe("sumRecognizedInPeriodLA — 認列期收入純函式(F2 塊D)", () => {
  const row = (o: Partial<RecognizedRowLike> = {}): RecognizedRowLike => ({
    amount: "1000.00",
    recognizedAt: new Date("2026-07-15T18:00:00Z"),
    linkedAccountId: 30003,
    ownerUserId: 1,
    accountIsActive: 1,
    ...o,
  });

  it("期內認列列加總;期外排除", () => {
    expect(
      sumRecognizedInPeriodLA(
        [row(), row({ amount: "500.00" }), row({ recognizedAt: new Date("2026-08-02T18:00:00Z") })],
        "2026-07-01",
        "2026-07-31",
      ),
    ).toBe(1500);
  });

  it("月界地雷(T2 #2):UTC 已跨到 8/1 凌晨、LA 還是 7/31 → 歸七月", () => {
    // 2026-08-01T02:00Z = LA 2026-07-31 19:00(PDT)
    const r = row({ recognizedAt: new Date("2026-08-01T02:00:00Z") });
    expect(sumRecognizedInPeriodLA([r], "2026-07-01", "2026-07-31")).toBe(1000);
    expect(sumRecognizedInPeriodLA([r], "2026-08-01", "2026-08-31")).toBe(0);
  });

  it("哨兵列(linkedAccountId=0,Stripe-direct)一律計入 —— 認列加回是它進 P&L 的唯一入口", () => {
    const sentinel = row({ linkedAccountId: 0, ownerUserId: null, accountIsActive: null });
    expect(sumRecognizedInPeriodLA([sentinel], "2026-07-01", "2026-07-31", 999)).toBe(1000);
  });

  it("真實帳戶列:inactive 帳戶排除;userId scope 不符排除", () => {
    expect(
      sumRecognizedInPeriodLA([row({ accountIsActive: 0 })], "2026-07-01", "2026-07-31"),
    ).toBe(0);
    expect(
      sumRecognizedInPeriodLA([row({ ownerUserId: 2 })], "2026-07-01", "2026-07-31", 1),
    ).toBe(0);
    expect(
      sumRecognizedInPeriodLA([row()], "2026-07-01", "2026-07-31", 1),
    ).toBe(1000);
  });
});

// ─── F2 塊D 回爐 P2:月度遞延口徑(損益/稅表/財報共用)─────────────────────────
import {
  foldMonthlyDeferralAdjustments,
  type DeferralLedgerRowLike,
} from "./trustDeferralService";

describe("foldMonthlyDeferralAdjustments — 月度口徑純函式(F2 塊D 回爐)", () => {
  const MONTHS = ["2026-06", "2026-07", "2026-08"] as const;
  const ledger = (o: Partial<DeferralLedgerRowLike> = {}): DeferralLedgerRowLike => ({
    amount: "1000.00",
    depositDate: "2026-06-05",
    recognizedAt: null,
    reversedAt: null,
    linkedAccountId: 30003,
    ownerUserId: 1,
    accountIsActive: 1,
    ...o,
  });

  it("跨月情境(P2 核心):6 月存入、8 月認列 → 6 月減 1000、8 月加回 1000", () => {
    const adj = foldMonthlyDeferralAdjustments(
      [ledger({ recognizedAt: new Date("2026-08-03T18:00:00Z") })],
      MONTHS,
    );
    expect(adj["2026-06"]).toEqual({ deferredDeposits: 1000, recognizedIncome: 0 });
    expect(adj["2026-07"]).toEqual({ deferredDeposits: 0, recognizedIncome: 0 });
    expect(adj["2026-08"]).toEqual({ deferredDeposits: 0, recognizedIncome: 1000 });
  });

  it("未認列列只有存入側;reversed 列兩側都不算", () => {
    const adj = foldMonthlyDeferralAdjustments(
      [ledger(), ledger({ amount: "500.00", reversedAt: new Date("2026-06-10") })],
      MONTHS,
    );
    expect(adj["2026-06"].deferredDeposits).toBe(1000); // reversed 的 500 不進
    expect(adj["2026-06"].recognizedIncome).toBe(0);
  });

  it("哨兵列(Stripe-direct):存入側不減(無銀行入帳可抵)、認列側照加", () => {
    const adj = foldMonthlyDeferralAdjustments(
      [
        ledger({
          linkedAccountId: 0,
          ownerUserId: null,
          accountIsActive: null,
          recognizedAt: new Date("2026-07-05T18:00:00Z"),
        }),
      ],
      MONTHS,
    );
    expect(adj["2026-06"].deferredDeposits).toBe(0);
    expect(adj["2026-07"].recognizedIncome).toBe(1000);
  });

  it("月界地雷(T2 #2):UTC 已到 8/1 凌晨、LA 還是 7/31 → 認列歸七月", () => {
    const adj = foldMonthlyDeferralAdjustments(
      [ledger({ recognizedAt: new Date("2026-08-01T02:00:00Z") })],
      MONTHS,
    );
    expect(adj["2026-07"].recognizedIncome).toBe(1000);
    expect(adj["2026-08"].recognizedIncome).toBe(0);
  });

  it("視窗外月份忽略;userId scope 不符的真實帳戶列兩側都不算", () => {
    const adj = foldMonthlyDeferralAdjustments(
      [ledger({ depositDate: "2025-12-01" })],
      MONTHS,
    );
    expect(adj["2026-06"].deferredDeposits).toBe(0);

    const scoped = foldMonthlyDeferralAdjustments(
      [ledger({ ownerUserId: 2, recognizedAt: new Date("2026-07-05T18:00:00Z") })],
      MONTHS,
      1,
    );
    expect(scoped["2026-06"].deferredDeposits).toBe(0);
    expect(scoped["2026-07"].recognizedIncome).toBe(0);
  });
});
