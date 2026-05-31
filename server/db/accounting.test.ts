/**
 * v2 Wave 2 · Module 2.7 — server/db/accounting.ts smoke test.
 *
 * Sanity-check the extraction:
 *
 *   Case 1 (named exports)
 *     - The 33 accounting-domain functions exist and are typeof "function".
 *       Surface: 5 accountingEntries + 8 invoices + 5 recurringExpenses +
 *       4 aiQuotes + 5 marketingCampaigns + 3 marketingMaterials +
 *       3 emailSendLogs = 33.
 *
 *   Case 2 (lazy-DB null path — read returns [] / null / zero envelopes)
 *     - getAccountingEntries() returns { entries: [], total: 0 } when DB null
 *     - getInvoices() returns [] when DB null
 *     - getInvoiceById(1) returns null when DB null
 *     - getInvoiceByBookingId(1) returns null when DB null
 *     - getAccountingStats() returns the zero-state envelope when DB null
 *     - listAiQuotes() returns [] when DB null
 *     - getMarketingCampaigns() returns [] when DB null
 *     - getMarketingMaterials() returns [] when DB null
 *     - getEmailSendLogs(1) returns [] when DB null
 *     - getRecurringExpenses() returns [] when DB null
 *
 *   Case 3 (lazy-DB null path — write returns false/null OR throws)
 *     - createAccountingEntry returns null when DB null (soft fail)
 *     - createInvoice returns null when DB null (soft fail)
 *     - createMarketingCampaign throws "Database not available" (hard fail —
 *       admin marketing actions should never silently no-op)
 *     - saveMarketingMaterial throws "Database not available"
 *     - createEmailSendLog throws "Database not available"
 *
 * Mocks `../db` to stub getDb() → null so we never need a real connection.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

import {
  // Accounting entries (5)
  createAccountingEntry,
  getAccountingEntries,
  updateAccountingEntry,
  deleteAccountingEntry,
  getAccountingStats,
  assembleAccountingStats,
  // Invoices (8)
  createInvoice,
  getInvoices,
  getInvoiceById,
  getInvoiceByBookingId,
  updateInvoice,
  getNextInvoiceSequence,
  updateInvoiceStatus,
  deleteInvoice,
  // Recurring expenses (5)
  getRecurringExpenses,
  createRecurringExpense,
  updateRecurringExpense,
  deleteRecurringExpense,
  getRecurringExpenseById,
  // AI quotes (4)
  createAiQuote,
  listAiQuotes,
  updateAiQuote,
  getAiQuoteById,
  // Marketing campaigns (5)
  createMarketingCampaign,
  getMarketingCampaigns,
  getMarketingCampaignById,
  updateMarketingCampaign,
  deleteMarketingCampaign,
  // Marketing materials (3)
  saveMarketingMaterial,
  getMarketingMaterials,
  deleteMarketingMaterial,
  // Email send logs (3)
  createEmailSendLog,
  updateEmailSendLog,
  getEmailSendLogs,
} from "./accounting";

describe("db/accounting — module surface", () => {
  it("exports the 33 accounting-domain functions", () => {
    // Accounting entries (5)
    expect(typeof createAccountingEntry).toBe("function");
    expect(typeof getAccountingEntries).toBe("function");
    expect(typeof updateAccountingEntry).toBe("function");
    expect(typeof deleteAccountingEntry).toBe("function");
    expect(typeof getAccountingStats).toBe("function");
    // Invoices (8)
    expect(typeof createInvoice).toBe("function");
    expect(typeof getInvoices).toBe("function");
    expect(typeof getInvoiceById).toBe("function");
    expect(typeof getInvoiceByBookingId).toBe("function");
    expect(typeof updateInvoice).toBe("function");
    expect(typeof getNextInvoiceSequence).toBe("function");
    expect(typeof updateInvoiceStatus).toBe("function");
    expect(typeof deleteInvoice).toBe("function");
    // Recurring expenses (5)
    expect(typeof getRecurringExpenses).toBe("function");
    expect(typeof createRecurringExpense).toBe("function");
    expect(typeof updateRecurringExpense).toBe("function");
    expect(typeof deleteRecurringExpense).toBe("function");
    expect(typeof getRecurringExpenseById).toBe("function");
    // AI quotes (4)
    expect(typeof createAiQuote).toBe("function");
    expect(typeof listAiQuotes).toBe("function");
    expect(typeof updateAiQuote).toBe("function");
    expect(typeof getAiQuoteById).toBe("function");
    // Marketing campaigns (5)
    expect(typeof createMarketingCampaign).toBe("function");
    expect(typeof getMarketingCampaigns).toBe("function");
    expect(typeof getMarketingCampaignById).toBe("function");
    expect(typeof updateMarketingCampaign).toBe("function");
    expect(typeof deleteMarketingCampaign).toBe("function");
    // Marketing materials (3)
    expect(typeof saveMarketingMaterial).toBe("function");
    expect(typeof getMarketingMaterials).toBe("function");
    expect(typeof deleteMarketingMaterial).toBe("function");
    // Email send logs (3)
    expect(typeof createEmailSendLog).toBe("function");
    expect(typeof updateEmailSendLog).toBe("function");
    expect(typeof getEmailSendLogs).toBe("function");
  });
});

describe("db/accounting — lazy-DB null read behavior", () => {
  it("getAccountingEntries returns zero envelope when DB is null", async () => {
    expect(await getAccountingEntries({})).toEqual({ entries: [], total: 0 });
  });

  it("getInvoices returns [] when DB is null", async () => {
    expect(await getInvoices({})).toEqual([]);
  });

  it("getInvoiceById returns null when DB is null", async () => {
    expect(await getInvoiceById(1)).toBeNull();
  });

  it("getInvoiceByBookingId returns null when DB is null", async () => {
    expect(await getInvoiceByBookingId(1)).toBeNull();
  });

  it("getAccountingStats returns zero envelope when DB is null", async () => {
    const stats = await getAccountingStats({
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
    });
    expect(stats).toEqual({
      totalIncome: 0, totalExpenses: 0, trustDeferredIncome: 0, netProfit: 0,
      prevTotalIncome: 0, prevTotalExpenses: 0, prevTrustDeferredIncome: 0, prevNetProfit: 0,
      yearIncome: 0, yearExpenses: 0, yearTrustDeferredIncome: 0, yearNetProfit: 0,
    });
  });

  it("listAiQuotes returns [] when DB is null", async () => {
    expect(await listAiQuotes({})).toEqual([]);
  });

  it("getMarketingCampaigns returns [] when DB is null", async () => {
    expect(await getMarketingCampaigns()).toEqual([]);
  });

  it("getMarketingMaterials returns [] when DB is null", async () => {
    expect(await getMarketingMaterials()).toEqual([]);
  });

  it("getEmailSendLogs returns [] when DB is null", async () => {
    expect(await getEmailSendLogs(1)).toEqual([]);
  });

  it("getRecurringExpenses returns [] when DB is null", async () => {
    expect(await getRecurringExpenses()).toEqual([]);
  });

  it("getNextInvoiceSequence returns 1 when DB is null", async () => {
    expect(await getNextInvoiceSequence(2026)).toBe(1);
  });
});

describe("db/accounting — lazy-DB null write behavior", () => {
  it("createAccountingEntry returns null when DB is null (soft fail)", async () => {
    expect(await createAccountingEntry({} as any)).toBeNull();
  });

  it("createInvoice returns null when DB is null (soft fail)", async () => {
    expect(await createInvoice({} as any)).toBeNull();
  });

  it("createAiQuote returns null when DB is null (soft fail)", async () => {
    expect(await createAiQuote({} as any)).toBeNull();
  });

  it("createRecurringExpense returns null when DB is null (soft fail)", async () => {
    expect(await createRecurringExpense({} as any)).toBeNull();
  });

  it("createMarketingCampaign throws when DB is null (hard fail)", async () => {
    await expect(createMarketingCampaign({} as any)).rejects.toThrow(
      "Database not available",
    );
  });

  it("saveMarketingMaterial throws when DB is null (hard fail)", async () => {
    await expect(saveMarketingMaterial({} as any)).rejects.toThrow(
      "Database not available",
    );
  });

  it("createEmailSendLog throws when DB is null (hard fail)", async () => {
    await expect(createEmailSendLog({} as any)).rejects.toThrow(
      "Database not available",
    );
  });

  it("deleteMarketingCampaign throws when DB is null (hard fail)", async () => {
    await expect(deleteMarketingCampaign(1)).rejects.toThrow(
      "Database not available",
    );
  });
});

/**
 * PKG-C — trust-aware netProfit (CST §17550). The pure assembly helper is the
 * single place the ledger P&L's netProfit math lives. RED-LINE under test:
 * customer deposits sitting in trust are NOT income until departure, so they
 * are subtracted from netProfit while totalIncome stays GROSS (= Σ categories).
 */
