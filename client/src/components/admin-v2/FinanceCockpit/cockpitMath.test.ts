/**
 * cockpitMath 測試 —— F3 財務駕駛艙真相列 + 工作區的數字計算。
 *
 * fixture 用「真實形狀」(dispatch-f3 驗收基準,2026-07-09 prod 探真):
 *   - 待認領 320 筆 / $447,732(bankTransactionLinks pendingSummary)
 *   - Trust 三段口徑(F3 回爐 P1,B-final 定稿):已對應未出發 $38,600 +
 *     已出發待認列 $6,400 + 未對應三筆 $8,908/$2,916/$3,598 = $15,422,
 *     合計 $60,422 —— 等式紅綠釘死。
 * 只斷言純計算(挑欄位 / 加總 / 比率 / 曆日 / 狀態機),不碰真實 DB。
 */
import { describe, it, expect } from "vitest";
import {
  selectOperatingBalance,
  aggregateTrust,
  profitMargin,
  resolveTileState,
  agingDays,
  laTodayClient,
  dateOnlyClient,
  foldDepartedPending,
  fmtMoney,
  fmtSignedMoney,
  type AccountRowLike,
  type TrustReconRowLike,
  type DeferredRowLike,
} from "./cockpitMath";

describe("selectOperatingBalance — 現金部位挑 Operating #2174 可動用餘額", () => {
  const accounts: AccountRowLike[] = [
    // Trust #5442(非 Operating,即使 available 有值也不能被挑到)
    { accountMask: "5442", isTrustAccount: 1, currentBalance: "60422.00", availableBalance: "60422.00" },
    // Operating #2174 —— available 優先
    { accountMask: "2174", isTrustAccount: 0, currentBalance: "13000.00", availableBalance: "12300.00" },
  ];

  it("挑 mask 2174 非 trust 帳戶,取 availableBalance", () => {
    expect(selectOperatingBalance(accounts)).toBe(12300);
  });

  it("availableBalance 為 null 時退回 currentBalance", () => {
    expect(
      selectOperatingBalance([
        { accountMask: "2174", isTrustAccount: 0, currentBalance: "13000.00", availableBalance: null },
      ]),
    ).toBe(13000);
  });

  it("同 mask 但 isTrustAccount=1 不算 Operating(不誤把信託餘額當現金)", () => {
    expect(
      selectOperatingBalance([
        { accountMask: "2174", isTrustAccount: 1, currentBalance: "9999.00", availableBalance: "9999.00" },
      ]),
    ).toBeNull();
  });

  it("找不到帳戶回 null(前端顯示「尚未連結」,不謊報 $0)", () => {
    expect(selectOperatingBalance([])).toBeNull();
    expect(selectOperatingBalance(undefined)).toBeNull();
    expect(selectOperatingBalance([{ accountMask: "0001", isTrustAccount: 0, currentBalance: "5", availableBalance: "5" }])).toBeNull();
  });

  it("兩個餘額都 null 回 null", () => {
    expect(
      selectOperatingBalance([
        { accountMask: "2174", isTrustAccount: 0, currentBalance: null, availableBalance: null },
      ]),
    ).toBeNull();
  });
});

