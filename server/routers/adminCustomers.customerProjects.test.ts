/**
 * customer-projects (0104) 三態合約回歸測試。
 *
 * design.md §5.1 / §4.2 / §8 — 補回歸測試,不改邏輯(獨立稽核已確認
 * customerConversationThread / customerChatList 本身是對的、fail-closed)。
 *
 * 蓋的是「查詢結構本身」而不是回傳值長相 —— 這次稽核的教訓是查詢結構從沒被斷言過,
 * 只信過文件的自我宣稱。技巧跟 server/db/customOrder.test.ts 的
 * `assignInteractionsToOrder` 測試一樣:用一個會「捕捉傳進 where() 的條件」的假
 * drizzleDb,不整個 mock getDb 回傳假資料表。real drizzle-orm (eq/and/isNull/
 * inArray/or) 照跑 —— 它們回傳的 SQL 物件本身可以序列化檢查,不用另外 mock
 * drizzle-orm 把它換成 token(see probe in this session: queryChunks 裡就帶
 * column 物件跟字面值)。
 *
 * 兩個 procedure 都呼叫 `await db.getDb()`,其餘 helper(mergeThread /
 * inquiryFirstTurn / interactionTurn ...)是純函式,讓它們真的跑。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────
// Capture-where fake drizzleDb. Keyed by the REAL schema table object
// (reference equality — adminCustomers.ts does
// `await import("../../drizzle/schema")`, same module instance as this
// test's import, so the live mysqlTable objects line up as map keys).
// ─────────────────────────────────────────────────────────────────────

type Capture = { table: unknown; where: unknown }[];

function dump(x: unknown): string {
  // Flatten a drizzle SQL node (queryChunks tree) into a grep-able string —
  // column refs render as `COL(<name>)`, literal values render as themselves.
  // Drizzle's internal chunk classes are reliably distinguishable by
  // constructor name (verified by probing real eq()/and()/isNull()/inArray()
  // output in this session): MySql<Type>Column → a real table column (has
  // `.name`); Param → a bound literal (has `.value`); StringChunk → raw SQL
  // text fragment (has `.value`, often the operator like " = " / " is null").
  const seen = new Set<unknown>();
  function walk(v: any): string {
    if (v == null) return "";
    if (typeof v !== "object") return String(v);
    if (seen.has(v)) return "";
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk).join(" ");
    const ctor = v.constructor?.name ?? "";
    if (ctor.startsWith("MySql") && typeof v.name === "string") {
      return `COL(${v.name})`;
    }
    if (ctor === "Param") return walk(v.value);
    if (ctor === "StringChunk") return walk(v.value);
    if ("queryChunks" in v) return walk(v.queryChunks);
    if ("value" in v) return walk(v.value);
    return Object.values(v).map(walk).join(" ");
  }
  return walk(x);
}

/**
 * Builds a fake drizzleDb whose `.select().from(table).where(cond)` records
 * `{ table, where: cond }` into `capture`, then resolves rowsByTable.get(table)
 * (default []) regardless of whether `.orderBy()/.limit()` are chained after.
 */
function buildCaptureDb(capture: Capture, rowsByTable = new Map<unknown, unknown[]>()) {
  function chain(table: unknown) {
    const node: any = {
      where(cond: unknown) {
        capture.push({ table, where: cond });
        return node;
      },
      orderBy() {
        return node;
      },
      limit() {
        return Promise.resolve(rowsByTable.get(table) ?? []);
      },
      // some call sites don't chain .limit() after .where() (none here, but
      // keep it await-safe just in case a path resolves the chain directly).
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(rowsByTable.get(table) ?? []).then(resolve);
      },
    };
    return node;
  }
  return {
    select() {
      return {
        from(table: unknown) {
          return chain(table);
        },
      };
    },
  };
}

vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../db";
import { adminCustomersRouter } from "./adminCustomers";
import {
  users,
  customerProfiles,
  inquiries,
  inquiryMessages,
  customerInteractions,
  customerChatMessages,
} from "../../drizzle/schema";

