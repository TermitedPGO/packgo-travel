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
import { eq, desc, or, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import { createChildLogger } from "./logger";
import { loadCustomerDocs, type CustomerDocsScope } from "./customerDocsLoader";
import { buildCustomerDocsText } from "./customerDocsText";

const log = createChildLogger({ module: "customerChatContext" });

/**
 * 批3 m4 — append the customer's document list + PDF content (報價/行程) to the
 * pinned chat block. Jeff 拍板「每次都全讀」(Stage 2 Q2): the AI reads the actual
 * itinerary/quote text so it can answer 「行程第幾天去哪」. Lands in the cached
 * system block (opsAgentStream cache_control), so repeat turns in one
 * conversation reuse it cheaply. PII rule: extracted text only flows into the
 * prompt here — never persisted (customerDocsText reads, never writes). Degrades
 * to "" on any failure so a doc hiccup never breaks the chat.
 */
async function buildDocsBlock(scope: CustomerDocsScope): Promise<string> {
  try {
    const docs = await loadCustomerDocs(scope); // raw R2 keys (no signing)
    if (!docs.length) return "";
    const { list, fullText } = await buildCustomerDocsText(
      docs.map((d) => ({ kind: d.kind, name: d.name, url: d.url, meta: d.meta })),
    );
    const parts = ["\n\n" + list];
    if (fullText) {
      parts.push(
        "\n\n【以下是這位客人文件的內容,回答行程/報價問題時據此回答;成本/同業價是內部數字,絕不寫進給客人的草稿】\n" +
          fullText,
      );
    }
    return parts.join("");
  } catch (err) {
    log.warn(
      { err: (err as Error).message },
      "[customerChatContext] docs block failed — chat continues without docs",
    );
    return "";
  }
}

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
  /** guest-customer-chat (2026-06-15) — email guest with no account. Renders a
   *  guest header and skips the PackPoint / 歷史訂單 membership line (which is
   *  meaningless and misleading for a not-yet-registered visitor). */
  isGuest?: boolean;
  /** guest-customer-chat — recent Gmail-originated turns (the 來信 context).
   *  Registered customers leave this undefined (they have bookings/quotes). */
  recentInteractions?: Array<{
    direction: string;
    summary: string | null;
    snippet: string;
  }>;
}

