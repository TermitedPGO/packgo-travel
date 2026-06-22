/**
 * server/db/customOrder.ts — 訂製單資料層 smoke test。
 *
 * Mocks `../db` so getDb() → null;驗證 surface + lazy-DB null path + 兩個
 * 不需 DB 的純路徑(generateOrderNumber 格式、ensureCustomerProfileId 的
 * profileId 直通)。CRUD 的真 DB 行為留給整合測試(本機無 DATABASE_URL)。
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

import {
  generateOrderNumber,
  ensureCustomerProfileId,
  createCustomOrder,
  getCustomOrderById,
  listCustomOrdersByProfile,
  updateCustomOrder,
  listInvoicesForCustomOrder,
} from "./customOrder";

describe("db/customOrder — surface", () => {
  it("exports the expected functions", () => {
    for (const fn of [
      generateOrderNumber,
      ensureCustomerProfileId,
      createCustomOrder,
      getCustomOrderById,
      listCustomOrdersByProfile,
      updateCustomOrder,
      listInvoicesForCustomOrder,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("generateOrderNumber", () => {
  it("returns ORD-YYYY-* with the current year (no-DB fallback)", async () => {
    const n = await generateOrderNumber();
    expect(n).toMatch(/^ORD-\d{4}-\d+$/);
    expect(n.startsWith(`ORD-${new Date().getFullYear()}-`)).toBe(true);
  });
});

describe("ensureCustomerProfileId", () => {
  it("returns the profileId directly when given (guest path, no DB needed)", async () => {
    expect(await ensureCustomerProfileId({ profileId: 42 })).toBe(42);
  });
  it("prefers profileId over userId when both present", async () => {
    expect(await ensureCustomerProfileId({ profileId: 7, userId: 9 })).toBe(7);
  });
  it("returns null for a userId when DB is unavailable", async () => {
    expect(await ensureCustomerProfileId({ userId: 9 })).toBeNull();
  });
  it("returns null when neither id is given", async () => {
    expect(await ensureCustomerProfileId({})).toBeNull();
  });
});

describe("db/customOrder — lazy-DB null path (soft fail)", () => {
  it("createCustomOrder returns null", async () => {
    expect(await createCustomOrder({} as any)).toBeNull();
  });
  it("getCustomOrderById returns null", async () => {
    expect(await getCustomOrderById(1)).toBeNull();
  });
  it("listCustomOrdersByProfile returns []", async () => {
    expect(await listCustomOrdersByProfile(1)).toEqual([]);
  });
  it("updateCustomOrder returns null", async () => {
    expect(await updateCustomOrder(1, {})).toBeNull();
  });
  it("listInvoicesForCustomOrder returns []", async () => {
    expect(await listInvoicesForCustomOrder(1)).toEqual([]);
  });
});