const getDbMock = vi.mocked(getDb);

function adminCtx() {
  return {
    req: { headers: {}, socket: {} } as any,
    res: { cookie: () => {}, clearCookie: () => {} } as any,
    user: { id: 1, email: "jeff@packgo.com", role: "admin" },
    ip: "127.0.0.1",
  };
}
const caller = () => (adminCustomersRouter as any).createCaller(adminCtx());

beforeEach(() => {
  vi.clearAllMocks();
});

// A guest (profileId-keyed) caller skips the registered-user identity
// resolution branch (users + customerProfiles-by-userId-or-email lookups),
// so it's the simplest path to exercise the inquiries / customerInteractions
// where-clauses without needing to fake the users table too.
function setupGuestDb(opts: { profileId: number; profileEmail?: string | null }) {
  const capture: Capture = [];
  const rowsByTable = new Map<unknown, unknown[]>();
  rowsByTable.set(customerProfiles, [{ id: opts.profileId, email: opts.profileEmail ?? null }]);
  const fakeDb = buildCaptureDb(capture, rowsByTable);
  getDbMock.mockResolvedValue(fakeDb as any);
  return { capture, rowsByTable };
}

describe("customerConversationThread — 三態合約 (design.md §5.1)", () => {
  it("orderId 給定 → customerInteractions where 含 eq(customOrderId, orderId),inquiries 完全不查 (inquiryWhere 排除)", async () => {
    const { capture } = setupGuestDb({ profileId: 5 });

    await caller().customerConversationThread({ profileId: 5, orderId: 42 });

    // inquiries table must NEVER appear in the capture — projectScoped skips
    // the inquiries/inquiryMessages source entirely (inquiryWhere = null,
    // so the `if (inquiryWhere)` guard never even issues the query).
    const inquiriesCalls = capture.filter((c) => c.table === inquiries);
    expect(inquiriesCalls).toEqual([]);
    const inquiryMessagesCalls = capture.filter((c) => c.table === inquiryMessages);
    expect(inquiryMessagesCalls).toEqual([]);

    // customerInteractions where must include eq(customOrderId, 42) AND the
    // caller's own profileId scope (inArray(customerProfileId, [5])).
    const ciCall = capture.find((c) => c.table === customerInteractions);
    expect(ciCall).toBeTruthy();
    const whereStr = dump(ciCall!.where);
    expect(whereStr).toContain("COL(customOrderId)");
    expect(whereStr).toContain("42");
    expect(whereStr).toContain("COL(customerProfileId)");
    expect(whereStr).toContain("5");
    // must NOT be the unfiled (IS NULL) branch
    expect(whereStr).not.toContain("is null");
  });

  it("unfiledOnly: true → customerInteractions where 是 isNull(customOrderId),且 inquiries 仍照常查(未分類視圖含 inquiries)", async () => {
    const { capture } = setupGuestDb({ profileId: 5, profileEmail: "guest@x.co" });

    await caller().customerConversationThread({ profileId: 5, unfiledOnly: true });

    const ciCall = capture.find((c) => c.table === customerInteractions);
    expect(ciCall).toBeTruthy();
    const whereStr = dump(ciCall!.where);
    expect(whereStr).toContain("COL(customOrderId)");
    expect(whereStr).toContain("is null");
    // the caller's own profile scope must still be present
    expect(whereStr).toContain("COL(customerProfileId)");
    expect(whereStr).toContain("5");

    // inquiries source IS included in the unfiled view (guestEmail set →
    // inquiryWhere built → the inquiries table gets queried).
    const inquiriesCalls = capture.filter((c) => c.table === inquiries);
    expect(inquiriesCalls.length).toBeGreaterThan(0);
  });

  it("orderId 跟 unfiledOnly 都沒給 → customerInteractions where 完全沒有 customOrderId 限制(客人層全部),且含 inquiries", async () => {
    const { capture } = setupGuestDb({ profileId: 5, profileEmail: "guest@x.co" });

    await caller().customerConversationThread({ profileId: 5 });

    const ciCall = capture.find((c) => c.table === customerInteractions);
    expect(ciCall).toBeTruthy();
    const whereStr = dump(ciCall!.where);
    // The trap this test guards against: a future refactor "simplifying" the
    // three-state branch into `orderId ? eq(...) : isNull(...)` would make
    // this contain "is null" — that must NOT happen on the no-filter path.
    expect(whereStr).not.toContain("COL(customOrderId)");
    expect(whereStr).not.toContain("is null");
    // caller's own profile scope still present (no cross-customer leakage)
    expect(whereStr).toContain("COL(customerProfileId)");
    expect(whereStr).toContain("5");

    const inquiriesCalls = capture.filter((c) => c.table === inquiries);
    expect(inquiriesCalls.length).toBeGreaterThan(0);
  });

  it("registered (userId) caller — customerInteractions where 限定在解出的 profileIds 範圍(不會查到別人的)", async () => {
    const capture: Capture = [];
    const rowsByTable = new Map<unknown, unknown[]>();
    rowsByTable.set(users, [{ email: "real@customer.com" }]);
    rowsByTable.set(customerProfiles, [{ id: 11 }, { id: 12 }]);
    const fakeDb = buildCaptureDb(capture, rowsByTable);
    getDbMock.mockResolvedValue(fakeDb as any);

    await caller().customerConversationThread({ userId: 100, orderId: 7 });

    const ciCall = capture.find((c) => c.table === customerInteractions);
    expect(ciCall).toBeTruthy();
    const whereStr = dump(ciCall!.where);
    // resolved profileIds (11, 12) scope present — never the raw input userId
    // and never an unscoped query.
    expect(whereStr).toContain("COL(customerProfileId)");
    expect(whereStr).toContain("11");
    expect(whereStr).toContain("12");
    expect(whereStr).toContain("COL(customOrderId)");
    expect(whereStr).toContain("7");
  });
});