/** Pure formatter — same input, same block. Lists capped, total capped. */
export function formatCustomerContext(data: CustomerContextData): string {
  const u = data.user;
  const lines: string[] = [];
  if (data.isGuest) {
    // Email guest — no account yet. No PackPoint/booking-count line (would
    // imply a known member with 0 of everything); flag the un-registered state
    // so the agent knows there's no users.id to look bookings up against.
    lines.push(
      `【現在聊的訪客】${u.email || `#${u.id}`} · email 訪客,尚未註冊帳號(尚無訂單記錄)`,
    );
  } else {
    lines.push(
      `【現在聊的客人】${u.name || u.email || `#${u.id}`}` +
        (u.email && u.name ? ` (${u.email})` : "") +
        (u.tier ? ` · 等級 ${u.tier}` : "") +
        ` · PackPoint ${u.packpointBalance ?? 0} · 歷史訂單 ${u.bookingCount ?? 0} 筆`,
    );
  }
  lines.push(
    "這個對話只關於這位客人。回答任何問題、找團、擬訊息都以他為對象;查資料工具查到別的客人不要混進來。",
  );
  // m3b — chips render now; tell the agent the true mechanics so it never
  // implies an action already ran (click → confirm → THEN it executes).
  lines.push(
    "你用 suggest_action 提的動作會顯示成按鈕,Jeff 點了還要再確認一次才會執行;在他確認前,不要在文字裡假設動作已經完成。",
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
  const ri = (data.recentInteractions ?? []).slice(0, LIST_CAP);
  if (ri.length) {
    lines.push("【近期來信】");
    for (const it of ri) {
      const dir = it.direction === "inbound" ? "客人來信" : "我們回覆";
      lines.push(`- ${dir}: ${it.summary || it.snippet || "(無內容)"}`);
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

  const base = formatCustomerContext({
    user,
    openBookings: open,
    openInquiries: openInq,
    recentQuotes,
  });
  return base + (await buildDocsBlock({ userId: customerUserId }));
}

/**
 * Guest variant (guest-customer-chat, 2026-06-15) — pins an EMAIL guest
 * (customerProfiles row, no users.id) into the chat system prompt. There are
 * no bookings to join; the context is the guest's email + their inquiry and
 * Gmail history (keyed by email / profileId, same sources as GuestCustomerPane)
 * + any AI quotes that went to that email. Degrades to null on missing
 * db/profile, same as the registered builder.
 */
export async function buildGuestChatContext(
  profileId: number,
): Promise<string | null> {
  const db = await getDb();
  if (!db) {
    log.warn("[customerChatContext] db unavailable — guest chat continues unpinned");
    return null;
  }
  const { customerProfiles, inquiries, customerInteractions, aiQuotes } =
    await import("../../drizzle/schema");

  const [profile] = await db
    .select({ id: customerProfiles.id, email: customerProfiles.email })
    .from(customerProfiles)
    .where(eq(customerProfiles.id, profileId))
    .limit(1);
  if (!profile) return null;
  const email = profile.email;

  // Inquiries are keyed by email (a guest has no userId on the inquiry row).
  const inquiryRows = email
    ? await db
        .select({
          subject: inquiries.subject,
          destination: inquiries.destination,
          status: inquiries.status,
        })
        .from(inquiries)
        .where(eq(inquiries.customerEmail, email))
        .orderBy(desc(inquiries.createdAt))
        .limit(20)
    : [];
  const openInq = inquiryRows.filter((q) =>
    ["new", "in_progress"].includes(q.status),
  );

  // Gmail history lives in customerInteractions (keyed by profileId). Mirror
  // GuestCustomerPane: hide spam unless Jeff rescued it (don't feed junk to
  // the agent).
  const interactions = await db
    .select({
      direction: customerInteractions.direction,
      contentSummary: customerInteractions.contentSummary,
      content: customerInteractions.content,
    })
    .from(customerInteractions)
    .where(
      and(
        eq(customerInteractions.customerProfileId, profileId),
        // NULL-safe: outbound replies are inserted with no classification
        // (→ NULL). Without COALESCE, `NULL = 'spam'` is UNKNOWN → `NOT (…)`
        // is UNKNOWN → the WHERE drops the row, silently hiding every reply we
        // sent. Coalesce so only real, non-rescued spam is excluded.
        sql`NOT (COALESCE(${customerInteractions.classification}, '') = 'spam' AND COALESCE(${customerInteractions.spamVerdict}, '') != 'rescued')`,
      ),
    )
    .orderBy(desc(customerInteractions.createdAt))
    .limit(LIST_CAP);

  const recentQuotes = email
    ? await db
        .select({
          quoteNumber: aiQuotes.quoteNumber,
          estimatedTotal: aiQuotes.estimatedTotal,
          currency: aiQuotes.currency,
          status: aiQuotes.status,
        })
        .from(aiQuotes)
        .where(eq(aiQuotes.customerEmail, email))
        .orderBy(desc(aiQuotes.createdAt))
        .limit(LIST_CAP)
    : [];

  const base = formatCustomerContext({
    user: {
      id: profile.id,
      name: null,
      email,
      tier: null,
      packpointBalance: null,
      bookingCount: null,
    },
    openBookings: [],
    openInquiries: openInq,
    recentQuotes,
    isGuest: true,
    recentInteractions: interactions.map((i) => ({
      direction: i.direction,
      summary: i.contentSummary,
      snippet: (i.content ?? "").slice(0, 200),
    })),
  });
  return base + (await buildDocsBlock({ profileId }));
}
