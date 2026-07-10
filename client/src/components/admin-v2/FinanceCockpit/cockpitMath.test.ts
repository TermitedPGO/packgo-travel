/**
 * cockpitMath 測試 —— F3 財務駕駛艙塊A 真相列的數字計算。
 *
 * fixture 用「真實形狀」(dispatch-f3 驗收基準,2026-07-09 prod 探真):
 *   - 待認領 320 筆 / $447,732(bankTransactionLinks pendingSummary)
 *   - Trust 未歸戶三筆 $8,908 / $2,916 / $3,598 = $15,422(trustReconciliation unmatched)
 * 只斷言純計算(挑欄位 / 加總 / 比率 / 狀態機),不碰真實 DB。
 */
import { describe, it, expect } from "vitest";
import {
  selectOperatingBalance,
  aggregateTrust,
  profitMargin,
  resolveTileState,
  fmtMoney,
  fmtSignedMoney,
  type AccountRowLike,
  type TrustReconRowLike,
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

describe("aggregateTrust — 跨帳戶加總三段勾稽", () => {
  it("單一 trust 帳戶:未歸戶三筆 $15,422 進 unmatchedTotal / count=3", () => {
    const rows: TrustReconRowLike[] = [
      {
        enabled: true,
        outstandingTotal: 15422,
        unmatchedCount: 3,
        unmatchedTotal: 8908 + 2916 + 3598, // = 15422
        balance: 15422,
      },
    ];
    const agg = aggregateTrust(rows);
    expect(agg.unmatchedTotal).toBe(15422);
    expect(agg.unmatchedCount).toBe(3);
    expect(agg.outstanding).toBe(15422);
    expect(agg.balance).toBe(15422);
    expect(agg.enabled).toBe(true);
    expect(agg.accountCount).toBe(1);
  });

  it("多帳戶:outstanding / unmatched / balance 各自加總,任一 enabled 即 enabled", () => {
    const rows: TrustReconRowLike[] = [
      { enabled: false, outstandingTotal: 38600, unmatchedCount: 0, unmatchedTotal: 0, balance: 45000 },
      { enabled: true, outstandingTotal: 15422, unmatchedCount: 3, unmatchedTotal: 15422, balance: 15422 },
    ];
    const agg = aggregateTrust(rows);
    expect(agg.outstanding).toBe(54022);
    expect(agg.unmatchedTotal).toBe(15422);
    expect(agg.unmatchedCount).toBe(3);
    expect(agg.balance).toBe(60422);
    expect(agg.enabled).toBe(true);
    expect(agg.accountCount).toBe(2);
  });

  it("null / 缺欄位當 0,不 NaN;無帳戶回全 0 + enabled=false", () => {
    expect(aggregateTrust(null)).toEqual({
      outstanding: 0, unmatchedTotal: 0, unmatchedCount: 0, balance: 0, enabled: false, accountCount: 0,
    });
    const agg = aggregateTrust([{ enabled: true }]);
    expect(agg.outstanding).toBe(0);
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

describe("resolveTileState — 每格載入 / 失敗 / 就緒(fail-open)", () => {
  it("isError 優先 → error(即使同時 loading)", () => {
    expect(resolveTileState({ isLoading: true, isError: true, hasData: false })).toBe("error");
  });
  it("loading 或還沒 data → loading", () => {
    expect(resolveTileState({ isLoading: true, isError: false, hasData: false })).toBe("loading");
    expect(resolveTileState({ isLoading: false, isError: false, hasData: false })).toBe("loading");
  });
  it("有 data 且無錯無載入 → ready", () => {
    expect(resolveTileState({ isLoading: false, isError: false, hasData: true })).toBe("ready");
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
