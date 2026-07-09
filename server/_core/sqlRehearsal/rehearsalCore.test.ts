/**
 * 彩排核心安全鐵則四條的單測(派工單塊 B 驗收項)。
 *
 * 測的是 scripts/sqlRehearsal/rehearsalCore.mjs —— 那支檔會被 orchestrator inline 進
 * 送上 prod 的遠端 blob,所以這裡綠 = 遠端跑的守門邏輯被釘住。純函式、無 DB、無網路。
 */
import { describe, it, expect, vi } from "vitest";
import {
  assertLeadingVerbAllowed,
  assertSingleStatement,
  buildExplainStatement,
  runRehearsal,
} from "../../../scripts/sqlRehearsal/rehearsalCore.mjs";

// 一個假的 mysql2.format:把 ? 依序代入(引號跳脫的細節不是這裡要測的,測的是流程)。
const fakeFormat = (sql: string, params: unknown[]) => {
  let i = 0;
  return sql.replace(/\?/g, () => {
    const v = params[i++];
    return typeof v === "number" ? String(v) : `'${String(v)}'`;
  });
};

describe("鐵則 1 — 正向白名單(擋 EXPLAIN / bare ANALYZE / 非 DML 動詞)", () => {
  it("throws for EXPLAIN- and (關鍵)bare ANALYZE-prefixed statements", () => {
    expect(() => assertLeadingVerbAllowed("EXPLAIN SELECT 1")).toThrow();
    expect(() => assertLeadingVerbAllowed("explain analyze SELECT 1")).toThrow();
    expect(() => assertLeadingVerbAllowed("   EXPLAIN SELECT 1")).toThrow();
    // 對抗審查 finding #1:bare ANALYZE 開頭 + 閘統一加 EXPLAIN = EXPLAIN ANALYZE(真執行 DML)。
    expect(() => assertLeadingVerbAllowed("ANALYZE DELETE FROM bookings WHERE 1=1")).toThrow();
    expect(() => assertLeadingVerbAllowed("analyze table bookings")).toThrow();
  });
  it("throws for non-DML leading verbs and leading comments (SET/USE/CALL/LOAD/前導註解)", () => {
    expect(() => assertLeadingVerbAllowed("SET SESSION x = 1")).toThrow();
    expect(() => assertLeadingVerbAllowed("USE mydb")).toThrow();
    expect(() => assertLeadingVerbAllowed("CALL some_proc()")).toThrow();
    expect(() => assertLeadingVerbAllowed("/*x*/ EXPLAIN ANALYZE SELECT 1")).toThrow();
  });
  it("accepts bare SELECT/INSERT/UPDATE/DELETE/REPLACE/WITH (does not throw)", () => {
    expect(() => assertLeadingVerbAllowed("SELECT 1")).not.toThrow();
    expect(() => assertLeadingVerbAllowed("UPDATE t SET x = 1 WHERE id = 2")).not.toThrow();
    expect(() => assertLeadingVerbAllowed("INSERT INTO t (a) VALUES (?)")).not.toThrow();
    expect(() => assertLeadingVerbAllowed("WITH c AS (SELECT 1) SELECT * FROM c")).not.toThrow();
    // 'explanation' 這種以 explain 為前綴的識別字在 SELECT 後不該誤判
    expect(() => assertLeadingVerbAllowed("SELECT explanation FROM t")).not.toThrow();
  });
});

describe("鐵則 2 — 單語句(內嵌分號一律擋,尾隨一個放行)", () => {
  it("throws when a semicolon appears mid-statement", () => {
    expect(() => assertSingleStatement("SELECT 1; DROP TABLE t")).toThrow();
    expect(() => assertSingleStatement("SELECT 1 ; SELECT 2")).toThrow();
    expect(() => assertSingleStatement("UPDATE t SET x=1; UPDATE t SET y=2;")).toThrow();
  });
  it("accepts a single statement with or without a trailing semicolon", () => {
    expect(() => assertSingleStatement("SELECT 1")).not.toThrow();
    expect(() => assertSingleStatement("SELECT 1;")).not.toThrow();
    expect(() => assertSingleStatement("SELECT 1;   \n")).not.toThrow();
  });
});

