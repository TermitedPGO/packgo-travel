/**
 * SupplierMonitorCards — 批5 m2 monitor card renderers + the 🔒 price-update
 * dialog (split from SupplierMonitor to keep files under the 300-line rule).
 *
 * 更新我的售價 walks the EXISTING tours.update mutation behind a gated
 * checkbox confirm — no new money path.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { ArrowRight, Lock } from "lucide-react";
import { WorkspaceCard, BtnB, BtnO, Kv } from "./ws-ui";
import { formatRelTime } from "./relTime";
import { monitorCardKind, priceDeltaPct } from "./workspaceSuppliers.helpers";

export type MonitorLog = {
  id: number;
  tourId: number;
  monitoredAt: Date | string;
  departureDate: string | null;
  previousStatus: string | null;
  currentStatus: string | null;
  previousPrice: number | null;
  currentPrice: number | null;
  priceChanged: number | null;
  previousSeats: number | null;
  currentSeats: number | null;
  seatsChanged: number | null;
  hasChanges: number | null;
  changesSummary: string | null;
  status: "success" | "failed" | "skipped";
  errorMessage: string | null;
  tourTitle: string | null;
  tourPrice: number | null;
  tourPriceCurrency: string | null;
};

export function MonitorLogCard({
  log,
  handled,
  onToggle,
  toggleBusy,
  onUpdatePrice,
}: {
  log: MonitorLog;
  handled: boolean;
  onToggle: (handled: boolean) => void;
  toggleBusy: boolean;
  onUpdatePrice: () => void;
}) {
  const { t } = useLocale();
  const kind = monitorCardKind(log);
  const title = log.tourTitle ?? `#${log.tourId}`;
  const time = formatRelTime(log.monitoredAt, t);

  if (kind === "error") {
    return (
      <WorkspaceCard
        type={t("workspace.supMonKindError")}
        whoCompany
        time={time}
        state={handled ? "done" : "err"}
        handled={handled}
        onToggle={() => onToggle(!handled)}
        toggleBusy={toggleBusy}
        jumpLabel={t("workspace.supMonGoTour")}
        onJump={() => window.open(`/tour/${log.tourId}`, "_blank")}
      >
        <span className="font-medium">{title}</span>
        <div className="text-[11px] text-gray-500 mt-0.5 break-words">
          {log.errorMessage ?? t("workspace.supMonNoDetail")}
        </div>
      </WorkspaceCard>
    );
  }

  if (kind === "price") {
    const delta = priceDeltaPct(log.previousPrice, log.currentPrice);
    return (
      <WorkspaceCard
        type={t("workspace.supMonKindPrice")}
        emphasize
        lock
        whoCompany
        time={time}
        state={handled ? "done" : "decide"}
        handled={handled}
        onToggle={() => onToggle(!handled)}
        toggleBusy={toggleBusy}
      >
        <span className="font-medium">{title}</span>
        {log.departureDate && (
          <span className="text-[11px] text-gray-500 ml-1.5">
            {log.departureDate}
          </span>
        )}
        <div className="flex items-center gap-2.5 mt-2 flex-wrap">
          <div className="rounded-lg border border-gray-200 px-3 py-1.5 text-center">
            <div className="text-[10px] text-gray-400">
              {t("workspace.supMonPrevPrice")}
            </div>
            <div className="font-semibold text-[13px]">
              {log.previousPrice?.toLocaleString() ?? "—"}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <div className="rounded-lg border-2 border-black px-3 py-1.5 text-center">
            <div className="text-[10px] text-gray-500">
              {t("workspace.supMonCurrPrice")}
            </div>
            <div className="font-bold text-[13px]">
              {log.currentPrice?.toLocaleString() ?? "—"}
            </div>
          </div>
          {delta != null && (
            <span className="text-[11px] text-gray-500">
              {delta > 0 ? "+" : ""}
              {delta}%
            </span>
          )}
        </div>
        {log.tourPrice != null && (
          <div className="mt-2 max-w-xs">
            <Kv
              k={t("workspace.supMonMyPrice")}
              v={`${log.tourPriceCurrency ?? ""} ${log.tourPrice.toLocaleString()}`}
            />
          </div>
        )}
        {!handled && (
          <div className="flex gap-2 mt-2.5">
            <BtnB onClick={onUpdatePrice}>
              {t("workspace.supMonUpdatePrice")}
            </BtnB>
            <BtnO onClick={() => onToggle(true)}>
              {t("workspace.supMonKeepPrice")}
            </BtnO>
          </div>
        )}
        <div className="text-[10px] text-gray-400 mt-1.5">
          {t("workspace.supMonPriceSrc")}
        </div>
      </WorkspaceCard>
    );
  }

  if (kind === "soldout") {
    return (
      <WorkspaceCard
        type={t("workspace.supMonKindSoldout")}
        emphasize
        whoCompany
        time={time}
        state={handled ? "done" : "decide"}
        handled={handled}
        onToggle={() => onToggle(!handled)}
        toggleBusy={toggleBusy}
        jumpLabel={t("workspace.supMonGoTour")}
        onJump={() => window.open(`/tour/${log.tourId}`, "_blank")}
      >
        <span className="font-medium">{title}</span>
        {log.departureDate && (
          <span className="text-[11px] text-gray-500 ml-1.5">
            {log.departureDate}
          </span>
        )}
        <div className="text-[11px] text-gray-500 mt-0.5">
          {log.changesSummary ?? t("workspace.supMonSoldoutBody")}
        </div>
      </WorkspaceCard>
    );
  }

  // generic change (status / seats)
  return (
    <WorkspaceCard
      type={t("workspace.supMonKindChange")}
      whoCompany
      time={time}
      state={handled ? "done" : "wait"}
      handled={handled}
      onToggle={() => onToggle(!handled)}
      toggleBusy={toggleBusy}
      jumpLabel={t("workspace.supMonGoTour")}
      onJump={() => window.open(`/tour/${log.tourId}`, "_blank")}
    >
      <span className="font-medium">{title}</span>
      <div className="text-[11px] text-gray-500 mt-0.5 break-words">
        {log.changesSummary ?? t("workspace.supMonNoDetail")}
      </div>
    </WorkspaceCard>
  );
}

/* ─────────────── 🔒 更新我的售價 (碰錢 gated, 走既有 tours.update) ─────────────── */

