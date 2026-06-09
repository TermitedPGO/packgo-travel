/**
 * approvalTaskWho — resolve 「這張卡是誰的事」 for the workspace 今日待辦.
 *
 * approvalTasks.payload is a lane-specific JSON string and relatedType/Id is a
 * soft ref that does NOT always point at the customer (quote → "tour"). This
 * module turns that into a lightweight display + jump target:
 *
 *   cs    → payload.inquiryId  → inquiries row (userId soft ref, fresh name)
 *   quote → payload.customerEmail → users row by email
 *   marketing / finance → null (company-wide, the UI shows 🏢 全公司)
 *
 * Resolution is honest by design: `userId` is null whenever we cannot map the
 * task to a registered user (guest inquiry, unknown email) — the UI then shows
 * the @name chip without a jump instead of pretending. Lookups are batched
 * with inArray (zero per-row queries), and a missing DB only degrades userId,
 * never the label (payload still names the customer).
 */
import { inArray } from "drizzle-orm";
import { getDb } from "../db";
import { inquiries, users } from "../../drizzle/schema";
import type { ApprovalTask } from "./approvalTasks";

/** Customer pointers parsed out of a lane payload (best-effort, never throws). */
export interface CustomerRef {
  inquiryId?: number;
  customerEmail?: string;
  customerName?: string;
}

/** Who a task belongs to, resolved for display + jump. */
export interface TaskWho {
  /** Display name — customer name, falling back to email. */
  label: string;
  /** users.id when resolvable (jump target); null = chip only, no jump. */
  userId: number | null;
}

/**
 * Parse the lane payload into customer pointers. Only cs / quote carry a
 * customer; malformed JSON or missing fields return null rather than throwing
 * (the payload shape is owned by the producers and may drift).
 */
export function extractCustomerRef(
  lane: string,
  payload: string,
): CustomerRef | null {
  if (lane !== "cs" && lane !== "quote") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const p = parsed as Record<string, unknown>;
  const ref: CustomerRef = {};
  if (lane === "cs" && typeof p.inquiryId === "number") {
    ref.inquiryId = p.inquiryId;
  }
  if (typeof p.customerEmail === "string" && p.customerEmail.trim()) {
    ref.customerEmail = p.customerEmail.trim();
  }
  if (typeof p.customerName === "string" && p.customerName.trim()) {
    ref.customerName = p.customerName.trim();
  }
  return ref.inquiryId !== undefined || ref.customerEmail || ref.customerName
    ? ref
    : null;
}

type InquiryRow = {
  id: number;
  userId: number | null;
  customerName: string | null;
  customerEmail: string;
};

/**
 * Attach `who` to each task. Two batched lookups total regardless of task
 * count: inquiries by id (cs) and users by email (quote + guest-cs fallback).
 */
export async function enrichTasksWithWho<
  T extends Pick<ApprovalTask, "lane" | "payload">,
>(tasks: T[]): Promise<(T & { who: TaskWho | null })[]> {
  const refs = tasks.map((t) => extractCustomerRef(t.lane, t.payload));

  const inquiryIds = [
    ...new Set(
      refs.flatMap((r) => (r?.inquiryId !== undefined ? [r.inquiryId] : [])),
    ),
  ];
  const emails = [
    ...new Set(
      refs.flatMap((r) =>
        r?.customerEmail ? [r.customerEmail.toLowerCase()] : [],
      ),
    ),
  ];

  const inquiryById = new Map<number, InquiryRow>();
  const userByEmail = new Map<string, { id: number; name: string | null }>();

  const db = await getDb();
  if (db && inquiryIds.length > 0) {
    const rows = await db
      .select({
        id: inquiries.id,
        userId: inquiries.userId,
        customerName: inquiries.customerName,
        customerEmail: inquiries.customerEmail,
      })
      .from(inquiries)
      .where(inArray(inquiries.id, inquiryIds));
    for (const r of rows) inquiryById.set(r.id, r);
  }
  if (db && emails.length > 0) {
    const rows = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(inArray(users.email, emails));
    for (const r of rows) {
      if (r.email) userByEmail.set(r.email.toLowerCase(), r);
    }
  }

  return tasks.map((t, i) => {
    const ref = refs[i];
    if (!ref) return { ...t, who: null };

    const inq =
      ref.inquiryId !== undefined ? inquiryById.get(ref.inquiryId) : undefined;
    const email = (inq?.customerEmail || ref.customerEmail)?.toLowerCase();
    const emailUser = email ? userByEmail.get(email) : undefined;

    const userId = inq?.userId ?? emailUser?.id ?? null;
    const label =
      inq?.customerName?.trim() ||
      ref.customerName ||
      emailUser?.name?.trim() ||
      inq?.customerEmail ||
      ref.customerEmail ||
      "";

    return { ...t, who: label ? { label, userId } : null };
  });
}
