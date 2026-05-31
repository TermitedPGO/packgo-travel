import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BankPLReport } from "../../services/bankPLService";
import type { ReconciliationReport } from "../../services/reconciliationService";

// Mock all external dependencies
vi.mock("../../_core/logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../_core/approvalTasks", () => ({
  createApprovalTask: vi.fn().mockResolvedValue({ id: 1 }),
}));

// These are dynamically imported, so we mock them as modules
const mockGenerateBankPL = vi.fn();
const mockRunReconciliation = vi.fn();
const mockTotalDeferredForUser = vi.fn();
const mockIsTrustDeferralEnabled = vi.fn();

vi.mock("../../services/bankPLService", () => ({
  generateBankPL: (...args: any[]) => mockGenerateBankPL(...args),
}));

vi.mock("../../services/reconciliationService", () => ({
  runReconciliation: (...args: any[]) => mockRunReconciliation(...args),
}));

vi.mock("../../services/trustDeferralService", () => ({
  totalDeferredForUser: (...args: any[]) => mockTotalDeferredForUser(...args),
  isTrustDeferralEnabled: () => mockIsTrustDeferralEnabled(),
}));

// Import after mocks
import {
  checkStripeMismatch,
  checkProfitDrop,
  checkUnclassifiedPileup,
  checkTrustAnomaly,
  checkSupplierPaymentMismatch,
  PROFIT_DROP_THRESHOLD_PCT,
  UNCLASSIFIED_PILEUP_THRESHOLD,
  TRUST_ANOMALY_THRESHOLD_USD,
} from "./financeAlertProducer";

function makeBankPL(overrides: Partial<BankPLReport> = {}): BankPLReport {
  return {
    period: { startDate: "2026-05-01", endDate: "2026-05-31" },
    income: { total: 10000, byCategory: {} },
    expenses: { total: 5000, cogs: 3000, operating: 2000, byCategory: {} },
    refunds: 0,
    transfer: { total: 0, count: 0 },
    grossProfit: 5000,
    netProfit: 5000,
    profitMargin: 50,
    transactionCount: 20,
    needsReviewCount: 2,
    needsReviewAmount: 100,
    scheduleCMap: {} as any,
    excludedFromAccounting: 0,
    uncategorizedCount: 0,
    trustDeferredIncome: 0,
    ...overrides,
  };
}

function makeReconciliation(
  discrepancies: ReconciliationReport["discrepancies"] = [],
): ReconciliationReport {
  return {
    period: { start: new Date(), end: new Date() },
    internalPayments: { count: 0, totalAmount: 0, byCurrency: {} },
    stripeCharges: null,
    costs: { accounting: [], estimated: [] },
    pnl: { income: 0, stripeFees: 0, estimatedCosts: 0, netProfit: 0, currency: "USD" },
    bank: {
      enabled: false,
      inflowsTotal: 0,
      outflowsTotal: 0,
      netCashFlow: 0,
      txCount: 0,
      uncategorizedCount: 0,
      byCategory: [],
      excludedCount: 0,
    },
    discrepancies,
    warnings: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkStripeMismatch", () => {
  it("returns null when no discrepancies", async () => {
    mockRunReconciliation.mockResolvedValue(makeReconciliation([]));
    expect(await checkStripeMismatch()).toBeNull();
  });

  it("returns null when only low-severity discrepancies", async () => {
    mockRunReconciliation.mockResolvedValue(
      makeReconciliation([
        { severity: "low", type: "timing", description: "minor", affectedIds: [] },
      ]),
    );
    expect(await checkStripeMismatch()).toBeNull();
  });

  it("returns alert for high-severity discrepancies", async () => {
    mockRunReconciliation.mockResolvedValue(
      makeReconciliation([
        { severity: "high", type: "missing_charge", description: "charge not found" },
      ]),
    );
    const result = await checkStripeMismatch();
    expect(result).not.toBeNull();
    expect(result!.alertType).toBe("stripe_mismatch");
    expect(result!.severity).toBe("warning");
    expect(result!.metric).toBe(1);
  });

  it("returns critical when 3+ high-severity discrepancies", async () => {
    mockRunReconciliation.mockResolvedValue(
      makeReconciliation([
        { severity: "high", type: "a", description: "a" },
        { severity: "high", type: "b", description: "b" },
        { severity: "high", type: "c", description: "c" },
      ]),
    );
    const result = await checkStripeMismatch();
    expect(result!.severity).toBe("critical");
  });

  it("returns null if reconciliation throws", async () => {
    mockRunReconciliation.mockRejectedValue(new Error("db down"));
    expect(await checkStripeMismatch()).toBeNull();
  });
});

