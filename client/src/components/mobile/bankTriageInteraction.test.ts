/**
 * bankTriageInteraction —— 1A0a BankTriage 真事件互動 regression
 * (Codex 7-18 15:56 P1-3 / 窄修 3:「用真事件+mutation spy 鎖四條 stale 禁寫」)。
 *
 * @vitest-environment jsdom
 *
 * 15:56 裁定的反例:既有測試只數 SSR disabled 屬性與直測 predicate,「以不落盤
 * 突變移除 handler guard 後 25/25 仍綠」。本檔補上缺的那塊:jsdom 裡 createRoot
 * 真渲染,對元件派發真 touch/click 事件,斷言 mutation spy 的實際呼叫次數 ——
 *
 * - cached-stale:四條寫入路徑(swipe 右確認 / swipe 左排除 / pill 改類別 /
 *   底列按鈕)事件後 mutation 零呼叫。swipe 路徑沒有 disabled 第二層保護,
 *   事件直達 performTriageWrite chokepoint —— 移除該 guard,此檔必紅。
 * - fresh:同一組事件必須真的打到 mutation(exact payload 斷言),證明本測試
 *   不是 vacuous(事件真的接上了寫入路徑,零呼叫不是因為事件沒發出去)。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { React?: typeof React }).React = React;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock("@/contexts/LocaleContext", () => ({
  useLocale: () => ({ t: (k: string) => k, language: "zh-TW" }),
}));

type Q = { data: unknown; isLoading: boolean; isError: boolean; dataUpdatedAt: number };
let Q_STATE: Q = { data: undefined, isLoading: false, isError: true, dataUpdatedAt: 0 };
const mutateAsyncSpy = vi.fn(async () => ({}));

vi.mock("@/lib/trpc", () => {
  const make = (path: string[]): unknown =>
    new Proxy(() => {}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        if (prop === "useQuery" || prop === "useInfiniteQuery") return () => Q_STATE;
        if (prop === "useMutation")
          return () => ({
            mutate: () => {},
            mutateAsync: mutateAsyncSpy,
            isPending: false,
            isError: false,
          });
        if (prop === "useUtils") return () => make([]);
        if (prop === "invalidate" || prop === "setInfiniteData") return () => {};
        return make([...path, prop]);
      },
      apply() { return undefined; },
    });
  return { trpc: make([]) };
});

const { default: BankTriagePage } = await import("./BankTriagePage");

/** pile filter 要求 agentCategory 空或 "other_review";confirmAI 需其 truthy。 */
const TX = {
  id: 42,
  date: "2026-07-01",
  amount: 120,
  agentCategory: "other_review",
  agentConfidence: 88,
  excludeFromAccounting: 0,
};
const FRESH: Q = { isError: false, isLoading: false, dataUpdatedAt: 1, data: { items: [TX] } };
const STALE: Q = { isError: true, isLoading: false, dataUpdatedAt: 1, data: { items: [TX] } };

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  // URL 殘留會讓 ?triageIdx=N 帶進下一測(元件會 replaceState 持久化位置);
  // jsdom 只允許同 origin,故以當前 origin 重置。
  window.history.replaceState({}, "", window.location.origin + "/");
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container.remove();
});

function mount() {
  root = createRoot(container);
  act(() => {
    root.render(createElement(BankTriagePage, { onExit: () => {} }));
  });
}

/** jsdom 無 TouchEvent 建構子:以泛型 Event 掛 touches,React 讀 nativeEvent.touches。 */
function fireTouch(el: Element, type: "touchstart" | "touchmove" | "touchend", clientX?: number) {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  if (clientX !== undefined) {
    Object.defineProperty(ev, "touches", { value: [{ clientX, clientY: 0 }] });
  }
  act(() => { el.dispatchEvent(ev); });
}

/** 對卡片做一次完整 swipe(距離超過 threshold=100 才觸發寫入路徑)。 */
function swipe(deltaX: number) {
  const card = container.querySelector(".rounded-2xl");
  expect(card, "交易卡必須在畫面上(swipe 目標)").toBeTruthy();
  fireTouch(card!, "touchstart", 200);
  fireTouch(card!, "touchmove", 200 + deltaX);
  fireTouch(card!, "touchend");
}

