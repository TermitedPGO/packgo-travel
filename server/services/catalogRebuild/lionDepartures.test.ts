/**
 * lionDepartures.test — Lion 班期 adapter 純函式測。
 *
 * 紅線(逐條釘):
 *   - 起價取直客價(StraightLowestPrice),同業價(IndustryLowestPrice)絕不出現;
 *   - TWD → USD 換算正確;
 *   - GroupID 校正:代表團取最近未來那顆,不拿最舊/過去那顆;
 *   - 過去班期跳過、無直客價跳過、額滿標 full。
 */

import { describe, it, expect } from "vitest";
import {
  buildLionDepartureFromMirrorRow,
  buildLionDepartures,
  convertLionDeparturesToUsd,
  pickRepresentativeGroupId,
} from "./lionDepartures";

const TODAY_MS = new Date(2026, 5, 1, 0, 0, 0).getTime(); // 2026-06-01 local

// A real-shape Lion mirror departure. Straight(直客)=14,950, Industry(同業/成本)=14,200.
const lionRaw = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    GroupID: "26TS716SL38-T",
    GoDate: "2026/08/16",
    Status: "available",
    StatusText: "可報名",
    StraightLowestPrice: "14,950",
    IndustryLowestPrice: "14,200",
    IsVip: false,
    ...over,
  });

describe("buildLionDepartureFromMirrorRow — 直客價 / 過期 / 額滿", () => {
  it("takes the direct (Straight) retail price, NEVER the industry (agent/cost) price", () => {
    const dep = buildLionDepartureFromMirrorRow(lionRaw(), 3, TODAY_MS)!;
    expect(dep).not.toBeNull();
    expect(dep.adultPriceTwd).toBe(14950); // Straight, comma-parsed
    // The cost price (14200) must not leak into any field.
    expect(dep.adultPriceTwd).not.toBe(14200);
    expect(JSON.stringify(dep)).not.toContain("14200");
    expect(dep.groupId).toBe("26TS716SL38-T");
    // date 2026-08-16 08:00 local; returnDate +（3-1)=+2 → 08-18
    expect(dep.departureDate.getFullYear()).toBe(2026);
    expect(dep.departureDate.getMonth()).toBe(7); // August
    expect(dep.departureDate.getDate()).toBe(16);
    expect(dep.returnDate.getDate()).toBe(18);
  });

  it("skips a past departure", () => {
    expect(
      buildLionDepartureFromMirrorRow(lionRaw({ GoDate: "2026/05/20" }), 3, TODAY_MS),
    ).toBeNull();
  });

  it("skips when the direct price is missing/zero — never falls back to industry price", () => {
    expect(
      buildLionDepartureFromMirrorRow(
        lionRaw({ StraightLowestPrice: "0", IndustryLowestPrice: "14,200" }),
        3,
        TODAY_MS,
      ),
    ).toBeNull();
  });

  it("marks a full departure as full, others as open", () => {
    expect(buildLionDepartureFromMirrorRow(lionRaw({ Status: "full" }), 3, TODAY_MS)!.status).toBe("full");
    expect(buildLionDepartureFromMirrorRow(lionRaw({ Status: "hot" }), 3, TODAY_MS)!.status).toBe("open");
    expect(buildLionDepartureFromMirrorRow(lionRaw({ Status: "available" }), 3, TODAY_MS)!.status).toBe("open");
  });

  it("returns null for unparseable / date-less blobs", () => {
    expect(buildLionDepartureFromMirrorRow(null, 3, TODAY_MS)).toBeNull();
    expect(buildLionDepartureFromMirrorRow("not json", 3, TODAY_MS)).toBeNull();
    expect(buildLionDepartureFromMirrorRow(JSON.stringify({ StraightLowestPrice: "100" }), 3, TODAY_MS)).toBeNull();
  });
});

describe("buildLionDepartures — headline + future count", () => {
  it("headline is the LOWEST direct price across future departures (起價), in TWD", () => {
    const rows = [
      lionRaw({ GoDate: "2026/08/16", StraightLowestPrice: "14,950" }),
      lionRaw({ GoDate: "2026/09/01", StraightLowestPrice: "13,950" }), // lowest
      lionRaw({ GoDate: "2026/05/10", StraightLowestPrice: "9,000" }), // past → excluded
    ];
    const { built, priceRetailTwd, futureCount } = buildLionDepartures(rows, 3, TODAY_MS);
    expect(futureCount).toBe(2);
    expect(priceRetailTwd).toBe(13950);
    expect(built.every((d) => d.adultPriceTwd > 0)).toBe(true);
  });
});

describe("convertLionDeparturesToUsd — TWD → USD 換算", () => {
  it("converts each TWD price to a rounded USD integer at the injected rate", () => {
    const { built } = buildLionDepartures([lionRaw()], 3, TODAY_MS);
    // 1 TWD ≈ 0.0307692 USD (i.e. 32.5 TWD per USD).
    const usd = convertLionDeparturesToUsd(built, 1 / 32.5);
    expect(usd[0].adultPrice).toBe(460); // round(14950 / 32.5) = 460
    // The USD shape is supplier-agnostic BuiltMirrorDeparture — no groupId / TWD carried.
    expect(usd[0]).not.toHaveProperty("groupId");
    expect(usd[0]).not.toHaveProperty("adultPriceTwd");
    expect(usd[0].status).toBe("open");
  });
});

describe("pickRepresentativeGroupId — GroupID 校正到最近未來團", () => {
  it("picks the NEAREST-future group id, not the oldest / a past one", () => {
    const rows = [
      lionRaw({ GoDate: "2026/05/11", GroupID: "26TS511SL38-T", StraightLowestPrice: "9,000" }), // past → excluded
      lionRaw({ GoDate: "2026/09/22", GroupID: "26TS922SL38-T" }), // later future
      lionRaw({ GoDate: "2026/07/16", GroupID: "26TS716SL38-T" }), // nearest future
    ];
    const { built } = buildLionDepartures(rows, 3, TODAY_MS);
    expect(pickRepresentativeGroupId(built)).toBe("26TS716SL38-T");
  });

  it("returns null when there are no future departures", () => {
    const { built } = buildLionDepartures(
      [lionRaw({ GoDate: "2026/01/01", StraightLowestPrice: "9,000" })],
      3,
      TODAY_MS,
    );
    expect(pickRepresentativeGroupId(built)).toBeNull();
  });
});
