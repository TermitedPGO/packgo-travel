/**
 * SecondaryNav —— 駕駛艙第二層入口列(對齊 B-final .second)。
 *
 * 塊A:先掛連結,點了在駕駛艙內開「明細層」渲染既有 FinanceReports 對應分頁
 * (完整損益表 / 發票 / 對帳明細 / 報表與稅務 / 報稅匯出),讓發票等未遷功能仍可達
 * (dispatch 塊A#4)。塊D 再把「報表與稅務」換成 D 藍本的正式明細頁。
 */
import { BarChart3, Receipt, GitCompareArrows, FileText, ArrowDownToLine } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import type { FinanceReportView } from "../FinanceReports";

const LINKS: { view: FinanceReportView; labelKey: string; icon: typeof BarChart3 }[] = [
  { view: "pl", labelKey: "financeCockpit.secondary.fullPL", icon: BarChart3 },
  { view: "invoices", labelKey: "financeCockpit.secondary.invoices", icon: Receipt },
  { view: "recon", labelKey: "financeCockpit.secondary.recon", icon: GitCompareArrows },
  { view: "tax", labelKey: "financeCockpit.secondary.reports", icon: FileText },
];

export function SecondaryNav({ onOpen }: { onOpen: (view: FinanceReportView) => void }) {
  const { t } = useLocale();
  return (
    <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
      <span className="mr-0.5 text-xs text-gray-400">{t("financeCockpit.secondary.label")}</span>
      {LINKS.map(({ view, labelKey, icon: Icon }) => (
        <button
          key={labelKey}
          type="button"
          onClick={() => onOpen(view)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <Icon className="h-[13px] w-[13px] text-gray-400" />
          {t(labelKey)}
        </button>
      ))}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => onOpen("tax")}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
      >
        <ArrowDownToLine className="h-[13px] w-[13px] text-gray-400" />
        {t("financeCockpit.secondary.exportCsv")}
      </button>
    </div>
  );
}
