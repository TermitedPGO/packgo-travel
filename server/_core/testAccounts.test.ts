/**
 * testAccounts — Phase6 A6「測試帳號排除 helper」單元測試。
 *
 * testAccounts.ts 是零重型依賴的 leaf module(OWN_EMAILS source of truth,
 * gmailPipeline.ts 反向 import 它——見該檔案 module doc),測試不需要 mock
 * db/redis/gmail 等任何 collaborator。
 */
import { describe, it, expect } from "vitest";
import { isTestOrOwnerAccount } from "./testAccounts";

describe("isTestOrOwnerAccount", () => {
  it("blocks OWN_EMAILS addresses (jeffhsieh09@gmail.com / support@packgoplay.com)", () => {
    expect(isTestOrOwnerAccount("jeffhsieh09@gmail.com")).toBe(true);
    expect(isTestOrOwnerAccount("support@packgoplay.com")).toBe(true);
    // case-insensitive + trims, same convention as gmailPipeline.isOwnEmail
    expect(isTestOrOwnerAccount("  JEFFHSIEH09@Gmail.com  ")).toBe(true);
  });

  it("blocks jeffhsieh0909@gmail.com (0909 test customer) even though it is NOT in OWN_EMAILS", () => {
    expect(isTestOrOwnerAccount("jeffhsieh0909@gmail.com")).toBe(true);
    expect(isTestOrOwnerAccount("JEFFHSIEH0909@GMAIL.COM")).toBe(true);
  });

  it("blocks profileId 2760017 (0909 test customer merged member card)", () => {
    expect(isTestOrOwnerAccount(undefined, 2760017)).toBe(true);
  });

  it("blocks profileId 2730002 (Jeff's own personal card, userId=1)", () => {
    expect(isTestOrOwnerAccount(undefined, 2730002)).toBe(true);
  });

  it("lets a normal customer through (neither email nor profileId excluded)", () => {
    expect(isTestOrOwnerAccount("jane.doe@example.com", 12345)).toBe(false);
  });

  it("returns false when both args are omitted", () => {
    expect(isTestOrOwnerAccount()).toBe(false);
  });

  it("a normal customer's email is not accidentally blocked by the profileId check", () => {
    // Regression guard: profileId undefined must not match the excluded set.
    expect(isTestOrOwnerAccount("jane.doe@example.com")).toBe(false);
  });
});
