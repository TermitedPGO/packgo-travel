/**
 * retailOnlyEndpoints.regression — 紅線回歸鎖(DB-free)。
 *
 * 成本(agentPrice = Lion 同業價)只活在供應商鏡像 `supplierDepartures`。客人頁 / 端點
 * 絕不能讀到它。這支用兩道結構性鎖,免真 DB 就把它焊住:
 *
 *   1. schema 層:客人表(tours / tourDepartures)的「欄位名」過 findCostLeaks → 必須乾淨;
 *      正控:鏡像表 supplierDepartures 必須被抓出 agentPrice / spareSeats(證明 guard 有效)。
 *   2. source 層:客人 router(departures.ts / toursRead.ts)原始碼不得出現 supplierDepartures
 *      / agentPrice 字樣(= 只讀安全的 tourDepartures / tours)。
 *
 * 任何人哪天把 agentPrice 加進客人表、或讓客人 router 去 join 鏡像表,這裡就紅。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";
import {
  tours,
  tourDepartures,
  supplierDepartures,
} from "../../../drizzle/schema";
import { findCostLeaks } from "./guard";

/** 把一張表的欄位名組成 { col: true } payload,丟給 cost-leak walker 掃。 */
function columnNamesPayload(table: unknown): Record<string, true> {
  const cols = Object.keys(getTableColumns(table as never));
  return Object.fromEntries(cols.map((c) => [c, true]));
}

describe("retail-only · schema 層:客人表無成本欄", () => {
  it("tours 無 agentPrice / cost / spareSeats 欄", () => {
    expect(findCostLeaks(columnNamesPayload(tours))).toEqual([]);
  });

  it("tourDepartures(客人班期)無 agentPrice / cost / spareSeats 欄", () => {
    expect(findCostLeaks(columnNamesPayload(tourDepartures))).toEqual([]);
  });

  it("正控:supplierDepartures(鏡像)的成本欄會被 guard 抓出", () => {
    const leaks = findCostLeaks(columnNamesPayload(supplierDepartures));
    expect(leaks.length).toBeGreaterThan(0);
    const joined = leaks.join(",").toLowerCase();
    expect(joined).toContain("agentprice");
    expect(joined).toContain("spareseats");
  });
});

describe("retail-only · source 層:客人 router 不讀鏡像成本表", () => {
  for (const file of ["departures.ts", "toursRead.ts"]) {
    it(`${file} 原始碼不出現 supplierDepartures / agentPrice`, () => {
      const src = readFileSync(
        new URL(`../../routers/${file}`, import.meta.url),
        "utf8",
      );
      expect(src).not.toMatch(/supplierDepartures/);
      expect(src).not.toMatch(/agentPrice/);
    });
  }
});
