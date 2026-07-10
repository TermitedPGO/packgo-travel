/**
 * deploySmoke tests (Wave1 Block A — ship 後自動煙霧).
 *
 * Covers:
 *   - timeArm 的成功/失敗分流(ms 計時、rowCount 帶出、error 格式化 `name: message`
 *     截到 200 字、絕不含 stack)。
 *   - never-throw-whole-suite:任一臂拋錯不影響其餘臂,arms 陣列永遠回滿七筆。
 *   - simulateFail 注入:額外 push 第八筆固定失敗臂,不影響真實七臂各自照跑。
 *   - watchdogForCustomer:user 找不到 / profileId 解析不到都必須讓這一臂 fail
 *     (不可回傳 0 假裝成功);profileId 一律動態解析,不直接 import 硬編常數。
 *
 * 全部底層 db / router imports 都 mock 掉 —— 這支測試不連真 DB,不打真查詢。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({} as unknown)),
  getUserByEmail: vi.fn(async () => ({ id: 42, email: "jeffhsieh0909@gmail.com" })),
  findCustomerProfileId: vi.fn(async () => 2760017),
  listCustomOrdersByProfile: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
  searchTours: vi.fn(async () => ({ tours: [{ id: 1 }], total: 5 })),
}));

vi.mock("../routers/adminCustomers", () => ({
  runCustomerListQuery: vi.fn(async () => [{ id: 1 }]),
  runGuestListQuery: vi.fn(async () => [{ profileId: 1 }, { profileId: 2 }]),
  runRegisteredUnreadCountQuery: vi.fn(async () => [{ status: "active" }]),
  runGuestUnreadRankingQuery: vi.fn(async () => [{ status: "active" }, { status: "active" }]),
}));

vi.mock("../routers/adminCustomerOrders", () => ({
  loadTodayListItems: vi.fn(async () => [{ kind: "followUpDue" }]),
}));

vi.mock("./approvalTasks", () => ({
  listApprovalTasks: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 3 }]),
}));

vi.mock("./escalationBox", () => ({
  listEscalations: vi.fn(async () => [{ id: 1 }]),
}));

import { runDeploySmoke } from "./deploySmoke";
import * as db from "../db";
import {
  runCustomerListQuery,
  runGuestListQuery,
  runRegisteredUnreadCountQuery,
  runGuestUnreadRankingQuery,
} from "../routers/adminCustomers";
import { loadTodayListItems } from "../routers/adminCustomerOrders";
import { listApprovalTasks } from "./approvalTasks";
import { listEscalations } from "./escalationBox";

const ARM_NAMES = [
  "customerList",
  "guestList",
  "customerUnreadCount",
  "todayList",
  "watchdogForCustomer",
  "commandCenter.approvalTasks",
  "commandCenter.escalations",
  "activeToursCount",
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.getDb).mockResolvedValue({} as unknown as any);
  vi.mocked(db.getUserByEmail).mockResolvedValue({
    id: 42,
    email: "jeffhsieh0909@gmail.com",
  } as any);
  vi.mocked(db.findCustomerProfileId).mockResolvedValue(2760017);
  vi.mocked(db.listCustomOrdersByProfile).mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
  vi.mocked(runCustomerListQuery).mockResolvedValue([{ id: 1 }] as any);
  vi.mocked(runGuestListQuery).mockResolvedValue([{ profileId: 1 }, { profileId: 2 }] as any);
  vi.mocked(runRegisteredUnreadCountQuery).mockResolvedValue([{ status: "active" }] as any);
  vi.mocked(runGuestUnreadRankingQuery).mockResolvedValue([
    { status: "active" },
    { status: "active" },
  ] as any);
  vi.mocked(loadTodayListItems).mockResolvedValue([{ kind: "followUpDue" }] as any);
  vi.mocked(listApprovalTasks).mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }] as any);
  vi.mocked(listEscalations).mockResolvedValue([{ id: 1 }] as any);
  // storefront healthy by default: 5 active tours (arm goes green)
  vi.mocked(db.searchTours).mockResolvedValue({ tours: [{ id: 1 }], total: 5 } as any);
});

describe("runDeploySmoke — happy path (all seven arms succeed)", () => {
  it("returns ok:true with all eight arms ok, correct rowCounts, ms timing present", async () => {
    const result = await runDeploySmoke();
    expect(result.ok).toBe(true);
    expect(result.arms).toHaveLength(8);
    expect(result.arms.map((a) => a.name)).toEqual(ARM_NAMES);
    for (const arm of result.arms) {
      expect(arm.ok).toBe(true);
      expect(typeof arm.ms).toBe("number");
      expect(arm.ms).toBeGreaterThanOrEqual(0);
      expect(arm.error).toBeUndefined();
    }
    const byName = Object.fromEntries(result.arms.map((a) => [a.name, a]));
    expect(byName.customerList.rowCount).toBe(1);
    expect(byName.guestList.rowCount).toBe(2);
    // customerUnreadCount = registered(1) + guest(2)
    expect(byName.customerUnreadCount.rowCount).toBe(3);
    expect(byName.todayList.rowCount).toBe(1);
    expect(byName.watchdogForCustomer.rowCount).toBe(2);
    expect(byName["commandCenter.approvalTasks"].rowCount).toBe(3);
    expect(byName["commandCenter.escalations"].rowCount).toBe(1);
    // activeToursCount reports the storefront's active-tour total (5 by default)
    expect(byName.activeToursCount.rowCount).toBe(5);
  });

  it("calls runCustomerListQuery / runGuestListQuery with the admin-UI default input ({})", async () => {
    await runDeploySmoke();
    expect(runCustomerListQuery).toHaveBeenCalledWith(expect.anything(), {});
    expect(runGuestListQuery).toHaveBeenCalledWith(expect.anything(), {});
  });

  it("calls the registered + guest unread arms via Promise.all (both invoked)", async () => {
    await runDeploySmoke();
    expect(runRegisteredUnreadCountQuery).toHaveBeenCalledTimes(1);
    expect(runGuestUnreadRankingQuery).toHaveBeenCalledTimes(1);
  });
});

describe("runDeploySmoke — never-throw-whole-suite: one arm fails, others unaffected", () => {
  it("customerList throws → that arm ok:false with formatted error; other six still ok:true", async () => {
    vi.mocked(runCustomerListQuery).mockRejectedValue(new TypeError("boom"));
    const result = await runDeploySmoke();
    expect(result.ok).toBe(false);
    expect(result.arms).toHaveLength(8);
    const byName = Object.fromEntries(result.arms.map((a) => [a.name, a]));
    expect(byName.customerList.ok).toBe(false);
    expect(byName.customerList.error).toBe("TypeError: boom");
    expect(byName.customerList.rowCount).toBeUndefined();
    // every other arm is untouched and still succeeds
    for (const name of ARM_NAMES.filter((n) => n !== "customerList")) {
      expect(byName[name].ok).toBe(true);
    }
  });

  it("guestList throws → isolated failure, does not affect customerUnreadCount/todayList/etc.", async () => {
    vi.mocked(runGuestListQuery).mockRejectedValue(new Error("TiDB 500"));
    const result = await runDeploySmoke();
    expect(result.ok).toBe(false);
    const byName = Object.fromEntries(result.arms.map((a) => [a.name, a]));
    expect(byName.guestList.ok).toBe(false);
    expect(byName.guestList.error).toBe("Error: TiDB 500");
    expect(byName.customerUnreadCount.ok).toBe(true);
    expect(byName.todayList.ok).toBe(true);
  });

  it("customerUnreadCount arm fails if EITHER the registered or guest sub-query throws", async () => {
    vi.mocked(runGuestUnreadRankingQuery).mockRejectedValue(new Error("GREATEST dialect error"));
    const result = await runDeploySmoke();
    const byName = Object.fromEntries(result.arms.map((a) => [a.name, a]));
    expect(byName.customerUnreadCount.ok).toBe(false);
    expect(byName.customerUnreadCount.error).toBe("Error: GREATEST dialect error");
  });

  it("commandCenter arms fail independently of each other", async () => {
    vi.mocked(listApprovalTasks).mockRejectedValue(new Error("approval down"));
    const result = await runDeploySmoke();
    const byName = Object.fromEntries(result.arms.map((a) => [a.name, a]));
    expect(byName["commandCenter.approvalTasks"].ok).toBe(false);
    expect(byName["commandCenter.escalations"].ok).toBe(true);
  });

  it("error message is truncated to 200 chars and never contains a stack trace", async () => {
    const longMessage = "x".repeat(500);
    vi.mocked(runCustomerListQuery).mockRejectedValue(new Error(longMessage));
    const result = await runDeploySmoke();
    const arm = result.arms.find((a) => a.name === "customerList")!;
    expect(arm.error).toBeDefined();
    expect(arm.error!.length).toBeLessThanOrEqual(200);
    expect(arm.error!.startsWith("Error: ")).toBe(true);
    expect(arm.error).not.toContain("\n    at "); // no stack frame lines
  });
});

describe("runDeploySmoke — watchdogForCustomer profileId resolution", () => {
  it("user not found → throws, arm recorded as failed (not a silent rowCount:0 success)", async () => {
    vi.mocked(db.getUserByEmail).mockResolvedValue(undefined as any);
    const result = await runDeploySmoke();
    const arm = result.arms.find((a) => a.name === "watchdogForCustomer")!;
    expect(arm.ok).toBe(false);
    expect(arm.rowCount).toBeUndefined();
    expect(db.findCustomerProfileId).not.toHaveBeenCalled();
  });

  it("profileId resolves to null → throws, arm recorded as failed", async () => {
    vi.mocked(db.findCustomerProfileId).mockResolvedValue(null);
    const result = await runDeploySmoke();
    const arm = result.arms.find((a) => a.name === "watchdogForCustomer")!;
    expect(arm.ok).toBe(false);
    expect(arm.rowCount).toBeUndefined();
    expect(db.listCustomOrdersByProfile).not.toHaveBeenCalled();
  });

  it("resolves profileId dynamically via getUserByEmail → findCustomerProfileId (never a hardcoded constant)", async () => {
    await runDeploySmoke();
    expect(db.getUserByEmail).toHaveBeenCalledWith("jeffhsieh0909@gmail.com");
    expect(db.findCustomerProfileId).toHaveBeenCalledWith({ userId: 42 });
    expect(db.listCustomOrdersByProfile).toHaveBeenCalledWith(2760017);
  });

  it("error field never contains the resolved userId/profileId or email", async () => {
    vi.mocked(db.getUserByEmail).mockResolvedValue(undefined as any);
    const result = await runDeploySmoke();
    const arm = result.arms.find((a) => a.name === "watchdogForCustomer")!;
    expect(arm.error).not.toContain("jeffhsieh0909");
    expect(arm.error).not.toContain("2760017");
    expect(arm.error).not.toContain("42");
  });
});

describe("runDeploySmoke — simulateFail injection", () => {
  it("opts.simulateFail:true appends a 'simulated' failed arm; real eight still run + succeed", async () => {
    const result = await runDeploySmoke({ simulateFail: true });
    expect(result.ok).toBe(false);
    expect(result.arms).toHaveLength(9);
    expect(result.arms.map((a) => a.name)).toEqual([...ARM_NAMES, "simulated"]);
    const simulated = result.arms.find((a) => a.name === "simulated")!;
    expect(simulated.ok).toBe(false);
    expect(simulated.ms).toBe(0);
    expect(simulated.error).toBeDefined();
    // the real eight arms are untouched by the simulated injection
    for (const name of ARM_NAMES) {
      const arm = result.arms.find((a) => a.name === name)!;
      expect(arm.ok).toBe(true);
    }
  });

  it("opts.simulateFail:false (default) never appends the simulated arm", async () => {
    const result = await runDeploySmoke({ simulateFail: false });
    expect(result.arms).toHaveLength(8);
    expect(result.arms.some((a) => a.name === "simulated")).toBe(false);
  });
});

describe("runDeploySmoke — activeToursCount (storefront zero alarm)", () => {
  it("count > 0 → arm green, rowCount is the storefront active-tour total", async () => {
    vi.mocked(db.searchTours).mockResolvedValue({ tours: [{ id: 1 }], total: 1205 } as any);
    const result = await runDeploySmoke();
    const arm = result.arms.find((a) => a.name === "activeToursCount")!;
    expect(arm.ok).toBe(true);
    expect(arm.rowCount).toBe(1205);
    expect(arm.error).toBeUndefined();
    // calls the real public search query with the storefront default input ({})
    expect(db.searchTours).toHaveBeenCalledWith({});
  });

  it("count === 0 → arm red (ok:false) with a storefront-zero error naming the incident report", async () => {
    vi.mocked(db.searchTours).mockResolvedValue({ tours: [], total: 0 } as any);
    const result = await runDeploySmoke();
    expect(result.ok).toBe(false);
    const arm = result.arms.find((a) => a.name === "activeToursCount")!;
    expect(arm.ok).toBe(false);
    expect(arm.rowCount).toBeUndefined();
    expect(arm.error).toContain("賣場對客零商品");
    expect(arm.error).toContain("active tours = 0");
    expect(arm.error).toContain(
      "docs/features/public-site/incident-20260617-tours-wipe.md",
    );
  });

  it("query throws → fail-open: arm red, but the other seven arms are unaffected", async () => {
    vi.mocked(db.searchTours).mockRejectedValue(new Error("TiDB 500 on tours count"));
    const result = await runDeploySmoke();
    expect(result.ok).toBe(false);
    expect(result.arms).toHaveLength(8);
    const byName = Object.fromEntries(result.arms.map((a) => [a.name, a]));
    expect(byName.activeToursCount.ok).toBe(false);
    expect(byName.activeToursCount.error).toBe("Error: TiDB 500 on tours count");
    // the storefront query blowing up must not drag down any other arm
    for (const name of ARM_NAMES.filter((n) => n !== "activeToursCount")) {
      expect(byName[name].ok).toBe(true);
    }
  });

  it("the storefront-zero red is distinct from a query-error red (different error text)", async () => {
    vi.mocked(db.searchTours).mockResolvedValue({ tours: [], total: 0 } as any);
    const zeroResult = await runDeploySmoke();
    const zeroArm = zeroResult.arms.find((a) => a.name === "activeToursCount")!;
    vi.mocked(db.searchTours).mockRejectedValue(new Error("connection reset"));
    const errResult = await runDeploySmoke();
    const errArm = errResult.arms.find((a) => a.name === "activeToursCount")!;
    expect(zeroArm.ok).toBe(false);
    expect(errArm.ok).toBe(false);
    expect(zeroArm.error).not.toBe(errArm.error);
    expect(errArm.error).toBe("Error: connection reset");
  });
});

describe("runDeploySmoke — DB unavailable (getDb() → null)", () => {
  it("each DB-dependent arm fails independently; arms array still has all seven", async () => {
    vi.mocked(db.getDb).mockResolvedValue(null as any);
    const result = await runDeploySmoke();
    expect(result.ok).toBe(false);
    expect(result.arms).toHaveLength(8);
    const byName = Object.fromEntries(result.arms.map((a) => [a.name, a]));
    expect(byName.customerList.ok).toBe(false);
    expect(byName.guestList.ok).toBe(false);
    expect(byName.customerUnreadCount.ok).toBe(false);
    // todayList / commandCenter / activeToursCount arms don't depend on this
    // module's getDb() call directly (loadTodayListItems/listApprovalTasks/
    // listEscalations/searchTours resolve their own db internally) — mocked
    // here to always succeed, so they stay ok.
    expect(byName.todayList.ok).toBe(true);
    expect(byName.activeToursCount.ok).toBe(true);
  });
});
