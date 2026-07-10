/**
 * bankTransactionLinks router — F1 對帳引擎 塊A「待認領」認領 UI 後端 (2026-07-08).
 * F3 財務駕駛艙塊B 擴充 (2026-07-10)。
 *
 * Procedures (6):
 *   - listPending — 唯讀。撈還沒有 link 的入帳,each 附 dry-run 算出的候選訂單
 *     (供 UI 顯示「疑似這幾張單」)。不寫入——真正的自動 link 由
 *     bankTransactionLinkAlerts(daily 掃描)或本檔的 claim(人工)負責。
 *   - pendingSummary — 唯讀。真相列「待認領」的「總筆數 + 總金額」。全量 dry-run
 *     掃描較貴,Redis 快取 TTL 5 分鐘 + 進程內 single-flight;claim / unlink
 *     成功時主動失效,Jeff 按完動作真相列不滯後。
 *   - listAutoLinked — 唯讀。本月(LA 曆月)引擎自動對上的 link 列表 + 彙總,
 *     餵駕駛艙「已自動處理」卡(只讓 Jeff 知道引擎做了什麼,不用他決定)。
 *   - searchClaimTargets — 唯讀。認領對話框的訂單搜尋逃生口(候選不對時,
 *     Jeff 用單號 / 客人名 / 團名搜 customOrders)。
 *   - claim — 人工認領,錢的真相寫入路徑。AI 絕不呼叫這支;它只服務 Jeff 按下
 *     的認領鈕。留 auditLog(dispatch-f1.md 鐵律 #5)。
 *   - unlink — 人工撤銷一筆 link(對帳明細層的複查動作;dispatch-f3 塊B#4 先建
 *     tRPC 與入口)。同樣只服務 Jeff 的按鈕,留 auditLog。
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { audit } from "../_core/auditLog";
import { getDb } from "../db";
import {
  bankTransactionLinks,
  bankTransactions,
  customOrders,
} from "../../drizzle/schema";
import { and, desc, eq, gte, like, or } from "drizzle-orm";
import {
  scanUnlinkedInflows,
  processInboundTransaction,
  createBankTransactionLink,
  AllocationExceededError,
} from "../services/bankTransactionLinkEngine";
import { ACCOUNTING_CATEGORIES } from "../agents/autonomous/accountingAgent";
import { laToday } from "../services/trustOutstandingSplit";
import { redis } from "../redis";
import { reportFunnelError } from "../_core/errorFunnel";
import { TRPCError } from "@trpc/server";

/* ── pendingSummary 快取(TTL 5 分鐘 + single-flight)────────────────── */

export interface PendingSummary {
  count: number;
  totalAmount: number;
}

const PENDING_SUMMARY_CACHE_KEY = "financeCockpit:pendingSummary:v1";
const PENDING_SUMMARY_TTL_S = 300;

/** 進程內 single-flight:快取 miss 時同時多個 poll 只跑一次全量 dry-run。 */
let pendingSummaryInflight: Promise<PendingSummary> | null = null;

async function computePendingSummary(): Promise<PendingSummary> {
  // 唯讀:runBackfillDryRun 內部 processInboundTransaction({ dryRun: true }),
  // 只算不寫、不建卡(建卡是 confirm 的事)。
  const { runBackfillDryRun } = await import(
    "../services/bankTransactionLinkBackfill"
  );
  const report = await runBackfillDryRun();
  return { count: report.pendingCount, totalAmount: report.pendingTotalAmount };
}

/** claim / unlink 成功後呼叫 —— 待認領數字變了,不讓真相列滯後 5 分鐘。 */
async function bustPendingSummaryCache(): Promise<void> {
  try {
    await redis.del(PENDING_SUMMARY_CACHE_KEY);
  } catch (err) {
    reportFunnelError({
      source: "fail-open:bankTransactionLinks:cacheBust",
      err,
    }).catch(() => {});
  }
}

