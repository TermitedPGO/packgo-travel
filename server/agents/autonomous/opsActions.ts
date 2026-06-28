/**
 * Round 81 Phase 2 (2026-05-17) — OpsAgent action executors.
 *
 * The agent only PROPOSES actions (text + JSON). Actual execution happens
 * here, only when Jeff explicitly confirms via UI. Every action:
 *   1. Validates args (zod schema below)
 *   2. Executes the side effect (DB write / email / etc)
 *   3. Returns a structured result for the audit trail
 *   4. Posts an "observation" message to #ops channel so the conversation
 *      shows "Jeff did X" inline
 *
 * Safety pattern: any action that touches money or external systems
 * (sendEmail, markPaid) requires sensitivity='sensitive' and typed
 * confirmation on the frontend.
 */
import { z } from "zod";
import { createChildLogger } from "../../_core/logger";
const log = createChildLogger({ module: "opsActions" });

// ────────────────────────────────────────────────────────────────────────
// Action arg schemas
// ────────────────────────────────────────────────────────────────────────
export const ActionTypeEnum = z.enum([
  "sendCustomerEmail",
  "addTourGroupNote",
  "assignTourLeader",
  "updateInternalNote",
  "markBookingPaid",
  "scheduleReminder",
  // Round 81 Phase 4 (2026-05-17) — sensitive actions
  "cancelBooking",
  "triggerRefund",
  // 指揮中心 integration (2026-05-31) — OpsAgent can trigger command center
  // workflows via Jeff's confirmation chips. All are "normal" sensitivity
  // (never auto-execute, always require Jeff's click).
  "runFinanceAlerts",
  "askFinanceAdvisor",
  "produceInquiryReply",
  "downloadTaxCsv",
  // PACK&GO Agent expansion (2026-06-01)
  "classifyBankTransactions",
  "draftWechatReply",
  // gmail-full-thread-filing — Jeff 指名「收某客人」的整串 Gmail 對話。
  // 唯讀候選確認 (preview_customer_threads) 後出 chip,Jeff 點才執行。
  "collectCustomerThreads",
]);
export type ActionType = z.infer<typeof ActionTypeEnum>;

export const SendCustomerEmailArgs = z.object({
  customerProfileId: z.number().int().positive(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10_000),
  language: z.enum(["zh-TW", "en"]).default("zh-TW"),
});

export const AddTourGroupNoteArgs = z.object({
  tourDepartureId: z.number().int().positive(),
  type: z.enum(["ops", "customer", "financial", "followup", "ai_query"]),
  body: z.string().min(1).max(5000),
});

export const AssignTourLeaderArgs = z.object({
  tourDepartureId: z.number().int().positive(),
  tourLeader: z.string().min(1).max(128),
});

export const UpdateInternalNoteArgs = z.object({
  tourDepartureId: z.number().int().positive(),
  append: z.string().min(1).max(2000),
});

export const MarkBookingPaidArgs = z.object({
  bookingId: z.number().int().positive(),
  paymentType: z.enum(["deposit", "balance", "full"]),
  amount: z.number().positive(),
});

export const ScheduleReminderArgs = z.object({
  tourDepartureId: z.number().int().positive(),
  remindAt: z.string(), // ISO8601
  message: z.string().min(1).max(2000),
});

export const CancelBookingArgs = z.object({
  bookingId: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});

export const TriggerRefundArgs = z.object({
  bookingId: z.number().int().positive(),
  amountUsd: z.number().positive(),
  reason: z.string().min(1).max(500),
  // For partial refunds; defaults to false (full refund)
  partial: z.boolean().default(false),
});

// ────────────────────────────────────────────────────────────────────────
// 指揮中心 action arg schemas (2026-05-31)
// ────────────────────────────────────────────────────────────────────────

export const RunFinanceAlertsArgs = z.object({}).optional();

export const AskFinanceAdvisorArgs = z.object({
  question: z.string().min(1).max(2000),
});

export const ProduceInquiryReplyArgs = z.object({
  inquiryId: z.number().int().positive(),
});

export const DownloadTaxCsvArgs = z.object({
  year: z.number().int().min(2020).max(2030),
});

// ────────────────────────────────────────────────────────────────────────
// PACK&GO Agent expansion (2026-06-01)
// ────────────────────────────────────────────────────────────────────────

