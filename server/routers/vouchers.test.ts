/**
 * Smoke test for Phase 4D · vouchers sub-router extraction.
 *
 * Verifies the extracted router module loads cleanly + exposes the 5
 * procedures originally at server/routers.ts L937-1102. This is the
 * structural regression anchor for the Phase 4D money-path split.
 *
 * Behavioral coverage for voucher issue / redeem (idempotency, gate
 * evaluation, expiry handling) lives in server/_core/vouchers.test.ts.
 */
import { describe, it, expect } from "vitest";
import { vouchersRouter } from "./vouchers";

describe("vouchersRouter (Phase 4D extraction)", () => {
  it("exposes all 5 procedures from the pre-split source", () => {
    const procs = Object.keys((vouchersRouter as any)._def.procedures);
    expect(procs.sort()).toEqual(
      ["catalog", "redeem", "myVouchers", "adminList", "adminMarkRedeemed"].sort(),
    );
  });
});
