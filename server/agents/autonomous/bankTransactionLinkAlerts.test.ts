/**
 * bankTransactionLinkAlerts 純函式測試(F1 對帳引擎 塊A 噪音閘,2026-07-08)。
 *
 * 只測 allocateCardSlots(每日上限的純分配邏輯)與 laDay。DB-touching 的
 * scanAndAlertPendingClaims 本地無 DATABASE_URL 測不到,誠實列 T6 已知限制。
 */
import { describe, it, expect } from "vitest";
import { allocateCardSlots, laDay, DAILY_PENDING_CLAIM_CARD_CAP, buildPendingCandidateNote } from "./bankTransactionLinkAlerts";

describe("allocateCardSlots — 每日出卡上限(噪音閘)", () => {
  it("今天還沒出過卡,items 數 <= cap → 全部進 individual,overflow 空", () => {
    const items = [1, 2, 3];
    const { individual, overflow } = allocateCardSlots(items, 0, 10);
    expect(individual).toEqual([1, 2, 3]);
    expect(overflow).toEqual([]);
  });

  it("今天已出 8 張,cap=10,再來 5 筆 → 前 2 筆進 individual,後 3 筆進 overflow", () => {
    const items = ["a", "b", "c", "d", "e"];
    const { individual, overflow } = allocateCardSlots(items, 8, 10);
    expect(individual).toEqual(["a", "b"]);
    expect(overflow).toEqual(["c", "d", "e"]);
  });

  it("今天已達上限(cardsAlreadyToday >= cap)→ 全部進 overflow,一張個別卡都不出", () => {
    const items = [1, 2, 3];
    const { individual, overflow } = allocateCardSlots(items, 10, 10);
    expect(individual).toEqual([]);
    expect(overflow).toEqual([1, 2, 3]);
  });

  it("超過上限(理論上不該發生,但防禦)→ 一樣全部進 overflow", () => {
    const items = [1, 2];
    const { individual, overflow } = allocateCardSlots(items, 15, 10);
    expect(individual).toEqual([]);
    expect(overflow).toEqual([1, 2]);
  });

  it("預設 cap 取模組常數 DAILY_PENDING_CLAIM_CARD_CAP(10)", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    const { individual, overflow } = allocateCardSlots(items, 0);
    expect(individual).toHaveLength(DAILY_PENDING_CLAIM_CARD_CAP);
    expect(overflow).toHaveLength(12 - DAILY_PENDING_CLAIM_CARD_CAP);
  });

  it("空陣列 → 兩邊都空", () => {
    const { individual, overflow } = allocateCardSlots([], 0, 10);
    expect(individual).toEqual([]);
    expect(overflow).toEqual([]);
  });
});

describe("laDay — America/Los_Angeles 曆日", () => {
  it("回傳 YYYY-MM-DD 格式", () => {
    const d = laDay(new Date("2026-07-08T12:00:00Z"));
    expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("UTC 午夜前後同一個 UTC 時刻,LA 曆日應落在 UTC 日期或前一天(時區換算方向守門)", () => {
    // UTC 2026-07-08 03:00 = LA 2026-07-07 20:00(PDT, UTC-7)—— 確認換算方向沒搞反。
    const d = laDay(new Date("2026-07-08T03:00:00Z"));
    expect(d).toBe("2026-07-07");
  });
});


describe("buildPendingCandidateNote — 撥款候選分支(F2 塊D 回令 #3)", () => {
  it("payout 候選存在 → note 帶「銷售 − 手續費 = 費率」明細與人工確認提示", () => {
    const note = buildPendingCandidateNote([], [
      {
        orderNumbers: ["ORD-2026-0011"],
        saleTotalCents: 49000,
        impliedFeeCents: 1451,
        impliedFeePct: 0.0296,
      },
    ]);
    expect(note).toContain("疑似 Square 撥款");
    expect(note).toContain("ORD-2026-0011");
    expect(note).toContain("$490.00");
    expect(note).toContain("$14.51");
    expect(note).toContain("2.96%");
    expect(note).toContain("Jeff 認領時確認");
  });

  it("一般候選 + payout 候選並存 → 兩段以分號拼接;全空 → 誠實寫無候選", () => {
    const both = buildPendingCandidateNote(
      [{ orderNumber: "ORD-2026-0042" }],
      [{ orderNumbers: ["ORD-2026-0011"], saleTotalCents: 49000, impliedFeeCents: 1451, impliedFeePct: 0.0296 }],
    );
    expect(both).toContain("疑似候選訂單:ORD-2026-0042");
    expect(both).toContain(";疑似 Square 撥款");
    expect(buildPendingCandidateNote([], [])).toBe("沒有金額吻合的候選訂單");
  });
});
