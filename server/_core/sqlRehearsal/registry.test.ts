/**
 * registry.test.ts — 登記表自驗(硬化戰役 Wave 2 塊 A 驗收項)。
 *
 * 不連 DB、不 mock:純檢查登記表資料本身的自洽性,尤其「每條 sampleParams 數量 ==
 * sql 內 ? 佔位符數」—— 數量不符,ship 前的彩排在 mysql2.format 代參數時就會錯位,
 * 這裡先紅。順帶把「裸語句(不含 EXPLAIN 前綴、單語句)」的約束也釘住,跟遠端閘的
 * 安全鐵則 1/2 同口徑,雙保險。
 */
import { describe, it, expect } from "vitest";
import { getRegistry, countPlaceholders } from "./registry";

const { entries, whitelist } = getRegistry();

describe("SQL 彩排登記表自驗(Wave2 塊 A)", () => {
  it("有條目(sanity)", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it("每條 sampleParams 數量 == sql 內 ? 佔位符數", () => {
    const mismatches = entries
      .filter((e) => countPlaceholders(e.sql) !== e.sampleParams.length)
      .map(
        (e) =>
          `${e.key} (${e.sources[0]}): sql 有 ${countPlaceholders(e.sql)} 個 ?,但 sampleParams 有 ${e.sampleParams.length} 個` +
          (e.sql.includes("'?'") || /'[^']*\?[^']*'/.test(e.sql)
            ? "  ← 疑似字串字面內夾了字面 ?(mysql2.format 會連它一起代入 → 錯位;把字串內的 ? 換成無害字元)"
            : ""),
      );
    expect(mismatches, `sampleParams 數量對不上 ? 佔位符:\n${mismatches.join("\n")}`).toEqual([]);
  });

  it("key 全表唯一", () => {
    const seen = new Map<string, number>();
    for (const e of entries) seen.set(e.key, (seen.get(e.key) ?? 0) + 1);
    const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
    expect(dups, `重複 key:\n${dups.join("\n")}`).toEqual([]);
  });

  it("sql 是裸語句:不以 EXPLAIN 開頭(對齊遠端閘鐵則 1)", () => {
    const bad = entries.filter((e) => /^\s*explain\b/i.test(e.sql)).map((e) => e.key);
    expect(bad, `這些條目以 EXPLAIN 開頭(前綴由閘統一加,登記表不准自帶):\n${bad.join("\n")}`).toEqual(
      [],
    );
  });

  it("sql 是單語句:無內嵌分號(尾隨一個除外,對齊遠端閘鐵則 2)", () => {
    const bad = entries
      .filter((e) => {
        const t = e.sql.replace(/\s+$/, "");
        const body = t.endsWith(";") ? t.slice(0, -1) : t;
        return body.includes(";");
      })
      .map((e) => `${e.key} (${e.sources[0]})`);
    expect(bad, `這些條目含內嵌分號(多語句):\n${bad.join("\n")}`).toEqual([]);
  });

  it("sql 以 DML/SELECT 關鍵字開頭(bare statement sanity)", () => {
    const KW = /^\s*(SELECT|UPDATE|INSERT|DELETE|REPLACE|WITH)\b/i;
    const bad = entries.filter((e) => !KW.test(e.sql)).map((e) => `${e.key}: ${e.sql.slice(0, 40)}`);
    expect(bad, `這些條目不像獨立語句(該是 B 類包住片段的整條 query?):\n${bad.join("\n")}`).toEqual([]);
  });

  it("每條 sources 非空且格式為 path:line", () => {
    const bad: string[] = [];
    for (const e of entries) {
      if (!e.sources.length) bad.push(`${e.key}: sources 空`);
      for (const s of e.sources)
        if (!/^server\/.+\.ts:\d+$/.test(s)) bad.push(`${e.key}: source 格式怪 "${s}"`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("cls 只有 A / B", () => {
    const bad = entries.filter((e) => e.cls !== "A" && e.cls !== "B").map((e) => e.key);
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("白名單 source 格式正確且不重複", () => {
    const seen = new Set<string>();
    const bad: string[] = [];
    for (const w of whitelist) {
      if (!/^server\/.+\.ts:\d+$/.test(w.source)) bad.push(`格式怪 "${w.source}"`);
      if (!w.reason?.trim()) bad.push(`${w.source}: 理由空`);
      if (seen.has(w.source)) bad.push(`${w.source}: 重複`);
      seen.add(w.source);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("同一 source 不會同時在 entries 與 whitelist(不重複歸屬)", () => {
    const inEntries = new Set<string>();
    for (const e of entries) for (const s of e.sources) inEntries.add(s);
    const both = whitelist.filter((w) => inEntries.has(w.source)).map((w) => w.source);
    expect(both, `這些 source 同時被登記與白名單:\n${both.join("\n")}`).toEqual([]);
  });
});
