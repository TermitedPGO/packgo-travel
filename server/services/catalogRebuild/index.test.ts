/**
 * index.test — 重抓總指揮的純邏輯 + import 煙霧測。
 *
 * 純 DB glue 的 rebuildCatalog 不在這裡跑(需真 DB);這裡只測可純測的 set-difference
 * 退役邏輯,並藉「import 得起來」確認 orchestrator 的 import graph 沒打結。
 */

import { describe, it, expect } from "vitest";
import { computeRetiredTourIds, extractUvProductCode } from "./index";

describe("computeRetiredTourIds", () => {
  it("retires active tours whose product code wasn't seen this run", () => {
    const existing = new Map([
      ["P1", { id: 1, status: "active" }],
      ["P2", { id: 2, status: "active" }],
      ["P3", { id: 3, status: "active" }],
    ]);
    const seen = new Set(["P1", "P3"]); // P2 dropped by supplier
    expect(computeRetiredTourIds(existing, seen)).toEqual([2]);
  });

  it("never retires a tour that is already inactive/draft", () => {
    const existing = new Map([
      ["P1", { id: 1, status: "inactive" }],
      ["P2", { id: 2, status: "draft" }],
    ]);
    const seen = new Set<string>(); // nothing seen
    expect(computeRetiredTourIds(existing, seen)).toEqual([]);
  });

  it("retires nothing when every active tour is still present", () => {
    const existing = new Map([
      ["P1", { id: 1, status: "active" }],
      ["P2", { id: 2, status: "active" }],
    ]);
    const seen = new Set(["P1", "P2"]);
    expect(computeRetiredTourIds(existing, seen)).toEqual([]);
  });
});

describe("extractUvProductCode", () => {
  it("pulls the product code from a UV detail URL", () => {
    expect(
      extractUvProductCode("https://uvbookings.toursbms.com/en/product/detail/P00002255"),
    ).toBe("P00002255");
  });

  it("ignores query string + hash", () => {
    expect(
      extractUvProductCode("https://uvbookings.toursbms.com/en/product/detail/P123?x=1#frag"),
    ).toBe("P123");
  });

  it("returns null for null / non-matching URLs", () => {
    expect(extractUvProductCode(null)).toBeNull();
    expect(extractUvProductCode("https://example.com/other")).toBeNull();
  });
});
