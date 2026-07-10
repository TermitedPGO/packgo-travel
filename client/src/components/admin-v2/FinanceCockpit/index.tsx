/**
 * FinanceCockpit —— F3 財務駕駛艙(取代 /ops/finance placeholder + /workspace 月報 tab)。
 *
 * 藍本:design-proposals/B-final-駕駛艙合成版.html(Jeff 點頭定稿,像素級基準)。
 * 佈局:PageHeader(serif H1)→ 真相列四格 → 雙欄(左工作區 / 右兩本帳)→ 第二層入口列。
 *
 * 塊A(2026-07-09)只做殼 + 真相列 + 雙欄骨架 + 第二層。左右欄本體 = 塊B/C 往
 * WorkColumn / LedgerColumn 裡填(useCockpitData 已把四個真相列數字接好,共用同源)。
 * 第二層點了在艙內開 CockpitDetail 渲染既有 FinanceReports 對應分頁(發票等未遷功能
 * 仍可達);塊D 再把「報表與稅務」換成 D 藍本正式明細頁。
 *
 * 掛在 AdminShell 內(rail 由 AdminShell 提供),故根容器自己 overflow-y-auto 捲動;
 * 也可掛在 /workspace 月報 tab(該處已有捲動,h-full 不會產生雙捲軸)。
 */
import { Suspense, lazy, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { LoadingPage } from "@/components/ui/spinner";
import { PageHeader } from "@/components/admin/primitives/PageHeader";
import { useCockpitData } from "./useCockpitData";
import { TruthRow } from "./TruthRow";
import { WorkColumn } from "./WorkColumn";
import { LedgerColumn } from "./LedgerColumn";
import { SecondaryNav } from "./SecondaryNav";
import type { FinanceReportView } from "../FinanceReports";

const FinanceReports = lazy(() => import("../FinanceReports"));

function formatAsOf(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 明細層:駕駛艙內開既有報表分頁,附返回鍵。塊D 會替換「報表與稅務」為正式頁。 */
function CockpitDetail({
  view,
  onBack,
}: {
  view: FinanceReportView;
  onBack: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-[1160px] px-6 md:px-9 pt-6 pb-16">
        <button
          type="button"
          onClick={onBack}
          className="mb-4 inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 text-xs text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <ChevronLeft className="h-[14px] w-[14px] text-gray-400" />
          {t("financeCockpit.secondary.back")}
        </button>
        <Suspense fallback={<LoadingPage text={t("financeCockpit.loading")} />}>
          <FinanceReports initialView={view} />
        </Suspense>
      </div>
    </div>
  );
}

export default function FinanceCockpit() {
  const { t } = useLocale();
  const [detail, setDetail] = useState<FinanceReportView | null>(null);
  const data = useCockpitData();

  if (detail) {
    return <CockpitDetail view={detail} onBack={() => setDetail(null)} />;
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto max-w-[1160px] px-6 md:px-9 pt-6 pb-16">
        <PageHeader
          title={t("financeCockpit.pageTitle")}
          caption={t("financeCockpit.pageSubtitle")}
          actions={
            <div className="text-right text-[11px] leading-relaxed text-gray-400">
              {t("financeCockpit.asOf", {
                time: data.asOf ? formatAsOf(data.asOf) : "—",
              })}
              <br />
              {t("financeCockpit.asOfSource")}
            </div>
          }
        />

        <TruthRow truth={data.truth} />

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.12fr_0.88fr]">
          <WorkColumn data={data} />
          <LedgerColumn data={data} />
        </div>

        <SecondaryNav onOpen={setDetail} />
      </div>
    </div>
  );
}
