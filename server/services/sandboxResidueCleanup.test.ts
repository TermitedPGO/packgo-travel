/**
 * sandboxResidueCleanup 純函式測試(F1 對帳引擎 塊D,2026-07-09)。
 *
 * 只測 assertOnlySandboxRows —— 三重防護裡的第二/三道(JS 逐列複驗 + BofA
 * 黑名單)。scan/dry_run/confirm 是 DB-touching,本地無 DATABASE_URL 測不到,
 * 誠實列 T6 已知限制(同塊A/塊C 慣例)。這支純函式是「絕不刪到 BofA」的
 * 程式化保證,獨立可測最關鍵。
 */
import { describe, it, expect } from "vitest";
import { assertOnlySandboxRows, type SandboxAccountRow } from "./sandboxResidueCleanup";

const row = (over: Partial<SandboxAccountRow>): SandboxAccountRow => ({
  id: 1,
  institutionName: "First Platypus Bank",
  accountName: "Plaid Checking",
  isActive: 0,
  ...over,
});

describe("assertOnlySandboxRows — 三重防護的 JS 複驗", () => {
  it("全部是 First Platypus 且 isActive=0 → 回傳全部 id", () => {
    const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 24 })];
    expect(assertOnlySandboxRows(rows)).toEqual([1, 2, 24]);
  });

  it("空輸入 → 回傳空陣列(沒有殘留可刪)", () => {
    expect(assertOnlySandboxRows([])).toEqual([]);
  });

  it("⛔ 命中 BofA 黑名單(名字含 'Bank of America')→ 整批 throw,絕不刪", () => {
    const rows = [row({ id: 1 }), row({ id: 5, institutionName: "Bank of America", isActive: 0 })];
    expect(() => assertOnlySandboxRows(rows)).toThrow(/絕不刪除/);
  });

  it("⛔ 命中 BofA 黑名單('BofA' 不分大小寫)→ throw", () => {
    expect(() => assertOnlySandboxRows([row({ id: 9, institutionName: "BOFA Operating" })])).toThrow();
  });

  it("⛔ 名字不精確等於 sandbox(即使很像)→ throw,不做模糊比對", () => {
    expect(() => assertOnlySandboxRows([row({ id: 3, institutionName: "First Platypus Bank 2" })])).toThrow(/不精確等於/);
  });

  it("⛔ isActive 非 0(可能是使用中的真帳戶)→ throw", () => {
    expect(() => assertOnlySandboxRows([row({ id: 4, isActive: 1 })])).toThrow(/isActive/);
  });

  it("一列壞掉就整批中止(不做部分刪除)", () => {
    const rows = [row({ id: 1 }), row({ id: 2 }), row({ id: 3, isActive: 1 })];
    expect(() => assertOnlySandboxRows(rows)).toThrow();
  });
});
