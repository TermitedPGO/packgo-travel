import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { shouldFunnelTrpcError } from "./trpcNoiseGate";

describe("shouldFunnelTrpcError", () => {
  it("INTERNAL_SERVER_ERROR (plain, 無 cause) → true(該進漏斗)", () => {
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "unexpected db failure",
    });
    expect(shouldFunnelTrpcError(error)).toBe(true);
  });

  it("FORBIDDEN → false(預期的權限行為)", () => {
    const error = new TRPCError({
      code: "FORBIDDEN",
      message: "not an admin",
    });
    expect(shouldFunnelTrpcError(error)).toBe(false);
  });

  it("UNAUTHORIZED → false(預期的權限行為)", () => {
    const error = new TRPCError({
      code: "UNAUTHORIZED",
      message: "not logged in",
    });
    expect(shouldFunnelTrpcError(error)).toBe(false);
  });

  it("BAD_REQUEST → false(呼叫端資料問題)", () => {
    const error = new TRPCError({
      code: "BAD_REQUEST",
      message: "invalid input",
    });
    expect(shouldFunnelTrpcError(error)).toBe(false);
  });

  it("NOT_FOUND → false(預期的業務結果)", () => {
    const error = new TRPCError({
      code: "NOT_FOUND",
      message: "resource not found",
    });
    expect(shouldFunnelTrpcError(error)).toBe(false);
  });

  it("TOO_MANY_REQUESTS → false(設計好的節流,不是事故)", () => {
    const error = new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "rate limited",
    });
    expect(shouldFunnelTrpcError(error)).toBe(false);
  });

  it("INTERNAL_SERVER_ERROR 但 cause 帶 EPIPE code → false(基礎設施雜訊,且必須是靠 cause 判斷,不是靠 message 子字串)", () => {
    // message 故意用中性文字、不含 INFRA_NOISE_MESSAGE_SUBSTRINGS 任何字串,
    // 逼這個測試只能靠 error.cause.code === "EPIPE" 判斷過關。
    // 如果 shouldFunnelTrpcError 漏傳 error.cause(2026-07 那次真實分岔事故的同一類 bug),
    // isKnownInfraNoise 會找不到任何雜訊訊號、回傳 false,這個測試就會抓到(誤報 true)。
    const cause = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "unexpected failure",
      cause,
    });
    expect(shouldFunnelTrpcError(error)).toBe(false);
  });

  it("INTERNAL_SERVER_ERROR 但 message 含 LLM_RATE_LIMITED → false(基礎設施雜訊)", () => {
    const error = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "LLM_RATE_LIMITED: retries exhausted",
    });
    expect(shouldFunnelTrpcError(error)).toBe(false);
  });
});
