/**
 * server/db/customOrder.ts — 訂製單資料層 smoke test。
 *
 * Mocks `../db` so getDb() → null;驗證 surface + lazy-DB null path + 兩個
 * 不需 DB 的純路徑(generateOrderNumber 格式、ensureCustomerProfileId 的
 * profileId 直通)。CRUD 的真 DB 行為留給整合測試(本機無 DATABASE_URL)。
 */

import { describe, it, expect, vi } from "vitest";
import { and, or, inArray } from "drizzle-orm";
import { customerInteractions } from "../../drizzle/schema";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

import { getDb } from "../db";
const getDbMock = vi.mocked(getDb);

import {
  generateOrderNumber,
  ensureCustomerProfileId,
  createCustomOrder,
  getCustomOrderById,
  listCustomOrdersByProfile,
  updateCustomOrder,
  listInvoicesForCustomOrder,
  resolveCustomerProfileIds,
  assignInteractionsToOrder,
  orderBelongsToProfiles,
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
      resolveCustomerProfileIds,
      assignInteractionsToOrder,
      orderBelongsToProfiles,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });
});

describe("orderBelongsToProfiles (audit fix, 0104) — the one shared cross-customer rule", () => {
  it("true when the order's profileId is in the customer's resolved profileIds", () => {
    expect(orderBelongsToProfiles(7, [3, 7, 9])).toBe(true);
  });
  it("false when it is not in the list", () => {
    expect(orderBelongsToProfiles(5, [3, 7, 9])).toBe(false);
  });
  it("false for a customer with only ONE registered profileId — the exact bug class this audit found: a customer who contacted as a guest before registering has TWO profileIds, and a single-profile lookup would wrongly reject their own pre-registration order", () => {
    // the registered profileId (9) does NOT cover the pre-registration guest
    // profileId (5) the order was actually filed under — caller must pass ALL
    // resolved profileIds (via resolveCustomerProfileIds), not just one.
    expect(orderBelongsToProfiles(5, [9])).toBe(false);
    expect(orderBelongsToProfiles(5, [5, 9])).toBe(true);
  });
  it("false when the order has no owning profile (null)", () => {
    expect(orderBelongsToProfiles(null, [3, 7])).toBe(false);
  });
  it("false for an empty profileIds list (unresolvable customer, never silently allow)", () => {
    expect(orderBelongsToProfiles(7, [])).toBe(false);
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
  it("resolveCustomerProfileIds returns [] (customer-projects 0104)", async () => {
    expect(await resolveCustomerProfileIds({ userId: 9 })).toEqual([]);
    expect(await resolveCustomerProfileIds({ profileId: 42 })).toEqual([]);
  });
  it("assignInteractionsToOrder returns 0 (customer-projects 0104)", async () => {
    expect(
      await assignInteractionsToOrder({ profileIds: [1], orderId: 5, gmailThreadIds: ["t"] }),
    ).toBe(0);
  });
});

describe("assignInteractionsToOrder — guards never run an unscoped UPDATE", () => {
  // A db whose .update() throws — so the assertions below prove the guard
  // returned 0 WITHOUT touching the table (not just because getDb was null).
  const explodingDb = () =>
    ({
      update() {
        throw new Error("UPDATE must not run when the assignment is unscoped");
      },
    }) as any;

  it("no-op (0) when profileIds is empty (db present, update never called)", async () => {
    getDbMock.mockResolvedValueOnce(explodingDb());
    expect(
      await assignInteractionsToOrder({ profileIds: [], orderId: 5, gmailThreadIds: ["t"] }),
    ).toBe(0);
  });

  it("no-op (0) when neither gmailThreadIds nor interactionIds is given", async () => {
    getDbMock.mockResolvedValueOnce(explodingDb());
    expect(await assignInteractionsToOrder({ profileIds: [1], orderId: 5 })).toBe(0);
  });

  it("no-op (0) when gmailThreadIds and interactionIds are both empty arrays", async () => {
    getDbMock.mockResolvedValueOnce(explodingDb());
    expect(
      await assignInteractionsToOrder({
        profileIds: [1],
        orderId: 5,
        gmailThreadIds: [],
        interactionIds: [],
      }),
    ).toBe(0);
  });

  it("scoped UPDATE runs (returns affectedRows) when target + scope are present, customerProfileId scope is the OUTER AND (not nested inside an OR)", async () => {
    let captured: unknown;
    getDbMock.mockResolvedValueOnce({
      update() {
        return {
          set() {
            return {
              where(w: unknown) {
                captured = w;
                // mysql2 shape: [ResultSetHeader, undefined]
                return Promise.resolve([{ affectedRows: 2 }]);
              },
            };
          },
        };
      },
    } as any);
    const n = await assignInteractionsToOrder({
      profileIds: [1, 2],
      orderId: 142,
      gmailThreadIds: ["thread-abc"],
    });
    expect(n).toBe(2);
    // Structural equality, not just truthy (verification-pass catch, 2026-06-30:
    // `expect(captured).toBeTruthy()` alone would still pass even if a future
    // regression swapped the top-level and() for or() — exactly the
    // cross-customer leak class this rule exists to prevent). Built from the
    // SAME real drizzle-orm builders + schema columns as the production code.
    const expected = and(
      inArray(customerInteractions.customerProfileId, [1, 2]),
      inArray(customerInteractions.gmailThreadId, ["thread-abc"]),
    );
    expect(captured).toEqual(expected);
  });

  it("batch: multiple gmailThreadIds AND interactionIds combine into one UPDATE — customerProfileId scope wraps the WHOLE or(), never sits inside it", async () => {
    let captured: unknown;
    getDbMock.mockResolvedValueOnce({
      update() {
        return {
          set() {
            return {
              where(w: unknown) {
                captured = w;
                return Promise.resolve([{ affectedRows: 5 }]);
              },
            };
          },
        };
      },
    } as any);
    const n = await assignInteractionsToOrder({
      profileIds: [1],
      orderId: 142,
      gmailThreadIds: ["thread-a", "thread-b"],
      interactionIds: [101, 102],
    });
    expect(n).toBe(5);
    const expected = and(
      inArray(customerInteractions.customerProfileId, [1]),
      or(
        inArray(customerInteractions.gmailThreadId, ["thread-a", "thread-b"]),
        inArray(customerInteractions.id, [101, 102]),
      ),
    );
    expect(captured).toEqual(expected);
  });
});
