/**
 * bankTransactionLinks router — F1 對帳引擎 塊A「待認領」認領 UI 後端 (2026-07-08).
 *
 * Procedures (3):
 *   - listPending — 唯讀。撈還沒有 link 的入帳,each 附 dry-run 算出的候選訂單
 *     (供 UI 顯示「疑似這幾張單」)。不寫入——真正的自動 link 由
 *     bankTransactionLinkAlerts(daily 掃描)或本檔的 claim(人工)負責。
 *   - pendingSummary — 唯讀。F3 財務駕駛艙真相列「待認領」一格要的「總筆數 +
 *     總金額」。listPending 只回 items 且有 limit,真相列要的是全部待認領的彙總,
 *     故借用存量回填的 dry-run(只算不寫)取 pendingCount / pendingTotalAmount。
 *   - claim — 人工認領,唯一「錢的真相」寫入路徑。AI 絕不呼叫這支;它只服務
 *     Jeff 在 FinanceReports「待認領」頁按下的認領鈕。留 auditLog(dispatch-f1.md
 *     鐵律 #5)。
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { audit } from "../_core/auditLog";
import {
  scanUnlinkedInflows,
  processInboundTransaction,
  createBankTransactionLink,
  AllocationExceededError,
} from "../services/bankTransactionLinkEngine";
import { TRPCError } from "@trpc/server";

export const bankTransactionLinksRouter = router({
  listPending: adminProcedure
    .input(z.object({ limit: z.number().int().positive().max(200).optional() }).optional())
    .query(async ({ input }) => {
      const unlinked = await scanUnlinkedInflows({ limit: input?.limit ?? 100 });
      const items: Array<{
        bankTransactionId: number;
        amount: number;
        date: string;
        candidates: { orderId: number; orderNumber: string; title: string; legKind: string; matchedAmount: number }[];
      }> = [];

      for (const u of unlinked) {
        const outcome = await processInboundTransaction(u.id, { dryRun: true });
        if (outcome.status !== "pending_claim") continue; // 會自動 link 的不算待認領
        items.push({
          bankTransactionId: u.id,
          // remainingAmount(而非原始交易金額)——部分認領後這裡顯示的是「還
          // 沒分配的餘額」,對抗審查 P1 修復:舊版顯示整筆原始金額,Jeff 對
          // 已部分認領的流水會看到誤導的總額。
          amount: u.remainingAmount,
          date: u.date,
          candidates: outcome.candidates.map((c) => ({
            orderId: c.orderId,
            orderNumber: c.orderNumber,
            title: c.title,
            legKind: c.legKind,
            matchedAmount: c.matchedAmount,
          })),
        });
      }
      return { items };
    }),

  pendingSummary: adminProcedure.query(async () => {
    // 唯讀:runBackfillDryRun 內部 processInboundTransaction({ dryRun: true }),
    // 只算不寫、不建卡(建卡是 confirm 的事)。回傳全部待認領的彙總數字給真相列。
    const { runBackfillDryRun } = await import(
      "../services/bankTransactionLinkBackfill"
    );
    const report = await runBackfillDryRun();
    return { count: report.pendingCount, totalAmount: report.pendingTotalAmount };
  }),

  claim: adminProcedure
    .input(
      z.object({
        bankTransactionId: z.number().int().positive(),
        targetType: z.enum(["custom_order", "invoice", "booking", "category"]),
        targetId: z.number().int().positive().optional(),
        categoryCode: z.string().trim().max(64).optional(),
        amountAllocated: z.number().positive(),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.targetType === "category" && !input.categoryCode) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "categoryCode required when targetType='category'" });
      }
      if (input.targetType !== "category" && !input.targetId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "targetId required for custom_order/invoice/booking" });
      }

      try {
        const { id } = await createBankTransactionLink({
          bankTransactionId: input.bankTransactionId,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          categoryCode: input.categoryCode ?? null,
          amountAllocated: input.amountAllocated,
          matchMethod: "manual",
          matchConfidence: 100,
          claimedBy: "jeff",
          note: input.note ?? null,
        });

        await audit({
          ctx,
          action: "bankTransactionLink.claim",
          targetType: "bankTransaction",
          targetId: input.bankTransactionId,
          changes: {
            linkId: id,
            targetType: input.targetType,
            targetId: input.targetId ?? null,
            categoryCode: input.categoryCode ?? null,
            amountAllocated: input.amountAllocated,
          },
        });

        return { id };
      } catch (err) {
        if (err instanceof AllocationExceededError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),
});