/** 純函式(可單測):已自動處理列 → 彙總(筆數 + 金額)。 */
export function summarizeAutoLinked(
  rows: { amountAllocated: string | number }[],
): { count: number; totalAmount: number } {
  let total = 0;
  for (const r of rows) total += parseFloat(String(r.amountAllocated)) || 0;
  return { count: rows.length, totalAmount: Math.round(total * 100) / 100 };
}

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

  pendingSummary: adminProcedure.query(async (): Promise<PendingSummary> => {
    // 1) Redis 快取命中直接回(fail-open:redis 掛了就直接算,不擋真相列)。
    try {
      const cached = await redis.get(PENDING_SUMMARY_CACHE_KEY);
      if (cached) return JSON.parse(cached) as PendingSummary;
    } catch (err) {
      reportFunnelError({
        source: "fail-open:bankTransactionLinks:cacheGet",
        err,
      }).catch(() => {});
    }
    // 2) miss → single-flight 全量 dry-run(同時多個 poll 只算一次)。
    if (!pendingSummaryInflight) {
      pendingSummaryInflight = computePendingSummary().finally(() => {
        pendingSummaryInflight = null;
      });
    }
    const summary = await pendingSummaryInflight;
    // 3) 回填快取(fail-open)。
    try {
      await redis.set(
        PENDING_SUMMARY_CACHE_KEY,
        JSON.stringify(summary),
        "EX",
        PENDING_SUMMARY_TTL_S,
      );
    } catch (err) {
      reportFunnelError({
        source: "fail-open:bankTransactionLinks:cacheSet",
        err,
      }).catch(() => {});
    }
    return summary;
  }),

  listAutoLinked: adminProcedure
    .input(
      z
        .object({ limit: z.number().int().positive().max(50).optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], summary: { count: 0, totalAmount: 0 } };
      // 本月 = LA 曆月(bankTransactions.date 是曆日欄位,與 laToday 同一套換算)
      const monthStart = `${laToday().slice(0, 7)}-01`;
      const rows = await db
        .select({
          linkId: bankTransactionLinks.id,
          bankTransactionId: bankTransactionLinks.bankTransactionId,
          date: bankTransactions.date,
          amountAllocated: bankTransactionLinks.amountAllocated,
          matchMethod: bankTransactionLinks.matchMethod,
          targetType: bankTransactionLinks.targetType,
          targetId: bankTransactionLinks.targetId,
          categoryCode: bankTransactionLinks.categoryCode,
          orderNumber: customOrders.orderNumber,
          orderTitle: customOrders.title,
        })
        .from(bankTransactionLinks)
        .innerJoin(
          bankTransactions,
          eq(bankTransactionLinks.bankTransactionId, bankTransactions.id),
        )
        .leftJoin(
          customOrders,
          and(
            eq(bankTransactionLinks.targetType, "custom_order"),
            eq(bankTransactionLinks.targetId, customOrders.id),
          ),
        )
        .where(
          and(
            // 'system' = 引擎自動 link(matchMethod 'auto:<rule>' / 'stripe_payout' 等);
            // 'jeff' 的人工認領不算「已自動處理」。
            eq(bankTransactionLinks.claimedBy, "system"),
            gte(bankTransactions.date, monthStart as any),
          ),
        )
        .orderBy(desc(bankTransactions.date), desc(bankTransactionLinks.id));

      const summary = summarizeAutoLinked(rows);
      return { items: rows.slice(0, input?.limit ?? 5), summary };
    }),

  searchClaimTargets: adminProcedure
    .input(z.object({ q: z.string().trim().min(1).max(120) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { orders: [] };
      const like_ = `%${input.q}%`;
      const orders = await db
        .select({
          orderId: customOrders.id,
          orderNumber: customOrders.orderNumber,
          customerName: customOrders.customerName,
          title: customOrders.title,
          status: customOrders.status,
        })
        .from(customOrders)
        .where(
          or(
            like(customOrders.orderNumber, like_),
            like(customOrders.customerName, like_),
            like(customOrders.title, like_),
          ),
        )
        .orderBy(desc(customOrders.id))
        .limit(8);
      return { orders };
    }),

  claim: adminProcedure
    .input(
      z.object({
        bankTransactionId: z.number().int().positive(),
        targetType: z.enum(["custom_order", "invoice", "booking", "category"]),
        targetId: z.number().int().positive().optional(),
        // F3 塊C 小修(2026-07-10):server 端也鎖 SCHEDULE_C_MAP 枚舉(defense in
        // depth,原本只有 client 下拉鎖)。自動 link 不走本 procedure,不受影響。
        categoryCode: z.enum(ACCOUNTING_CATEGORIES).optional(),
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

        // 認領成功 → 待認領彙總變了,主動失效快取(F3 塊B)。
        await bustPendingSummaryCache();

        return { id };
      } catch (err) {
        if (err instanceof AllocationExceededError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  unlink: adminProcedure
    .input(
      z.object({
        linkId: z.number().int().positive(),
        note: z.string().trim().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "db unavailable" });
      }
      const [link] = await db
        .select()
        .from(bankTransactionLinks)
        .where(eq(bankTransactionLinks.id, input.linkId))
        .limit(1);
      if (!link) {
        throw new TRPCError({ code: "NOT_FOUND", message: `link ${input.linkId} not found` });
      }

      await db
        .delete(bankTransactionLinks)
        .where(eq(bankTransactionLinks.id, input.linkId));

      // 撤銷是錢的真相寫入路徑 —— 同 claim,一律留 audit(dispatch-f3 塊B#4)。
      await audit({
        ctx,
        action: "bankTransactionLink.unlink",
        targetType: "bankTransaction",
        targetId: link.bankTransactionId,
        changes: {
          linkId: link.id,
          targetType: link.targetType,
          targetId: link.targetId,
          categoryCode: link.categoryCode,
          amountAllocated: String(link.amountAllocated),
          matchMethod: link.matchMethod,
          note: input.note ?? null,
        },
      });

      // 撤銷後這筆回到待認領 → 失效彙總快取。
      await bustPendingSummaryCache();

      return { ok: true, bankTransactionId: link.bankTransactionId };
    }),
});
