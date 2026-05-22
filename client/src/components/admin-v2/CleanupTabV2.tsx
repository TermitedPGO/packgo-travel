/**
 * CleanupTabV2 — review + bulk-delete dev/test data.
 *
 * 2026-05-22 — Jeff: "把測試訊息都刪掉" + 行程顯示 141 但實際 100.
 *
 * 3 sections, each shows a candidate list flagged by heuristic. Checkbox
 * per row, "Select all strong candidates (score >= 2)" shortcut, bulk
 * delete button. Never auto-deletes — Jeff approves every batch.
 *
 * Sections:
 *   1. Stale tours — soft delete (mark inactive). Drops the active count.
 *   2. Test inquiries — hard delete. Cleans inbox / inquiries list.
 *   3. Stale agent messages — hard delete. Cleans Office Chat noise.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle, RefreshCw, CheckSquare } from "lucide-react";
import { StatusDot } from "@/components/admin/primitives";

type Section = "tours" | "inquiries" | "messages";

export default function CleanupTabV2() {
  const { t } = useLocale();
  const [activeSection, setActiveSection] = useState<Section>("tours");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <SectionToggle
          label={t("cleanupTab.sectionTours")}
          active={activeSection === "tours"}
          onClick={() => setActiveSection("tours")}
        />
        <SectionToggle
          label={t("cleanupTab.sectionInquiries")}
          active={activeSection === "inquiries"}
          onClick={() => setActiveSection("inquiries")}
        />
        <SectionToggle
          label={t("cleanupTab.sectionMessages")}
          active={activeSection === "messages"}
          onClick={() => setActiveSection("messages")}
        />
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2 text-xs text-amber-900">
        <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div>
          <div className="font-semibold mb-0.5">{t("cleanupTab.warningTitle")}</div>
          <div>{t("cleanupTab.warningBody")}</div>
        </div>
      </div>

      {activeSection === "tours" && <ToursCleanup />}
      {activeSection === "inquiries" && <InquiriesCleanup />}
      {activeSection === "messages" && <MessagesCleanup />}
    </div>
  );
}

function SectionToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={`h-7 px-3 rounded-md text-xs font-medium border transition-colors ${
        active
          ? "bg-gray-900 text-white border-gray-900"
          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400"
      }`}
    >
      {label}
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tours cleanup
// ──────────────────────────────────────────────────────────────────────
function ToursCleanup() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.adminCleanup.findStaleTours.useQuery();
  const mutation = trpc.adminCleanup.markToursInactive.useMutation({
    onSuccess: (res) => {
      toast.success(t("cleanupTab.toursMarked", { count: res.affected }));
      utils.adminCleanup.findStaleTours.invalidate();
      utils.admin.getStats.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const rows = useMemo(() => (data?.rows as any[]) ?? [], [data?.rows]);

  const toggle = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectStrong = () => {
    const next = new Set<number>();
    for (const r of rows) if (r.score >= 2) next.add(r.id);
    setSelected(next);
  };

  const clearAll = () => setSelected(new Set());

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600">
        <span>
          {t("cleanupTab.total")}: <strong>{data?.total ?? 0}</strong>
        </span>
        <span>· {t("cleanupTab.candidates")}: <strong>{data?.candidates ?? 0}</strong></span>
        <span>· {t("cleanupTab.strongCandidates")}: <strong className="text-amber-700">{data?.strongCandidates ?? 0}</strong></span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="h-7 rounded-lg ml-auto gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          {t("common.refresh")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={selectStrong}
          className="h-7 rounded-lg gap-1"
        >
          <CheckSquare className="h-3 w-3" />
          {t("cleanupTab.selectStrong")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={clearAll}
          className="h-7 rounded-lg"
        >
          {t("cleanupTab.clearSelection")}
        </Button>
        <Button
          size="sm"
          disabled={selected.size === 0 || mutation.isPending}
          onClick={() => {
            if (!confirm(t("cleanupTab.confirmMarkInactive", { count: selected.size }))) return;
            mutation.mutate({ ids: Array.from(selected) });
            setSelected(new Set());
          }}
          className="h-7 rounded-lg gap-1 bg-rose-600 hover:bg-rose-700"
        >
          <Trash2 className="h-3 w-3" />
          {t("cleanupTab.markInactive")} ({selected.size})
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-sm text-gray-500">{t("common.loading")}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colTitle")}</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colReasons")}</th>
                <th className="px-2 py-2 text-right">{t("cleanupTab.colBookings")}</th>
                <th className="px-2 py-2 text-right">{t("cleanupTab.colAge")}</th>
                <th className="px-2 py-2 text-center">{t("cleanupTab.colScore")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r: any) => (
                <tr key={r.id} className={selected.has(r.id) ? "bg-rose-50" : "hover:bg-gray-50"}>
                  <td className="px-3 py-1.5 text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-3.5 w-3.5"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 tabular-nums">#{r.id}</td>
                  <td className="px-2 py-1.5 text-gray-900 max-w-md truncate">
                    {r.title}
                    {r.featured && <span className="ml-1.5 text-[#c9a563] text-[10px]">★</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.reasons.map((reason: string, i: number) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800"
                        >
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-700">{r.bookingCount}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{r.ageDays}d</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      r.score >= 3 ? "bg-rose-100 text-rose-700"
                      : r.score >= 2 ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                    }`}>
                      {r.score}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    {t("cleanupTab.noneFound")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-500">{data?.criteriaNote}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Inquiries cleanup
// ──────────────────────────────────────────────────────────────────────
function InquiriesCleanup() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.adminCleanup.findTestInquiries.useQuery();
  const mutation = trpc.adminCleanup.deleteInquiries.useMutation({
    onSuccess: (res) => {
      toast.success(t("cleanupTab.inquiriesDeleted", { count: res.affected }));
      utils.adminCleanup.findTestInquiries.invalidate();
      utils.inquiries.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rows = useMemo(() => (data?.rows as any[]) ?? [], [data?.rows]);

  const toggle = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600">
        <span>{t("cleanupTab.total")}: <strong>{data?.total ?? 0}</strong></span>
        <span>· {t("cleanupTab.candidates")}: <strong>{data?.candidates ?? 0}</strong></span>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-7 rounded-lg ml-auto gap-1">
          <RefreshCw className="h-3 w-3" />
          {t("common.refresh")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelected(new Set(rows.filter((r) => r.score >= 2).map((r) => r.id)))}
          className="h-7 rounded-lg gap-1"
        >
          <CheckSquare className="h-3 w-3" />
          {t("cleanupTab.selectStrong")}
        </Button>
        <Button
          size="sm"
          disabled={selected.size === 0 || mutation.isPending}
          onClick={() => {
            if (!confirm(t("cleanupTab.confirmDelete", { count: selected.size }))) return;
            mutation.mutate({ ids: Array.from(selected) });
            setSelected(new Set());
          }}
          className="h-7 rounded-lg gap-1 bg-rose-600 hover:bg-rose-700"
        >
          <Trash2 className="h-3 w-3" />
          {t("cleanupTab.deleteHard")} ({selected.size})
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-sm text-gray-500">{t("common.loading")}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colName")}</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colEmail")}</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colMessage")}</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colReasons")}</th>
                <th className="px-2 py-2 text-center">{t("cleanupTab.colScore")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r: any) => (
                <tr key={r.id} className={selected.has(r.id) ? "bg-rose-50" : "hover:bg-gray-50"}>
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-3.5 w-3.5" />
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 tabular-nums">#{r.id}</td>
                  <td className="px-2 py-1.5 text-gray-900">{r.customerName || "—"}</td>
                  <td className="px-2 py-1.5 text-gray-600">{r.customerEmail || "—"}</td>
                  <td className="px-2 py-1.5 text-gray-500 max-w-xs truncate">{r.message}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.reasons.map((reason: string, i: number) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${r.score >= 3 ? "bg-rose-100 text-rose-700" : r.score >= 2 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                      {r.score}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">{t("cleanupTab.noneFound")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-500">{data?.criteriaNote}</p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Agent messages cleanup
// ──────────────────────────────────────────────────────────────────────
function MessagesCleanup() {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.adminCleanup.findTestAgentMessages.useQuery();
  const mutation = trpc.adminCleanup.deleteAgentMessages.useMutation({
    onSuccess: (res) => {
      toast.success(t("cleanupTab.messagesDeleted", { count: res.affected }));
      utils.adminCleanup.findTestAgentMessages.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const rows = useMemo(() => (data?.rows as any[]) ?? [], [data?.rows]);

  const toggle = (id: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs text-gray-600">
        <span>{t("cleanupTab.total")}: <strong>{data?.total ?? 0}</strong></span>
        <span>· {t("cleanupTab.candidates")}: <strong>{data?.candidates ?? 0}</strong></span>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="h-7 rounded-lg ml-auto gap-1">
          <RefreshCw className="h-3 w-3" />
          {t("common.refresh")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelected(new Set(rows.filter((r) => r.score >= 2).map((r) => r.id)))}
          className="h-7 rounded-lg gap-1"
        >
          <CheckSquare className="h-3 w-3" />
          {t("cleanupTab.selectStrong")}
        </Button>
        <Button
          size="sm"
          disabled={selected.size === 0 || mutation.isPending}
          onClick={() => {
            if (!confirm(t("cleanupTab.confirmDelete", { count: selected.size }))) return;
            mutation.mutate({ ids: Array.from(selected) });
            setSelected(new Set());
          }}
          className="h-7 rounded-lg gap-1 bg-rose-600 hover:bg-rose-700"
        >
          <Trash2 className="h-3 w-3" />
          {t("cleanupTab.deleteHard")} ({selected.size})
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-sm text-gray-500">{t("common.loading")}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
              <tr>
                <th className="w-8 px-3 py-2"></th>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colAgent")}</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colTitle")}</th>
                <th className="px-2 py-2 text-left">{t("cleanupTab.colReasons")}</th>
                <th className="px-2 py-2 text-center">{t("cleanupTab.colState")}</th>
                <th className="px-2 py-2 text-right">{t("cleanupTab.colAge")}</th>
                <th className="px-2 py-2 text-center">{t("cleanupTab.colScore")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r: any) => (
                <tr key={r.id} className={selected.has(r.id) ? "bg-rose-50" : "hover:bg-gray-50"}>
                  <td className="px-3 py-1.5 text-center">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-3.5 w-3.5" />
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 tabular-nums">#{r.id}</td>
                  <td className="px-2 py-1.5 text-gray-700">{r.agentName}</td>
                  <td className="px-2 py-1.5 text-gray-900 max-w-md truncate">{r.title}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.reasons.map((reason: string, i: number) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800">
                          {reason}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    {r.readByJeff ? (
                      <StatusDot tone="muted" size="xs" />
                    ) : (
                      <StatusDot tone="warn" size="xs" />
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{r.ageDays}d</td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${r.score >= 3 ? "bg-rose-100 text-rose-700" : r.score >= 2 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
                      {r.score}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400">{t("cleanupTab.noneFound")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-500">{data?.criteriaNote}</p>
    </div>
  );
}