describe("buildExplainStatement — 統一加 EXPLAIN + 代入 sampleParams", () => {
  it("prepends EXPLAIN and substitutes params via formatFn", () => {
    const out = buildExplainStatement(
      "SELECT ?, ? WHERE notes LIKE ? ESCAPE ?",
      [1, "x@x.com", "%a%", "!"],
      fakeFormat,
    );
    expect(out.startsWith("EXPLAIN ")).toBe(true);
    expect(out).toContain("ESCAPE '!'");
    expect(out).not.toContain("?"); // 全部 ? 代掉了
  });
  it("rejects an EXPLAIN-prefixed entry (鐵則 1) before formatting", () => {
    expect(() => buildExplainStatement("EXPLAIN ANALYZE SELECT 1", [], fakeFormat)).toThrow(/EXPLAIN/);
  });
  it("rejects a multi-statement entry (鐵則 2)", () => {
    expect(() => buildExplainStatement("SELECT 1; DELETE FROM t", [], fakeFormat)).toThrow(/;/);
  });
});

describe("runRehearsal — 鐵則 3(READ ONLY 先跑)+ 鐵則 4(只回 key/source/error)", () => {
  it("runs setup() BEFORE any EXPLAIN query (READ ONLY session established first)", async () => {
    const order: string[] = [];
    const setup = vi.fn(async () => {
      order.push("setup");
    });
    const queryFn = vi.fn(async (s: string) => {
      order.push("query:" + s.slice(0, 12));
    });
    await runRehearsal({
      entries: [
        { key: "a", source: "f:1", sql: "SELECT 1", sampleParams: [] },
        { key: "b", source: "f:2", sql: "SELECT 2", sampleParams: [] },
      ],
      queryFn,
      formatFn: fakeFormat,
      setup,
    });
    expect(order[0]).toBe("setup"); // setup 一定第一個
    expect(order.slice(1).every((o) => o.startsWith("query:"))).toBe(true);
    expect(setup).toHaveBeenCalledTimes(1);
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("returns only {key,source,error} on failure — never EXPLAIN result rows", async () => {
    const queryFn = vi.fn(async (s: string) => {
      // 假裝 EXPLAIN 對第二條 parse 失敗;成功那條「回結果行」(要被丟掉)
      if (s.includes("BADCOL")) throw new Error("Unknown column 'BADCOL' in 'field list'");
      return [{ id: 1, secretSchemaDetail: "should_never_surface" }];
    });
    const res = await runRehearsal({
      entries: [
        { key: "ok1", source: "f:1", sql: "SELECT 1", sampleParams: [] },
        { key: "bad", source: "f:2", sql: "SELECT BADCOL FROM t", sampleParams: [] },
      ],
      queryFn,
      formatFn: fakeFormat,
      setup: async () => {},
    });
    expect(res.ok).toBe(false);
    expect(res.total).toBe(2);
    expect(res.passed).toBe(1);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]).toEqual({
      key: "bad",
      source: "f:2",
      error: "Unknown column 'BADCOL' in 'field list'",
    });
    // 整個回傳裡不得出現任何結果行的痕跡
    expect(JSON.stringify(res)).not.toContain("secretSchemaDetail");
    expect(JSON.stringify(res)).not.toContain("should_never_surface");
  });

  it("a guard-rejected entry (EXPLAIN-prefixed) is recorded as a failure and its queryFn is NOT called", async () => {
    const queryFn = vi.fn(async () => {});
    const res = await runRehearsal({
      entries: [{ key: "sneaky", source: "f:9", sql: "EXPLAIN ANALYZE SELECT 1", sampleParams: [] }],
      queryFn,
      formatFn: fakeFormat,
      setup: async () => {},
    });
    expect(res.ok).toBe(false);
    expect(res.failures[0].key).toBe("sneaky");
    expect(res.failures[0].error).toMatch(/guard:/);
    expect(queryFn).not.toHaveBeenCalled(); // 被 guard 擋住,沒送到 DB
  });
});