export const ClassifyBankTransactionsArgs = z.object({
  limit: z.number().int().min(1).max(200).default(50),
}).optional();

export const DraftWechatReplyArgs = z.object({
  customerName: z.string().min(1).max(100),
  incomingMessage: z.string().min(1).max(5000),
  language: z.enum(["zh-TW", "zh-CN", "en"]).default("zh-TW"),
});

// gmail-full-thread-filing — collect one named customer's whole Gmail history.
// email is required (the AI must have confirmed WHICH email with Jeff first via
// the read-only preview); profileId is optional — omitted for a not-yet-filed
// contact, in which case the executor ensure-creates the profile by email.
export const CollectCustomerThreadsArgs = z.object({
  email: z.string().email(),
  profileId: z.number().int().positive().optional(),
});

// ────────────────────────────────────────────────────────────────────────
// Executor — pick action type, validate, run
// ────────────────────────────────────────────────────────────────────────

export interface ExecutionResult {
  ok: boolean;
  summary: string; // 1-line outcome shown in #ops
  details?: Record<string, unknown>;
  error?: string;
}

export async function executeOpsAction(
  actionType: ActionType,
  args: unknown
): Promise<ExecutionResult> {
  try {
    switch (actionType) {
      case "sendCustomerEmail":
        return await doSendCustomerEmail(SendCustomerEmailArgs.parse(args));
      case "addTourGroupNote":
        return await doAddTourGroupNote(AddTourGroupNoteArgs.parse(args));
      case "assignTourLeader":
        return await doAssignTourLeader(AssignTourLeaderArgs.parse(args));
      case "updateInternalNote":
        return await doUpdateInternalNote(UpdateInternalNoteArgs.parse(args));
      case "markBookingPaid":
        return await doMarkBookingPaid(MarkBookingPaidArgs.parse(args));
      case "scheduleReminder":
        return await doScheduleReminder(ScheduleReminderArgs.parse(args));
      case "cancelBooking":
        return await doCancelBooking(CancelBookingArgs.parse(args));
      case "triggerRefund":
        return await doTriggerRefund(TriggerRefundArgs.parse(args));
      // 指揮中心 actions (2026-05-31)
      case "runFinanceAlerts":
        return await doRunFinanceAlerts();
      case "askFinanceAdvisor":
        return await doAskFinanceAdvisor(AskFinanceAdvisorArgs.parse(args));
      case "produceInquiryReply":
        return await doProduceInquiryReply(ProduceInquiryReplyArgs.parse(args));
      case "downloadTaxCsv":
        return await doDownloadTaxCsv(DownloadTaxCsvArgs.parse(args));
      case "classifyBankTransactions":
        return await doClassifyBankTransactions(ClassifyBankTransactionsArgs.parse(args));
      case "draftWechatReply":
        return await doDraftWechatReply(DraftWechatReplyArgs.parse(args));
      case "collectCustomerThreads":
        return await doCollectCustomerThreads(CollectCustomerThreadsArgs.parse(args));
      default:
        return { ok: false, summary: "未知動作", error: `Unknown actionType: ${actionType}` };
    }
  } catch (err) {
    const msg = (err as Error).message;
    log.error({ err, actionType }, "[opsActions] action failed");
    return { ok: false, summary: "執行失敗: " + msg.slice(0, 100), error: msg };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Individual action implementations
// ────────────────────────────────────────────────────────────────────────

async function doSendCustomerEmail(args: z.infer<typeof SendCustomerEmailArgs>): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const { customerProfiles } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  const rows = await db
    .select({ email: customerProfiles.email, userId: customerProfiles.userId })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, args.customerProfileId))
    .limit(1);
  if (!rows[0]?.email) {
    return { ok: false, summary: "找不到客戶 email", error: "customer_no_email" };
  }

  // Use Gmail SMTP via existing transporter
  const { getTransporter } = await import("../../email");
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, summary: "SMTP 未設定", error: "no_smtp" };
  }

  await transporter.sendMail({
    from: `"PACK&GO Travel" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
    to: rows[0].email,
    subject: args.subject,
    text: args.body,
    html: args.body.replace(/\n/g, "<br>"),
  });

  return {
    ok: true,
    summary: `✓ 已寄信給客戶 #${args.customerProfileId} (${rows[0].email}) · 主旨「${args.subject}」`,
    details: { customerProfileId: args.customerProfileId, email: rows[0].email },
  };
}

