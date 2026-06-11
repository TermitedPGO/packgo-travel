/**
 * WorkspaceSuppliers — 整合工作台供應商頁 shell (批5).
 *
 * Replaces SupplierEnrichmentTabV2 in WorkspaceCompany's suppliers sub-tab.
 * Mockup: 後台_07_行銷.html PAGE 2「供應商完整」.
 * 4 lazy sub-views: 同步 (m1) / 監控 (m2) / 商品庫 (m3) / 競品 (m4).
 */
import { useState, lazy, Suspense } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { RefreshCw, Activity, Library, Eye } from "lucide-react";

const SupplierSync = lazy(() => import("./SupplierSync"));
const SupplierMonitor = lazy(() => import("./SupplierMonitor"));
const SupplierCatalog = lazy(() => import("./SupplierCatalog"));

type SupplierView = "sync" | "monitor" | "catalog" | "competitor";

export default function WorkspaceSuppliers() {
  const { t } = useLocale();
  const [view, setView] = useState<SupplierView>("sync");

  const VIEWS: { id: SupplierView; label: string; icon: typeof RefreshCw }[] = [
    { id: "sync", label: t("workspace.supViewSync"), icon: RefreshCw },
    { id: "monitor", label: t("workspace.supViewMonitor"), icon: Activity },
    { id: "catalog", label: t("workspace.supViewCatalog"), icon: Library },
    { id: "competitor", label: t("workspace.supViewCompetitor"), icon: Eye },
  ];

  const fallback = (
    <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
  );

  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
              view === v.id
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:bg-gray-50"
            }`}
          >
            <v.icon className="w-3.5 h-3.5" />
            {v.label}
          </button>
        ))}
      </div>

      <Suspense fallback={fallback}>
        {view === "sync" && <SupplierSync />}
        {view === "monitor" && <SupplierMonitor />}
        {view === "catalog" && <SupplierCatalog />}
        {view === "competitor" && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-xs text-gray-400">
            {t("workspace.supComingSoon")}
          </div>
        )}
      </Suspense>
    </div>
  );
}
