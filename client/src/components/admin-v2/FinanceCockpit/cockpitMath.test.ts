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
  foldMatchedNotDeparted,
  compBarSegments,
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
      accountMask: null,
    });
    const agg = aggregateTrust([{ enabled: true }]);
    expect(agg.matchedNotDeparted).toBe(0);
    expect(Number.isNaN(agg.outstanding)).toBe(false);
    expect(agg.enabled).toBe(true);
  });

  it("accountMask:取第一個有 mask 的帳戶(客人訂金卡標題 Trust #5442)", () => {
    const agg = aggregateTrust([
      { enabled: true, accountMask: null },
      { enabled: true, accountMask: "5442" },
    ]);
    expect(agg.accountMask).toBe("5442");
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

describe("resolveTileState — 載入 / 失敗 / 舊值降級 / 就緒", () => {
  // 1A0a:TileState → QueryDisplayState 遷移,"error" 更名 "transport-error"
  it("首載失敗且沒有任何值 → transport-error", () => {
    expect(resolveTileState({ isLoading: false, isError: true, hasData: false })).toBe("transport-error");
    expect(resolveTileState({ isLoading: true, isError: true, hasData: false })).toBe("transport-error");
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
      customerName: null,
      tourTitle: null,
    });
  });

  it("塊C join 名稱透傳(客人名/團名)", () => {
    const out = foldDepartedPending(
      [{
        id: 7, bookingId: 105, amount: "6400.00", depositDate: "2026-06-01",
        expectedRecognitionDate: "2026-07-05",
        bookingCustomerName: "陳先生", bookingTourTitle: "韓國團",
      }],
      TODAY,
    );
    expect(out.items[0].customerName).toBe("陳先生");
    expect(out.items[0].tourTitle).toBe("韓國團");
  });

  it("認列日 = 今天含當日(邊界與 server splitOutstandingTrust 一致)", () => {
    const out = foldDepartedPending(
      [{ id: 9, bookingId: 1, amount: "100.00", depositDate: null, expectedRecognitionDate: TODAY }],
      TODAY,
    );
    expect(out.count).toBe(1);
  });

  it("空 / null 回全 0(1A0a:invalidCount 欄 —— 爛值不折 0 的顯性排除計數)", () => {
    expect(foldDepartedPending(null, TODAY)).toEqual({ items: [], total: 0, count: 0, invalidCount: 0 });
    expect(foldDepartedPending([], TODAY)).toEqual({ items: [], total: 0, count: 0, invalidCount: 0 });
  });
});

describe("foldMatchedNotDeparted — 客人訂金卡逐團列表(塊C)", () => {
  const TODAY = "2026-07-09";
  const rows: DeferredRowLike[] = [
    // 已對應未出發 ×5(B-final:前 4 列出,第 5 進「其他」聚合)
    { id: 1, bookingId: 101, amount: "18500.00", depositDate: null, expectedRecognitionDate: "2026-12-20", bookingCustomerName: "王家", bookingTourTitle: "台越日三國團" },
    { id: 2, bookingId: 102, amount: "9200.00", depositDate: null, expectedRecognitionDate: "2026-07-28", bookingCustomerName: "陳小姐", bookingTourTitle: "日本團" },
    { id: 3, bookingId: 103, amount: "7300.00", depositDate: null, expectedRecognitionDate: "2026-09-15", bookingCustomerName: "Lisa Wu", bookingTourTitle: "越南團" },
    { id: 4, bookingId: 104, amount: "2000.00", depositDate: null, expectedRecognitionDate: "2027-01-10" },
    { id: 5, bookingId: 106, amount: "1600.00", depositDate: null, expectedRecognitionDate: null }, // 未排認列日 → 排最後
    // 已出發(不進本列表 —— departedPending 的事)
    { id: 6, bookingId: 105, amount: "6400.00", depositDate: null, expectedRecognitionDate: "2026-07-05" },
    // 未對應(不進)
    { id: 7, bookingId: null, amount: "8908.00", depositDate: null, expectedRecognitionDate: null },
    // 已認列(不進)
    { id: 8, bookingId: 99, amount: "500.00", depositDate: null, expectedRecognitionDate: "2026-08-01", recognizedAt: "2026-07-01T00:00:00Z" },
  ];

  it("只留已對應未出發;按認列日近→遠排序,null 最後;前 4 列出、其餘聚合", () => {
    const out = foldMatchedNotDeparted(rows, TODAY, 4);
    expect(out.count).toBe(5);
    expect(out.total).toBe(38600); // B-final matchedNotDeparted 口徑
    expect(out.listed.map((x) => x.id)).toEqual([2, 3, 1, 4]); // 07/28 → 09/15 → 12/20 → 2027
    expect(out.othersCount).toBe(1);
    expect(out.othersTotal).toBe(1600);
  });

  it("近出發(<=30 天)標 soon(amber dot);遠的不標;未排認列日 daysUntil=null", () => {
    const out = foldMatchedNotDeparted(rows, TODAY, 10);
    const byId = Object.fromEntries(out.listed.map((x) => [x.id, x]));
    expect(byId[2].soon).toBe(true); // 07/28,19 天後
    expect(byId[2].daysUntil).toBe(19);
    expect(byId[3].soon).toBe(false); // 09/15
    expect(byId[5].daysUntil).toBeNull();
    expect(byId[5].soon).toBe(false);
  });

  it("名稱透傳;空 / null 回全 0", () => {
    const out = foldMatchedNotDeparted(rows, TODAY, 4);
    expect(out.listed[0].customerName).toBe("陳小姐");
    expect(out.listed[0].tourTitle).toBe("日本團");
    expect(foldMatchedNotDeparted(null, TODAY)).toEqual({
      listed: [], othersCount: 0, othersTotal: 0, total: 0, count: 0,
    });
  });
});

describe("compBarSegments — 損益成分條寬度(塊C)", () => {
  const bFinalCosts = [
    { key: "cogs_tour", value: 6400 },
    { key: "cogs_other", value: 520 },
    { key: "expense_marketing", value: 1200 },
    { key: "expense_office", value: 780 },
  ];

  it("B-final 數字:各段佔營收比例,加總恰 100(最後一段吃殘差)", () => {
    const segs = compBarSegments(bFinalCosts, 12450, 3550);
    expect(segs.map((s) => s.key)).toEqual([
      "cogs_tour", "cogs_other", "expense_marketing", "expense_office", "net",
    ]);
    const sum = segs.reduce((s, x) => s + x.pct, 0);
    expect(sum).toBeCloseTo(100, 6);
    expect(segs[0].pct).toBeCloseTo(51.4, 1); // 供應商 51%
    expect(segs[segs.length - 1].pct).toBeCloseTo(28.5, 1); // 淨利 28.5%
  });

  it("0 收入不除零 → 空陣列(UI 藏條)", () => {
    expect(compBarSegments(bFinalCosts, 0, 0)).toEqual([]);
    expect(compBarSegments(bFinalCosts, -5, -5)).toEqual([]);
  });

  it("淨利為負 → 空陣列(段寬無法表達虧損,只列行不畫條)", () => {
    expect(compBarSegments(bFinalCosts, 1000, -200)).toEqual([]);
  });

  it("value 0 的成本段被濾掉,不佔 0 寬段", () => {
    const segs = compBarSegments(
      [{ key: "cogs_tour", value: 500 }, { key: "cogs_other", value: 0 }],
      1000,
      500,
    );
    expect(segs.map((s) => s.key)).toEqual(["cogs_tour", "net"]);
    expect(segs.reduce((s, x) => s + x.pct, 0)).toBeCloseTo(100, 6);
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