/**
 * Structural subset of MonitorLog the dialog actually needs — m5's margin
 * card reuses the same gated dialog by adapting its rows to this shape.
 */
export type PriceTarget = {
  tourId: number;
  tourTitle: string | null;
  tourPrice: number | null;
  tourPriceCurrency: string | null;
  previousPrice: number | null;
  currentPrice: number | null;
};

export function UpdatePriceDialog({
  log,
  onClose,
}: {
  log: PriceTarget;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [price, setPrice] = useState(String(log.tourPrice ?? ""));
  const [confirmed, setConfirmed] = useState(false);

  const updateMut = trpc.tours.update.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.supMonPriceUpdated"));
      utils.tourMonitor.getRecentLogs.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const parsed = Number(price);
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md shadow-lg">
        <h3 className="text-sm font-semibold mb-1">
          {t("workspace.supMonUpdatePrice")}
        </h3>
        <p className="text-[11px] text-gray-500 mb-4 break-words">
          {log.tourTitle ?? `#${log.tourId}`}
        </p>

        <div className="space-y-1 mb-3">
          <Kv
            k={t("workspace.supMonSrcChange")}
            v={`${log.previousPrice?.toLocaleString() ?? "—"} → ${log.currentPrice?.toLocaleString() ?? "—"}`}
          />
          {log.tourPrice != null && (
            <Kv
              k={t("workspace.supMonMyPrice")}
              v={`${log.tourPriceCurrency ?? ""} ${log.tourPrice.toLocaleString()}`}
            />
          )}
        </div>

        <label className="text-[11px] text-gray-500 mb-1 block">
          {t("workspace.supMonNewPrice")}
          {log.tourPriceCurrency ? `（${log.tourPriceCurrency}）` : ""}
        </label>
        <input
          type="number"
          min={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-base sm:text-sm"
        />

        <div className="mt-4 rounded-lg bg-black text-white px-3 py-2.5 flex items-start gap-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <label className="flex items-start gap-2 cursor-pointer text-[11px] leading-relaxed">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>{t("workspace.supMonPriceConfirm")}</span>
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <BtnO onClick={onClose}>{t("workspace.supCancel")}</BtnO>
          <BtnB
            onClick={() =>
              updateMut.mutate({ id: log.tourId, price: parsed })
            }
            disabled={!valid || !confirmed || updateMut.isPending}
          >
            {updateMut.isPending
              ? t("workspace.supMonUpdating")
              : t("workspace.supMonConfirmUpdate")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
