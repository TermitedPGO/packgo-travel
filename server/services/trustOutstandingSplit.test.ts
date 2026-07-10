/**
 * trustOutstandingSplit 測試 —— F3 塊A 回爐 P1(Trust 真相格口徑)。
 *
 * 鐵則:未認列總額 = matchedNotDeparted + departedPending + unmatched,
 * 三段互斥完備。fixture 用 B-final 定稿口徑:$38,600 + $6,400 + $15,422
 * = $60,422(未對應三筆 $8,908/$2,916/$3,598 = prod 探真)。
 */
import { describe, it, expect } from "vitest";
import {
  splitOutstandingTrust,
  dateOnly,
  laToday,
  type TrustSplitRowLike,
} from "./trustOutstandingSplit";

const TODAY = "2026-07-09"; // 固定基準日,測試不依賴牆鐘

/** B-final 三段口徑 fixture。 */
const bFinalRows: TrustSplitRowLike[] = [
  // 已對應未出發 $38,600(王家 18,500 + 陳小姐 9,200 + Lisa 7,300 + 其他 3,600)
  { amount: "18500.00", bookingId: 101, expectedRecognitionDate: "2026-12-20" },
  { amount: "9200.00", bookingId: 102, expectedRecognitionDate: "2026-07-28" },
  { amount: "7300.00", bookingId: 103, expectedRecognitionDate: "2026-09-15" },
  { amount: "3600.00", bookingId: 104, expectedRecognitionDate: "2027-01-10" },
  // 已出發待認列 $6,400(陳先生 韓國團 07/05 出發)
  { amount: "6400.00", bookingId: 105, expectedRecognitionDate: "2026-07-05" },
  // 未對應三筆 $15,422(prod 探真:$8,908/$2,916/$3,598)
  { amount: "8908.00", bookingId: null, expectedRecognitionDate: null },
  { amount: "2916.00", bookingId: null, expectedRecognitionDate: null },
  { amount: "3598.00", bookingId: null, expectedRecognitionDate: null },
];

describe("splitOutstandingTrust — B-final 三段口徑", () => {
  it("38,600 / 6,400 / 15,422 各歸各段,主數字是 matchedNotDeparted", () => {
    const s = splitOutstandingTrust(bFinalRows, TODAY);
    expect(s.matchedNotDeparted).toBe(38600);
    expect(s.departedPending).toBe(6400);
    expect(s.departedPendingCount).toBe(1);
    expect(s.unmatched).toBe(15422);
    expect(s.unmatchedCount).toBe(3);
    expect(s.total).toBe(60422);
  });

  it("鐵則等式:total === matchedNotDeparted + departedPending + unmatched(缺一不可)", () => {
    const s = splitOutstandingTrust(bFinalRows, TODAY);
    expect(s.total).toBe(s.matchedNotDeparted + s.departedPending + s.unmatched);
  });

  it("認列日 = 今天 → 算已出發待認列(<= 邊界含當日)", () => {
    const s = splitOutstandingTrust(
      [{ amount: "100.00", bookingId: 1, expectedRecognitionDate: TODAY }],
      TODAY,
    );
    expect(s.departedPending).toBe(100);
    expect(s.matchedNotDeparted).toBe(0);
  });

  it("認列日 = 明天 → 未出發", () => {
    const s = splitOutstandingTrust(
      [{ amount: "100.00", bookingId: 1, expectedRecognitionDate: "2026-07-10" }],
      TODAY,
    );
    expect(s.matchedNotDeparted).toBe(100);
    expect(s.departedPending).toBe(0);
  });

  it("有 bookingId 但認列日 null → 未出發(排不進認列,不能謊稱可認列)", () => {
    const s = splitOutstandingTrust(
      [{ amount: "100.00", bookingId: 1, expectedRecognitionDate: null }],
      TODAY,
    );
    expect(s.matchedNotDeparted).toBe(100);
    expect(s.departedPending).toBe(0);
  });

  it("mysql2 Date 物件(local-midnight)輸入:曆日還原正確", () => {
    // new Date(2026, 6, 5) = local 2026-07-05 00:00 —— mysql2 DATE 欄的形狀
    const s = splitOutstandingTrust(
      [{ amount: "6400.00", bookingId: 1, expectedRecognitionDate: new Date(2026, 6, 5) }],
      TODAY,
    );
    expect(s.departedPending).toBe(6400);
  });

  it("空列表:全 0,等式仍成立", () => {
    const s = splitOutstandingTrust([], TODAY);
    expect(s.total).toBe(0);
    expect(s.total).toBe(s.matchedNotDeparted + s.departedPending + s.unmatched);
  });

  it("爛金額字串當 0,不 NaN 汙染總額", () => {
    const s = splitOutstandingTrust(
      [
        { amount: "not-a-number", bookingId: null, expectedRecognitionDate: null },
        { amount: "50.00", bookingId: null, expectedRecognitionDate: null },
      ],
      TODAY,
    );
    expect(s.unmatched).toBe(50);
    expect(Number.isNaN(s.total)).toBe(false);
  });
});

describe("dateOnly / laToday — 曆日換算(T2 地雷 #2:兩端同套)", () => {
  it("字串直切前 10 碼", () => {
    expect(dateOnly("2026-07-05")).toBe("2026-07-05");
    expect(dateOnly("2026-07-05T00:00:00.000Z")).toBe("2026-07-05");
  });
  it("Date 物件用 local getters(非 toISOString,避免非 UTC 伺服器偏一天)", () => {
    expect(dateOnly(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
  it("null/undefined → null", () => {
    expect(dateOnly(null)).toBeNull();
    expect(dateOnly(undefined)).toBeNull();
  });
  it("laToday:UTC 傍晚(LA 還是前一天)換算成 LA 曆日", () => {
    // 2026-07-10T02:00Z = LA 2026-07-09 19:00(PDT, UTC-7)
    expect(laToday(new Date("2026-07-10T02:00:00Z"))).toBe("2026-07-09");
    // 2026-07-10T08:00Z = LA 2026-07-10 01:00
    expect(laToday(new Date("2026-07-10T08:00:00Z"))).toBe("2026-07-10");
  });
});
