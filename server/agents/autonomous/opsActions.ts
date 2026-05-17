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
      default:
        return { ok: false, summary: "未知動作", error: `Unknown actionType: ${actionType}` };
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[opsActions] ${actionType} failed:`, msg);
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
