/**
 * commandCenter — 指揮中心 (Command Center) 審核箱脊椎 S-3 tRPC router.
 *
 * The single API the 指揮中心 UI talks to. Reads the approval inbox and routes
 * approve/reject back to the lane executor registered for each task's
 * `taskType` (server/_core/approvalTasks.ts). v1 registers no executors, so
 * approve flips status to "approved" and stops there; lanes P1-P4 plug in
 * their executors and the same approve path starts sending.
 *
 * All procedures use adminProcedure → automatic role check + 60 req/min/admin
 * mutation rate-limit (server/_core/trpc.ts). Decision + create audit rows are
 * written inside the helper.
 *
 * riskLevel policy (design.md §2 S-3 line 99/101):
 *   - approve / reject are per-item.
 *   - bulkApprove allows riskLevel = auto / review only; hard_gate is BLOCKED
 *     (money / irreversible / customer-visible must never be batch-approved).
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import {
  listApprovalTasks,
  getApprovalStats,
  getApprovalTaskById,
  decideApprovalTask,
  getApprovalExecutor,
  markApprovalTaskSent,
  markApprovalTaskFailed,
  type ApprovalAuditCtx,
  type ApprovalTask,
} from "../_core/approvalTasks";
import { enrichTasksWithWho } from "../_core/approvalTaskWho";
import {
  listSpamInteractions,
  rescueSpamInteraction,
  confirmSpamInteraction,
} from "../_core/spamBox";
import {
  listEscalations,
  ackEscalation,
  countUnreadEscalations,
} from "../_core/escalationBox";
// 指揮中心 客服頁 (P1) — registering the cs lane executor at module load.
// This file is imported by server/routers.ts to build appRouter (loaded at
// server boot), so importing + calling registerCsExecutors() HERE guarantees
// the "inquiry_reply" executor is registered before any approve can dispatch.
// Without this, approveAndExecute would find no executor and stop at
// "approved" (never sending). See inquiryReplyExecutor.ts header.
import { registerCsExecutors } from "../agents/autonomous/inquiryReplyExecutor";
// 指揮中心 報價頁 (P2) — same registration-at-boot wiring as the cs lane: this
// file is on the appRouter import graph, so calling registerQuoteExecutors()
// here guarantees the "quote_draft" executor is registered before any approve
// can dispatch. See quoteExecutor.ts header.
import { registerQuoteExecutors } from "../agents/autonomous/quoteExecutor";
// 指揮中心 行銷頁 (P3) — registering the marketing lane executor at module load.
import { registerMarketingExecutors } from "../agents/autonomous/marketingExecutor";
// 指揮中心 財務頁 (P4) — registering the finance lane executor at module load.
// Same pattern as P1 cs. The finance executor is acknowledge-only (marks
// alerts as seen, NEVER moves money).
import { registerFinanceExecutors } from "../agents/autonomous/financeExecutor";

registerCsExecutors();
registerQuoteExecutors();
registerMarketingExecutors();
registerFinanceExecutors();

const laneEnum = z.enum(["cs", "quote", "marketing", "finance"]);
const statusEnum = z.enum([
  "pending",
  "approved",
  "rejected",
  "sent",
  "failed",
  "expired",
]);

/** Outcome of approving one task (shared by approve + bulkApprove). */
export interface ApproveOutcome {
  id: number;
  /** Terminal status after the executor ran (or "approved" if none). */
  status: ApprovalTask["status"];
  /** Whether a lane executor was found and invoked. */
  executed: boolean;
  errorMessage?: string;
}

/**
 * Approve one task, then run its lane executor if registered. Centralized so
 * approve (single) and bulkApprove share identical send semantics. The caller
 * is responsible for the hard_gate / pending guards before invoking this.
 */
