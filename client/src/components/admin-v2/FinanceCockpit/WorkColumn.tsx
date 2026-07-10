/**
 * WorkColumn —— 駕駛艙左欄「工作區」(F3 塊B 本體,2026-07-10)。
 *
 * 三張卡:待認領表(PendingClaimsCard)、待認列確認(RecognitionCard)、
 * 已自動處理(AutoHandledCard)。欄標頭計數與真相列同源(CockpitData);
 * 待認領 0 且待認列 0 時顯示「今天沒有等你的事」空態(B-final 第二態),
 * 已自動卡仍顯示(讓 Jeff 知道引擎活著)。
 */
import { Check } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { ColumnHeader } from "./ColumnHeader";
import { PendingClaimsCard } from "./PendingClaimsCard";
import { RecognitionCard } from "./RecognitionCard";
import { AutoHandledCard } from "./AutoHandledCard";
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
  const pendingCount = data.counts.pendingCount;
  const recogCount = data.counts.departedPendingCount;
  const allClear = pendingCount === 0 && recogCount === 0 && !data.isLoading;

  return (
    <div>
      <ColumnHeader
        title={t("financeCockpit.work.colTitle")}
        count={
          <>
            {t("financeCockpit.work.countPendingPre")}{" "}
            <b className="font-semibold text-amber-700 tabular-nums">
              {t("financeCockpit.work.countPendingNum", { count: String(pendingCount) })}
            </b>{" "}
            · {t("financeCockpit.work.countRecogPre")}{" "}
            <b className="font-semibold text-amber-700 tabular-nums">
              {t("financeCockpit.work.countRecogNum", { count: String(recogCount) })}
            </b>
          </>
        }
      />
      <div className="space-y-4">
        {allClear ? (
          /* B-final 第二態:全部對上,今天沒有等你的事 */
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
