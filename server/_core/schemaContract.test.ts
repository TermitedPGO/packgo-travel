/**
 * schemaContract.test.ts — 必要表存在契約的純邏輯單測(DB 硬化批)。
 *
 * 不連真 DB:注入一個假的 execute()，回傳「information_schema.tables 查到的表名」列表，
 * 驗 assertSchemaContract 正確算出 missing / ok。
 *
 * 覆蓋:
 *   - 全表都在 → ok:true, missing:[]
 *   - 少一張(模擬事故:tours 被 DROP)→ ok:false, missing 含 tours
 *   - 少多張(事故七表全清)→ missing 精確等於那七張
 *   - db 回 { rows } 形狀(轉接層)也能解析
 *   - REQUIRED_TABLES 自身健全(去重、非空、含事故七表 + 財務紅線表)
 */
import { describe, it, expect, vi } from "vitest";

// drizzle-orm 只用到 sql 標籤模板 —— 回一個 execute 能吞掉的 sentinel。
vi.mock("drizzle-orm", () => ({
  sql: (..._args: unknown[]) => ({ __sql: true }),
}));

import { assertSchemaContract, REQUIRED_TABLES, type SchemaExecutor } from "./schemaContract";

/** 造一個假 db:execute() 回 mysql2 形狀 [rows, fields]，rows = 給定表名。 */
function fakeDbFromTableNames(names: string[], shape: "array" | "rows" = "array"): SchemaExecutor {
  const rows = names.map((t) => ({ t }));
  return {
    execute: vi.fn(async () => (shape === "array" ? [rows, []] : { rows })),
  };
}

describe("assertSchemaContract", () => {
  it("全部必要表都在 → ok:true, missing 空, present == checked", async () => {
    const db = fakeDbFromTableNames([...REQUIRED_TABLES, "someOtherTable"]);
    const res = await assertSchemaContract(db);
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.checkedCount).toBe(REQUIRED_TABLES.length);
    expect(res.presentCount).toBe(REQUIRED_TABLES.length);
  });

  it("tours 被 DROP(單表缺失)→ ok:false, missing 只含 tours", async () => {
    const remaining = REQUIRED_TABLES.filter((t) => t !== "tours");
    const db = fakeDbFromTableNames([...remaining]);
    const res = await assertSchemaContract(db);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(["tours"]);
    expect(res.presentCount).toBe(REQUIRED_TABLES.length - 1);
  });

  it("2026-06-17 事故七表全清 → missing 精確等於那七張(順序照 REQUIRED_TABLES)", async () => {
    const wiped = [
      "tours",
      "bookings",
      "payments",
      "tourDepartures",
      "tourReviews",
      "catalogBatches",
      "toursCatalogArchive",
    ];
    const remaining = REQUIRED_TABLES.filter((t) => !wiped.includes(t));
    const db = fakeDbFromTableNames([...remaining]);
    const res = await assertSchemaContract(db);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(wiped);
    expect(res.presentCount).toBe(REQUIRED_TABLES.length - wiped.length);
  });

  it("空 schema(全表都不在)→ missing == 全部 REQUIRED_TABLES", async () => {
    const db = fakeDbFromTableNames([]);
    const res = await assertSchemaContract(db);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual([...REQUIRED_TABLES]);
    expect(res.presentCount).toBe(0);
  });

  it("db 回 { rows } 形狀(轉接層)也能正確解析", async () => {
    const db = fakeDbFromTableNames([...REQUIRED_TABLES], "rows");
    const res = await assertSchemaContract(db);
    expect(res.ok).toBe(true);
  });

  it("大小寫欄位別名容錯:回 TABLE_NAME(而非別名 t)也能讀到", async () => {
    const rows = REQUIRED_TABLES.map((t) => ({ TABLE_NAME: t }));
    const db: SchemaExecutor = { execute: vi.fn(async () => [rows, []]) };
    const res = await assertSchemaContract(db);
    expect(res.ok).toBe(true);
  });
});

describe("REQUIRED_TABLES 清單健全性", () => {
  it("非空、無重複", () => {
    expect(REQUIRED_TABLES.length).toBeGreaterThan(0);
    expect(new Set(REQUIRED_TABLES).size).toBe(REQUIRED_TABLES.length);
  });

  it("含 2026-06-17 事故七表(回歸守門:別把受害表從契約拿掉)", () => {
    for (const t of [
      "tours",
      "bookings",
      "payments",
      "tourDepartures",
      "tourReviews",
      "catalogBatches",
      "toursCatalogArchive",
    ]) {
      expect(REQUIRED_TABLES).toContain(t);
    }
  });

  it("含財務紅線表與 migration 追蹤表", () => {
    expect(REQUIRED_TABLES).toContain("trustDeferredIncome");
    expect(REQUIRED_TABLES).toContain("bankTransactions");
    expect(REQUIRED_TABLES).toContain("__drizzle_migrations");
  });
});
