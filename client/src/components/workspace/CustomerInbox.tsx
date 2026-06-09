/**
 * CustomerInbox — 整合工作台 per-customer inbox (P2/P3).
 *
 * One customer = one inbox. Header (who) + a worklist of their OPEN items
 * (open bookings + open inquiries + pending approval tasks) merged into one
 * timeline. P3: each card has a 未處理/處理好了 toggle (workspace.setDisposition);
 * handled items dim + sink to the bottom.
 */
import { useLocale } from "@/contexts/LocaleContext";
import { trpc } from "@/lib/trpc";
import { LoadingPage } from "@/components/ui/spinner";
import { Check } from "lucide-react";
import { mergeOpenItems, type InboxItemKind } from "./customerInbox.helpers";

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
    onSuccess: () => utils.admin.customerOpenItems.invalidate({ userId }),
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

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-3 flex-shrink-0">
        <div className="h-10 w-10 rounded-full bg-gray-900 text-white flex items-center justify-center font-bold flex-shrink-0">
          {(user.name || user.email || "?").charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-bold truncate">{user.name || user.email}</span>
            {user.tier && (
              <span className="text-[11px] border border-gray-300 rounded-md px-1.5 py-0.5">
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
      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        <div className="text-[11px] font-semibold text-gray-500">
          {t("workspace.openItems")} {open.data?.counts.total ?? 0}
        </div>
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-8 text-center text-sm text-gray-500">
            {t("workspace.noOpenItems")}
          </div>
        ) : (
          items.map((it) => (
            <div
              key={it.key}
              className={`rounded-xl border border-gray-200 bg-white p-3 transition-opacity ${
                it.handled ? "opacity-40" : ""
              }`}
              style={{ borderLeftWidth: 2, borderLeftColor: "#111827" }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold tracking-wide px-1.5 py-0.5 rounded-md border border-gray-300">
                      {t(KIND_LABEL[it.kind])}
                    </span>
                    <span className="text-[10px] text-gray-400 tabular-nums">
                      #{it.id}
                    </span>
                  </div>
                  <div className="text-sm font-medium">{it.title}</div>
                  <div className="text-[12px] text-gray-500 mt-0.5">{it.sub}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDisposition.mutate({
                      kind: it.kind,
                      id: it.id,
                      handled: !it.handled,
                    })
                  }
                  className="flex-shrink-0 flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-900"
                  title={it.handled ? t("workspace.handled") : t("workspace.markHandled")}
                >
                  <span
                    className={`w-4 h-4 rounded-[4px] border-2 flex items-center justify-center ${
                      it.handled
                        ? "bg-gray-900 border-gray-900 text-white"
                        : "border-gray-300"
                    }`}
                  >
                    {it.handled && <Check className="w-3 h-3" />}
                  </span>
                  {it.handled && <span>{t("workspace.handled")}</span>}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
