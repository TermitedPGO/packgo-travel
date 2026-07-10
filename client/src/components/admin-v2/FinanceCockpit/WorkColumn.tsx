/**
 * WorkColumn —— 駕駛艙左欄「工作區」。塊A 只搭骨架(欄標頭 + 建置中占位)。
 *
 * ▟ 塊B 的家:把下面 <ColumnPlaceholder> 換成三張卡 ——
 *     1) 待認領表(日期/金額/aging chip/候選 chip/認領鈕;接 bankTransactionLinks.listPending)
 *     2) 待認列確認卡(出發了·訂金可認列;認列走 audit 寫路徑)
 *     3) 已自動處理卡 +「引擎已自動對上 N 筆」摘要
 *   欄標頭的計數(待認領 N 筆)已由 CockpitData.counts 接好,塊B 補上待認列 / 已自動。
 *   真相列的「待認領」數字與此欄標頭同源(useCockpitData),不要另開會打架的 query。
 */
import { useLocale } from "@/contexts/LocaleContext";
import { ColumnHeader } from "./ColumnHeader";
import { ColumnPlaceholder } from "./ColumnPlaceholder";
import type { CockpitData } from "./types";

export function WorkColumn({ data }: { data: CockpitData }) {
  const { t } = useLocale();
  return (
    <div>
      <ColumnHeader
        title={t("financeCockpit.work.colTitle")}
        count={t("financeCockpit.work.colCount", {
          pending: String(data.counts.pendingCount),
        })}
      />
      <ColumnPlaceholder
        title={t("financeCockpit.work.placeholderTitle")}
        desc={t("financeCockpit.work.placeholderDesc")}
      />
    </div>
  );
}
