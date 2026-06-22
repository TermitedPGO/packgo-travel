/**
 * 訂製單狀態機(純函式)測試。design.md §3。
 * 蓋:lifecycle 全表合法/非法、idempotent re-send、payment 只進不退 + 不蓋
 * confirmed+、terminal、needsQuote 分支。
 */

import { describe, it, expect } from "vitest";
import {
  CUSTOM_ORDER_STATUSES,
  canTransition,
  assertTransition,
  statusAfterPayment,
  isTerminal,
  type CustomOrderStatus,
} from "./customOrderStateMachine";

const ALLOWED: Array<[CustomOrderStatus, CustomOrderStatus]> = [
  ["draft", "quoted"],
  ["draft", "arranged"],
  ["draft", "cancelled"],
  ["quoted", "arranged"],
  ["quoted", "cancelled"],
  ["arranged", "confirmed"],
  ["arranged", "cancelled"],
  ["deposit_paid", "confirmed"],
  ["paid", "confirmed"],
  ["confirmed", "departed"],
  ["departed", "completed"],
  ["confirmed", "cancelled"],
];

const FORBIDDEN: Array<[CustomOrderStatus, CustomOrderStatus]> = [
  ["draft", "confirmed"], // must arrange first
  ["draft", "paid"],
  ["quoted", "confirmed"],
  ["completed", "draft"], // terminal, no going back
  ["completed", "cancelled"],
  ["cancelled", "draft"], // terminal
  ["cancelled", "arranged"],
  ["confirmed", "draft"], // no backward
  ["paid", "arranged"],
];

describe("canTransition — lifecycle table", () => {
  it.each(ALLOWED)("allows %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });
  it.each(FORBIDDEN)("forbids %s → %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("assertTransition", () => {
  it("is a no-op for an allowed transition", () => {
    expect(() => assertTransition("arranged", "confirmed")).not.toThrow();
  });
  it("is idempotent for same→same (e.g. re-send quote while quoted)", () => {
    expect(() => assertTransition("quoted", "quoted")).not.toThrow();
  });
  it("throws BAD_REQUEST for an illegal transition", () => {
    expect(() => assertTransition("draft", "confirmed")).toThrow(
      /illegal custom-order transition/,
    );
  });
});

describe("statusAfterPayment — forward-only, never clobbers confirmed+", () => {
  it("deposit from arranged → deposit_paid", () => {
    expect(statusAfterPayment("arranged", "deposit")).toBe("deposit_paid");
  });
  it("balance from deposit_paid → paid", () => {
    expect(statusAfterPayment("deposit_paid", "balance")).toBe("paid");
  });
  it("balance from arranged (pay in full) → paid", () => {
    expect(statusAfterPayment("arranged", "balance")).toBe("paid");
  });
  it("deposit from draft/quoted nudges to deposit_paid", () => {
    expect(statusAfterPayment("draft", "deposit")).toBe("deposit_paid");
    expect(statusAfterPayment("quoted", "deposit")).toBe("deposit_paid");
  });
  it("does not move backward: deposit while already paid keeps paid", () => {
    expect(statusAfterPayment("paid", "deposit")).toBe("paid");
  });
  it("does not clobber confirmed: balance while confirmed keeps confirmed", () => {
    expect(statusAfterPayment("confirmed", "balance")).toBe("confirmed");
  });
  it("does not clobber departed: balance while departed keeps departed", () => {
    expect(statusAfterPayment("departed", "balance")).toBe("departed");
  });
});

describe("isTerminal", () => {
  it("completed and cancelled are terminal", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });
  it("others are not", () => {
    for (const s of CUSTOM_ORDER_STATUSES) {
      if (s === "completed" || s === "cancelled") continue;
      expect(isTerminal(s)).toBe(false);
    }
  });
});

