/**
 * TourCalibrationCard — 批7 m4 品質卡(吸收 calibration-review tab).
 *
 * 總分 + verdict;展開 getCalibrationResult 5 分項 + issues。
 * pending_review 行程在這裡 approve 🔒(客人立刻可見)/ reject —
 * 既有 approveTour / rejectTour mutation,零新寫路徑。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Lock } from "lucide-react";
import { BtnB, BtnO, Kv, Pill, Src } from "./ws-ui";

export default function TourCalibrationCard({
  tour,
}: {
  tour: {
    id: number;
    status: string;
    calibrationScore?: number | null;
    calibrationVerdict?: string | null;
  };
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveChecked, setApproveChecked] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const pending = tour.status === "pending_review";
  const hasScore = tour.calibrationScore != null;
  if (!hasScore && !pending) return null;

  const calibQ = trpc.tours.getCalibrationResult.useQuery(
    { tourId: tour.id },
    { enabled: expanded },
  );

  const invalidate = () => {
    utils.tours.getById.invalidate({ id: tour.id });
    utils.tours.list.invalidate();
  };
  const approveMut = trpc.tours.approveTour.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      invalidate();
      setApproving(false);
    },
    onError: (e) => toast.error(e.message),
  });
  const rejectMut = trpc.tours.rejectTour.useMutation({
    onSuccess: (res) => {
      toast.success(res.message);
      invalidate();
      setRejecting(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const detail = calibQ.data;
  const issues = parseIssues(detail?.issues);

  return (
    <div
      className={`rounded-xl bg-white p-3 ${
        pending ? "border-2 border-black" : "border border-gray-200"
      }`}
    >
      <h3 className="text-[12px] font-semibold mb-1.5 flex items-center gap-1.5">
        {pending && <Lock className="w-3.5 h-3.5" />}
        {t("workspace.trsQuality")}
      </h3>
      {hasScore && (
        <Kv
          k={t("workspace.trsCalibTotal")}
          v={`${tour.calibrationScore} / 100`}
        />
      )}
      {tour.calibrationVerdict && (
        <div className="mt-1.5">
          <Pill>{t(`workspace.trsVerdict_${tour.calibrationVerdict}`)}</Pill>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="mt-2 text-[11px] text-gray-400 inline-flex items-center gap-0.5 min-h-[44px] sm:min-h-0"
      >
        {expanded ? t("workspace.trsCalibLess") : t("workspace.trsCalibMore")}
        {expanded ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-0.5">
          {calibQ.isLoading && (
            <p className="text-[11px] text-gray-400">{t("workspace.loading")}</p>
          )}
          {!calibQ.isLoading && !detail && (
            <p className="text-[11px] text-gray-400">
              {t("workspace.trsNoCalib")}
            </p>
          )}
          {detail && (
            <>
              <Kv k={t("workspace.trsCalibContent")} v={detail.contentFidelityScore} />
              <Kv k={t("workspace.trsCalibTranslation")} v={detail.translationScore} />
              <Kv k={t("workspace.trsCalibImage")} v={detail.imageScore} />
              <Kv k={t("workspace.trsCalibCompleteness")} v={detail.completenessScore} />
              <Kv k={t("workspace.trsCalibMarketing")} v={detail.marketingScore} />
              {issues.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {issues.slice(0, 5).map((iss, i) => (
                    <div key={i} className="text-[11px] text-gray-600 break-words">
                      <span className="font-medium">{iss.check}</span>
                      {": "}
                      {iss.message}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <Src>{t("workspace.trsCalibSrc")}</Src>

      {pending && (
        <div className="mt-2.5 space-y-2">
          {approving ? (
            <div className="rounded-lg bg-black text-white px-3 py-2.5 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer text-[11px] leading-relaxed">
                <input
                  type="checkbox"
                  checked={approveChecked}
                  onChange={(e) => setApproveChecked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>{t("workspace.trsApproveConfirm")}</span>
              </label>
              <div className="flex gap-2">
                <BtnO onClick={() => setApproving(false)}>
                  {t("workspace.supCancel")}
                </BtnO>
                <button
                  onClick={() => approveMut.mutate({ id: tour.id })}
                  disabled={!approveChecked || approveMut.isPending}
                  className="px-2.5 py-1 rounded-lg bg-white text-black text-[11px] font-medium disabled:opacity-40"
                >
                  {t("workspace.trsApproveGo")}
                </button>
              </div>
            </div>
          ) : rejecting ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-gray-500">
                {t("workspace.trsRejectConfirm")}
              </span>
              <BtnB
                onClick={() => rejectMut.mutate({ id: tour.id })}
                disabled={rejectMut.isPending}
              >
                {t("workspace.trsRejectGo")}
              </BtnB>
              <BtnO onClick={() => setRejecting(false)}>
                {t("workspace.supCancel")}
              </BtnO>
            </div>
          ) : (
            <div className="flex gap-2">
              <BtnB onClick={() => setApproving(true)}>
                {t("workspace.trsApprove")}
              </BtnB>
              <BtnO onClick={() => setRejecting(true)}>
                {t("workspace.trsReject")}
              </BtnO>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function parseIssues(
  raw: string | null | undefined,
): { check: string; message: string }[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (x): x is { check: string; message: string } =>
          x != null &&
          typeof x === "object" &&
          typeof x.check === "string" &&
          typeof x.message === "string",
      )
      .slice(0, 10);
  } catch {
    return [];
  }
}