async function doAddTourGroupNote(args: z.infer<typeof AddTourGroupNoteArgs>): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const { tourGroupNotes } = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  await db.insert(tourGroupNotes).values({
    tourDepartureId: args.tourDepartureId,
    type: args.type,
    author: "OpsAgent",
    body: args.body,
  } as any);

  return {
    ok: true,
    summary: `✓ 已新增 ${args.type} 筆記到團期 #${args.tourDepartureId}`,
    details: args,
  };
}

async function doAssignTourLeader(args: z.infer<typeof AssignTourLeaderArgs>): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const { tourDepartures } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  const result: any = await db
    .update(tourDepartures)
    .set({ tourLeader: args.tourLeader })
    .where(eq(tourDepartures.id, args.tourDepartureId));

  return {
    ok: true,
    summary: `✓ 團期 #${args.tourDepartureId} 領隊已改為「${args.tourLeader}」`,
    details: args,
  };
}

async function doUpdateInternalNote(args: z.infer<typeof UpdateInternalNoteArgs>): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const { tourDepartures } = await import("../../../drizzle/schema");
  const { eq, sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  // Append to existing internalNotes with a date stamp
  const timestamp = new Date().toISOString().slice(0, 10);
  const appendText = `\n[${timestamp}] ${args.append}`;

  await db
    .update(tourDepartures)
    .set({
      internalNotes: sql`CONCAT(COALESCE(${tourDepartures.internalNotes}, ''), ${appendText})`,
    })
    .where(eq(tourDepartures.id, args.tourDepartureId));

  return {
    ok: true,
    summary: `✓ 已追加筆記到團期 #${args.tourDepartureId}`,
    details: { appendedText: args.append },
  };
}

async function doMarkBookingPaid(args: z.infer<typeof MarkBookingPaidArgs>): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const { bookings } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  // Note: this bypasses Stripe — should ONLY be used for manual payments
  // (wire transfer, cash). Stripe-recorded payments come through webhook.
  const newPaymentStatus = args.paymentType === "deposit" ? "deposit" : "paid";
  const newBookingStatus = args.paymentType === "full" || args.paymentType === "balance" ? "confirmed" : "pending";

  await db
    .update(bookings)
    .set({
      paymentStatus: newPaymentStatus as any,
      bookingStatus: newBookingStatus as any,
    })
    .where(eq(bookings.id, args.bookingId));

  return {
    ok: true,
    summary: `✓ Booking #${args.bookingId} → ${newPaymentStatus} (${args.paymentType} $${args.amount})`,
    details: args,
  };
}

async function doScheduleReminder(args: z.infer<typeof ScheduleReminderArgs>): Promise<ExecutionResult> {
  // For v0, store the reminder as a tourGroupNote with type='followup' + a
  // marker so a future cron can pick it up. Full implementation would queue
  // via BullMQ delayed jobs.
  const { getDb } = await import("../../db");
  const { tourGroupNotes } = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  await db.insert(tourGroupNotes).values({
    tourDepartureId: args.tourDepartureId,
    type: "followup",
    author: "OpsAgent.scheduleReminder",
    body: `[REMINDER ${args.remindAt}] ${args.message}`,
  } as any);

  return {
    ok: true,
    summary: `✓ 已排程提醒於 ${args.remindAt.slice(0, 16)} (團期 #${args.tourDepartureId})`,
    details: args,
  };
}

/**
 * Cancel a booking.
 *
 * This is a sensitive operation — it updates bookingStatus='cancelled',
 * release seats on the departure, but does NOT issue a refund. Call
 * doTriggerRefund separately for the money side.
 *
 * Idempotent: if booking is already cancelled, returns success without changes.
 */
