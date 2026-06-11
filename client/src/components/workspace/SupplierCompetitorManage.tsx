/**
 * SupplierCompetitorManage — 批5 m4 競品最小管理(列表/新增/手動爬/刪除)
 * (split from SupplierCompetitor for the 300-line rule).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { BtnB, BtnO, Badge, Pill } from "./ws-ui";
import { formatRelTime } from "./relTime";

const COMPETITOR_LABELS: Record<string, string> = {
  liontravel: "workspace.supCmpV_liontravel",
  colatour: "workspace.supCmpV_colatour",
  settour: "workspace.supCmpV_settour",
};

/* ───────────────────── 最小管理 ───────────────────── */

export function ManageList({ onAdd }: { onAdd: () => void }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const toursQ = trpc.competitor.list.useQuery({ page: 1, pageSize: 30 });
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const scrapeMut = trpc.competitor.triggerScrape.useMutation({
    onSuccess: () => toast.success(t("workspace.supCmpScrapeQueued")),
    onError: (e) => toast.error(e.message),
  });
  const deleteMut = trpc.competitor.delete.useMutation({
    onSuccess: () => {
      utils.competitor.list.invalidate();
      toast.success(t("workspace.supCmpDeleted"));
      setDeletingId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const tours = toursQ.data?.tours ?? [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold">
          {t("workspace.supCmpTracked", { n: toursQ.data?.total ?? 0 })}
        </span>
        <BtnO onClick={onAdd}>
          <span className="inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />
            {t("workspace.supCmpAdd")}
          </span>
        </BtnO>
      </div>
      <div className="divide-y divide-gray-100">
        {tours.map((c) => (
          <div
            key={c.id}
            className="px-3 py-2 flex items-center gap-2.5 min-w-0"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium truncate">
                {c.tourTitle || c.tourUrl}
              </div>
              <div className="text-[11px] text-gray-400 flex items-center gap-1.5 flex-wrap">
                <Badge>
                  {COMPETITOR_LABELS[c.competitor]
                    ? t(COMPETITOR_LABELS[c.competitor])
                    : c.competitor}
                </Badge>
                <Pill>{t(`workspace.supCmpSt_${c.scrapeStatus}`)}</Pill>
                {c.basePrice != null && (
                  <span>${Number(c.basePrice).toLocaleString()}</span>
                )}
                {c.lastScrapedAt && (
                  <span>{formatRelTime(c.lastScrapedAt, t)}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {deletingId === c.id ? (
                <>
                  <span className="text-[10px] text-gray-500">
                    {t("workspace.supCmpDeleteConfirm")}
                  </span>
                  <BtnB
                    onClick={() => deleteMut.mutate({ id: c.id })}
                    disabled={deleteMut.isPending}
                  >
                    {t("workspace.supCmpDeleteGo")}
                  </BtnB>
                  <BtnO onClick={() => setDeletingId(null)}>
                    {t("workspace.supCancel")}
                  </BtnO>
                </>
              ) : (
                <>
                  <BtnO
                    onClick={() => scrapeMut.mutate({ id: c.id })}
                    disabled={scrapeMut.isPending}
                  >
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw className="w-3 h-3" />
                      {t("workspace.supCmpScrape")}
                    </span>
                  </BtnO>
                  <BtnO onClick={() => setDeletingId(c.id)}>
                    <Trash2 className="w-3 h-3" />
                  </BtnO>
                </>
              )}
            </div>
          </div>
        ))}
        {tours.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">
            {t("workspace.supCmpEmpty")}
          </p>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── 新增 dialog ───────────────────── */

export function AddDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [competitor, setCompetitor] = useState<
    "liontravel" | "colatour" | "settour"
  >("liontravel");
  const [tourUrl, setTourUrl] = useState("");
  const [tourTitle, setTourTitle] = useState("");

  const createMut = trpc.competitor.create.useMutation({
    onSuccess: () => {
      utils.competitor.list.invalidate();
      toast.success(t("workspace.supCmpAdded"));
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const validUrl = /^https?:\/\/.+/.test(tourUrl.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md shadow-lg">
        <h3 className="text-sm font-semibold mb-4">
          {t("workspace.supCmpAdd")}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.supCmpVendor")}
            </label>
            <select
              value={competitor}
              onChange={(e) =>
                setCompetitor(e.target.value as typeof competitor)
              }
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-base sm:text-sm"
            >
              <option value="liontravel">
                {t("workspace.supCmpV_liontravel")} (liontravel)
              </option>
              <option value="colatour">
                {t("workspace.supCmpV_colatour")} (colatour)
              </option>
              <option value="settour">
                {t("workspace.supCmpV_settour")} (settour)
              </option>
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.supCmpUrl")}
            </label>
            <input
              value={tourUrl}
              onChange={(e) => setTourUrl(e.target.value)}
              placeholder="https://…"
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-base sm:text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">
              {t("workspace.supCmpTitle")}
            </label>
            <input
              value={tourTitle}
              onChange={(e) => setTourTitle(e.target.value)}
              placeholder={t("workspace.supCmpTitlePh")}
              className="w-full px-3 py-2 rounded-lg border border-gray-300 text-base sm:text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <BtnO onClick={onClose}>{t("workspace.supCancel")}</BtnO>
          <BtnB
            onClick={() =>
              createMut.mutate({
                competitor,
                tourUrl: tourUrl.trim(),
                tourTitle: tourTitle.trim() || undefined,
              })
            }
            disabled={!validUrl || createMut.isPending}
          >
            {createMut.isPending
              ? t("workspace.supCmpAdding")
              : t("workspace.supCmpAddGo")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