describe("aggregateTrust — 三段口徑(F3 回爐 P1,B-final 定稿)", () => {
  /** B-final 定稿 fixture:38,600 + 6,400 + 15,422 = 60,422。 */
  const bFinalRow: TrustReconRowLike = {
    enabled: true,
    outstandingTotal: 60422,
    matchedNotDeparted: 38600,
    departedPending: 6400,
    departedPendingCount: 1,
    unmatchedCount: 3,
    unmatchedTotal: 8908 + 2916 + 3598, // = 15422(prod 探真三筆)
    balance: 60422,
  };

  it("主數字 = matchedNotDeparted(38,600 口徑),不是全部 outstanding(54,022/60,422 口徑)", () => {
    const agg = aggregateTrust([bFinalRow]);
    expect(agg.matchedNotDeparted).toBe(38600);
    expect(agg.departedPending).toBe(6400);
    expect(agg.departedPendingCount).toBe(1);
    expect(agg.unmatchedTotal).toBe(15422);
    expect(agg.unmatchedCount).toBe(3);
    expect(agg.outstanding).toBe(60422);
    expect(agg.enabled).toBe(true);
  });

  it("鐵則等式:outstanding === matchedNotDeparted + departedPending + unmatched", () => {
    const agg = aggregateTrust([bFinalRow]);
    expect(agg.outstanding).toBe(agg.matchedNotDeparted + agg.departedPending + agg.unmatchedTotal);
  });

  it("多帳戶:各段各自加總,任一 enabled 即 enabled", () => {
    const agg = aggregateTrust([
      { enabled: false, outstandingTotal: 38600, matchedNotDeparted: 38600, departedPending: 0, departedPendingCount: 0, unmatchedCount: 0, unmatchedTotal: 0, balance: 45000 },
      { enabled: true, outstandingTotal: 21822, matchedNotDeparted: 0, departedPending: 6400, departedPendingCount: 1, unmatchedCount: 3, unmatchedTotal: 15422, balance: 15422 },
    ]);
    expect(agg.matchedNotDeparted).toBe(38600);
    expect(agg.departedPending).toBe(6400);
    expect(agg.unmatchedTotal).toBe(15422);
    expect(agg.outstanding).toBe(60422);
    expect(agg.balance).toBe(60422);
    expect(agg.enabled).toBe(true);
    expect(agg.accountCount).toBe(2);
  });

  it("null / 缺欄位當 0,不 NaN;無帳戶回全 0 + enabled=false", () => {
    expect(aggregateTrust(null)).toEqual({
      outstanding: 0, matchedNotDeparted: 0, departedPending: 0, departedPendingCount: 0,
      unmatchedTotal: 0, unmatchedCount: 0, balance: 0, enabled: false, accountCount: 0,
    });
    const agg = aggregateTrust([{ enabled: true }]);
    expect(agg.matchedNotDeparted).toBe(0);
    expect(Number.isNaN(agg.outstanding)).toBe(false);
    expect(agg.enabled).toBe(true);
  });
});

describe("profitMargin — 利潤率 %", () => {
  it("正常:淨利 / 營收 * 100,四捨五入到 0.1", () => {
    expect(profitMargin(12450, 3550)).toBe(28.5);
  });
  it("虧損:負利潤率", () => {
    expect(profitMargin(1000, -200)).toBe(-20);
  });
  it("營收 <= 0 回 0(不除以零 / 不 Infinity)", () => {
    expect(profitMargin(0, 500)).toBe(0);
    expect(profitMargin(-10, 500)).toBe(0);
  });
});

describe("resolveTileState — 載入 / 失敗 / 舊值降級 / 就緒(fail-open)", () => {
  it("首載失敗且沒有任何值 → error", () => {
    expect(resolveTileState({ isLoading: false, isError: true, hasData: false })).toBe("error");
    expect(resolveTileState({ isLoading: true, isError: true, hasData: false })).toBe("error");
  });
  it("refetch 失敗但 react-query 保留上次好值 → stale(顯示上次值+淡標記,F3 回爐 #7)", () => {
    expect(resolveTileState({ isLoading: false, isError: true, hasData: true })).toBe("stale");
  });
  it("loading 或還沒 data → loading", () => {
    expect(resolveTileState({ isLoading: true, isError: false, hasData: false })).toBe("loading");
    expect(resolveTileState({ isLoading: false, isError: false, hasData: false })).toBe("loading");
  });
  it("有 data 且無錯無載入 → ready", () => {
    expect(resolveTileState({ isLoading: false, isError: false, hasData: true })).toBe("ready");
  });
});