async function approveAndExecute(
  id: number,
  ctx: ApprovalAuditCtx,
  decidedBy: number | undefined,
  editedPayload?: string,
): Promise<ApproveOutcome> {
  // 1. Flip status → "approved" (audited). Throws if not pending.
  const task = await decideApprovalTask(
    { id, decision: "approve", decidedBy, editedPayload },
    ctx,
  );

  // 2. Look up the lane executor. None registered (v1) → stop at "approved".
  const executor = getApprovalExecutor(task.taskType);
  if (!executor) {
    return { id, status: task.status, executed: false };
  }

  // 3. Run it. The executor must report sent/failed rather than throw, but we
  //    still wrap to mark the row failed on an unexpected throw.
  try {
    const result = await executor(task, ctx);
    if (result.status === "sent") {
      await markApprovalTaskSent(id);
      return { id, status: "sent", executed: true };
    }
    await markApprovalTaskFailed(id, result.errorMessage ?? "executor failed");
    return {
      id,
      status: "failed",
      executed: true,
      errorMessage: result.errorMessage,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markApprovalTaskFailed(id, message);
    return { id, status: "failed", executed: true, errorMessage: message };
  }
}

export const commandCenterRouter = router({
  /**
   * Inbox list — optional lane / status filter, newest first. Each row is
   * enriched with `who` (customer label + jump userId, null for company-wide
   * lanes) so the workspace 今日待辦 can render the @客戶 chip + 「去X」jump
   * without parsing lane payloads client-side.
   */
  list: adminProcedure
    .input(
      z
        .object({
          lane: laneEnum.optional(),
          status: statusEnum.optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const tasks = await listApprovalTasks(input ?? {});
      return enrichTasksWithWho(tasks);
    }),

  /**
   * One task by id (批2 m1) — the per-customer inbox card opens the shared
   * ReviewTaskDialog on demand; customerOpenItems only carries a summary row,
   * so the dialog fetches the full payload here. Read-only.
   */
  get: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const task = await getApprovalTaskById(input.id);
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }
      return task;
    }),

  /**
   * Per-lane pending counts for the 狀態 strip. `escalationUnread` (批1 m3b)
   * is additive — existing consumers keep reading totalPending/pendingByLane;
   * the workspace sidebar badge adds the unread escalations on top.
   */
  stats: adminProcedure.query(async () => {
    const [approval, escalationUnread] = await Promise.all([
      getApprovalStats(),
      countUnreadEscalations(),
    ]);
    return { ...approval, escalationUnread };
  }),

  /** Approve one task → run its lane executor (per-item; hard_gate allowed here). */
  approve: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        editedPayload: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return approveAndExecute(
        input.id,
        ctx as ApprovalAuditCtx,
        ctx.user.id,
        input.editedPayload,
      );
    }),

  /** Reject one task (status → rejected, audited). No executor runs. */
  reject: adminProcedure
    .input(
      z.object({
        id: z.number().int(),
        reason: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await decideApprovalTask(
        {
          id: input.id,
          decision: "reject",
          decidedBy: ctx.user.id,
          reason: input.reason,
        },
        ctx as ApprovalAuditCtx,
      );
      return { id: task.id, status: task.status };
    }),

  /**
   * Batch-approve auto / review tasks in one click. hard_gate tasks are
   * BLOCKED (reported back, never approved). Non-pending / missing ids are
   * also reported as blocked so the UI can show exactly what happened.
   */
  bulkApprove: adminProcedure
    .input(z.object({ ids: z.array(z.number().int()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const approved: ApproveOutcome[] = [];
      const blocked: Array<{ id: number; reason: string }> = [];

      for (const id of input.ids) {
        const task = await getApprovalTaskById(id);
        if (!task) {
          blocked.push({ id, reason: "not_found" });
          continue;
        }
        if (task.riskLevel === "hard_gate") {
          // 鐵律：碰錢 / 不可逆 / 對客可見一律逐筆，不准批次。
          blocked.push({ id, reason: "hard_gate" });
          continue;
        }
        if (task.status !== "pending") {
          blocked.push({ id, reason: `already_${task.status}` });
          continue;
        }
        approved.push(
          await approveAndExecute(id, ctx as ApprovalAuditCtx, ctx.user.id),
        );
      }

      return { approved, blocked };
    }),

  /**
   * 疑似垃圾匣 (批1 m3a, design.md §2 rule 4) — spam-classified inbound rows.
   * Includes decided rows (rescued / confirmed) so nothing ever vanishes.
   */
  spamList: adminProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).optional() })
        .optional(),
    )
    .query(async ({ input }) => listSpamInteractions(input?.limit ?? 50)),

  /**
   * 「其實是客人,救回」— creates a real inquiry from the stored content and
   * runs the SAME draft path as a normal inbound (agent → cs approval task).
   * Agent failure is reported honestly in the result, never hidden.
   */
  spamRescue: adminProcedure
    .input(z.object({ interactionId: z.number().int() }))
    .mutation(async ({ ctx, input }) =>
      rescueSpamInteraction(input.interactionId, ctx as ApprovalAuditCtx),
    ),

  /** 「確定是垃圾」— verdict only; the row is muted but never deleted. */
  spamConfirm: adminProcedure
    .input(z.object({ interactionId: z.number().int() }))
    .mutation(async ({ ctx, input }) =>
      confirmSpamInteraction(input.interactionId, ctx as ApprovalAuditCtx),
    ),

  /**
   * Escalations 進今日待辦 (批1 m3b) — agentMessages escalation rows for the
   * 需要你決定 bucket: every unread one (no date window — old unread must not
   * silently vanish) + the most recent read ones, dimmed. No send path here:
   * acting on an escalation stays in Gmail / agent chat.
   */
  escalationList: adminProcedure.query(async () => listEscalations()),

  /**
   * 處理好了 toggle on an escalation card. Writes readByJeff — the same state
   * the agent-chat unread badge reads, so one ack clears both surfaces.
   */
  escalationAck: adminProcedure
    .input(
      z.object({
        messageId: z.number().int(),
        handled: z.boolean(),
      }),
    )
    .mutation(async ({ input }) =>
      ackEscalation(input.messageId, input.handled),
    ),

  /**
   * email-auto-reply m2 — 自動回/影子留底卡(今日待辦 box)。唯讀;
   * dismiss 走 agent.replyToMessage markRead(與 channel 未讀同一狀態)。
   */
  autoReplyCards: adminProcedure.query(async () => {
    const { listAutoReplyCards } = await import("../_core/autoReplyBox");
    return listAutoReplyCards();
  }),

  /**
   * email-auto-reply m3 — 信任階梯成績單(per-class 不改直接核准率 +
   * 影子數)。唯讀;達標徽章門檻 = 20 封 + 95%(拍板)。
   */
  autoReplyReadiness: adminProcedure.query(async () => {
    const { getAutoReplyReadiness } = await import(
      "../_core/autoReplyReadiness"
    );
    return getAutoReplyReadiness();
  }),

  /**
   * 批9 m1 — Jeff 編輯 AI 草稿後核准寄出(escalation 卡的 🔒 dialog)。
   * Replies in the ORIGINAL Gmail thread via the pipeline's send helper;
   * old rows without a structured reply target fail honestly. 鐵律不變:
   * this is a human-approved send, never autonomous.
   */
  escalationReply: adminProcedure
    .input(
      z.object({
        messageId: z.number().int().positive(),
        body: z.string().min(1).max(10_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { sendEscalationReply } = await import("../_core/escalationBox");
      const result = await sendEscalationReply(input.messageId, input.body);
      if (result.sent) {
        const { audit } = await import("../_core/auditLog");
        audit({
          ctx,
          action: "escalation.reply",
          targetType: "agentMessage",
          targetId: input.messageId,
          changes: { bodyLength: input.body.length },
        });
      }
      return result;
    }),

  /**
   * 客服頁 producer trigger (P1-b) — run InquiryAgent on an existing inquiry
   * and drop the resulting draft into the 審核箱 as a pending cs task.
   *
   * Admin-only + on-demand: the LLM call lives here (NOT on the public
   * inquiry-create hot path), so producing a draft never slows a customer
   * submit. Jeff clicks "起草" on an inquiry → this runs the agent → producer
   * → createApprovalTask. The draft then appears in the cs lane for review.
   *
   * runInquiryAgent + the producer are dynamically imported so the agent's
   * LLM dependency graph isn't pulled into the router's eager module load.
   */
  produceInquiryReply: adminProcedure
    .input(z.object({ inquiryId: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await import("../db");
      const inquiry = await db.getInquiryById(input.inquiryId);
      if (!inquiry) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Inquiry not found" });
      }

      const { runInquiryAgent } = await import(
        "../agents/autonomous/inquiryAgent"
      );
      const { produceInquiryReplyTask } = await import(
        "../agents/autonomous/inquiryReplyProducer"
      );

      // Feed the agent the customer's own words (subject + message).
      const agent = await runInquiryAgent({
        rawMessage: `${inquiry.subject}\n\n${inquiry.message}`,
        channel: "email",
        customerProfile: inquiry.customerEmail
          ? { id: inquiry.id, email: inquiry.customerEmail }
          : undefined,
      });

      const { id, riskLevel } = await produceInquiryReplyTask(
        {
          inquiryId: inquiry.id,
          customerEmail: inquiry.customerEmail,
          customerName: inquiry.customerName,
          subject: inquiry.subject,
          inquiryText: `${inquiry.subject}\n${inquiry.message}`,
        },
        agent,
        ctx as ApprovalAuditCtx,
      );

      return { taskId: id, riskLevel };
    }),

  /**
   * 報價頁 producer trigger (P2) — turn a tour + optional supplier departure +
   * customer info into a pending quote draft in the 審核箱.
   *
   *   - 供應商團 (isCustomTrip=false, departureId given): resolve the supplier
   *     RETAIL price (直客價 / supplierDepartures.retailPrice — Jeff 2026-05-31,
   *     NOT agentPrice) so the review shows the price Jeff would quote against
   *     the (future) AI estimate.
   *   - 客製遊 (isCustomTrip=true): no price lookup — the producer makes a
   *     "需手動報價" 待辦 only.
   *
   * aiEstimate is left undefined in v1 (aiQuotes has no clean per-tour link).
   * The producer is dynamically imported so its dependency graph isn't pulled
   * into the router's eager module load.
   */
  produceQuoteDraft: adminProcedure
    .input(
      z.object({
        tourId: z.number().int(),
        departureId: z.number().int().optional(),
        customerName: z.string().max(200).optional(),
        customerEmail: z.string().email().max(320).optional(),
        customerChannel: z
          .enum(["ai_assistant", "gmail", "wechat", "line"])
          .optional(),
        isCustomTrip: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = await import("../db");
      const tour = await db.getTourById(input.tourId);
      if (!tour) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tour not found" });
      }

      const isCustomTrip = input.isCustomTrip ?? false;

      // 供應商團：拉 supplierDepartures 的 retailPrice（直客價）+ 幣別。
      // 客製遊或無 departureId → 不撈價，supplierPrice 留 undefined。
      let supplierPrice: number | undefined;
      let currency: string | undefined;
      if (!isCustomTrip && input.departureId !== undefined) {
        const database = await db.getDb();
        if (database) {
          const { supplierDepartures } = await import("../../drizzle/schema");
          const rows = await database
            .select({
              retailPrice: supplierDepartures.retailPrice,
              currency: supplierDepartures.currency,
            })
            .from(supplierDepartures)
            .where(eq(supplierDepartures.id, input.departureId))
            .limit(1);
          const dep = rows[0];
          if (dep) {
            // decimal columns come back as strings — coerce to number.
            supplierPrice =
              dep.retailPrice != null ? Number(dep.retailPrice) : undefined;
            currency = dep.currency ?? undefined;
          }
        }
      }

      const { produceQuoteDraftTask } = await import(
        "../agents/autonomous/quoteProducer"
      );

      const { id, riskLevel } = await produceQuoteDraftTask(
        {
          tourId: input.tourId,
          departureId: input.departureId,
          tourTitle: tour.title ?? `#${input.tourId}`,
          customerName: input.customerName,
          customerEmail: input.customerEmail,
          customerChannel: input.customerChannel,
          supplierPrice,
          currency,
          isCustomTrip,
          // aiEstimate: v1 left undefined — aiQuotes has no clean per-tour link.
        },
        ctx as ApprovalAuditCtx,
      );

      return { taskId: id, riskLevel };
    }),

  // ── 行銷頁 (P3) ─────────────────────────────────────────────────────────

  /**
   * 行銷頁 producer trigger (P3) — manually drop a marketing draft into the
   * 審核箱 as a pending marketing task.
   *
   * Admin-only: Jeff fills in the content type, title, body, optional
   * platform/tourId/image/hashtags → this calls the producer → creates an
   * approval task. The draft then appears in the marketing lane for review.
   */
  produceMarketingDraft: adminProcedure
    .input(
      z.object({
        contentType: z.enum([
          "xhs_post",
          "wechat_article",
          "edm",
          "poster_copy",
          "social_post",
          "other",
        ]),
        title: z.string().min(1).max(255),
        body: z.string().min(1),
        platform: z.string().max(64).optional(),
        targetAudience: z.string().max(500).optional(),
        tourId: z.number().int().optional(),
        tourTitle: z.string().max(255).optional(),
        imageUrl: z.string().url().max(2000).optional(),
        hashtags: z.array(z.string().max(100)).max(30).optional(),
        hasPrice: z.boolean().optional(),
        sourceRouter: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { produceMarketingDraftTask } = await import(
        "../agents/autonomous/marketingProducer"
      );

      const { id, riskLevel } = await produceMarketingDraftTask(
        {
          contentType: input.contentType,
          title: input.title,
          body: input.body,
          platform: input.platform,
          targetAudience: input.targetAudience,
          tourId: input.tourId,
          tourTitle: input.tourTitle,
          imageUrl: input.imageUrl,
          hashtags: input.hashtags,
          hasPrice: input.hasPrice,
          sourceRouter: input.sourceRouter,
        },
        ctx as ApprovalAuditCtx,
      );

      return { taskId: id, riskLevel };
    }),

  /**
   * 行銷頁 supplier content transform (P3-v2) — paste supplier text + optional
   * poster image → AI transforms into PACK&GO branded draft → drops into 審核箱.
   *
   * Reuses the existing produceMarketingDraftTask pipeline so the draft appears
   * in the marketing lane inbox exactly like a manually composed one.
   */
  transformSupplierContent: adminProcedure
    .input(
      z.object({
        supplierText: z.string().min(10).max(5000),
        supplierImageUrl: z.string().url().max(2000).optional(),
        platform: z.string().max(64).optional(),
        notes: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { transformSupplierContent: transform } = await import(
        "../agents/autonomous/marketingTransformer"
      );
      const { produceMarketingDraftTask } = await import(
        "../agents/autonomous/marketingProducer"
      );

      // Step 1: AI transform supplier content → PACK&GO brand version
      const result = await transform(input);

      // Step 2: Feed into existing producer pipeline
      const { id, riskLevel } = await produceMarketingDraftTask(
        {
          contentType: "social_post",
          title: result.title,
          body: result.body,
          platform: input.platform,
          imageUrl: input.supplierImageUrl,
          hashtags: result.hashtags,
          hasPrice: !!result.extractedPrice,
          sourceRouter: "supplierTransform",
          supplierText: input.supplierText,
          supplierImageUrl: input.supplierImageUrl,
        },
        ctx as ApprovalAuditCtx,
      );

      return { taskId: id, riskLevel, transformed: result };
    }),

  // ── 財務頁 (P4) ─────────────────────────────────────────────────────────

  /**
   * Run all 5 finance alert checks and produce approval tasks for anomalies.
   * Admin triggers this from the finance dashboard "一鍵掃描" button.
   */
  runFinanceAlerts: adminProcedure.mutation(async ({ ctx }) => {
    const { produceFinanceAlerts } = await import(
      "../agents/autonomous/financeAlertProducer"
    );
    return produceFinanceAlerts(ctx as ApprovalAuditCtx);
  }),

  /**
   * AI financial advisor — Jeff asks a question, gets a data-backed answer.
   * The advisor has read access to P&L, bank transactions, trust status,
   * and tax summaries. It NEVER executes transactions.
   */
  askFinanceAdvisor: adminProcedure
    .input(z.object({ question: z.string().min(1).max(2000) }))
    .mutation(async ({ input }) => {
      const { askFinanceAdvisor } = await import(
        "../agents/autonomous/financeAdvisor"
      );
      const answer = await askFinanceAdvisor(input.question);
      return { answer };
    }),

  /**
   * Generate and return a Schedule C tax CSV for the given year.
   * The CSV string is returned in the response (no file write); the client
   * triggers a browser download.
   */
  downloadTaxCsv: adminProcedure
    .input(z.object({ year: z.number().int().min(2020).max(2030) }))
    .mutation(async ({ input }) => {
      const { generateTaxCsv } = await import(
        "../services/taxCsvService"
      );
      const csv = await generateTaxCsv(input.year);
      return {
        csv,
        filename: `packgo-schedule-c-${input.year}.csv`,
      };
    }),
});
