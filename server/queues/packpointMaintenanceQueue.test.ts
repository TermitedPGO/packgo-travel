/**
 * Packpoint 免費升等:行為守門(2026-07-26 R3,返工單第 3 項)。
 *
 * R2 版只掃 token,終驗證實「刪掉 DB update 本體」仍綠。本版直接呼叫
 * runAutoUpgrade(test-only export),用 mock db 實測:
 *   一,有歷史 stripeSubscriptionId 與沒有的使用者,都實際被寫入相同
 *       的免費升等(tier + tierExpiresAt)——付費機制移除後該欄位不得
 *       影響行為(P1-2)。
 *   二,升等的 DB update 被刪時,本測試必紅(收到的 update 次數歸零)。
 * 原字串鎖(不得再讀 stripeSubscriptionId)保留在下方。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const state: {
  spendRows: Array<{ userId: number; totalSpend: number }>;
  users: Record<number, { id: number; tier: string; tierExpiresAt: Date | null }>;
  tierWrites: Array<{ userId: number; set: any }>;
} = { spendRows: [], users: {}, tierWrites: [] };

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    // runAutoUpgrade 的三種用法:spend 聚合(select().from().where().groupBy)、
    // 單一使用者(select().from().where().limit)、audit insert。
    select: (_cols?: unknown) => ({
      from: () => ({
        where: (..._a: unknown[]) => ({
          groupBy: async () => state.spendRows,
          limit: async () => {
            const uid = state._pendingUserId as number;
            return state.users[uid] ? [state.users[uid]] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (setArg: any) => ({
        where: async () => {
          state.tierWrites.push({ userId: state._pendingUserId as number, set: setArg });
        },
      }),
    }),
    insert: () => ({ values: async () => undefined }),
  })),
}));

// select(...).limit 拿不到 where 條件的 userId,用迴圈順序供給:
// runAutoUpgrade 逐列處理 spendRows,測試在 rows 供應側同步推進。
(state as any)._pendingUserId = 0;

import { __test__ } from "./packpointMaintenanceQueue";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "packpointMaintenanceQueue.ts"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("packpointMaintenanceQueue:免費升等行為(R3)", () => {
  beforeEach(() => {
    state.spendRows = []; state.users = {}; state.tierWrites = [];
  });

  it("無歷史訂閱欄位的使用者:消費達標實際寫入升等", async () => {
    state.spendRows = [{ userId: 1, totalSpend: 999999 }];
    state.users[1] = { id: 1, tier: "free", tierExpiresAt: null };
    (state as any)._pendingUserId = 1;
    const result: any = { upgraded: [], expired: [], birthdayAwarded: [] };
    await __test__.runAutoUpgrade(result);
    expect(state.tierWrites.length).toBe(1);
    expect(state.tierWrites[0].set).toHaveProperty("tier");
    expect(state.tierWrites[0].set).toHaveProperty("tierExpiresAt");
    expect(result.upgraded.length).toBe(1);
  });

  it("帶歷史 stripeSubscriptionId 的使用者:行為必須完全相同(P1-2)", async () => {
    state.spendRows = [{ userId: 2, totalSpend: 999999 }];
    state.users[2] = { id: 2, tier: "free", tierExpiresAt: null, stripeSubscriptionId: "sub_old" } as any;
    (state as any)._pendingUserId = 2;
    const result: any = { upgraded: [], expired: [], birthdayAwarded: [] };
    await __test__.runAutoUpgrade(result);
    expect(state.tierWrites.length).toBe(1);
    expect(result.upgraded.length).toBe(1);
  });

  it("字串鎖:原始碼不得再讀 stripeSubscriptionId", () => {
    expect(SRC).not.toMatch(/stripeSubscriptionId/);
  });
});