describe("agingDays / laTodayClient / dateOnlyClient — 老化天數(LA 曆日兩端同套)", () => {
  it("曆日差:04/13 → 07/09 = 87 天(B-final 表列實例)", () => {
    expect(agingDays("2026-04-13", "2026-07-09")).toBe(87);
  });
  it("同日 0 天;隔日 1 天", () => {
    expect(agingDays("2026-07-09", "2026-07-09")).toBe(0);
    expect(agingDays("2026-07-08", "2026-07-09")).toBe(1);
  });
  it("爛輸入回 null(不顯示 chip,不 NaN)", () => {
    expect(agingDays("not-a-date", "2026-07-09")).toBeNull();
  });
  it("laTodayClient:UTC 傍晚(LA 前一天)換算 LA 曆日", () => {
    expect(laTodayClient(new Date("2026-07-10T02:00:00Z"))).toBe("2026-07-09");
    expect(laTodayClient(new Date("2026-07-10T08:00:00Z"))).toBe("2026-07-10");
  });
  it("dateOnlyClient:ISO 字串切曆日;Date 用 local getters;null 回 null", () => {
    expect(dateOnlyClient("2026-07-05T00:00:00.000Z")).toBe("2026-07-05");
    expect(dateOnlyClient(new Date(2026, 6, 5))).toBe("2026-07-05");
    expect(dateOnlyClient(null)).toBeNull();
  });
});

describe("foldDepartedPending — 待認列確認卡(與 server departedPending 同口徑)", () => {
  const TODAY = "2026-07-09";
  const rows: DeferredRowLike[] = [
    // 已出發待認列(陳先生 韓國團 07/05,B-final 實例)
    { id: 1, bookingId: 105, amount: "6400.00", depositDate: "2026-06-01", expectedRecognitionDate: "2026-07-05" },
    // 未出發(不進卡)
    { id: 2, bookingId: 102, amount: "9200.00", depositDate: "2026-06-10", expectedRecognitionDate: "2026-07-28" },
    // 未對應(不進卡 —— 那是待認領的事)
    { id: 3, bookingId: null, amount: "8908.00", depositDate: "2026-04-13", expectedRecognitionDate: null },
    // 已認列(不進卡)
    { id: 4, bookingId: 99, amount: "5000.00", depositDate: "2026-05-01", expectedRecognitionDate: "2026-06-01", recognizedAt: "2026-06-01T10:00:00Z" },
    // 已沖銷(不進卡)
    { id: 5, bookingId: 98, amount: "3000.00", depositDate: "2026-05-02", expectedRecognitionDate: "2026-06-02", reversedAt: "2026-06-03T10:00:00Z" },
  ];

  it("只留:未認列未沖銷 + 已對應 + 認列日 <= 今天;total/count 正確", () => {
    const out = foldDepartedPending(rows, TODAY);
    expect(out.count).toBe(1);
    expect(out.total).toBe(6400);
    expect(out.items[0]).toEqual({
      id: 1,
      bookingId: 105,
      amount: 6400,
      depositDate: "2026-06-01",
      recognitionDate: "2026-07-05",
    });
  });

  it("認列日 = 今天含當日(邊界與 server splitOutstandingTrust 一致)", () => {
    const out = foldDepartedPending(
      [{ id: 9, bookingId: 1, amount: "100.00", depositDate: null, expectedRecognitionDate: TODAY }],
      TODAY,
    );
    expect(out.count).toBe(1);
  });

  it("空 / null 回全 0", () => {
    expect(foldDepartedPending(null, TODAY)).toEqual({ items: [], total: 0, count: 0 });
    expect(foldDepartedPending([], TODAY)).toEqual({ items: [], total: 0, count: 0 });
  });
});

describe("金額格式", () => {
  it("fmtMoney:整數千分位", () => {
    expect(fmtMoney(447732)).toBe("$447,732");
    expect(fmtMoney(12300.4)).toBe("$12,300");
  });
  it("fmtSignedMoney:帶正負號,負號用 U+2212", () => {
    expect(fmtSignedMoney(3550)).toBe("+$3,550");
    expect(fmtSignedMoney(-1200)).toBe("−$1,200");
  });
});