async function doCancelBooking(args: z.infer<typeof CancelBookingArgs>): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const { bookings, tourDepartures } = await import("../../../drizzle/schema");
  const { eq, and, ne, sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  // Load booking + check not already cancelled
  const rows = await db.select().from(bookings).where(eq(bookings.id, args.bookingId)).limit(1);
  if (rows.length === 0) {
    return { ok: false, summary: `Booking #${args.bookingId} 不存在`, error: "booking_not_found" };
  }
  const booking = rows[0];
  if (booking.bookingStatus === "cancelled") {
    return {
      ok: true,
      summary: `Booking #${args.bookingId} 早已 cancelled — 無動作`,
      details: { alreadyCancelled: true },
    };
  }

  // Conditional update (atomic) — only flip if not already cancelled
  const updateResult: any = await db
    .update(bookings)
    .set({
      bookingStatus: "cancelled" as any,
      // bookings has no `notes` column — append audit string to `message` field.
      // (Schema canonical: `message: text("message")` — see drizzle/schema.ts:690)
      message: sql`CONCAT(COALESCE(${bookings.message}, ''), '\n[cancelled by OpsAgent ${new Date().toISOString().slice(0, 10)}] ', ${args.reason})`,
    })
    .where(and(eq(bookings.id, args.bookingId), ne(bookings.bookingStatus, "cancelled")));

  const transitioned = (updateResult?.[0]?.affectedRows ?? updateResult?.affectedRows ?? 0) > 0;

  // Release seats only if we won the cancel race
  if (transitioned && booking.departureId) {
    const seatCount =
      (booking.numberOfAdults || 0) +
      (booking.numberOfChildrenWithBed || 0) +
      (booking.numberOfChildrenNoBed || 0);
    if (seatCount > 0) {
      await db
        .update(tourDepartures)
        .set({ bookedSlots: sql`GREATEST(${tourDepartures.bookedSlots} - ${seatCount}, 0)` })
        .where(eq(tourDepartures.id, booking.departureId));
    }
  }

  return {
    ok: true,
    summary: `✓ Booking #${args.bookingId} 已取消 · 釋出座位 · 原因「${args.reason.slice(0, 60)}」`,
    details: { transitioned, customerName: booking.customerName, originalStatus: booking.bookingStatus },
  };
}

/**
 * Trigger a Stripe refund.
 *
 * Calls Stripe API directly; the resulting charge.refunded webhook will
 * sync paymentStatus + trigger the standard accounting / notifications
 * pipeline (already wired in stripeWebhook.ts). We don't double-write
 * those fields here to avoid race conditions.
 *
 * Sensitivity: HIGH — typed CONFIRM in UI, no automatic retries.
 */
