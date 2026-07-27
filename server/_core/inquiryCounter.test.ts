/**
 * inquiryCounter 行為測試(2026-07-26 R3,返工單第 1 項)。
 *
 * R2 只做了搬移沒有測 DB update;本檔用 mock db 實測三種行為:
 * 已知使用者真的 +1、未知使用者零寫入、DB 掛掉不擋管線(non-fatal)。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
const state: { rows: Array<{ id: number }>; updateCalls: number; throwOnSelect: boolean } = {
  rows: [], updateCalls: 0, throwOnSelect: false,
};
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (state.throwOnSelect) throw new Error("db down");
            return state.rows;
          },
        }),
      }),
    }),
    update: () => {
      state.updateCalls += 1;
      return { set: updateSet };
    },
  })),
}));

import { recordInquiry } from "./inquiryCounter";

describe("inquiryCounter.recordInquiry", () => {
  beforeEach(() => {
    state.rows = []; state.updateCalls = 0; state.throwOnSelect = false;
    updateSet.mockClear();
  });

  it("已知使用者:inquiryCount +1 且 lastInquiryAt 更新", async () => {
    state.rows = [{ id: 42 }];
    const r = await recordInquiry({ senderEmail: "Jeff@Example.com" });
    expect(r).toEqual({ recorded: true, reason: "recorded" });
    expect(state.updateCalls).toBe(1);
    const setArg = updateSet.mock.calls[0][0];
    expect(setArg).toHaveProperty("inquiryCount");
    expect(setArg.lastInquiryAt).toBeInstanceOf(Date);
  });

  it("未知使用者:no-op,零寫入", async () => {
    const r = await recordInquiry({ senderEmail: "stranger@example.com" });
    expect(r).toEqual({ recorded: false, reason: "user_not_found" });
    expect(state.updateCalls).toBe(0);
  });

  it("DB 錯誤:non-fatal,不拋出", async () => {
    state.throwOnSelect = true;
    const r = await recordInquiry({ senderEmail: "jeff@example.com" });
    expect(r).toEqual({ recorded: false, reason: "error" });
  });

  it("空 email:no-op", async () => {
    const r = await recordInquiry({ senderEmail: "  " });
    expect(r).toEqual({ recorded: false, reason: "no_email" });
  });
});
