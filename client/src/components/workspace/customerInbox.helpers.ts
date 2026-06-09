/**
 * customerInbox.helpers — 整合工作台 per-customer inbox (P2/P3) pure logic.
 *
 * Merges the three open-item buckets returned by admin.customerOpenItems
 * (open bookings / open inquiries / pending approval tasks) into one
 * timeline. P3: items Jeff marked「處理好了」(handled) sink to the bottom;
 * within each group, newest first. Kept pure so it is unit-testable.
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
  title: string;
  sub: string;
  ts: number;
  handled: boolean;
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
      title: b.tourTitle ?? "行程",
      sub: `${b.bookingStatus} · ${b.paymentStatus} · ${b.currency} ${b.totalPrice}`,
      ts: toTs(b.createdAt),
      handled: b.handled ?? false,
    });
  }
  for (const q of data.openInquiries) {
    items.push({
      key: `inquiry:${q.id}`,
      kind: "inquiry",
      id: q.id,
      title: q.subject || q.destination || "詢問",
      sub: q.status,
      ts: toTs(q.createdAt),
      handled: q.handled ?? false,
    });
  }
  for (const t of data.pendingTasks) {
    items.push({
      key: `task:${t.id}`,
      kind: "task",
      id: t.id,
      title: t.title,
      sub: `${t.lane} · ${t.riskLevel}`,
      ts: toTs(t.createdAt),
      handled: t.handled ?? false,
    });
  }

  return items.sort((a, b) => {
    if (a.handled !== b.handled) return a.handled ? 1 : -1; // unhandled first
    return b.ts - a.ts; // newest first within a group
  });
}
