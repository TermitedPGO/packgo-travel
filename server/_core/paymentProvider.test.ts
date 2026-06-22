/**
 * 金流付款連結介面測試。design.md §4.3 / 決策 D。
 * 本批一律 Manual:createPaymentLink 回 null(Jeff 手貼連結)。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ManualPaymentProvider,
  getPaymentProvider,
  __resetPaymentProvider,
} from "./paymentProvider";

beforeEach(() => __resetPaymentProvider());

describe("ManualPaymentProvider", () => {
  it("createPaymentLink returns null (no auto link this batch)", async () => {
    const p = new ManualPaymentProvider();
    const r = await p.createPaymentLink({
      amountCents: 120000,
      currency: "USD",
      orderNumber: "ORD-2026-0001",
      description: "台灣12天 訂金",
    });
    expect(r).toBeNull();
  });
});

describe("getPaymentProvider", () => {
  it("returns a Manual provider this batch", () => {
    const p = getPaymentProvider();
    expect(p).toBeInstanceOf(ManualPaymentProvider);
  });
  it("memoizes the same instance", () => {
    expect(getPaymentProvider()).toBe(getPaymentProvider());
  });
  it("exposes the PaymentProvider shape", () => {
    expect(typeof getPaymentProvider().createPaymentLink).toBe("function");
  });
});
