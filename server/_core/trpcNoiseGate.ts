/**
 * tRPC onError 噪音閘 —— 決定一個 TRPCError 該不該送進 reportFunnelError 漏斗。
 *
 * 從 _core/index.ts 的 onError callback 抽出成獨立、可單元測試的純函式
 * (2026-07 Wave1 收尾補丁):原本 inline 寫在 onError 裡,從未有真正紅綠測試
 * 覆蓋六個 code 分支,只能靠人工 trace。行為完全對照原 inline 邏輯搬過來,
 * 純重構,不是修 bug。
 *
 * 白名單寫法(只放行 INTERNAL_SERVER_ERROR):
 *   - FORBIDDEN: adminProcedure 擋非 admin,是預期的權限行為。
 *   - UNAUTHORIZED: requireUser 擋未登入,同上,預期的權限行為。
 *   - BAD_REQUEST: zod 輸入驗證失敗,是呼叫端資料問題,不是系統壞了。
 *   - NOT_FOUND: 查詢不存在的資源,是預期的業務結果。
 *   - TOO_MANY_REQUESTS: adminProcedure mutation rate limit,是設計好的節流,
 *     不是事故(見 trpc.ts checkAdminMutationRateLimit)。
 * 因此上面五種、以及任何其他 tRPC 內建 code(PARSE_ERROR/BAD_GATEWAY/
 * CONFLICT/...)都會被擋。
 *
 * 即使 code 是 INTERNAL_SERVER_ERROR,client abort / EPIPE / ECONNRESET 這類
 * 部署滾動重啟或客人中途關閉分頁造成的網路雜訊,以及 LLM_RATE_LIMITED /
 * LLM_CIRCUIT_OPEN / LLM_TIMEOUT / BullMQ lock-renew 這類已有自己
 * retry/backoff 的基礎設施壓力訊號,都不算「系統壞了」。isKnownInfraNoise 是
 * 跟 sentry.ts(ignoreErrors / beforeSend)共用同一份訊號清單的函式(見
 * ./infraNoise.ts),避免漏斗和 Sentry 兩套過濾邏輯分岔各吹各的號。TRPCError
 * 常把底層錯誤包在 .cause 裡(getTRPCErrorFromUnknown),所以同時查 error 本身
 * 跟 error.cause 兩個候選。
 */

import type { TRPCError } from "@trpc/server";
import { isKnownInfraNoise } from "./infraNoise";

export function shouldFunnelTrpcError(error: TRPCError): boolean {
  if (error.code !== "INTERNAL_SERVER_ERROR") return false;
  if (isKnownInfraNoise(error, error.cause)) return false;
  return true;
}
