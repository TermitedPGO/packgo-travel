/**
 * WorkspaceCompany — 整合工作台 全公司事務 (P4).
 *
 * Non-customer work in one place: 記帳 / 月報 / 行銷 / 供應商. P4 reuses the
 * existing admin tabs (zero new backend), wired under a 4-tab sub-nav.
 * Richer per-domain workspace views (the design's cards) land later.
 */
import { useState, lazy, Suspense } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { LoadingPage } from "@/components/ui/spinner";

const BankLedgerV2 = lazy(() => import("@/components/admin-v2/BankLedgerV2"));
const FinanceReports = lazy(
  () => import("@/components/admin-v2/FinanceReports"),
);
const NewsletterTabV2 = lazy(
  () => import("@/components/admin-v2/NewsletterTabV2"),
);
const SupplierEnrichmentTabV2 = lazy(
  () => import("@/components/admin-v2/SupplierEnrichmentTabV2"),
);

type CompanyTab = "ledger" | "reports" | "marketing" | "suppliers";

const TABS: { id: CompanyTab; label: string }[] = [
  { id: "ledger", label: "workspace.companyLedger" },
  { id: "reports", label: "workspace.companyReports" },
  { id: "marketing", label: "workspace.companyMarketing" },
  { id: "suppliers", label: "workspace.companySuppliers" },
];

export default function WorkspaceCompany({
  sub,
  onSubChange,
}: {
  /** controlled active tab (driven by the workspace sidebar sub-items). */
  sub?: CompanyTab;
  onSubChange?: (s: CompanyTab) => void;
} = {}) {
  const { t } = useLocale();
  const [internalTab, setInternalTab] = useState<CompanyTab>("ledger");
  const tab = sub ?? internalTab;
  const setTab = (id: CompanyTab) => {
    setInternalTab(id);
    onSubChange?.(id);
  };

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
              tab === tb.id
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            {t(tb.label)}
          </button>
        ))}
      </div>

      <Suspense fallback={<LoadingPage text={t("workspace.loading")} />}>
        {tab === "ledger" && <BankLedgerV2 />}
        {tab === "reports" && <FinanceReports />}
        {tab === "marketing" && <NewsletterTabV2 />}
        {tab === "suppliers" && <SupplierEnrichmentTabV2 />}
      </Suspense>
    </div>
  );
}