describe("assembleAccountingStats — trust-aware netProfit", () => {
  it("subtracts trust-deferred from netProfit but keeps totalIncome gross", () => {
    const s = assembleAccountingStats({
      ti: 10000, te: 3000, pti: 0, pte: 0, yi: 0, ye: 0,
      trustDeferred: 4000,
    });
    expect(s.totalIncome).toBe(10000); // gross, untouched
    expect(s.trustDeferredIncome).toBe(4000);
    expect(s.netProfit).toBe(3000); // 10000 − 4000 deferred − 3000 expenses
  });

  it("defaults deferred to 0 (legacy / flag-off → netProfit = gross − expenses)", () => {
    const s = assembleAccountingStats({ ti: 10000, te: 3000, pti: 0, pte: 0, yi: 0, ye: 0 });
    expect(s.trustDeferredIncome).toBe(0);
    expect(s.netProfit).toBe(7000);
  });

  it("applies the per-period deferred independently to current / prev / year", () => {
    const s = assembleAccountingStats({
      ti: 5000, te: 1000, trustDeferred: 2000,
      pti: 4000, pte: 800, prevTrustDeferred: 1000,
      yi: 60000, ye: 12000, yearTrustDeferred: 9000,
    });
    expect(s.netProfit).toBe(2000); // 5000 − 2000 − 1000
    expect(s.prevNetProfit).toBe(2200); // 4000 − 1000 − 800
    expect(s.yearNetProfit).toBe(39000); // 60000 − 9000 − 12000
    expect(s.prevTrustDeferredIncome).toBe(1000);
    expect(s.yearTrustDeferredIncome).toBe(9000);
  });

  it("a deposit-only period (all income deferred) yields negative netProfit = −expenses", () => {
    const s = assembleAccountingStats({ ti: 8000, te: 500, pti: 0, pte: 0, yi: 0, ye: 0, trustDeferred: 8000 });
    expect(s.netProfit).toBe(-500); // every dollar of income is still in trust
  });
});
