/**
 * CustomerInbox — 整合工作台 per-customer inbox (P2/P3 + design rebuild).
 *
 * One customer = one inbox. Header (who + tier + stats) over a timeline of
 * their OPEN items (open bookings + open inquiries + pending approval tasks),
 * split 未處理 / 已處理. Cards use the shared ws-ui grammar (left-black-rule,
 * badge, 處理好了 toggle). Faithful to admin-inbox-per-customer.html.
 */
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { LoadingPage } from "@/components/ui/spinner";
import { mergeOpenItems, type InboxItemKind } from "./customerInbox.helpers";
import { formatRelTime } from "./relTime";
import { WorkspaceCard } from "./ws-ui";

const KIND_LABEL: Record<InboxItemKind, string> = {
  booking: "workspace.kindBooking",
  inquiry: "workspace.kindInquiry",
  task: "workspace.kindTask",
};

export default function CustomerInbox({ userId }: { userId: number }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const detail = trpc.admin.customerDetail.useQuery({ userId });
  const open = trpc.admin.customerOpenItems.useQuery({ userId });
  const setDisposition = trpc.workspace.setDisposition.useMutation({
    onSuccess: () => {
      utils.admin.customerOpenItems.invalidate({ userId });
      // 今日待辦 renders the same dispositions — keep it in sync
      utils.workspace.listDispositions.invalidate();
    },
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

  const card = (it: (typeof items)[number]) => (
    <WorkspaceCard
      key={it.key}
      type={t(KIND_LABEL[it.kind])}
      time={formatRelTime(it.ts, t)}
      state={it.handled ? "done" : "none"}
      handled={it.handled}
      onToggle={() =>
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
      <div className="font-medium">{it.title}</div>
      <div className="text-gray-500 mt-0.5 text-[12px]">{it.sub}</div>
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
            {t("workspace.bookings")} {user.bookingCount ?? 0} · {user.email}
          </div>
        </div>
      </div>

      {/* worklist */}
      <div className="flex-1 overflow-y-auto p-4">
        {items.length === 0 ? (
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
          </>
        )}
      </div>
    </div>
  );
}
