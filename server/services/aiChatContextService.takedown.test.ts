/**
 * AI 顧問 catalog enrichment 的下架鎖(TG-R1,P0-1)。
 *
 * 第 1 回合終驗抓到:行程對客下架後,首頁 AI 顧問仍把真實團名、價格、
 * 連結注入 prompt 並要求 AI 引用。本檔鎖:旗標關時 enrichChatContext
 * 對目的地意圖零 DB 查詢、零行程注入;旗標開時照常。
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const getDbSpy = vi.fn(async () => null);
vi.mock("../db", () => ({ getDb: getDbSpy }));

const ORIG = process.env.TOURS_PUBLIC_ENABLED;

describe("aiChatContextService:下架時不推薦行程", () => {
  beforeEach(() => { delete process.env.TOURS_PUBLIC_ENABLED; getDbSpy.mockClear(); });
  afterAll(() => {
    if (ORIG === undefined) delete process.env.TOURS_PUBLIC_ENABLED;
    else process.env.TOURS_PUBLIC_ENABLED = ORIG;
  });

  it("旗標關:目的地意圖不查 DB、不注入任何團", async () => {
    const { enrichChatContext } = await import("./aiChatContextService");
    const r = await enrichChatContext("我想去日本看楓葉,有什麼團?");
    expect(r.matchedTourCount).toBe(0);
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it("trusted admin 旁路(WeChat 後台草稿):旗標關仍可查型錄", async () => {
    const { enrichChatContext } = await import("./aiChatContextService");
    await enrichChatContext("客人想去日本", [], { trustedAdminBypassTourTakedown: true });
    expect(getDbSpy).toHaveBeenCalled();
  });

  it("公開路徑不得旁路:未帶 opts 一律 fail-closed(明文例外的邊界)", async () => {
    const { enrichChatContext } = await import("./aiChatContextService");
    await enrichChatContext("客人想去日本", []);
    await enrichChatContext("客人想去日本", [], {});
    expect(getDbSpy).not.toHaveBeenCalled();
  });

  it("旗標開:目的地意圖會查 DB(對照組,db null 時安全跳過)", async () => {
    process.env.TOURS_PUBLIC_ENABLED = "true";
    const { enrichChatContext } = await import("./aiChatContextService");
    await enrichChatContext("我想去日本看楓葉,有什麼團?");
    expect(getDbSpy).toHaveBeenCalled();
  });
});
