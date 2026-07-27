/**
 * 全行程下架總閘的行為鎖(2026-07-26,Jeff 裁定)。
 *
 * Jeff 原話:「所有行程也都先下架,因為目前我們得討論如何架構對的方向
 * 取得供應商的 API 照片 行程 等所有訊息」。
 *
 * 語義:TOURS_PUBLIC_ENABLED 未設(預設)= 對客行程面全下架。
 * 所有 public 讀取端點回空形狀,而且**不打資料庫**(行為鎖,不是字串鎖:
 * 把 guard 拆掉、留著旗標 import,本檔必紅)。設為 true 才放行讀取。
 *
 * 不受影響:簽證、客製、包團、聯絡、會員(那些是照常營業的業務)。
 * 重新上架的前置:供應商資料架構定案(API、照片授權、行程契約),
 * 由 Jeff 明示裁定後翻旗標,不得因「資料看起來齊了」自行開。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getDbSpy = vi.fn(async () => null);
const spies = {
  getAllTours: vi.fn(async () => [{ id: 1, status: "active", title: "假團" }]),
  getTourById: vi.fn(async () => ({ id: 1, status: "active", title: "假團" })),
  searchTours: vi.fn(async () => ({ tours: [{ id: 1 }], total: 1 })),
  getFilterOptions: vi.fn(async () => ({ destinations: [{ country: "JP", count: 1 }], tags: [], smartTags: { duration: [], price: [], transport: [], feature: [] } })),
  getDepartureCities: vi.fn(async () => ["SFO"]),
};
vi.mock("../db", () => ({
  ...spies,
  getDb: getDbSpy,
}));
vi.mock("../translation", () => ({
  getTourTranslations: vi.fn(async () => ({})),
  getBatchTourTranslations: vi.fn(async () => ({})),
}));

async function caller() {
  const { toursReadRouter } = await import("./toursRead");
  return (toursReadRouter as any).createCaller({ user: null, ip: "203.0.113.9" });
}
const resetSpies = () => { Object.values(spies).forEach((s) => s.mockClear()); getDbSpy.mockClear(); };
const ORIG_ENV = process.env.TOURS_PUBLIC_ENABLED;

describe("行程下架總閘(預設關 = 全下架)", () => {
  beforeEach(() => { delete process.env.TOURS_PUBLIC_ENABLED; resetSpies(); });
  afterEach(() => {
    if (ORIG_ENV === undefined) delete process.env.TOURS_PUBLIC_ENABLED;
    else process.env.TOURS_PUBLIC_ENABLED = ORIG_ENV;
  });

  it("list / getSimilar / getRecommended / suggest / getDepartureCities 回空且零 DB 呼叫", async () => {
    const c = await caller();
    expect(await c.list({})).toEqual([]);
    expect(await c.getSimilar({ tourId: 1 })).toEqual([]);
    expect(await c.getRecommended({})).toEqual([]);
    expect(await c.suggest({ query: "日本" })).toEqual({ suggestions: [] });
    expect(await c.getDepartureCities()).toEqual([]);
    for (const [name, s] of Object.entries(spies)) {
      expect(s, name).not.toHaveBeenCalled();
    }
    expect(getDbSpy, "getDb").not.toHaveBeenCalled();
  });

  it("search / searchCards 回零筆帶正確分頁形狀,零 DB 呼叫", async () => {
    const c = await caller();
    const r1 = await c.search({});
    expect(r1.tours).toEqual([]);
    expect(r1.pagination.total).toBe(0);
    expect(r1.pagination.hasMore).toBe(false);
    const r2 = await c.searchCards({});
    expect(r2.tours).toEqual([]);
    expect(r2.pagination.total).toBe(0);
    expect(spies.searchTours).not.toHaveBeenCalled();
  });

  it("getFilterOptions 回空選項全形狀(含 fallback 區間)", async () => {
    const c = await caller();
    const r = await c.getFilterOptions();
    expect(r).toEqual({
      destinations: [], tags: [],
      smartTags: { duration: [], price: [], transport: [], feature: [] },
      durationRange: { min: 1, max: 30 },
      priceRange: { min: 0, max: 500000 },
    });
    expect(spies.getFilterOptions).not.toHaveBeenCalled();
  });

  it("getSupplierDetail 回 null 且不打 getDb(12/12 補齊)", async () => {
    const c = await caller();
    expect(await c.getSupplierDetail({ tourId: 1 })).toBeNull();
    expect(getDbSpy).not.toHaveBeenCalled();
    expect(spies.getTourById).not.toHaveBeenCalled();
  });

  it("getById 回 NOT_FOUND,generatePdf 回 PRECONDITION_FAILED", async () => {
    const c = await caller();
    await expect(c.getById({ id: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(c.generatePdf({ id: 1 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(spies.getTourById).not.toHaveBeenCalled();
  });

  it("admin 不受下架影響:後台仍看得到行程(Jeff 要整備資料)", async () => {
    const { toursReadRouter } = await import("./toursRead");
    const c = (toursReadRouter as any).createCaller({ user: { id: 1, role: "admin" }, ip: "127.0.0.1" });
    const r = await c.list({});
    expect(r.length).toBeGreaterThan(0);
    expect(spies.getAllTours).toHaveBeenCalled();
  });

  it("旗標開啟時放行讀取(DB 真的被打)", async () => {
    process.env.TOURS_PUBLIC_ENABLED = "true";
    const c = await caller();
    const r = await c.list({});
    expect(r.length).toBeGreaterThan(0);
    expect(spies.getAllTours).toHaveBeenCalled();
  });
});
