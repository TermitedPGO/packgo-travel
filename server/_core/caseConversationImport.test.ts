/**
 * caseConversationImport tests (批十一 塊C). isConversationCandidate 純函式 + 協調層(fakeDb +
 * mock importChatLogForCustomer)。日期/認人/去重的安全機制在 chatLogImport 已測,這裡只驗
 * 「解析客人卡 + 只餵對話候選檔 + 聚合」的薄協調層。
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./logger", () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("./caseFileImport", () => ({
  caseImportTraceMarker: (f: string) => `匯入自案件資料.md(${f})`,
  escapeLikePattern: (s: string) => s,
  LIKE_ESCAPE_CHAR: "!",
}));
const importChatLogMock = vi.fn();
vi.mock("./chatLogImport", () => ({
  importChatLogForCustomer: (...a: unknown[]) => importChatLogMock(...a),
}));
vi.mock("../../drizzle/schema", () => ({
  customOrders: { id: "id", customerProfileId: "customerProfileId", notes: "notes" },
  customerProfiles: { id: "id", name: "name" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => ({ _eq: a }),
  sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ _sql: [s, v] }),
}));

let selectQueue: unknown[][] = [];
const fakeDb = {
  select: vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.limit = vi.fn(() => Promise.resolve(selectQueue.shift() ?? []));
    return chain;
  }),
};
vi.mock("../db", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { isConversationCandidate, fileExtLower, importCaseConversations } from "./caseConversationImport";

describe("isConversationCandidate / fileExtLower", () => {
  it(".txt / .md 是候選;pdf/xlsx/隱藏檔不是", () => {
    expect(isConversationCandidate("David_出票進度與訊息_20260626.md")).toBe(true);
    expect(isConversationCandidate("微信對話.txt")).toBe(true);
    expect(isConversationCandidate("纵横_Invoice.pdf")).toBe(false);
    expect(isConversationCandidate("報價.xlsx")).toBe(false);
    expect(isConversationCandidate(".DS_Store")).toBe(false);
    expect(isConversationCandidate(".hidden.md")).toBe(false);
    expect(fileExtLower("a.MD")).toBe(".md");
  });
});

describe("importCaseConversations — 協調", () => {
  it("找不到訂單 → case_not_imported,不餵任何檔", async () => {
    selectQueue = [[]]; // 無訂單
    importChatLogMock.mockClear();
    const res = await importCaseConversations(
      { folderName: "金宥_芝加哥尼加拉瀑布", files: [{ name: "a.md", text: "hi" }] },
      "dry_run",
    );
    expect(res.status).toBe("case_not_imported");
    expect(importChatLogMock).not.toHaveBeenCalled();
  });

  it("有訂單:只餵對話候選檔(.txt/.md),跳過 pdf,聚合結果", async () => {
    selectQueue = [
      [{ customerProfileId: 2760049 }], // 訂單
      [{ name: "HUANG DAVID" }], // 客人卡名
    ];
    importChatLogMock.mockReset();
    importChatLogMock
      .mockResolvedValueOnce({ status: "imported", dryRun: true, importedCount: 3 }) // .md
      .mockResolvedValueOnce({ status: "not_a_chat_log" }); // 另一個 .md
    const res = await importCaseConversations(
      {
        folderName: "David_中國行",
        files: [
          { name: "David_出票進度與訊息.md", text: "6/23 客人問..." },
          { name: "David_國內段_Trip訂單.pdf", text: "PDFBYTES" }, // 非候選 → 跳過
          { name: "David_機票追價.md", text: "純筆記" },
        ],
      },
      "dry_run",
    );
    expect(res.status).toBe("done");
    expect(res.profileId).toBe(2760049);
    expect(res.customerName).toBe("HUANG DAVID");
    // 只有兩個 .md 被餵(pdf 跳過)
    expect(importChatLogMock).toHaveBeenCalledTimes(2);
    expect(res.files?.map((f) => f.name)).toEqual(["David_出票進度與訊息.md", "David_機票追價.md"]);
    expect(res.files?.[0]).toMatchObject({ status: "imported", dryRun: true, importedCount: 3 });
    expect(res.files?.[1]).toMatchObject({ status: "not_a_chat_log" });
  });

  it("confirm:實際寫入的(非 dryRun)importedCount 加總進 totalImported", async () => {
    selectQueue = [[{ customerProfileId: 2760049 }], [{ name: null }]];
    importChatLogMock.mockReset();
    importChatLogMock.mockResolvedValueOnce({ status: "imported", importedCount: 5 });
    const res = await importCaseConversations(
      { folderName: "David_中國行", files: [{ name: "log.txt", text: "..." }] },
      "confirm",
    );
    expect(res.totalImported).toBe(5);
  });
});
