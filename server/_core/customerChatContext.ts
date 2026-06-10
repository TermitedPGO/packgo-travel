/**
 * customerChatContext — the customer block injected into the per-customer
 * chat system prompt (批2 m3).
 *
 * The ops agent already has read tools (search_tours / search_bookings /
 * search_customers …); this block pins WHO the conversation is about so
 * 「找九月溫泉團」means *for this customer* and the agent can answer
 * 「他有什麼事開著」without a tool round.
 *
 * Deliberately compact + capped (the prompt is paid context): profile line,
 * open bookings, open inquiries, recent AI quotes. Approval-task linkage is
 * NOT queried here (2 extra queries for Jeff-internal items the agent rarely
 * needs — recorded in tasks/batch-2-customers.md).
 *
 * formatCustomerContext is pure (unit-tested); buildCustomerChatContext does
 * the IO and degrades to null when the DB is down (chat still works, just
 * without the pinned block).
 */
import { eq, desc, or } from "drizzle-orm";
import { getDb } from "../db";
import { createChildLogger } from "./logger";

const log = createChildLogger({ module: "customerChatContext" });

/** Per-list cap — keeps the block small even for heavy customers. */
const LIST_CAP = 5;
/** Hard cap on the whole block (chars). */
const BLOCK_CAP = 2400;

export interface CustomerContextData {
  user: {
    id: number;
    name: string | null;
    email: string | null;
    tier: string | null;
    packpointBalance: number | null;
    bookingCount: number | null;
  };
  openBookings: Array<{
    tourTitle: string | null;
    bookingStatus: string;
    paymentStatus: string;
    totalPrice: number | string | null;
    currency: string | null;
  }>;
  openInquiries: Array<{
    subject: string | null;
    destination: string | null;
    status: string;
  }>;
  recentQuotes: Array<{
    quoteNumber: string;
    estimatedTotal: number | null;
    currency: string;
    status: string;
  }>;
}

/** Pure formatter — same input, same block. Lists capped, total capped. */
export function formatCustomerContext(data: CustomerContextData): string {
  const u = data.user;
  const lines: string[] = [];
  lines.push(
    `【現在聊的客人】${u.name || u.email || `#${u.id}`}` +
      (u.email && u.name ? ` (${u.email})` : "") +
      (u.tier ? ` · 等級 ${u.tier}` : "") +
      ` · PackPoint ${u.packpointBalance ?? 0} · 歷史訂單 ${u.bookingCount ?? 0} 筆`,
  );
  lines.push(
    "這個對話只關於這位客人。回答任何問題、找團、擬訊息都以他為對象;查資料工具查到別的客人不要混進來。",
  );

  const ob = data.openBookings.slice(0, LIST_CAP);
  if (ob.length) {
    lines.push("【進行中訂單】");
    for (const b of ob) {
      lines.push(
        `- ${b.tourTitle ?? "(行程)"} · ${b.bookingStatus}/${b.paymentStatus} · ${b.currency ?? ""} ${b.totalPrice ?? ""}`.trim(),
      );
    }
  }
  const oi = data.openInquiries.slice(0, LIST_CAP);
  if (oi.length) {
    lines.push("【開著的詢問】");
    for (const q of oi) {
      lines.push(`- ${q.subject || q.destination || "(詢問)"} · ${q.status}`);
    }
  }
  const rq = data.recentQuotes.slice(0, LIST_CAP);
  if (rq.length) {
    lines.push("【近期報價】");
    for (const q of rq) {
      lines.push(
        `- ${q.quoteNumber} · ${q.currency} ${q.estimatedTotal ?? "?"} · ${q.status}`,
      );
    }
  }

  const block = lines.join("\n");
  return block.length > BLOCK_CAP ? block.slice(0, BLOCK_CAP) : block;
}

/** IO assembly. Returns null when the DB is unavailable or the user is gone. */
export async function buildCustomerChatContext(
  customerUserId: number,
): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    log.warn("[customerChatContext] db unavailable — chat continues unpinned");
    return null;
  }
  const { users, bookings, tours, inquiries, aiQuotes } = await import(
    "../../drizzle/schema"
  );

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      tier: users.tier,
      packpointBalance: users.packpointBalance,
      bookingCount: users.bookingCount,
    })
    .from(users)
    .where(eq(users.id, customerUserId))
    .limit(1);
  if (!user) return null;

  const openBookings = await db
    .select({
      tourTitle: tours.title,
      bookingStatus: bookings.bookingStatus,
      paymentStatus: bookings.paymentStatus,
      totalPrice: bookings.totalPrice,
      currency: bookings.currency,
    })
    .from(bookings)
    .leftJoin(tours, eq(bookings.tourId, tours.id))
    .where(eq(bookings.userId, customerUserId))
    .orderBy(desc(bookings.createdAt))
    .limit(20);
  const open = openBookings.filter((b) =>
    ["pending", "confirmed"].includes(b.bookingStatus),
  );

  const openInquiries = await db
    .select({
      subject: inquiries.subject,
      destination: inquiries.destination,
      status: inquiries.status,
    })
    .from(inquiries)
    .where(eq(inquiries.userId, customerUserId))
    .orderBy(desc(inquiries.createdAt))
    .limit(20);
  const openInq = openInquiries.filter((q) =>
    ["new", "in_progress"].includes(q.status),
  );

  const recentQuotes = await db
    .select({
      quoteNumber: aiQuotes.quoteNumber,
      estimatedTotal: aiQuotes.estimatedTotal,
      currency: aiQuotes.currency,
      status: aiQuotes.status,
    })
    .from(aiQuotes)
    .where(
      user.email
        ? or(
            eq(aiQuotes.userId, customerUserId),
            eq(aiQuotes.customerEmail, user.email),
          )
        : eq(aiQuotes.userId, customerUserId),
    )
    .orderBy(desc(aiQuotes.createdAt))
    .limit(LIST_CAP);

  return formatCustomerContext({
    user,
    openBookings: open,
    openInquiries: openInq,
    recentQuotes,
  });
}
