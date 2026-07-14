/**
 * gmailAuthoritativeGate — 實機閘斷言(Codex 17 輪 §五.1)。這裡 NOT mocked:直接跑
 * production 的 isGmailAuthoritativeApproved(),釘死它硬回 false。gmailHistorySync.test.ts
 * 那批 feed-path 測試把閘 mock 為 true 以守護 feed 碼;此檔守護「預設姿態就是 fail-closed」
 * ——若有人把閘翻成 true(等同放行客戶可見副作用),這裡先紅。翻閘 = 獨立設計批,需 outbox/
 * 冪等鍵機械證據 + Codex 裁定 + Jeff 核准,並同步改本測試。
 *
 * 對照先例:trustTransferWriteGate 的 isTrustTransferWriteApproved() === false 亦以
 * 未 mock 的整合測試釘死(server/trustRecognitionWorker.integration.test.ts)。
 */
import { describe, it, expect } from "vitest";
import { isGmailAuthoritativeApproved } from "./gmailAuthoritativeGate";

describe("gmailAuthoritativeGate (實機閘,未 mock)", () => {
  it("isGmailAuthoritativeApproved() 硬回 false —— authoritative 餵送 fail-closed", () => {
    expect(isGmailAuthoritativeApproved()).toBe(false);
  });
});
