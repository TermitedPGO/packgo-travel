/**
 * Tests for workspaceSuppliers.helpers (批5 m1) — real implementations,
 * not re-implemented copies.
 */
import { describe, it, expect } from "vitest";
import {
  runStateOf,
  latestRunBySupplier,
  fmtDuration,
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
