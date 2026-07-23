/**
 * WorkColumn —— 駕駛艙左欄「工作區」(F3 塊B 本體,2026-07-10)。
 *
 * 三張卡:待認領表(PendingClaimsCard)、待認列確認(RecognitionCard)、
 * 已自動處理(AutoHandledCard)。欄標頭計數與真相列同源(CockpitData)。
 *
 * 1A0a allClear 公式(plan v4.3 §7.3):兩源(pendingSummary / trustReconciliation)
 * 皆 ready(蘊含 fresh)且計數皆真零才顯示綠勾;任一 loading / transport-error /
 * stale / count>0 / count===null → 顯示工作卡與(必要時)無法核實態。
 * 修 U1:error 折 0 假 all-clear。
 */
import { Check, AlertTriangle } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { ColumnHeader } from "./ColumnHeader";
import { PendingClaimsCard } from "./PendingClaimsCard";
import { RecognitionCard } from "./RecognitionCard";
import { AutoHandledCard } from "./AutoHandledCard";
import { isAllClear } from "./cockpitMath";
import type { CockpitData } from "./types";

export function WorkColumn({
  data,
  onOpenRecon,
}: {
  data: CockpitData;
  /** 「複查點對帳明細」入口(unlink 撤銷 UI 掛明細層,dispatch 塊B#4)。 */
  onOpenRecon: () => void;
}) {
  const { t } = useLocale();
  const pendingCount = data.work.pending.count;
  const recogCount = data.work.recog.count;
  const allClear = isAllClear(data.work);
  const anySourceBroken =
    data.work.pending.state === "transport-error" ||
    data.work.recog.state === "transport-error";

  const countNum = (n: number | null) => (n !== null ? String(n) : "—");

  return (
    <div>
      <ColumnHeader
        title={t("financeCockpit.work.colTitle")}
        count={
          <>
            {t("financeCockpit.work.countPendingPre")}{" "}
            <b className="font-semibold text-amber-700 tabular-nums">
              {t("financeCockpit.work.countPendingNum", { count: countNum(pendingCount) })}
            </b>{" "}
            · {t("financeCockpit.work.countRecogPre")}{" "}
            <b className="font-semibold text-amber-700 tabular-nums">
              {t("financeCockpit.work.countRecogNum", { count: countNum(recogCount) })}
            </b>
          </>
        }
      />
      <div className="space-y-4">
        {anySourceBroken ? (
          /* 1A0a:任一源連線失敗且無快取值 → 顯性「無法核實」,絕不綠勾 */
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-7 text-center">
              <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
                <AlertTriangle className="h-[18px] w-[18px] text-amber-700" />
              </div>
              <div className="text-sm font-semibold text-gray-800">
                {t("financeCockpit.work.sourceErrorTitle")}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {t("financeCockpit.work.sourceErrorDesc")}
              </div>
            </div>
          </div>
        ) : allClear ? (
          /* B-final 第二態:全部對上,今天沒有等你的事(兩源 ready+fresh+真零才進得來) */
          <div className="rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-7 text-center">
              <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-gray-50">
                <Check className="h-[18px] w-[18px] text-emerald-700" />
              </div>
              <div className="text-sm font-semibold text-gray-800">
                {t("financeCockpit.work.emptyTitle")}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {t("financeCockpit.work.emptyDesc")}
              </div>
            </div>
          </div>
        ) : (
          <>
            <PendingClaimsCard pending={data.truth.pending} />
            <RecognitionCard />
          </>
        )}
        <AutoHandledCard onOpenRecon={onOpenRecon} />
      </div>
    </div>
  );
}
