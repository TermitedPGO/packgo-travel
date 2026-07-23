/**
 * bankTriageGuard —— 1A0a(Codex 7-18 窄修1)stale 禁寫決策的承重單元測試。
 *
 * BankTriagePage 的四條寫入路徑(confirmAI / overrideCategory / markExcluded /
 * swipe onTouchEnd)都以 shouldBlockTriageWrite 為唯一 gate。render-only 測試無法
 * 演練事件,故用純 predicate 釘住決策:刪除或反轉 gate 邏輯此測試會紅。
 */
import { describe, expect, it } from "vitest";
import { shouldBlockTriageWrite } from "./BankTriagePage";

describe("shouldBlockTriageWrite — stale 禁寫決策(禁 mutation on stale)", () => {
  it("fresh(成功,未 error)→ 允許寫入", () => {
    expect(shouldBlockTriageWrite({ isError: false, data: { items: [] } })).toBe(false);
  });
  it("cold-error(從未成功,data undefined)→ 不阻擋(該態根本無 current 可寫,由 UI 錯屏擋)", () => {
    expect(shouldBlockTriageWrite({ isError: true, data: undefined })).toBe(false);
  });
  it("cached-stale(曾成功保有 data + 當前 refetch 失敗)→ 禁寫", () => {
    expect(shouldBlockTriageWrite({ isError: true, data: { items: [{ id: 1 }] } })).toBe(true);
    expect(shouldBlockTriageWrite({ isError: true, data: { items: [] } })).toBe(true);
  });
});
