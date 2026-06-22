// server/routers/customOrderStateMachine.ts — 訂製單狀態機(純函式,無 DB)。
//
// 設計:docs/features/custom-orders/design.md §3。重點:把「生命週期 lifecycle」和
// 「收款 payment」拆成兩個維度。
//   - lifecycle(canTransition / TRANSITIONS):draft→quoted→arranged→confirmed→
//     departed→completed,或任何非終態 → cancelled。報價可選(needsQuote=0 走
//     draft→arranged)。送報價/送確認書/出發/結案/取消都是 lifecycle 轉移。
//   - payment(statusAfterPayment):收款的「真相」是 depositPaidAt/balancePaidAt
//     時間戳(recordPayment 一定寫)。status 只是順手往前推的視覺狀態,只進不退,
//     且不會蓋掉已經 confirmed 之後的生命週期狀態。這樣「先發確認書、後收尾款」
//     不會撞到非法轉移。
//
// 這層不做 Trust 分錄、不碰營收認列(§17550),只回「該設成什麼 status」。

import { TRPCError } from "@trpc/server";

export const CUSTOM_ORDER_STATUSES = [
  "draft",
  "quoted",
  "arranged",
  "deposit_paid",
  "paid",
  "confirmed",
  "departed",
  "completed",
  "cancelled",
] as const;
export type CustomOrderStatus = (typeof CUSTOM_ORDER_STATUSES)[number];

export type PaymentKind = "deposit" | "balance";

/**
 * Lifecycle transitions. Payment moves (→deposit_paid / →paid) are intentionally
 * NOT here — those go through statusAfterPayment, because the money truth is the
 * timestamp, not the status. Terminal states (completed / cancelled) have none.
 */
const TRANSITIONS: Record<CustomOrderStatus, CustomOrderStatus[]> = {
  draft: ["quoted", "arranged", "cancelled"],
  quoted: ["arranged", "cancelled"],
  arranged: ["confirmed", "cancelled"],
  deposit_paid: ["confirmed", "cancelled"],
  paid: ["confirmed", "cancelled"],
  confirmed: ["departed", "cancelled"],
  departed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Forward rank for the payment nudge. cancelled is terminal, ranked -1. */
const STATUS_RANK: Record<CustomOrderStatus, number> = {
  draft: 0,
  quoted: 1,
  arranged: 2,
  deposit_paid: 3,
  paid: 4,
  confirmed: 5,
  departed: 6,
  completed: 7,
  cancelled: -1,
};

export function isTerminal(status: CustomOrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export function canTransition(
  from: CustomOrderStatus,
  to: CustomOrderStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throw a tRPC BAD_REQUEST when a lifecycle move is not allowed. */
export function assertTransition(
  from: CustomOrderStatus,
  to: CustomOrderStatus,
): void {
  if (from === to) return; // idempotent re-send (e.g. re-send quote while quoted)
  if (!canTransition(from, to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `illegal custom-order transition: ${from} → ${to}`,
    });
  }
}

/**
 * The status to set after recording a payment. Money truth (the paid-at
 * timestamp) is always written by the caller regardless of this. This only
 * nudges the visible status FORWARD and never:
 *   - moves backward (record deposit while already 'paid' keeps 'paid'),
 *   - clobbers a later lifecycle state (record balance while 'confirmed'/
 *     'departed' keeps that state — the timestamp still lands).
 * Recording a payment on a terminal order is rejected by the caller, not here.
 */
export function statusAfterPayment(
  current: CustomOrderStatus,
  kind: PaymentKind,
): CustomOrderStatus {
  const paymentState: CustomOrderStatus =
    kind === "deposit" ? "deposit_paid" : "paid";
  // Don't override confirmed or later (payment can legitimately trail the
  // confirmation). The timestamp captures the money fact either way.
  if (STATUS_RANK[current] >= STATUS_RANK["confirmed"]) return current;
  // Forward-only.
  return STATUS_RANK[paymentState] > STATUS_RANK[current] ? paymentState : current;
}
