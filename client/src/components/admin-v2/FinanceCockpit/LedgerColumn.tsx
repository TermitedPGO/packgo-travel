/**
 * LedgerColumn —— 駕駛艙右欄「兩本帳」。塊A 只搭骨架(欄標頭 + 建置中占位)。
 *
 * ▟ 塊C 的家:把下面 <ColumnPlaceholder> 換成兩張卡 + 空狀態 ——
 *     1) 損益卡(營收/成本行/成分條/淨利/中性列/退款列/口徑 note;接 financeKpi 或 profitLossReport)
 *     2) 客人訂金卡(Trust 餘額三段勾稽、逐團列表、footer 等式;數字由查詢算出禁寫死)
 *     3) 空狀態雙態($0 月 / 全部對上)+ loading/error(fail-open「讀取失敗」)
 *   真相列的「本月損益」「Trust 未認列」數字已在 CockpitData.truth,塊C 若要逐團 / 逐行
 *   明細,各自加 query,但總額口徑與真相列同源。
 */
import { useLocale } from "@/contexts/LocaleContext";
import { ColumnHeader } from "./ColumnHeader";
import { ColumnPlaceholder } from "./ColumnPlaceholder";
import type { CockpitData } from "./types";

export function LedgerColumn({ data: _data }: { data: CockpitData }) {
  const { t } = useLocale();
  return (
    <div>
      <ColumnHeader
        title={t("financeCockpit.ledger.colTitle")}
        count={t("financeCockpit.ledger.colSub")}
      />
      <ColumnPlaceholder
        title={t("financeCockpit.ledger.placeholderTitle")}
        desc={t("financeCockpit.ledger.placeholderDesc")}
      />
    </div>
  );
}
