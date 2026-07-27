/**
 * 全行程下架:跨 router 行為鎖(TG-R1,Codex 第 1 回合返工單)。
 *
 * 第 1 回合終驗證實只閘 toursRead 不構成「全行程下架」:departures、
 * routeMap、translation、affiliate、reviews、favorites、browsingHistory、
 * bookings.create 都能讀出或動到行程。本檔逐支驗證:旗標關且非 admin 時
 * 回空形狀且零 DB/零外部 side effect;admin 旁路一致;歷史履約資料不受
 * 影響(bookings 只擋 create,讀取不在本鎖範圍)。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const dbSpies = {
  getTourDepartures: vi.fn(async () => [{ id: 9, departureDate: "2099-01-01", status: "open" }]),
  getDepartureById: vi.fn(async () => ({ id: 9 })),
  getTourPriceComparison: vi.fn(async () => ({ tourId: 1, rows: [] })),
  getUserFavorites: vi.fn(async () => [{ id: 1, title: "假團" }]),
  getUserBrowsingHistory: vi.fn(async () => [{ id: 1, title: "假團" }]),
  createBooking: vi.fn(async () => ({ id: 1 })),
  createAiQuote: vi.fn(async () => ({ id: 1, quoteNumber: "Q-TEST-1" })),
  updateAiQuote: vi.fn(async () => undefined),
  getTourById: vi.fn(async () => ({ id: 1, status: "active" })),
};
const getDbSpy = vi.fn(async () => null);
vi.mock("../db", () => ({ ...dbSpies, getDb: getDbSpy }));

const matchToursSpy = vi.fn(async () => [{ id: 1, title: "假團" }]);
vi.mock("../services/aiQuoteService", () => ({
  extractQuoteParams: vi.fn(async () => ({ destination: "日本" })),
  matchToursForQuote: matchToursSpy,
  buildQuotePdf: vi.fn(async () => ({ html: "<html/>", r2Url: null })),
  generateQuoteNumber: vi.fn(async () => "Q-TEST-1"),
}));

const buildRouteMapSpy = vi.fn(async () => ({ staticMapUrl: "x", stops: [] }));
vi.mock("../services/routeMap/builder", () => ({ buildRouteMap: buildRouteMapSpy }));

const translateTextSpy = vi.fn(async () => "translated");
const translateBatchSpy = vi.fn(async () => ["translated"]);
const getTourTranslationsSpy = vi.fn(async () => ({ title: "x" }));
const getBatchTourTranslationsSpy = vi.fn(async () => ({ 1: { title: "x" } }));
const getAllTourTranslationsSpy = vi.fn(async () => ({ "zh-TW": { title: "x" } }));
vi.mock("../translation", () => ({
  translateText: translateTextSpy,
  translateBatch: translateBatchSpy,
  getTourTranslations: getTourTranslationsSpy,
  getBatchTourTranslations: getBatchTourTranslationsSpy,
  getAllTourTranslations: getAllTourTranslationsSpy,
}));

const ORIG = process.env.TOURS_PUBLIC_ENABLED;
const PUBLIC_CTX = { user: null, ip: "203.0.113.9" };
const MEMBER_CTX = { user: { id: 7, role: "user" }, ip: "203.0.113.9" };
const ADMIN_CTX = { user: { id: 1, role: "admin" }, ip: "127.0.0.1" };

const resetAll = () => {
  Object.values(dbSpies).forEach((s) => s.mockClear());
  getDbSpy.mockClear();
  buildRouteMapSpy.mockClear();
  matchToursSpy.mockClear();
  translateTextSpy.mockClear();
  translateBatchSpy.mockClear();
  getTourTranslationsSpy.mockClear();
  getBatchTourTranslationsSpy.mockClear();
  getAllTourTranslationsSpy.mockClear();
};

describe("跨 router 全行程下架(旗標關)", () => {
  beforeEach(() => { delete process.env.TOURS_PUBLIC_ENABLED; resetAll(); });
  afterAll(() => {
    if (ORIG === undefined) delete process.env.TOURS_PUBLIC_ENABLED;
    else process.env.TOURS_PUBLIC_ENABLED = ORIG;
  });

  it("departures 六支全回空,零 DB", async () => {
    const { departuresRouter } = await import("./departures");
    const c = (departuresRouter as any).createCaller(PUBLIC_CTX);
    expect(await c.getNext({ tourId: 1 })).toBeNull();
    expect(await c.getUpcoming({ tourId: 1 })).toEqual([]);
    expect(await c.getNextBatch({ tourIds: [1, 2] })).toEqual({});
    expect(await c.list({ tourId: 1 })).toEqual([]);
    expect(await c.listByTour({ tourId: 1 })).toEqual([]);
    expect(await c.getById({ id: 9 })).toBeNull();
    expect(dbSpies.getTourDepartures).not.toHaveBeenCalled();
    expect(dbSpies.getDepartureById).not.toHaveBeenCalled();
  });

  it("departures:admin 旁路照常讀取", async () => {
    const { departuresRouter } = await import("./departures");
    const c = (departuresRouter as any).createCaller(ADMIN_CTX);
    const r = await c.list({ tourId: 1 });
    expect(r.length).toBeGreaterThan(0);
    expect(dbSpies.getTourDepartures).toHaveBeenCalled();
  });

  it("tours.getRouteMap 回 null,不建圖不打 geocoder", async () => {
    const { toursRouteMapRouter } = await import("./toursRouteMap");
    const c = (toursRouteMapRouter as any).createCaller(PUBLIC_CTX);
    expect(await c.getRouteMap({ id: 1 })).toBeNull();
    expect(buildRouteMapSpy).not.toHaveBeenCalled();
  });

  it("tour translation 三支(single/batch/all)全回空,零 service 零 DB", async () => {
    const { translationRouter } = await import("./translation");
    const c = (translationRouter as any).createCaller(PUBLIC_CTX);
    expect(await c.getTourTranslations({ tourId: 1, targetLanguage: "en" })).toEqual({});
    expect(await c.getBatchTourTranslations({ tourIds: [1, 2], targetLanguage: "en" })).toEqual({});
    expect(await c.getAllTourTranslations({ tourId: 1 })).toEqual({});
    expect(getTourTranslationsSpy).not.toHaveBeenCalled();
    expect(getBatchTourTranslationsSpy).not.toHaveBeenCalled();
    expect(getAllTourTranslationsSpy).not.toHaveBeenCalled();
  });

  it("tour translation 三支:admin 旁路實際進入下層", async () => {
    const { translationRouter } = await import("./translation");
    const c = (translationRouter as any).createCaller(ADMIN_CTX);
    await c.getTourTranslations({ tourId: 1, targetLanguage: "en" });
    await c.getBatchTourTranslations({ tourIds: [1], targetLanguage: "en" });
    await c.getAllTourTranslations({ tourId: 1 });
    expect(getTourTranslationsSpy).toHaveBeenCalled();
    expect(getBatchTourTranslationsSpy).toHaveBeenCalled();
    expect(getAllTourTranslationsSpy).toHaveBeenCalled();
  });

  it("generic translate/translateBatch:原文原序返還、零 LLM(非 tour read,另計)", async () => {
    const { translationRouter } = await import("./translation");
    const c = (translationRouter as any).createCaller(PUBLIC_CTX);
    expect(await c.translate({ text: "原文", targetLanguage: "en" })).toEqual({ translated: "原文" });
    expect(await c.translateBatch({ texts: ["甲", "乙"], targetLanguage: "en" })).toEqual({ translated: ["甲", "乙"] });
    expect(translateTextSpy).not.toHaveBeenCalled();
    expect(translateBatchSpy).not.toHaveBeenCalled();
  });

  it("affiliate 比價回 null,零 DB", async () => {
    const { affiliateRouter } = await import("./affiliate");
    const c = (affiliateRouter as any).createCaller(PUBLIC_CTX);
    expect(await c.getPriceComparison({ tourId: 1 })).toBeNull();
    expect(dbSpies.getTourPriceComparison).not.toHaveBeenCalled();
  });

  it("reviews.listVerified 回空,零 DB", async () => {
    const { reviewsRouter } = await import("./reviews");
    const c = (reviewsRouter as any).createCaller(PUBLIC_CTX);
    expect(await c.listVerified({ limit: 6 })).toEqual([]);
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it("favorites.list 與 browsingHistory.list 對一般會員回空(收藏不刪)", async () => {
    const { favoritesRouter } = await import("./favorites");
    const { browsingHistoryRouter } = await import("./browsingHistory");
    const f = (favoritesRouter as any).createCaller(MEMBER_CTX);
    const b = (browsingHistoryRouter as any).createCaller(MEMBER_CTX);
    expect(await f.list()).toEqual([]);
    expect(await b.list({})).toEqual([]);
    expect(dbSpies.getUserFavorites).not.toHaveBeenCalled();
    expect(dbSpies.getUserBrowsingHistory).not.toHaveBeenCalled();
  });

  it("admin 旁路逐支:routeMap/affiliate/reviews/favorites/history 實際進入下層", async () => {
    const { toursRouteMapRouter } = await import("./toursRouteMap");
    const { affiliateRouter } = await import("./affiliate");
    const { reviewsRouter } = await import("./reviews");
    const { favoritesRouter } = await import("./favorites");
    const { browsingHistoryRouter } = await import("./browsingHistory");
    await (toursRouteMapRouter as any).createCaller(ADMIN_CTX).getRouteMap({ id: 1 });
    expect(buildRouteMapSpy).toHaveBeenCalled();
    await (affiliateRouter as any).createCaller(ADMIN_CTX).getPriceComparison({ tourId: 1 });
    expect(dbSpies.getTourPriceComparison).toHaveBeenCalled();
    await (reviewsRouter as any).createCaller(ADMIN_CTX).listVerified({ limit: 6 });
    expect(getDbSpy).toHaveBeenCalled();
    await (favoritesRouter as any).createCaller(ADMIN_CTX).list();
    expect(dbSpies.getUserFavorites).toHaveBeenCalled();
    await (browsingHistoryRouter as any).createCaller(ADMIN_CTX).list({});
    expect(dbSpies.getUserBrowsingHistory).toHaveBeenCalled();
  });

  it("bookings.create 對一般會員擋單(擋在任何 DB 與副作用前)", async () => {
    const { bookingsRouter } = await import("./bookings");
    const m = (bookingsRouter as any).createCaller(MEMBER_CTX);
    await expect(
      m.create({ tourId: 1, departureId: 1, contactName: "測試", contactPhone: "5551234" } as any),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dbSpies.createBooking).not.toHaveBeenCalled();
    expect(dbSpies.getTourById).not.toHaveBeenCalled();
  });

  it("bookings.create:admin 通過閘門,實際到達行程查詢(旁路是行為)", async () => {
    const { bookingsRouter } = await import("./bookings");
    const a = (bookingsRouter as any).createCaller(ADMIN_CTX);
    await a
      .create({ tourId: 1, departureId: 1, contactName: "測試", contactPhone: "5551234" } as any)
      .catch(() => undefined); // 後續流程在 mock 環境會失敗,不影響本鎖
    expect(dbSpies.getTourById).toHaveBeenCalled();
  });

  it("AI 報價(公開):不引用型錄,extraction/PDF/persist 照跑,matchedTourIds 為空", async () => {
    const svc = await import("../services/aiQuoteService");
    const { aiQuotesRouter } = await import("./aiQuotes");
    const c = (aiQuotesRouter as any).createCaller(PUBLIC_CTX);
    const r = await c.generate({ rawRequest: "一家四口想去日本七天,十一月出發,請報價" });
    expect(r).toBeTruthy();
    expect(matchToursSpy).not.toHaveBeenCalled();
    expect((svc.extractQuoteParams as any)).toHaveBeenCalled();
    expect((svc.buildQuotePdf as any)).toHaveBeenCalled();
    expect(dbSpies.createAiQuote).toHaveBeenCalled();
    const insertArg = (dbSpies.createAiQuote as any).mock.calls[0][0];
    expect(JSON.parse(insertArg.recommendedTours)).toEqual([]);
  });

  it("AI 報價(admin):trusted 後台可引用型錄(旁路一致)", async () => {
    const { aiQuotesRouter } = await import("./aiQuotes");
    const a = (aiQuotesRouter as any).createCaller(ADMIN_CTX);
    await a.generate({ rawRequest: "幫王先生一家報日本團,含機票,請引用現有行程" });
    expect(matchToursSpy).toHaveBeenCalled();
  });

  it("tours.search/searchCards 空分頁完整鎖(page/pageSize/total/totalPages/hasMore)", async () => {
    const { toursReadRouter } = await import("./toursRead");
    const c = (toursReadRouter as any).createCaller(PUBLIC_CTX);
    const r1 = await c.search({ page: 3, pageSize: 24 });
    expect(r1).toEqual({ tours: [], pagination: { page: 3, pageSize: 24, total: 0, totalPages: 0, hasMore: false } });
    const r2 = await c.searchCards({ page: 2, pageSize: 12 });
    expect(r2).toEqual({ tours: [], pagination: { page: 2, pageSize: 12, total: 0, totalPages: 0, hasMore: false } });
  });

  it("旗標開啟時 departures 放行(對照組)", async () => {
    process.env.TOURS_PUBLIC_ENABLED = "true";
    const { departuresRouter } = await import("./departures");
    const c = (departuresRouter as any).createCaller(PUBLIC_CTX);
    const r = await c.list({ tourId: 1 });
    expect(r.length).toBeGreaterThan(0);
    expect(dbSpies.getTourDepartures).toHaveBeenCalled();
  });
});
