// 批十三-1 (P2) — fetchRecentGeneratedAttachments 附件跟措辭脫鉤。重點:這支不吃草稿
// 文案(簽名裡根本沒有 body 參數),所以「不含『附上』字樣的草稿也掛得上」是結構性保證。
// 用 field-shape mock db(同 followupDraftProducer.test 的 makeDb 手法),不連真 DB。
import { describe, it, expect } from "vitest";
import { fetchRecentGeneratedAttachments } from "./followupDraftOnDemand";
import type { Db } from "../../_core/followupScan";

// select().from().where().orderBy().limit() 回傳 canned rows;drizzle eq/and/desc 只建 SQL,
// mock 一律忽略、直接吐 rows。
const makeDocDb = (rows: unknown[]): Db =>
  ({
    select: () => {
      const chain: Record<string, unknown> = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: async () => rows,
      };
      return chain;
    },
  }) as unknown as Db;

describe("fetchRecentGeneratedAttachments — 批十三-1 附件跟措辭脫鉤", () => {
  const NOW = new Date("2026-07-07T10:00:00Z").getTime();
  const WIN = 30 * 60 * 1000;

  it("30 分內最新一份 generated PDF 撈得到(簽名無 body → 不看任何文案)", async () => {
    const out = await fetchRecentGeneratedAttachments(
      makeDocDb([
        {
          r2Url: "reply-attachments/7/generated-100-quote_summary.pdf",
          fileName: "報價摘要_20260707.pdf",
          createdAt: new Date(NOW - 3 * 60_000),
        },
      ]),
      7,
      NOW,
      WIN,
    );
    expect(out).toEqual([
      { key: "reply-attachments/7/generated-100-quote_summary.pdf", filename: "報價摘要_20260707.pdf" },
    ]);
  });

  it("兩份都在窗內時只掛最新一份(一封信一份)", async () => {
    const out = await fetchRecentGeneratedAttachments(
      makeDocDb([
        {
          r2Url: "reply-attachments/7/generated-200-payment_request.pdf",
          fileName: "請款.pdf",
          createdAt: new Date(NOW - 2 * 60_000),
        },
        {
          r2Url: "reply-attachments/7/generated-100-quote_summary.pdf",
          fileName: "報價.pdf",
          createdAt: new Date(NOW - 20 * 60_000),
        },
      ]),
      7,
      NOW,
      WIN,
    );
    expect(out).toEqual([
      { key: "reply-attachments/7/generated-200-payment_request.pdf", filename: "請款.pdf" },
    ]);
  });

  it("超過視窗(30 分外)的舊文件不掛", async () => {
    const out = await fetchRecentGeneratedAttachments(
      makeDocDb([
        {
          r2Url: "reply-attachments/7/generated-100-quote_summary.pdf",
          fileName: "報價.pdf",
          createdAt: new Date(NOW - 60 * 60_000),
        },
      ]),
      7,
      NOW,
      WIN,
    );
    expect(out).toEqual([]);
  });

  it("沒有 generated 文件 → 回 []", async () => {
    const out = await fetchRecentGeneratedAttachments(makeDocDb([]), 7, NOW, WIN);
    expect(out).toEqual([]);
  });

  it("查詢失敗 → 回 [](best-effort,永不炸)", async () => {
    const badDb = {
      select: () => {
        throw new Error("db down");
      },
    } as unknown as Db;
    await expect(fetchRecentGeneratedAttachments(badDb, 7, NOW, WIN)).resolves.toEqual([]);
  });
});
