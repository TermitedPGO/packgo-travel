/**
 * Tests for workspaceSuppliers.helpers (批5 m1) — real implementations,
 * not re-implemented copies.
 */
import { describe, it, expect } from "vitest";
import {
  runStateOf,
  latestRunBySupplier,
  fmtDuration,
  monitorCardKind,
  priceDeltaPct,
} from "./workspaceSuppliers.helpers";

describe("runStateOf (m1)", () => {
  it("running → running", () => expect(runStateOf("running")).toBe("running"));
  it("success → done", () => expect(runStateOf("success")).toBe("done"));
  it("failed → err", () => expect(runStateOf("failed")).toBe("err"));
  it("partial → err (visible, not silently ok)", () =>
    expect(runStateOf("partial")).toBe("err"));
  it("unknown → none", () => expect(runStateOf("xyz")).toBe("none"));
});

describe("latestRunBySupplier (m1)", () => {
  it("picks first (newest) run per supplier from desc-sorted list", () => {
    const runs = [
      { id: 9, supplierCode: "lion", startedAt: "2026-06-11T04:00:00Z" },
      { id: 8, supplierCode: "uv", startedAt: "2026-06-11T03:55:00Z" },
      { id: 7, supplierCode: "lion", startedAt: "2026-06-10T04:00:00Z" },
      { id: 6, supplierCode: "uv", startedAt: "2026-06-10T03:55:00Z" },
    ];
    const latest = latestRunBySupplier(runs);
    expect(latest["lion"].id).toBe(9);
    expect(latest["uv"].id).toBe(8);
  });

  it("empty list → empty record", () => {
    expect(latestRunBySupplier([])).toEqual({});
  });
});

describe("fmtDuration (m1)", () => {
  it("sub-10s shows one decimal", () => expect(fmtDuration(900)).toBe("0.9s"));
  it("sub-minute rounds to seconds", () =>
    expect(fmtDuration(12_000)).toBe("12s"));
  it("over a minute shows m+s", () => expect(fmtDuration(95_000)).toBe("1m35s"));
  it("null/undefined → empty", () => {
    expect(fmtDuration(null)).toBe("");
    expect(fmtDuration(undefined)).toBe("");
  });
  it("negative → empty (bad data stays honest)", () =>
    expect(fmtDuration(-5)).toBe(""));
});

describe("monitorCardKind (m2)", () => {
  const base = {
    status: "success",
    priceChanged: 0,
    previousStatus: "open",
    currentStatus: "open",
    seatsChanged: 0,
    hasChanges: 0,
  };

  it("failed check → error even with changes recorded", () => {
    expect(
      monitorCardKind({ ...base, status: "failed", priceChanged: 1 }),
    ).toBe("error");
  });

  it("price change outranks generic change", () => {
    expect(
      monitorCardKind({ ...base, priceChanged: 1, hasChanges: 1 }),
    ).toBe("price");
  });

  it("newly soldout → soldout", () => {
    expect(
      monitorCardKind({
        ...base,
        previousStatus: "open",
        currentStatus: "soldout",
      }),
    ).toBe("soldout");
  });

  it("already-soldout stays generic (no repeat alarm)", () => {
    expect(
      monitorCardKind({
        ...base,
        previousStatus: "soldout",
        currentStatus: "soldout",
        hasChanges: 1,
      }),
    ).toBe("change");
  });

  it("seats change → change", () => {
    expect(monitorCardKind({ ...base, seatsChanged: 1 })).toBe("change");
  });

  it("clean check → ok (filtered out of cards)", () => {
    expect(monitorCardKind(base)).toBe("ok");
  });
});

describe("priceDeltaPct (m2)", () => {
  it("computes rounded percent", () => {
    expect(priceDeltaPct(1315, 1420)).toBe(8);
  });
  it("negative delta", () => {
    expect(priceDeltaPct(1000, 900)).toBe(-10);
  });
  it("null when prev missing or zero", () => {
    expect(priceDeltaPct(null, 1420)).toBeNull();
    expect(priceDeltaPct(0, 1420)).toBeNull();
  });
  it("null when curr missing", () => {
    expect(priceDeltaPct(1315, null)).toBeNull();
  });
});
