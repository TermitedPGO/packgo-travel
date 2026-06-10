/**
 * CustomerInbox — 整合工作台 per-customer inbox (P2/P3 + 批2 m1).
 *
 * One customer = one inbox. Header (who + tier + PackPoint · 總消費 · 訂單 +
 * 看完整資料 → shared CustomerDetailSheet) over a timeline of OPEN items
 * (open bookings + open inquiries + pending approval tasks), split
 * 未處理 / 已處理, with the closed-history tail (出團/取消 留底, locked).
 *
 * 批2 m1 actions — both reuse existing gated paths, zero new send routes:
 *   task 卡「審核」   → commandCenter.get → shared ReviewTaskDialog (批1 m2)
 *   詢問卡「起草回覆」 → commandCenter.produceInquiryReply (draft → 審核箱)
 * Money-received open bookings show the trust note (訂金不算營收 鐵律可見化).
 * Faithful to admin-inbox-per-customer.html.
 */
import { lazy, Suspense, useState } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { LoadingPage } from "@/components/ui/spinner";
import {
  mergeOpenItems,
  mergeClosedBookings,
  type InboxItem,
} from "./customerInbox.helpers";
import { formatRelTime } from "./relTime";
import { parseQuoteCard } from "./quoteTask";
import QuoteTaskBody from "./QuoteTaskBody";
import CustomerChat from "./CustomerChat";
import CustomerQuoteRecords from "./CustomerQuoteRecords";
import CustomerFlightOrders from "./CustomerFlightOrders";
import { BtnB, BtnO, WorkspaceCard } from "./ws-ui";

const ReviewTaskDialog = lazy(
  () => import("@/components/admin-v2/CommandCenter/ReviewTaskDialog"),
);
const CustomerDetailSheet = lazy(
  () => import("@/components/admin-v2/CustomerDetailSheet"),
);

const KIND_LABEL: Record<InboxItem["kind"], string> = {
  booking: "workspace.kindBooking",
  inquiry: "workspace.kindInquiry",
  task: "workspace.kindTask",
};

