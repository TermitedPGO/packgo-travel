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
  buildListProductsInput,
  EMPTY_CATALOG_FILTERS,
  enrichmentPct,
  groupRecentAlerts,
  alertRuleClass,
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

describe("buildListProductsInput (m3)", () => {
  it("empty filters → only paging + notYetImported", () => {
    const out = buildListProductsInput(EMPTY_CATALOG_FILTERS, 1);
    expect(out).toEqual({
      supplierCode: undefined,
      keyword: undefined,
      destinationCountry: undefined,
      daysMin: undefined,
      daysMax: undefined,
      notYetImported: false,
      page: 1,
      pageSize: 25,
    });
  });

  it("trims keyword and drops whitespace-only strings", () => {
    const out = buildListProductsInput(
      { ...EMPTY_CATALOG_FILTERS, keyword: "  京阪神 ", destinationCountry: "   " },
      2,
    );
    expect(out.keyword).toBe("京阪神");
    expect(out.destinationCountry).toBeUndefined();
    expect(out.page).toBe(2);
  });

  it("parses valid day bounds, drops junk and out-of-range", () => {
    const ok = buildListProductsInput(
      { ...EMPTY_CATALOG_FILTERS, daysMin: "3", daysMax: "10" },
      1,
    );
    expect(ok.daysMin).toBe(3);
    expect(ok.daysMax).toBe(10);

    const junk = buildListProductsInput(
      { ...EMPTY_CATALOG_FILTERS, daysMin: "abc", daysMax: "99" },
      1,
    );
    expect(junk.daysMin).toBeUndefined();
    expect(junk.daysMax).toBeUndefined(); // 99 > 60 cap
  });

  it("passes supplierCode through when set", () => {
    const out = buildListProductsInput(
      { ...EMPTY_CATALOG_FILTERS, supplierCode: "lion", notYetImported: true },
      1,
    );
    expect(out.supplierCode).toBe("lion");
    expect(out.notYetImported).toBe(true);
  });
});

describe("enrichmentPct (m3)", () => {
  it("normal ratio", () => expect(enrichmentPct(50, 200)).toBe(25));
  it("total=0 → 0 (no NaN)", () => expect(enrichmentPct(0, 0)).toBe(0));
  it("clamps over-100 (stale counts)", () =>
    expect(enrichmentPct(210, 200)).toBe(100));
});

describe("groupRecentAlerts (m4)", () => {
  const NOW = new Date("2026-06-11T12:00:00Z").getTime();
  const d = (daysAgo: number) =>
    new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  it("counts per type within 7 days, drops older", () => {
    const out = groupRecentAlerts(
      [
        { alertType: "price_drop", createdAt: d(1) },
        { alertType: "price_drop", createdAt: d(3) },
        { alertType: "sold_out", createdAt: d(6) },
        { alertType: "price_drop", createdAt: d(10) }, // outside window
      ],
      7,
      NOW,
    );
    expect(out.byType).toEqual({ price_drop: 2, sold_out: 1 });
    expect(out.total).toBe(3);
  });

  it("future-dated rows still count (clock skew must not hide alerts)", () => {
    const out = groupRecentAlerts(
      [{ alertType: "guaranteed", createdAt: d(-1) }],
      7,
      NOW,
    );
    expect(out.total).toBe(1);
  });

  it("invalid dates dropped, empty list safe", () => {
    expect(
      groupRecentAlerts([{ alertType: "x", createdAt: "garbage" }], 7, NOW)
        .total,
    ).toBe(0);
    expect(groupRecentAlerts([], 7, NOW).total).toBe(0);
  });
});

describe("alertRuleClass (m4)", () => {
  it("critical → 4px", () => expect(alertRuleClass("critical")).toBe("border-l-4"));
  it("warning → 3px", () =>
    expect(alertRuleClass("warning")).toBe("border-l-[3px]"));
  it("info → 1px", () => expect(alertRuleClass("info")).toBe("border-l"));
});
