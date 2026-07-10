/**
 * FinanceCockpit 設計紀律靜態斷言(F3 塊D 視覺驗收 fallback)。
 *
 * 本機起不了 dev server(無 DATABASE_URL),無法截圖與 B-final 並排 ——
 * 誠實申報用源碼級斷言鎖住四條可機檢的設計裁決(f1-acceptance / memory):
 *   1. 狀態色 = dot + 文字色,不做背景填色(禁 bg-{狀態色}-50 pill)
 *   2. serif 只准 PageHeader H1(本目錄元件不得自帶 serif)
 *   3. 全部圓角(禁 rounded-none)
 *   4. 負值 / 危險色用 red-700(B-final #c10007),不用 rose
 * 像素級對比(間距 / 字級)仍需 prod 截圖,total T6 已申報。
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));
const sources = files.map((f) => ({ name: f, text: readFileSync(join(dir, f), "utf8") }));

describe("FinanceCockpit 設計紀律(源碼級)", () => {
  it("讀到元件檔(防呆:目錄搬家時本測試不可默默變空轉)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("狀態色不做背景填色:禁 bg-amber/emerald/rose/red-50 類 pill 底色", () => {
    const offenders: string[] = [];
    for (const s of sources) {
      const m = s.text.match(/bg-(amber|emerald|rose|red)-(50|100)\b/g);
      if (m) offenders.push(s.name + ": " + m.join(", "));
    }
    expect(offenders).toEqual([]);
  });

  it("serif 只准 PageHeader H1:本目錄元件不得自帶 serif 字體", () => {
    const offenders = sources
      .filter((s) => /font-serif|Noto Serif/.test(s.text))
      .map((s) => s.name);
    expect(offenders).toEqual([]);
  });

  it("全部圓角:禁 rounded-none", () => {
    const offenders = sources.filter((s) => /rounded-none/.test(s.text)).map((s) => s.name);
    expect(offenders).toEqual([]);
  });

  it("負值 / 危險色用 red(B-final #c10007),不用 rose", () => {
    const offenders: string[] = [];
    for (const s of sources) {
      const m = s.text.match(/(?:text|bg|border)-rose-\d+/g);
      if (m) offenders.push(s.name + ": " + m.join(", "));
    }
    expect(offenders).toEqual([]);
  });
});
