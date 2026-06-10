/**
 * customerInbox.helpers — 整合工作台 per-customer inbox (P2/P3 + 批2 m1) pure logic.
 *
 * Merges the three open-item buckets returned by admin.customerOpenItems
 * (open bookings / open inquiries / pending approval tasks) into one
 * timeline. P3: items Jeff marked「處理好了」(handled) sink to the bottom;
 * within each group, newest first. 批2 m1 adds the closed-history tail
 * (completed/cancelled bookings as locked done cards, mockup 付款/出團 留底)
 * and the trust flag for money-received open bookings. Titles fall back via
 * `titleKey` so this file stays free of hardcoded Chinese (i18n 還債).
 * Kept pure so it is unit-testable.
 */

export type OpenBooking = {
  id: number;
  tourTitle: string | null;
  bookingStatus: string;
  paymentStatus: string;
  totalPrice: number;
  currency: string;
  createdAt: Date | string | number;
  handled?: boolean;
};

export type OpenInquiry = {
  id: number;
  status: string;
  destination: string | null;
  subject: string | null;
  createdAt: Date | string | number;
  handled?: boolean;
};

export type PendingTask = {
  id: number;
  lane: string;
  taskType: string;
  riskLevel: string;
  title: string;
  summary: string | null;
  createdAt: Date | string | number;
  handled?: boolean;
};

export type OpenItemsData = {
  openBookings: OpenBooking[];
  openInquiries: OpenInquiry[];
  pendingTasks: PendingTask[];
};

export type InboxItemKind = "booking" | "inquiry" | "task";

export type InboxItem = {
  /** stable React key, unique across kinds (ids can collide between tables) */
  key: string;
  kind: InboxItemKind;
  id: number;
  /** null → render t(titleKey) (no hardcoded zh in this pure module). */
  title: string | null;
  /** i18n fallback key when title is null. */
  titleKey: string;
  sub: string;
  ts: number;
  handled: boolean;
  /** closed-history fact (出團/取消) — dimmed, no 處理好了 toggle. */
  locked?: boolean;
  /** money received on a not-yet-departed booking → show the trust note. */
  trustNote?: boolean;
  /** pending approval task → card offers 審核 (shared ReviewTaskDialog). */
  reviewable?: boolean;
  /** open inquiry → card offers 起草回覆 (produceInquiryReply). */
  draftable?: boolean;
};

function toTs(v: Date | string | number): number {
  const n = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(n) ? n : 0;
}

/**
 * Merge + sort the three buckets into one timeline.
 * Unhandled (未處理) first, then handled (處理好了) sunk to the bottom;
 * within each group newest-first. Pure: same input → same output.
 */
export function mergeOpenItems(data: OpenItemsData): InboxItem[] {
  const items: InboxItem[] = [];

  for (const b of data.openBookings) {
    items.push({
      key: `booking:${b.id}`,
      kind: "booking",
      id: b.id,
      title: b.tourTitle,
      titleKey: "workspace.tours",
      sub: `${b.bookingStatus} · ${b.paymentStatus} · ${b.currency} ${b.totalPrice}`,
      ts: toTs(b.createdAt),
      handled: b.handled ?? false,
      // unpaid 以外 = 已收錢且還沒出發(open = pending/confirmed)→ trust 帳
      trustNote: b.paymentStatus !== "unpaid",
    });
  }
  for (const q of data.openInquiries) {
    items.push({
      key: `inquiry:${q.id}`,
      kind: "inquiry",
      id: q.id,
      title: q.subject || q.destination,
      titleKey: "workspace.kindInquiry",
      sub: q.status,
      ts: toTs(q.createdAt),
      handled: q.handled ?? false,
      draftable: true,
    });
  }
  for (const t of data.pendingTasks) {
    items.push({
      key: `task:${t.id}`,
      kind: "task",
      id: t.id,
      title: t.title,
      titleKey: "workspace.kindTask",
      sub: `${t.lane} · ${t.riskLevel}`,
      ts: toTs(t.createdAt),
      handled: t.handled ?? false,
      reviewable: true,
    });
  }

  return items.sort((a, b) => {
    if (a.handled !== b.handled) return a.handled ? 1 : -1; // unhandled first
    return b.ts - a.ts; // newest first within a group
  });
}

/** Shape of admin.customerDetail recentBookings rows this module reads. */
export type RecentBooking = {
  id: number;
  tourTitle: string | null;
  bookingStatus: string | null;
  paymentStatus: string | null;
  totalPrice: number | string | null;
  currency: string | null;
  createdAt: Date | string | number;
};

/**
 * 批2 m1 — closed-history tail (mockup 付款/出團 done cards): completed /
 * cancelled bookings as locked done items, newest first, bounded. These are
 * system facts, not dispositions — no 處理好了 toggle (locked), always
 * rendered dimmed at the bottom of the timeline.
 */
export function mergeClosedBookings(
  recent: RecentBooking[],
  limit = 5,
): InboxItem[] {
  return recent
    .filter(
      (b) => b.bookingStatus === "completed" || b.bookingStatus === "cancelled",
    )
    .sort((a, b) => toTs(b.createdAt) - toTs(a.createdAt))
    .slice(0, limit)
    .map((b) => ({
      key: `closed:${b.id}`,
      kind: "booking" as const,
      id: b.id,
      title: b.tourTitle,
      titleKey: "workspace.tours",
      sub: `${b.bookingStatus} · ${b.paymentStatus ?? ""} · ${b.currency ?? ""} ${b.totalPrice ?? ""}`,
      ts: toTs(b.createdAt),
      handled: true,
      locked: true,
    }));
}