describe("checkProfitDrop", () => {
  it("returns null when profit is stable", async () => {
    mockGenerateBankPL
      .mockResolvedValueOnce(makeBankPL({ netProfit: 5000 })) // current
      .mockResolvedValueOnce(makeBankPL({ netProfit: 5500 })); // previous
    expect(await checkProfitDrop()).toBeNull();
  });

  it("returns null when previous month is 0", async () => {
    mockGenerateBankPL
      .mockResolvedValueOnce(makeBankPL({ netProfit: 5000 }))
      .mockResolvedValueOnce(makeBankPL({ netProfit: 0 }));
    expect(await checkProfitDrop()).toBeNull();
  });

  it("returns alert when drop exceeds threshold", async () => {
    // 50% drop: prev=10000, cur=5000
    mockGenerateBankPL
      .mockResolvedValueOnce(makeBankPL({ netProfit: 5000 })) // current
      .mockResolvedValueOnce(makeBankPL({ netProfit: 10000 })); // previous
    const result = await checkProfitDrop();
    expect(result).not.toBeNull();
    expect(result!.alertType).toBe("profit_drop");
    expect(result!.metric).toBeCloseTo(50, 0);
    expect(result!.severity).toBe("critical");
  });

  it("returns warning for moderate drop", async () => {
    // 25% drop: prev=8000, cur=6000
    mockGenerateBankPL
      .mockResolvedValueOnce(makeBankPL({ netProfit: 6000 }))
      .mockResolvedValueOnce(makeBankPL({ netProfit: 8000 }));
    const result = await checkProfitDrop();
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warning");
  });

  it("returns null below threshold", async () => {
    // 10% drop: below 20% threshold
    mockGenerateBankPL
      .mockResolvedValueOnce(makeBankPL({ netProfit: 9000 }))
      .mockResolvedValueOnce(makeBankPL({ netProfit: 10000 }));
    expect(await checkProfitDrop()).toBeNull();
  });
});

describe("checkUnclassifiedPileup", () => {
  it("returns null below threshold", async () => {
    mockGenerateBankPL.mockResolvedValue(
      makeBankPL({ needsReviewCount: UNCLASSIFIED_PILEUP_THRESHOLD - 1 }),
    );
    expect(await checkUnclassifiedPileup()).toBeNull();
  });

  it("returns alert at threshold", async () => {
    mockGenerateBankPL.mockResolvedValue(
      makeBankPL({ needsReviewCount: UNCLASSIFIED_PILEUP_THRESHOLD, needsReviewAmount: 500 }),
    );
    const result = await checkUnclassifiedPileup();
    expect(result).not.toBeNull();
    expect(result!.alertType).toBe("unclassified_pileup");
    expect(result!.metric).toBe(UNCLASSIFIED_PILEUP_THRESHOLD);
  });

  it("returns critical for 30+ uncategorized", async () => {
    mockGenerateBankPL.mockResolvedValue(
      makeBankPL({ needsReviewCount: 35, needsReviewAmount: 2000 }),
    );
    const result = await checkUnclassifiedPileup();
    expect(result!.severity).toBe("critical");
  });
});

describe("checkTrustAnomaly", () => {
  it("returns null when trust deferral is disabled", async () => {
    mockIsTrustDeferralEnabled.mockReturnValue(false);
    expect(await checkTrustAnomaly()).toBeNull();
  });

  it("returns null below threshold", async () => {
    mockIsTrustDeferralEnabled.mockReturnValue(true);
    mockTotalDeferredForUser.mockResolvedValue(TRUST_ANOMALY_THRESHOLD_USD - 1);
    expect(await checkTrustAnomaly()).toBeNull();
  });

  it("returns alert at threshold", async () => {
    mockIsTrustDeferralEnabled.mockReturnValue(true);
    mockTotalDeferredForUser.mockResolvedValue(TRUST_ANOMALY_THRESHOLD_USD);
    const result = await checkTrustAnomaly();
    expect(result).not.toBeNull();
    expect(result!.alertType).toBe("trust_anomaly");
    expect(result!.severity).toBe("warning");
  });

  it("returns critical for very high deferred", async () => {
    mockIsTrustDeferralEnabled.mockReturnValue(true);
    mockTotalDeferredForUser.mockResolvedValue(35000);
    const result = await checkTrustAnomaly();
    expect(result!.severity).toBe("critical");
  });
});

describe("checkSupplierPaymentMismatch", () => {
  it("returns null when no supplier discrepancies", async () => {
    mockRunReconciliation.mockResolvedValue(
      makeReconciliation([
        { severity: "low", type: "timing_diff", description: "some diff" },
      ]),
    );
    expect(await checkSupplierPaymentMismatch()).toBeNull();
  });

  it("returns alert for supplier-type discrepancies", async () => {
    mockRunReconciliation.mockResolvedValue(
      makeReconciliation([
        {
          severity: "medium",
          type: "supplier_payment",
          description: "supplier invoice mismatch",
        },
      ]),
    );
    const result = await checkSupplierPaymentMismatch();
    expect(result).not.toBeNull();
    expect(result!.alertType).toBe("supplier_mismatch");
  });
});
