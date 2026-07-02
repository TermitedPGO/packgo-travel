import { describe, expect, it } from "vitest";
import { followMergePointerCore, MERGE_POINTER_MAX_HOPS } from "./mergedProfile";

const mapLookup =
  (m: Record<number, number | null>) =>
  (id: number): number | null | undefined =>
    m[id];

describe("followMergePointerCore(0109 合併轉寄指標)", () => {
  it("沒被併過(pointer null)→ 原 id", () => {
    expect(followMergePointerCore(10, mapLookup({ 10: null }))).toBe(10);
  });

  it("查不到 row(undefined)→ 原 id", () => {
    expect(followMergePointerCore(10, mapLookup({}))).toBe(10);
  });

  it("一跳:leslie(2460001)→ Emerald(2760016)", () => {
    expect(followMergePointerCore(2460001, mapLookup({ 2460001: 2760016, 2760016: null }))).toBe(
      2760016,
    );
  });

  it("兩跳鏈:A→B→C 落在 C(B 之後又被併進 C)", () => {
    expect(followMergePointerCore(1, mapLookup({ 1: 2, 2: 3, 3: null }))).toBe(3);
  });

  it("自指(A→A)不無窮迴圈,回 A", () => {
    expect(followMergePointerCore(7, mapLookup({ 7: 7 }))).toBe(7);
  });

  it("互指循環(A→B→A)停在循環前最後一張,回 B", () => {
    expect(followMergePointerCore(1, mapLookup({ 1: 2, 2: 1 }))).toBe(2);
  });

  it("超過 hop 上限的長鏈停在第 maxHops 張,不 runaway", () => {
    const chain: Record<number, number | null> = {};
    for (let i = 1; i <= 20; i++) chain[i] = i + 1;
    expect(followMergePointerCore(1, mapLookup(chain))).toBe(1 + MERGE_POINTER_MAX_HOPS);
  });

  it("懸空指標(目標卡已被硬刪,lookup=undefined)→ 退回最後一張存在的卡", () => {
    // 1 → 2,但 2 的 row 不存在(被 deleteGuestCustomer 硬刪)
    expect(followMergePointerCore(1, mapLookup({ 1: 2 }))).toBe(1);
  });

  it("兩跳後懸空(1→2→3,3 已刪)→ 退回 2", () => {
    expect(followMergePointerCore(1, mapLookup({ 1: 2, 2: 3 }))).toBe(2);
  });
})
