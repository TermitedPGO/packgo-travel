/**
 * cockpitState —— 1A0a 狀態折疊與 allClear 公式(plan v4.3 §7.3)。
 *
 * 契約:
 * - deriveWorkState:兩源(pendingSummary / trustReconciliation)各自折
 *   { state, count };state==="ready" 蘊含 fresh(age <= FRESH_MAX_AGE)。
 * - isAllClear:兩源皆 ready 且 count 皆真零;任一 loading/transport-error/
 *   stale/count>0/count===null → false(U1:error 折 0 假 all-clear 的修法)。
 * - freshness 邊界三點:門檻−1ms → ready;===門檻 → ready(等號案,錯寫 < 即紅);
 *   門檻+1ms → stale。
 */
import { describe, expect, it } from "vitest";
import {
  FRESH_MAX_AGE_MS,
  deriveWorkState,
  isAllClear,
  type WorkQueryLike,
} from "./cockpitMath";

const NOW = 1_800_000_000_000;

function q(over: Partial<WorkQueryLike>): WorkQueryLike {
  return {
    isLoading: false,
    isError: false,
    hasData: true,
    dataUpdatedAt: NOW,
    count: 0,
    ...over,
  };
}

function derive(pending: WorkQueryLike, recog: WorkQueryLike) {
  return deriveWorkState(pending, recog, NOW);
}

describe("deriveWorkState — 單源狀態折疊", () => {
  it("首載中(無 data)→ loading,count=null", () => {
    const w = derive(q({ isLoading: true, hasData: false, count: null }), q({}));
    expect(w.pending).toEqual({ state: "loading", count: null });
  });

  it("失敗且無快取值 → transport-error,count=null(不折 0)", () => {
    const w = derive(q({ isError: true, hasData: false, count: null }), q({}));
    expect(w.pending).toEqual({ state: "transport-error", count: null });
  });

  it("refetch 失敗但留舊值 → stale(顯示舊值)", () => {
    const w = derive(q({ isError: true, count: 3 }), q({}));
    expect(w.pending).toEqual({ state: "stale", count: 3 });
  });

  it("成功且 fresh → ready", () => {
    const w = derive(q({ count: 0 }), q({ count: 0 }));
    expect(w.pending.state).toBe("ready");
    expect(w.recog.state).toBe("ready");
  });
});

describe("freshness 邊界三點(契約 age <= threshold → ready)", () => {
  const cases = [
    { name: "pendingSummary", max: FRESH_MAX_AGE_MS.pendingSummary, pick: "pending" as const },
    { name: "trustReconciliation", max: FRESH_MAX_AGE_MS.trustReconciliation, pick: "recog" as const },
  ];
  for (const c of cases) {
    it(`${c.name}:age = 門檻−1ms → ready`, () => {
      const src = q({ dataUpdatedAt: NOW - (c.max - 1) });
      const w = derive(c.pick === "pending" ? src : q({}), c.pick === "recog" ? src : q({}));
      expect(w[c.pick].state).toBe("ready");
    });
    it(`${c.name}:age === 門檻 → ready(等號案)`, () => {
      const src = q({ dataUpdatedAt: NOW - c.max });
      const w = derive(c.pick === "pending" ? src : q({}), c.pick === "recog" ? src : q({}));
      expect(w[c.pick].state).toBe("ready");
    });
    it(`${c.name}:age = 門檻+1ms → stale`, () => {
      const src = q({ dataUpdatedAt: NOW - (c.max + 1) });
      const w = derive(c.pick === "pending" ? src : q({}), c.pick === "recog" ? src : q({}));
      expect(w[c.pick].state).toBe("stale");
    });
  }
});

describe("isAllClear —— 兩源 ready+fresh+真零才 true", () => {
  it("兩源 ready 且 0/0 → true", () => {
    expect(isAllClear(derive(q({ count: 0 }), q({ count: 0 })))).toBe(true);
  });
  it("任一 count>0 → false", () => {
    expect(isAllClear(derive(q({ count: 1 }), q({ count: 0 })))).toBe(false);
    expect(isAllClear(derive(q({ count: 0 }), q({ count: 2 })))).toBe(false);
  });
  it("任一 transport-error(count=null)→ false(不再假綠勾)", () => {
    expect(
      isAllClear(derive(q({ isError: true, hasData: false, count: null }), q({ count: 0 }))),
    ).toBe(false);
  });
  it("任一 loading → false", () => {
    expect(
      isAllClear(derive(q({ isLoading: true, hasData: false, count: null }), q({ count: 0 }))),
    ).toBe(false);
  });
  it("任一 stale(即使 count=0)→ false", () => {
    const staleSrc = q({ dataUpdatedAt: NOW - (FRESH_MAX_AGE_MS.pendingSummary + 1), count: 0 });
    expect(isAllClear(derive(staleSrc, q({ count: 0 })))).toBe(false);
  });
});