function clickText(text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  expect(btn, `按鈕「${text}」必須存在`).toBeTruthy();
  act(() => { btn!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
}

describe("BankTriagePage 互動 — fresh:事件真的接上 mutation(非 vacuous 對照組)", () => {
  it("swipe 右(確認 AI)→ mutation 恰一次,payload = {transactionId, category}", () => {
    Q_STATE = { ...FRESH };
    mount();
    swipe(150);
    expect(mutateAsyncSpy).toHaveBeenCalledTimes(1);
    expect(mutateAsyncSpy).toHaveBeenCalledWith({ transactionId: 42, category: "other_review" });
    // 寫入成功 → advance → 單筆 pile 清空畫面
    expect(container.textContent).toContain("全部清完");
  });

  it("swipe 左(排除個人)→ mutation 恰一次,payload = {transactionId, exclude, reason}", () => {
    Q_STATE = { ...FRESH };
    mount();
    swipe(-150);
    expect(mutateAsyncSpy).toHaveBeenCalledTimes(1);
    expect(mutateAsyncSpy).toHaveBeenCalledWith({
      transactionId: 42,
      exclude: true,
      reason: "標為個人 — mobile triage",
    });
  });

  it("點 pill(改類別)→ mutation 恰一次,payload 帶 pill 類別", () => {
    Q_STATE = { ...FRESH };
    mount();
    clickText("供應商付款");
    expect(mutateAsyncSpy).toHaveBeenCalledTimes(1);
    expect(mutateAsyncSpy).toHaveBeenCalledWith({ transactionId: 42, category: "cogs_tour" });
  });

  it("點「確認 AI」按鈕 → mutation 恰一次;swipe 未過 threshold(<100px)不觸發寫入", () => {
    Q_STATE = { ...FRESH };
    mount();
    swipe(60); // 未過 threshold —— 不得寫入
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
    clickText("確認 AI");
    expect(mutateAsyncSpy).toHaveBeenCalledTimes(1);
    expect(mutateAsyncSpy).toHaveBeenCalledWith({ transactionId: 42, category: "other_review" });
  });
});

describe("BankTriagePage 互動 — cached-stale:四條寫入路徑事件後 mutation 零呼叫(禁寫)", () => {
  it("swipe 右(確認)→ mutation 零呼叫 + staleWriteBlocked 提示;卡片不前進", () => {
    Q_STATE = { ...STALE };
    mount();
    expect(container.textContent).toContain("mobile.staleWriteBlocked"); // banner
    swipe(150);
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("mobile.staleWriteBlocked");
    // 被擋的寫入不得 advance:同一張卡(1 / 1 計數器)必須仍在畫面上 ——
    // 只斷言 not「全部清完」可被「advance 到 staleNotice 全屏」繞過,正斷言封死
    expect(container.textContent).toContain("1 / 1");
    expect(container.textContent).not.toContain("全部清完");
  });

  it("swipe 左(排除)→ mutation 零呼叫", () => {
    Q_STATE = { ...STALE };
    mount();
    swipe(-150);
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

  it("點 pill / 確認 AI / 排除個人 → mutation 全零呼叫(disabled 之外 guard 仍擋)", () => {
    Q_STATE = { ...STALE };
    mount();
    clickText("供應商付款");
    clickText("確認 AI");
    clickText("排除個人");
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
  });

  it("「跳過」非寫入路徑:stale 下仍可按,前進但 mutation 零呼叫", () => {
    Q_STATE = { ...STALE };
    mount();
    clickText("跳過");
    expect(mutateAsyncSpy).not.toHaveBeenCalled();
    // 單筆 pile 跳過後 current 變 undefined;stale 下不得顯「全部清完」假 all-clear
    expect(container.textContent).toContain("mobile.staleNotice");
    expect(container.textContent).not.toContain("全部清完");
  });
});