export default function CustomerInbox({ userId }: { userId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const detail = trpc.admin.customerDetail.useQuery({ userId });
  const open = trpc.admin.customerOpenItems.useQuery({ userId });
  const [profileOpen, setProfileOpen] = useState(false);
  // 批2 m1 — task under review; the dialog needs the full payload row, which
  // customerOpenItems doesn't carry → fetch on demand.
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const reviewTaskQ = trpc.commandCenter.get.useQuery(
    { id: reviewingId! },
    { enabled: reviewingId !== null },
  );

  const setDisposition = trpc.workspace.setDisposition.useMutation({
    onSuccess: () => {
      utils.admin.customerOpenItems.invalidate({ userId });
      // 今日待辦 renders the same dispositions — keep it in sync
      utils.workspace.listDispositions.invalidate();
    },
  });

  const draftReply = trpc.commandCenter.produceInquiryReply.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.draftCreated"));
      utils.admin.customerOpenItems.invalidate({ userId });
      utils.commandCenter.list.invalidate();
      utils.commandCenter.stats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (detail.isLoading || open.isLoading) {
    return <LoadingPage text={t("workspace.loading")} />;
  }
  const user = detail.data?.user;
  if (!user) {
    return (
      <div className="p-6 text-sm text-gray-500">
        {t("workspace.customerNotFound")}
      </div>
    );
  }

  const items = open.data ? mergeOpenItems(open.data) : [];
  const unhandled = items.filter((it) => !it.handled);
  const handled = items.filter((it) => it.handled);
  const closed = mergeClosedBookings(detail.data?.recentBookings ?? []);

  const card = (it: InboxItem) => (
    <WorkspaceCard
      key={it.key}
      type={t(KIND_LABEL[it.kind])}
      time={formatRelTime(it.ts, t)}
      state={it.handled ? "done" : "none"}
      handled={it.locked ? undefined : it.handled}
      onToggle={
        it.locked
          ? undefined
          : () =>
              setDisposition.mutate({
                kind: it.kind,
                id: it.id,
                handled: !it.handled,
              })
      }
      toggleBusy={
        setDisposition.isPending &&
        setDisposition.variables?.kind === it.kind &&
        setDisposition.variables?.id === it.id
      }
    >
      <div className="font-medium">{it.title ?? t(it.titleKey)}</div>
      <div className="text-gray-500 mt-0.5 text-[12px]">{it.sub}</div>
      {/* quote 卡上過目層 (批2 m2):價格 + 來源,動作仍走審核 dialog */}
      {it.lane === "quote" && it.payload && parseQuoteCard(it.payload) && (
        <QuoteTaskBody payload={it.payload} />
      )}
      {/* 鐵律可見化:已收錢未出發 → trust 帳,不是營收 */}
      {it.trustNote && (
        <div className="text-[11px] text-gray-500 mt-1">
          {t("workspace.trustNote")}
        </div>
      )}
      {!it.handled && (it.reviewable || it.draftable) && (
        <div className="flex gap-2 mt-2">
          {it.reviewable && (
            <BtnB onClick={() => setReviewingId(it.id)}>
              {t("workspace.review")}
            </BtnB>
          )}
          {it.draftable && (
            <BtnO
              disabled={draftReply.isPending}
              onClick={() => draftReply.mutate({ inquiryId: it.id })}
            >
              {t("workspace.draftReply")}
            </BtnO>
          )}
        </div>
      )}
    </WorkspaceCard>
  );

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-3 flex-shrink-0">
        <div className="h-10 w-10 rounded-full bg-black text-white flex items-center justify-center font-bold flex-shrink-0">
          {(user.name || user.email || "?").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold truncate">
              {user.name || user.email}
            </span>
            {user.tier && (
              <span className="text-[11px] border border-gray-300 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-black" />
                {user.tier}
              </span>
            )}
          </div>
          <div className="text-[11px] text-gray-500 mt-0.5 truncate">
            {t("workspace.packpoint")} {user.packpointBalance ?? 0} ·{" "}
            {t("workspace.totalSpent")} $
            {Number(user.totalSpend ?? 0).toLocaleString()} ·{" "}
            {t("workspace.bookings")} {user.bookingCount ?? 0}
          </div>
        </div>
        <button
          onClick={() => setProfileOpen(true)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium flex-shrink-0"
        >
          {t("workspace.viewFullProfile")}
        </button>
      </div>

      {/* worklist */}
      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 && closed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-8 text-center text-sm text-gray-500">
            {t("workspace.noOpenItems")}
          </div>
        ) : (
          <>
            <div className="text-[11px] font-semibold text-gray-500 mb-2">
              {t("workspace.openItems")} ({unhandled.length})
            </div>
            <div className="space-y-2.5">
              {unhandled.length === 0 ? (
                <div className="text-[12px] text-gray-400 py-1">
                  {t("workspace.noOpenItems")}
                </div>
              ) : (
                unhandled.map(card)
              )}
            </div>

            {handled.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-gray-400 mb-2 mt-5">
                  {t("workspace.handled")} ({handled.length})
                </div>
                <div className="space-y-2.5">{handled.map(card)}</div>
              </>
            )}

            {/* 已結留底 (批2 m1) — 出團/取消 facts, locked, bounded 5 */}
            {closed.length > 0 && (
              <>
                <div className="text-[11px] font-semibold text-gray-400 mb-2 mt-5">
                  {t("workspace.closedSection")} ({closed.length})
                </div>
                <div className="space-y-2.5">{closed.map(card)}</div>
              </>
            )}
          </>
        )}

        {/* 報價記錄 (批2 m2) + 代客訂機票 (批2 m4) — outside the empty-state
            branch: a zero-item customer must still see records and be able
            to start a flight booking */}
        <CustomerQuoteRecords quotes={detail.data?.recentQuotes ?? []} />
        <CustomerFlightOrders userId={userId} />
      </div>

      {/* per-customer 對話 (批2 m3) — thread + composer, bound to this
          customer; streams over the shared hardened ops SSE pipeline */}
      <CustomerChat
        userId={userId}
        customerName={user.name || user.email || ""}
      />

      <Suspense fallback={null}>
        {profileOpen && (
          <CustomerDetailSheet
            userId={userId}
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
          />
        )}
        {reviewingId !== null && reviewTaskQ.data && (
          <ReviewTaskDialog
            task={reviewTaskQ.data}
            onClose={() => setReviewingId(null)}
            onDecided={() => {
              utils.admin.customerOpenItems.invalidate({ userId });
              utils.commandCenter.list.invalidate();
              utils.commandCenter.stats.invalidate();
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
