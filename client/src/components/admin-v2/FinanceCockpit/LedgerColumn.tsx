/**
 * LedgerColumn —— 駕駛艙右欄「兩本帳」(F3 塊C 本體,2026-07-10)。
 *
 * 兩張卡:損益卡(PLCard,profitLossReport)+ 客人訂金卡(TrustCard,三段
 * 拆分吃 truth.trust 與真相列同源)。$0 月 / 空 Trust / loading / error / stale
 * 三態在各卡內處理(resolveTileState 模式)。
 */
import { useLocale } from "@/contexts/LocaleContext";
import { ColumnHeader } from "./ColumnHeader";
import { PLCard } from "./PLCard";
import { TrustCard } from "./TrustCard";
import type { CockpitData } from "./types";

export function LedgerColumn({ data }: { data: CockpitData }) {
  const { t } = useLocale();
  return (
    <div>
      <ColumnHeader
        title={t("financeCockpit.ledger.colTitle")}
        count={t("financeCockpit.ledger.colSub")}
      />
      <div className="space-y-4">
        <PLCard />
        <TrustCard trust={data.truth.trust} />
      </div>
    </div>
  );
}
