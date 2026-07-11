/**
 * checkoutVerification red-green — 結帳前即時驗位驗價(錢的碼,從嚴)。
 *
 * 全 hermetic:UvLiveApi 與 loadStoredDetail 皆注入 stub,不碰網路/DB。
 * 錨定的行為(外部顧問第二輪審計 §三 模式一):
 *   - 非 UV 商品一律擋,且連 live API 都不打(硬邊界)
 *   - (a) 商品在售 (b) 班期有位 (c) 價格 $0 容差 + 必付清單一致 (d) 新鮮度記錄
 *   - UV API 逾時/炸 → fail-closed(絕不 fail-open)
 *   - 尾款:vendor_confirmed 才放行,否則擋
 *   - 不論過/不過,verification + snapshot 都齊(caller 落存證)
 */
import { describe, it, expect, vi } from "vitest";
import {
  verifyTourCheckout,
  resolveUvProductCode,
  localCalendarDate,
  mandatoryFeeListsEqual,
  extractMandatoryFeeLines,
  recomputeGrossTotal,
  seatsRequested,
  type UvLiveApi,
  type StoredSupplierDetail,
  type BookingForVerification,
  type TourForVerification,
  type DepartureForVerification,
} from "./checkoutVerification";

/* ─────────────────── fixtures ─────────────────── */

const UV_SOURCE = "https://uvbookings.toursbms.com/product/detail/P00002255";

function booking(overrides: Partial<BookingForVerification> = {}): BookingForVerification {
  return {
    id: 55,
    tourId: 10,
    departureId: 3,
    currency: "USD",
    numberOfAdults: 2,
    numberOfChildrenWithBed: 0,
    numberOfChildrenNoBed: 0,
    numberOfInfants: 0,
    numberOfSingleRooms: 0,
    totalPrice: 2470, // 2 × 1235
    depositAmount: 494,
    remainingAmount: 1976,
    supplierStatus: "not_placed",
    disclaimerVersion: "v3",
    disclaimerAcceptedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

function tour(overrides: Partial<TourForVerification> = {}): TourForVerification {
  return {
    id: 10,
    title: "美西大峽谷七日",
    status: "active",
    sourceUrl: UV_SOURCE,
    productCode: "P00002255",
    ...overrides,
  };
}

function departure(overrides: Partial<DepartureForVerification> = {}): DepartureForVerification {
  return {
    id: 3,
    departureDate: new Date(2026, 8, 15, 8, 0, 0), // 2026-09-15 local
    returnDate: new Date(2026, 8, 21, 20, 0, 0),
    adultPrice: 1235,
    childPriceWithBed: 1100,
    childPriceNoBed: 900,
    infantPrice: 0,
    singleRoomSupplement: 400,
    currency: "USD",
    ...overrides,
  };
}

/** live getProductGroup row(pt4 = 兩人一房 = 成人基準)。 */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    groupDate: "2026-09-15 00:00:00",
    groupStock: 20,
    groupSaleStock: 5,
    stockStatus: 200,
    groupPrice: [
      { priceType: 3, groupPrice: 1650 },
      { priceType: 4, groupPrice: 1235 },
    ],
    currencyNum: "USD",
    ...overrides,
  } as any;
}

/** live getProductTravelDetail:一條必付(與 stored 相同 → 通過)。 */
const LIVE_TRAVEL_WITH_FEE = {
  productNotice: { noticeInfo: [] },
  productCost: {
    list: [
      {
        expIExpandName: "YG Mandatory Fee",
        expIExpandDesc: "",
        priceInfo: [{ expPriceName: "Everyone", expPriceMoney: "$215.00" }],
      },
    ],
  },
} as any;
/** parseUvPriceTerms(LIVE_TRAVEL_WITH_FEE).excluded 的必付行(頁面同一把尺)。 */
const FEE_LINE = "必付:YG Mandatory Fee — Everyone $215.00";

const LIVE_TRAVEL_NO_FEE = {
  productNotice: { noticeInfo: [] },
  productCost: { list: [] },
} as any;

function stored(overrides: Partial<StoredSupplierDetail> = {}): StoredSupplierDetail {
  return {
    mandatoryFeeLines: [FEE_LINE],
    paymentTerms: "報名時付訂金、出發前依縱橫標準條款付尾款",
    cancellationPolicy: [],
    priceTermsFetchedAt: new Date("2026-07-09T00:00:00Z"),
    supplierLastSyncedAt: new Date("2026-07-10T00:00:00Z"),
    ...overrides,
  };
}