describe("customerChatList — orderId 分支 (design.md §4.2)", () => {
  it("orderId 給定 → where 是 eq(customOrderId, orderId)", async () => {
    const capture: Capture = [];
    const fakeDb = buildCaptureDb(capture);
    getDbMock.mockResolvedValue(fakeDb as any);

    await caller().customerChatList({ profileId: 5, orderId: 9 });

    const call = capture.find((c) => c.table === customerChatMessages);
    expect(call).toBeTruthy();
    const whereStr = dump(call!.where);
    expect(whereStr).toContain("COL(customOrderId)");
    expect(whereStr).toContain("9");
    expect(whereStr).not.toContain("is null");
    // caller's own scope present
    expect(whereStr).toContain("COL(customerProfileId)");
    expect(whereStr).toContain("5");
  });

  it("orderId 沒給 → where 是 isNull(customOrderId)(未分類籃子),不是「全部」", async () => {
    const capture: Capture = [];
    const fakeDb = buildCaptureDb(capture);
    getDbMock.mockResolvedValue(fakeDb as any);

    await caller().customerChatList({ profileId: 5 });

    const call = capture.find((c) => c.table === customerChatMessages);
    expect(call).toBeTruthy();
    const whereStr = dump(call!.where);
    expect(whereStr).toContain("COL(customOrderId)");
    expect(whereStr).toContain("is null");
    expect(whereStr).toContain("COL(customerProfileId)");
    expect(whereStr).toContain("5");
  });

  it("userId 呼叫者 → scope 用 customerUserId,不是 customerProfileId", async () => {
    const capture: Capture = [];
    const fakeDb = buildCaptureDb(capture);
    getDbMock.mockResolvedValue(fakeDb as any);

    await caller().customerChatList({ userId: 77, orderId: 3 });

    const call = capture.find((c) => c.table === customerChatMessages);
    expect(call).toBeTruthy();
    const whereStr = dump(call!.where);
    expect(whereStr).toContain("COL(customerUserId)");
    expect(whereStr).toContain("77");
    expect(whereStr).toContain("COL(customOrderId)");
    expect(whereStr).toContain("3");
  });
});
