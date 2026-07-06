/**
 * caseLessonHarvest tests (批十一 塊B). parseCaseLessons 純函式為主;harvestCaseLessons 用
 * fakeDb + 注入 deidentify(不燒 LLM)驗 dry_run / 冪等 / confirm 三路。deidentifyCaseLessons
 * 的真實 LLM 路照 repo 慣例上線後 prod 驗。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./caseFileImport", () => ({
  caseImportTraceMarker: (f: string) => `匯入自案件資料.md(${f})`,
  escapeLikePattern: (s: string) => s,
  LIKE_ESCAPE_CHAR: "!",
}));
vi.mock("../../drizzle/schema", () => ({
  caseLearnings: { id: "id", sourceFolder: "sourceFolder" },
  customOrders: { id: "id", category: "category", destination: "destination", notes: "notes" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  sql: (strings: TemplateStringsArray, ...v: unknown[]) => ({ _sql: [strings, v] }),
}));

let selectQueue: unknown[][] = [];
const capturedInserts: Record<string, unknown>[] = [];
const fakeDb = {
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []));
    return chain;
  }),
  insert: vi.fn(() => ({ values: vi.fn((v: Record<string, unknown>) => { capturedInserts.push(v); return Promise.resolve([{ insertId: 1 }]); }) })),
};
vi.mock("../db", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { parseCaseLessons, harvestCaseLessons, deidentifyCaseLessons } from "./caseLessonHarvest";

const MD = `# 某案 — 案件資料

## 一、案件概要
| 項目 | 內容 |
|---|---|
| 客人 | 王先生 |

## 二、行程明細
Day 1 接機。

## 八、風險與注意事項
1. Day 2 單程約 10 小時為最長路段,超時費 $60/小時已含全包價
2. 霧中少女號 8 月旺季建議提前網路訂票
3. 短

## 對話經驗(踩坑)
- 供應商 Excel 公式壞掉漏算 $1,108,報價前一定逐日加總驗算
- **纵横** free cancel 截止比給客人的早 3 天,多扛風險要記著
`;

describe("parseCaseLessons — 純解析", () => {
  it("只抽經驗/風險段的條列項,跳過概要/行程段", () => {
    const out = parseCaseLessons(MD);
    expect(out).toContain("Day 2 單程約 10 小時為最長路段,超時費 $60/小時已含全包價");
    expect(out).toContain("霧中少女號 8 月旺季建議提前網路訂票");
    expect(out).toContain("供應商 Excel 公式壞掉漏算 $1,108,報價前一定逐日加總驗算");
    // 概要段的「王先生」不會被當教訓(不是經驗段)
    expect(out.some((l) => l.includes("王先生"))).toBe(false);
    // 過短的「短」被丟
    expect(out).not.toContain("短");
  });

  it("去 markdown 粗體 / 反引號", () => {
    const out = parseCaseLessons(MD);
    expect(out.some((l) => l.includes("**"))).toBe(false);
    expect(out.find((l) => l.includes("纵横"))).toBe("纵横 free cancel 截止比給客人的早 3 天,多扛風險要記著");
  });

  it("沒有經驗段 → 空", () => {
    expect(parseCaseLessons("# 標題\n## 概要\n- 一般內容")).toEqual([]);
  });
});

describe("deidentifyCaseLessons — 邊界", () => {
  it("空候選 → 直接回 [](不呼叫 LLM)", async () => {
    expect(await deidentifyCaseLessons([], { caseType: null, destination: null })).toEqual([]);
  });
});

describe("harvestCaseLessons — dry_run / 冪等 / confirm(注入 de-id)", () => {
  it("dry_run:回候選 + 帶訂單的 caseType/destination/sourceOrderId,不寫入", async () => {
    selectQueue = [
      [], // sourceFolder 冪等查詢:無
      [{ id: 6, category: "quote", destination: "芝加哥" }], // 找到訂單
    ];
    capturedInserts.length = 0;
    const res = await harvestCaseLessons({ folderName: "金宥_芝加哥尼加拉瀑布", markdown: MD }, "dry_run");
    expect(res.status).toBe("dry_run");
    expect(res.sourceOrderId).toBe(6);
    expect(res.caseType).toBe("quote");
    expect(res.destination).toBe("芝加哥");
    expect(res.candidateCount).toBeGreaterThan(0);
    expect(capturedInserts.length).toBe(0);
  });

  it("冪等:sourceFolder 已存在 → already_harvested,不查訂單不寫入", async () => {
    selectQueue = [[{ id: 99 }]]; // 已有列
    capturedInserts.length = 0;
    const res = await harvestCaseLessons({ folderName: "金宥_芝加哥尼加拉瀑布", markdown: MD }, "dry_run");
    expect(res.status).toBe("already_harvested");
    expect(capturedInserts.length).toBe(0);
  });

  it("confirm:注入 de-id → 每條寫一列 caseLearnings(帶 sourceFolder)", async () => {
    selectQueue = [
      [], // 冪等:無
      [{ id: 6, category: "quote", destination: "芝加哥" }], // 訂單
    ];
    capturedInserts.length = 0;
    const fakeDeid = vi.fn(async () => ["某芝加哥包車案:供應商 Excel 公式易壞,報價前逐日加總驗算"]);
    const res = await harvestCaseLessons(
      { folderName: "金宥_芝加哥尼加拉瀑布", markdown: MD },
      "confirm",
      { deidentify: fakeDeid as unknown as typeof deidentifyCaseLessons },
    );
    expect(res.status).toBe("harvested");
    expect(res.written).toBe(1);
    expect(capturedInserts.length).toBe(1);
    expect(capturedInserts[0]).toMatchObject({
      caseType: "quote",
      destination: "芝加哥",
      sourceOrderId: 6,
      sourceFolder: "金宥_芝加哥尼加拉瀑布",
    });
    expect(String(capturedInserts[0].lesson)).not.toContain("王先生");
  });

  it("confirm:blocked 案(無訂單)→ sourceOrderId NULL 仍可寫", async () => {
    selectQueue = [
      [], // 冪等:無
      [], // 無訂單(blocked)
    ];
    capturedInserts.length = 0;
    const fakeDeid = vi.fn(async () => ["某郵輪案:控房確認單有付清版與未付清版,歸檔要對版本"]);
    const res = await harvestCaseLessons(
      { folderName: "三寶寺_舊金山包團", markdown: MD, caseType: "general", destination: "舊金山" },
      "confirm",
      { deidentify: fakeDeid as unknown as typeof deidentifyCaseLessons },
    );
    expect(res.status).toBe("harvested");
    expect(capturedInserts[0]).toMatchObject({ sourceOrderId: null, sourceFolder: "三寶寺_舊金山包團", caseType: "general" });
  });
});
