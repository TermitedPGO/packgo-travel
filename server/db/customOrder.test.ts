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
  getCustomOrderProfileId,
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
      getCustomOrderProfileId,
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
  it("resolveCustomerProfileIds returns [] (customer-projects 0104)", async () => {
    expect(await resolveCustomerProfileIds({ userId: 9 })).toEqual([]);
    expect(await resolveCustomerProfileIds({ profileId: 42 })).toEqual([]);
  });
  it("assignInteractionsToOrder returns 0 (customer-projects 0104)", async () => {
    expect(
      await assignInteractionsToOrder({ profileIds: [1], orderId: 5, gmailThreadId: "t" }),
    ).toBe(0);
  });
  it("getCustomOrderProfileId returns null (customer-projects 0104)", async () => {
    expect(await getCustomOrderProfileId(1)).toBeNull();
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
      await assignInteractionsToOrder({ profileIds: [], orderId: 5, gmailThreadId: "t" }),
    ).toBe(0);
  });

  it("no-op (0) when neither gmailThreadId nor interactionId is given", async () => {
    getDbMock.mockResolvedValueOnce(explodingDb());
    expect(await assignInteractionsToOrder({ profileIds: [1], orderId: 5 })).toBe(0);
  });

  it("scoped UPDATE runs (returns affectedRows) when target + scope are present", async () => {
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
      gmailThreadId: "thread-abc",
    });
    expect(n).toBe(2);
    expect(captured).toBeTruthy(); // a WHERE (scope + target) was applied
  });
});

describe("listCustomOrdersByProfile — ordering contract (customer-projects 0104, design.md §2)", () => {
  // design.md §2: ProjectBar sorts "departureDate ?? createdAt, newest first" — a
  // later-departing order built earlier must still sort ahead of an
  // earlier-departing order built later. Regression risk: reverting to plain
  // `desc(createdAt)` compiles fine and returns *something*, so a coarse
  // "truthy" assertion wouldn't catch it — inspect the actual SQL chunks.
  it("orders by coalesce(departureDate, createdAt) desc, not createdAt alone", async () => {
    let capturedOrderBy: unknown;
    getDbMock.mockResolvedValueOnce({
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy(o: unknown) {
                    capturedOrderBy = o;
                    return Promise.resolve([]);
                  },
                };
              },
            };
          },
        };
      },
    } as any);

    await listCustomOrdersByProfile(1);

    const chunks = (capturedOrderBy as any)?.queryChunks ?? [];
    const literalText = chunks
      .filter((c: any) => Array.isArray(c?.value))
      .flatMap((c: any) => c.value)
      .join(" ")
      .toLowerCase();
    expect(literalText).toContain("coalesce");
    expect(literalText).toContain("desc");

    const referencedColumns = chunks.map((c: any) => c?.name).filter(Boolean);
    expect(referencedColumns).toContain("departureDate");
    expect(referencedColumns).toContain("createdAt");
  });
});
