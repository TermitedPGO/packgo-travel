/**
 * F2 塊A — 接線測試(runSandboxCleanupConfirm)。
 *
 * cleanup-sandbox-residue confirm 是 LOCAL_SCRIPT_TOKEN 端點的破壞性寫入
 * (刪假帳戶 + 交易),無 ctx.user。釘死 confirm 真的刪了東西後發一筆
 * systemAudit(actor=system:sandboxCleanup、action=sandbox.cleanup_confirm、
 * 刪除筆數 = 量值)。fire-and-forget → 依 T2 地雷 #6 用 vi.waitFor。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const systemAudit = vi.fn().mockResolvedValue(undefined);
vi.mock("../_core/auditLog", () => ({ systemAudit: (...a: unknown[]) => systemAudit(...a) }));

const getDb = vi.fn();
vi.mock("../db", () => ({ getDb: (...a: unknown[]) => getDb(...a) }));

import { runSandboxCleanupConfirm } from "./sandboxResidueCleanup";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runSandboxCleanupConfirm → systemAudit(sandbox.cleanup_confirm)", () => {
  it("刪 2 帳戶 / 3 交易後發稽核,量值(deletedAccounts/deletedTransactions)釘死", async () => {
    const accounts = [
      { id: 101, institutionName: "First Platypus Bank", accountName: "Checking", isActive: 0 },
      { id: 102, institutionName: "First Platypus Bank", accountName: "Savings", isActive: 0 },
    ];
    const txns = [{ id: 1 }, { id: 2 }, { id: 3 }];
    // scan(): 第一次 select → accounts,第二次 select → txns
    const selectResults: unknown[] = [accounts, txns];
    let selIdx = 0;
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve(selectResults[selIdx++]) }) }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ delete: () => ({ where: () => Promise.resolve(undefined) }) }),
    };
    getDb.mockResolvedValue(db);

    const report = await runSandboxCleanupConfirm();
    expect(report.deletedAccounts).toBe(2);
    expect(report.deletedTransactions).toBe(3);

    await vi.waitFor(() => {
      expect(systemAudit).toHaveBeenCalledWith(
        "system:sandboxCleanup",
        "sandbox.cleanup_confirm",
        "First Platypus Bank",
        expect.objectContaining({ deletedAccounts: 2, deletedTransactions: 3, accountIds: [101, 102] }),
      );
    });
  });
});