function api(overrides: Partial<UvLiveApi> = {}): UvLiveApi {
  return {
    getProductMain: vi.fn(async () => ({ productCode: "P00002255" })),
    getProductGroup: vi.fn(async () => [liveRow()]),
    getProductTravelDetail: vi.fn(async () => LIVE_TRAVEL_WITH_FEE),
    ...overrides,
  };
}

function run(opts: {
  b?: Partial<BookingForVerification>;
  t?: Partial<TourForVerification>;
  d?: Partial<DepartureForVerification>;
  api?: Partial<UvLiveApi>;
  stored?: Partial<StoredSupplierDetail>;
  paymentType?: "deposit" | "remaining";
  callBudgetMs?: number;
}) {
  const theApi = api(opts.api);
  return {
    api: theApi,
    result: verifyTourCheckout({
      booking: booking(opts.b),
      tour: tour(opts.t),
      departure: departure(opts.d),
      paymentType: opts.paymentType ?? "deposit",
      api: theApi,
      loadStoredDetail: async () => stored(opts.stored),
      callBudgetMs: opts.callBudgetMs ?? 2_000,
    }),
  };
}

/* ─────────────────── pure helpers ─────────────────── */

describe("checkoutVerification pure helpers", () => {
  it("resolveUvProductCode: UV sourceUrl → code;Lion/空 → null(非 UV 擋的依據)", () => {
    expect(resolveUvProductCode(UV_SOURCE)).toBe("P00002255");
    expect(resolveUvProductCode("https://travel.liontravel.com/detail?NormGroupID=abc")).toBeNull();
    expect(resolveUvProductCode(null)).toBeNull();
    expect(resolveUvProductCode(undefined)).toBeNull();
    // host 對但路徑異形 → 退回乾淨的 productCode 欄
    expect(
      resolveUvProductCode("https://uvbookings.toursbms.com/weird", "P00008687"),
    ).toBe("P00008687");
    // host 不對時 productCode 欄不可救(Lion 的 productCode 是別的 ID 體系)
    expect(resolveUvProductCode("https://travel.liontravel.com/x", "P00008687")).toBeNull();
  });

  it("localCalendarDate 用本地曆日(不經 toISOString,時區不飄日)", () => {
    expect(localCalendarDate(new Date(2026, 8, 15, 8, 0, 0))).toBe("2026-09-15");
    expect(localCalendarDate(new Date(2026, 0, 1, 8, 0, 0))).toBe("2026-01-01");
  });

  it("mandatoryFeeListsEqual: 多重集合語義(順序無關、重複計數)", () => {
    expect(mandatoryFeeListsEqual(["a", "b"], ["b", "a"])).toBe(true);
    expect(mandatoryFeeListsEqual(["a", "a"], ["a"])).toBe(false);
    expect(mandatoryFeeListsEqual([], [])).toBe(true);
    expect(mandatoryFeeListsEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("extractMandatoryFeeLines 只收 必付: 前綴行", () => {
    expect(extractMandatoryFeeLines(["必付:X — $1", "含機票", "必付:Y"])).toEqual([
      "必付:X — $1",
      "必付:Y",
    ]);
    expect(extractMandatoryFeeLines(null)).toEqual([]);
  });

  it("recomputeGrossTotal 與 bookings.create 同公式(含 child/infant/單房差 fallback)", () => {
    const g = recomputeGrossTotal(
      booking({ numberOfAdults: 2, numberOfChildrenNoBed: 1, numberOfSingleRooms: 1 }),
      departure({ adultPrice: 1000, childPriceNoBed: null, singleRoomSupplement: 300 }),
    );
    // 2×1000 + 1×floor(1000×0.7) + 300 = 3000
    expect(g).toBe(2000 + 700 + 300);
  });

  it("seatsRequested 嬰兒不佔位(與退款釋位同一口徑)", () => {
    expect(
      seatsRequested(booking({ numberOfAdults: 2, numberOfChildrenWithBed: 1, numberOfInfants: 3 })),
    ).toBe(3);
  });
});

/* ─────────────────── fail-closed 紅測 ─────────────────── */

describe("verifyTourCheckout — fail-closed blocks (紅)", () => {
  it("非 UV 商品一律擋,且 live API 一次都不打(硬邊界)", async () => {
    const { api: a, result } = run({
      t: { sourceUrl: "https://travel.liontravel.com/detail?NormGroupID=xyz", productCode: null },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unsupported_supplier");
    expect(a.getProductMain).not.toHaveBeenCalled();
    expect(a.getProductGroup).not.toHaveBeenCalled();
    expect(a.getProductTravelDetail).not.toHaveBeenCalled();
    // 不論過/不過,存證素材都要齊
    expect(r.verification.outcome).toBe("failed");
    expect(r.snapshot.pricing.amountToCharge).toBe(494);
  });

  it("本站商品非 active → tour_not_active,不打 live", async () => {
    const { api: a, result } = run({ t: { status: "inactive" } });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("tour_not_active");
    expect(a.getProductMain).not.toHaveBeenCalled();
  });

  it("幣別基準非 USD(booking TWD)→ currency_mismatch,不打 live", async () => {
    const { api: a, result } = run({ b: { currency: "TWD" } });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("currency_mismatch");
    expect(a.getProductMain).not.toHaveBeenCalled();
  });

  it("booking 幣別缺失(runtime 髒資料)→ currency_missing,不 throw、不打 live(絕不 throw 不變式)", async () => {
    const { api: a, result } = run({ b: { currency: null as any } });
    const r = await result; // 不 reject = 不變式成立
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("currency_missing");
    expect(r.verification.checks.currency).toEqual({
      booking: null,
      departure: "USD",
      live: null,
    });
    expect(a.getProductMain).not.toHaveBeenCalled();
    expect(a.getProductGroup).not.toHaveBeenCalled();
  });

  it("(a) 供應商端商品已下架(responseResult 軟失敗)→ product_not_on_sale", async () => {
    const { result } = run({
      api: {
        getProductMain: vi.fn(async () => {
          throw new Error("[uv] 17626/getProductMain: responseResult 404 not found (P404)");
        }),
      },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("product_not_on_sale");
  });

  it("(a) UV API 網路炸 → supplier_unreachable(fail-closed,絕不 fail-open)", async () => {
    const { result } = run({
      api: {
        getProductMain: vi.fn(async () => {
          throw new Error("[uv] 17626/getProductMain: network error");
        }),
      },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("supplier_unreachable");
  });

  it("(b) 該出發日在供應商端消失 → departure_not_found", async () => {
    const { result } = run({
      api: { getProductGroup: vi.fn(async () => [liveRow({ groupDate: "2026-09-16 00:00:00" })]) },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("departure_not_found");
  });

  it("(b) live 餘位不足(2 人只剩 1 位)→ insufficient_seats", async () => {
    const { result } = run({
      api: { getProductGroup: vi.fn(async () => [liveRow({ groupStock: 6, groupSaleStock: 5 })]) },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_seats");
    expect(r.verification.checks.seats).toEqual({
      requested: 2,
      liveSpare: 1,
      liveStockStatus: 200,
    });
  });

  it("(b) stockStatus 非 200(供應商關團期)→ insufficient_seats,即使數字上有位", async () => {
    const { result } = run({
      api: { getProductGroup: vi.fn(async () => [liveRow({ stockStatus: 100 })]) },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("insufficient_seats");
  });

  it("(c) 現價差 $1 → price_changed(容差 $0;canonical 基準為整數 USD,$1 是最小可表示差)", async () => {
    const { result } = run({
      api: {
        getProductGroup: vi.fn(async () => [
          liveRow({ groupPrice: [{ priceType: 4, groupPrice: 1236 }] }),
        ]),
      },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("price_changed");
    expect(r.verification.checks.price).toEqual({
      displayedAdultPrice: 1235,
      liveAdultPrice: 1236,
    });
  });

  it("(c) 現價帶小數(1235.51 → round 1236)≠ 展示 1235 → price_changed(分位變動經同一把尺仍擋)", async () => {
    const { result } = run({
      api: {
        getProductGroup: vi.fn(async () => [
          liveRow({ groupPrice: [{ priceType: 4, groupPrice: 1235.51 }] }),
        ]),
      },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("price_changed");
  });

  it("(c) live 無可用 pt4/pt1 價(pickDepartureAdultPrice=0)→ price_changed", async () => {
    const { result } = run({
      api: {
        getProductGroup: vi.fn(async () => [
          liveRow({ groupPrice: [{ priceType: 3, groupPrice: 1650 }] }), // 只剩單人價
        ]),
      },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("price_changed");
  });

  it("(c) 超收防護:booking.totalPrice 高於現行班期基準 → price_changed", async () => {
    const { result } = run({ b: { totalPrice: 2471 } }); // gross = 2×1235 = 2470
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("price_changed");
    expect(r.verification.checks.grossGuard).toEqual({
      bookingTotal: 2471,
      recomputedGross: 2470,
    });
  });

  it("(c) live 幣別非 USD → currency_mismatch", async () => {
    const { result } = run({
      api: { getProductGroup: vi.fn(async () => [liveRow({ currencyNum: "TWD" })]) },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("currency_mismatch");
  });

  it("(c) 必付費用 live 與頁面展示不一致(live 多一條)→ mandatory_fees_changed", async () => {
    const { result } = run({ stored: { mandatoryFeeLines: [] } }); // 頁面沒展示必付,live 有
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("mandatory_fees_changed");
  });

  it("(c) 必付費用 live 取消了頁面仍展示的一條 → mandatory_fees_changed", async () => {
    const { result } = run({
      api: { getProductTravelDetail: vi.fn(async () => LIVE_TRAVEL_NO_FEE) },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("mandatory_fees_changed");
  });

  it("UV API 逾時(hang 超過預算)→ supplier_unreachable(fail-closed)", async () => {
    const { result } = run({
      api: { getProductGroup: vi.fn(() => new Promise(() => {})) as any },
      callBudgetMs: 50,
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("supplier_unreachable");
  });

  it("尾款但供應商未確認座位 → balance_without_vendor_confirmation,不打 live", async () => {
    const { api: a, result } = run({
      paymentType: "remaining",
      b: { supplierStatus: "placed" },
    });
    const r = await result;
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("balance_without_vendor_confirmation");
    expect(a.getProductMain).not.toHaveBeenCalled();
    expect(a.getProductGroup).not.toHaveBeenCalled();
  });
});

/* ─────────────────── 通過綠測 ─────────────────── */

describe("verifyTourCheckout — pass (綠)", () => {
  it("四項全過 → ok,verification/snapshot 欄位齊(含新鮮度時間戳)", async () => {
    const { result } = run({});
    const r = await result;
    expect(r.ok).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.verification.outcome).toBe("passed");
    expect(r.verification.mode).toBe("uv_live");
    expect(r.verification.productCode).toBe("P00002255");
    expect(r.verification.checks.price).toEqual({
      displayedAdultPrice: 1235,
      liveAdultPrice: 1235,
    });
    expect(r.verification.checks.seats).toEqual({
      requested: 2,
      liveSpare: 15,
      liveStockStatus: 200,
    });
    // (d) 供應商資料新鮮時間戳
    expect(r.verification.supplierFreshness.supplierLastSyncedAt).toBe(
      "2026-07-10T00:00:00.000Z",
    );
    expect(r.verification.supplierFreshness.priceTermsFetchedAt).toBe(
      "2026-07-09T00:00:00.000Z",
    );
    expect(typeof r.verification.supplierFreshness.liveCheckedAt).toBe("string");
    // snapshot = 客戶即將同意的版本
    expect(r.snapshot.tour).toMatchObject({ id: 10, title: "美西大峽谷七日" });
    expect(r.snapshot.departure).toMatchObject({ id: 3, date: "2026-09-15" });
    expect(r.snapshot.pricing).toMatchObject({
      currency: "USD",
      adultPrice: 1235,
      totalPrice: 2470,
      depositAmount: 494,
      paymentType: "deposit",
      amountToCharge: 494,
      counts: { adults: 2, childrenWithBed: 0, childrenNoBed: 0, infants: 0, singleRooms: 0 },
    });
    expect(r.snapshot.mandatoryFees).toEqual([FEE_LINE]);
    expect(r.snapshot.policy).toMatchObject({
      paymentTerms: "報名時付訂金、出發前依縱橫標準條款付尾款",
      disclaimerVersion: "v3",
    });
  });

  it("booking.totalPrice 低於現行基準(Packpoint 折抵情境)→ 不擋,但 grossGuard 記錄差異", async () => {
    const { result } = run({ b: { totalPrice: 2400 } });
    const r = await result;
    expect(r.ok).toBe(true);
    expect(r.verification.checks.grossGuard).toEqual({
      bookingTotal: 2400,
      recomputedGross: 2470,
    });
  });

  it("尾款 + vendor_confirmed → 放行(mode=balance_vendor_confirmed),不重驗 live,快照 amountToCharge=尾款", async () => {
    const { api: a, result } = run({
      paymentType: "remaining",
      b: { supplierStatus: "vendor_confirmed" },
    });
    const r = await result;
    expect(r.ok).toBe(true);
    expect(r.verification.mode).toBe("balance_vendor_confirmed");
    expect(a.getProductMain).not.toHaveBeenCalled();
    expect(r.snapshot.pricing.amountToCharge).toBe(1976);
  });
});
