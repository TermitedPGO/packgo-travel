/**
 * Membership router。
 *
 * 2026-07-25 Jeff 裁定:會員制為免費單層,不應存在任何付費機制。
 * 本檔隨之移除 createCheckoutSession(Stripe 訂閱結帳)與
 * createPortalSession(訂閱管理入口)。移除依據:
 *   一,Cal. B&P Code §17550.27(Seller of Travel Discount Program):
 *       收費會員需 10 萬美元保證金、年費上限 150 美元、續約授權
 *       不得在到期前 60 天以上取得。原實作在加入當下取得永久扣款
 *       同意,與該條牴觸。
 *   二,免費制無購買人、無扣款,加州自動續訂法(現行 AB 2863)整組
 *       不適用,一人公司省下整套法遵維護。
 * 完整研究:PACKGO_AI交流/網站專案/會員方案_研究報告_2026-07-25.md。
 * 對應的前端鎖在 client/src/pages/Membership.test.ts,
 * 本檔的鎖在 server/routers/membership.test.ts。
 *
 * 保留 getStatus:Header 等處仍可查目前 tier(免費升等後的等級累積
 * 由 packpointMaintenanceQueue 維護,與付費無關)。
 * 日後若要恢復付費層,必須先完成上述法遵並更新兩份鎖測試,
 * 不得直接刪測試了事。
 */

import { publicProcedure, router } from "../_core/trpc";

export const membershipRouter = router({
    getStatus: publicProcedure.query(async ({ ctx }) => {
      const user = ctx.user as any;
      if (!user) {
        return { tier: "free" as const, expiresAt: null, hasSubscription: false };
      }
      return {
        tier: (user.tier || "free") as "free" | "plus" | "concierge",
        expiresAt: user.tierExpiresAt || null,
        // 永遠 false:訂閱機制已移除。保留欄位是為了不破壞既有呼叫端的型別。
        hasSubscription: false,
      };
    }),
  });