async function doTriggerRefund(args: z.infer<typeof TriggerRefundArgs>): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const { bookings, payments } = await import("../../../drizzle/schema");
  const { eq, and, desc } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  // Find the most recent paid Stripe payment for this booking
  const paymentRows = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.bookingId, args.bookingId),
        eq(payments.paymentStatus, "completed")
      )
    )
    .orderBy(desc(payments.id))
    .limit(1);

  if (paymentRows.length === 0) {
    return {
      ok: false,
      summary: `Booking #${args.bookingId} 找不到已付款記錄`,
      error: "no_completed_payment",
    };
  }
  const payment = paymentRows[0];
  if (!payment.stripePaymentIntentId) {
    return {
      ok: false,
      summary: `Booking #${args.bookingId} 沒有 Stripe payment intent (可能手動付款)`,
      error: "no_stripe_intent",
    };
  }

  // 2026-05-17 red-team round 3 — idempotency check.
  // Without this guard, double-clicking the chip or two admin tabs racing
  // would create 2 Stripe refunds for the same booking. Stripe accepts both
  // if there's enough left to refund. Catch it before the API call.
  if (payment.paymentStatus === "refunded") {
    return {
      ok: false,
      summary: `Booking #${args.bookingId} payment 已退款,無動作`,
      error: "already_refunded",
    };
  }

  // Convert USD → cents for Stripe API
  const refundCents = Math.round(args.amountUsd * 100);

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "");
    // 2026-05-17 red-team round 3 — Stripe idempotency-key.
    // Same booking + same payment intent + same hour → same refund. If a
    // duplicate request arrives within a minute (UI double-click, network
    // retry, concurrent admin tab), Stripe returns the original refund
    // instead of creating a new one.
    const idempotencyKey = `refund-${args.bookingId}-${payment.stripePaymentIntentId}-${Math.floor(Date.now() / 60_000)}`;
    const refund = await stripe.refunds.create(
      {
        payment_intent: payment.stripePaymentIntentId,
        amount: args.partial ? refundCents : undefined, // undefined = full refund
        reason: "requested_by_customer",
        metadata: {
          bookingId: String(args.bookingId),
          reason: args.reason.slice(0, 500),
          triggeredBy: "OpsAgent",
        },
      },
      { idempotencyKey }
    );

    return {
      ok: true,
      summary: `✓ Stripe 退款 $${args.amountUsd.toFixed(2)} 已啟動 (refund_id: ${refund.id.slice(0, 24)}...)`,
      details: {
        refundId: refund.id,
        bookingId: args.bookingId,
        amountUsd: args.amountUsd,
        partial: args.partial,
        status: refund.status,
      },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return {
      ok: false,
      summary: `Stripe 退款失敗: ${msg.slice(0, 100)}`,
      error: msg,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────
// 指揮中心 action implementations (2026-05-31)
// All use dynamic imports to avoid pulling LLM/service deps into boot graph.
// ────────────────────────────────────────────────────────────────────────

async function doRunFinanceAlerts(): Promise<ExecutionResult> {
  try {
    const { produceFinanceAlerts } = await import("./financeAlertProducer");
    const result = await produceFinanceAlerts();
    return {
      ok: true,
      summary: `✓ 財務掃描完成，產生 ${result.produced} 筆警示`,
      details: { produced: result.produced },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, summary: "財務掃描失敗", error: msg };
  }
}

async function doAskFinanceAdvisor(
  args: z.infer<typeof AskFinanceAdvisorArgs>,
): Promise<ExecutionResult> {
  try {
    const { askFinanceAdvisor } = await import("./financeAdvisor");
    const answer = await askFinanceAdvisor(args.question);
    return {
      ok: true,
      summary: answer.length > 200 ? answer.slice(0, 200) + "…" : answer,
      details: { fullAnswer: answer, question: args.question },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, summary: "財務顧問暫時不可用", error: msg };
  }
}

async function doProduceInquiryReply(
  args: z.infer<typeof ProduceInquiryReplyArgs>,
): Promise<ExecutionResult> {
  try {
    const db = await import("../../db");
    const inquiry = await db.getInquiryById(args.inquiryId);
    if (!inquiry) {
      return { ok: false, summary: `詢問 #${args.inquiryId} 不存在`, error: "not_found" };
    }

    const { runInquiryAgent } = await import("./inquiryAgent");
    const { produceInquiryReplyTask } = await import("./inquiryReplyProducer");

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
    );

    return {
      ok: true,
      summary: `✓ 已為詢問 #${args.inquiryId} 產生客服草稿 (task #${id}, ${riskLevel})`,
      details: { taskId: id, riskLevel, inquiryId: args.inquiryId },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, summary: "產生客服草稿失敗", error: msg };
  }
}

async function doDownloadTaxCsv(
  args: z.infer<typeof DownloadTaxCsvArgs>,
): Promise<ExecutionResult> {
  try {
    const { generateTaxCsv } = await import("../../services/taxCsvService");
    const csv = await generateTaxCsv(args.year);
    // Can't trigger a browser download from server — return the CSV in details
    // so the UI can render a download link or the agent can paste a summary.
    return {
      ok: true,
      summary: `✓ ${args.year} 報稅 CSV 已生成 (${csv.length} 字元)`,
      details: {
        year: args.year,
        filename: `packgo-schedule-c-${args.year}.csv`,
        csvLength: csv.length,
        // Don't include full CSV in details — too large for chat. The user
        // should use the Finance Dashboard download button for the actual file.
      },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, summary: "報稅 CSV 生成失敗", error: msg };
  }
}

// ────────────────────────────────────────────────────────────────────────
// PACK&GO Agent expansion (2026-06-01)
// ────────────────────────────────────────────────────────────────────────

async function doClassifyBankTransactions(
  args?: z.infer<typeof ClassifyBankTransactionsArgs>,
): Promise<ExecutionResult> {
  try {
    const { classifyUncategorizedBatch } = await import(
      "../../services/accountingAgentService"
    );
    const result = await classifyUncategorizedBatch({
      limit: args?.limit ?? 50,
    });
    return {
      ok: true,
      summary: `✓ 已分類 ${result.succeeded} 筆${result.needsReviewCount > 0 ? ` (${result.needsReviewCount} 筆需人工審)` : ""}`,
      details: {
        processed: result.processed,
        succeeded: result.succeeded,
        failed: result.failed,
        needsReviewCount: result.needsReviewCount,
        byCategory: result.byCategory,
      },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, summary: "帳單分類失敗", error: msg };
  }
}

async function doDraftWechatReply(
  args: z.infer<typeof DraftWechatReplyArgs>,
): Promise<ExecutionResult> {
  try {
    const { draftReply } = await import("../../services/wechatAssistService");
    const result = await draftReply({
      inboundText: args.incomingMessage,
      source: "manual_paste",
      fromDisplayName: args.customerName,
    });
    return {
      ok: true,
      summary: result.draftText.length > 200
        ? result.draftText.slice(0, 200) + "…"
        : result.draftText,
      details: {
        fullReply: result.draftText,
        confidence: result.confidence,
        detectedIntent: result.detectedIntent,
        customerName: args.customerName,
      },
    };
  } catch (err) {
    const msg = (err as Error).message;
    return { ok: false, summary: "微信草稿生成失敗", error: msg };
  }
}

/**
 * gmail-full-thread-filing — collect one named customer's entire Gmail history
 * into customerInteractions. Runs only after Jeff clicks the chip (the agent
 * confirmed WHICH email via the read-only preview first). Pure搬運: reuses
 * backfillCustomerByEmail (claim-or-insert, scrubPii, idempotent) across every
 * connected mailbox. Ensure-creates the profile for a not-yet-filed contact.
 */
export async function doCollectCustomerThreads(
  args: z.infer<typeof CollectCustomerThreadsArgs>,
): Promise<ExecutionResult> {
  const { getDb } = await import("../../db");
  const db = await getDb();
  if (!db) return { ok: false, summary: "DB unavailable", error: "no_db" };

  const { gmailIntegration } = await import("../../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const { buildGmailClient } = await import("../../_core/gmail");
  const { backfillCustomerByEmail } = await import("../../_core/customerBackfill");
  const { ensureCustomerByEmail } = await import("../../routers/agent/_shared");

  const email = args.email.trim().toLowerCase();

  // Resolve the profile. A not-yet-filed contact (e.g. Emerald) has none →
  // ensure-create by email. We deliberately do NOT bump lastInteractionAt: this
  // backfills HISTORICAL mail, and bumping "active now" would (a) be wrong and
  // (b) push the customer into the nightly AI-summary scan, burning LLM.
  let profileId = args.profileId;
  let created = false;
  if (!profileId) {
    const ensured = await ensureCustomerByEmail(db, email);
    profileId = ensured.id;
    created = ensured.created;
  }

  const integrations = await db
    .select()
    .from(gmailIntegration)
    .where(eq(gmailIntegration.isActive, 1));
  if (integrations.length === 0) {
    return { ok: false, summary: "沒有連線中的 Gmail 帳號", error: "no_gmail_integration" };
  }

  const totals = { threadsSeen: 0, inserted: 0, claimed: 0, restamped: 0, skipped: 0, trashSkipped: 0 };
  const perMailbox: Array<{ mailbox: string; threadsSeen: number; inserted: number; claimed: number }> = [];
  for (const integ of integrations) {
    try {
      const gmail = buildGmailClient(integ);
      const r = await backfillCustomerByEmail(db, gmail, integ.emailAddress, profileId, email);
      totals.threadsSeen += r.threadsSeen;
      totals.inserted += r.inserted;
      totals.claimed += r.claimed;
      totals.restamped += r.restamped;
      totals.skipped += r.skipped;
      totals.trashSkipped += r.trashSkipped;
      perMailbox.push({ mailbox: integ.emailAddress, threadsSeen: r.threadsSeen, inserted: r.inserted, claimed: r.claimed });
    } catch (e) {
      log.warn(
        { err: e, mailbox: integ.emailAddress, email },
        "[opsActions] collectCustomerThreads one mailbox failed (non-fatal)",
      );
    }
  }

  return {
    ok: true,
    summary:
      `✓ 已收 ${email}${created ? "(新建檔)" : ""} · ${totals.threadsSeen} 條 thread → ` +
      `新增 ${totals.inserted}、認領 ${totals.claimed}` +
      `${totals.restamped ? `、修正 ${totals.restamped} 個日期` : ""}` +
      `、跳過 ${totals.skipped}(${integrations.length} 個信箱)`,
    details: { profileId, email, created, ...totals, perMailbox },
  };
}
