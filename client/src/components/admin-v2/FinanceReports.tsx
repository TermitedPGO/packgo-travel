/**
 * FinanceReports — 財務「報表」中心 (2026-05-29 七合三 UI 簡化)。
 *
 * Jeff:「用的更直白簡單 也不要叫什麼 V2」。財務原本 7 個分頁 (3 主要 +
 * 4 進階) 收成 3 個 (總覽 / 帳本 / 報表)。本元件就是「報表」這一頁，把
 * 五張報表收進同一個地方，用上面一排小切換在彼此間切，不用回總覽。
 *
 *   損益表 (ProfitLossV2)          ← 預設
 *   對帳   (ReconciliationTab)
 *   發票   (InvoicesTab)
 *   待認領 (PendingClaimsTab)       ← F1 對帳引擎 塊A 新增 (2026-07-08)
 *   客人訂金 (TrustComplianceV2)    ← 原「信託合規」白話化
 *   報稅匯出 (AccountingTab)        ← 原「帳務 (Schedule C)」白話化
 *
 * `initialView` 讓總覽頁 / DailyBriefingCard / 手機版的深層連結
 * (onNavigate("reconciliation") 等) 直接落到對的那張報表 — 既有 caller
 * 完全不用改 (AdminV2 把舊 pageId 對映到這裡的 view)。
 */
import { Suspense, lazy, useEffect, useState } from "react";
import { LoadingPage } from "@/components/ui/spinner";
import { BarChart3, Scale, Receipt, Lock, ArrowDownToLine, Inbox } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

const ProfitLossV2 = lazy(() => import("./ProfitLossV2"));
const TrustComplianceV2 = lazy(() => import("./TrustComplianceV2"));
const ReconciliationTab = lazy(() => import("@/components/admin/ReconciliationTab"));
const InvoicesTab = lazy(() => import("@/components/admin/InvoicesTab"));
const AccountingTab = lazy(() => import("@/components/admin/AccountingTab"));
const PendingClaimsTab = lazy(() => import("@/components/admin/PendingClaimsTab"));

export type FinanceReportView = "pl" | "recon" | "invoices" | "pendingClaims" | "trust" | "tax";

export default function FinanceReports({
  initialView = "pl",
}: {
  initialView?: FinanceReportView;
}) {
  const { t } = useLocale();
  const TABS: { id: FinanceReportView; label: string; icon: typeof BarChart3 }[] = [
    { id: "pl", label: "損益表", icon: BarChart3 },
    { id: "recon", label: "對帳", icon: Scale },
    { id: "invoices", label: "發票", icon: Receipt },
    // F1 對帳引擎 塊A (2026-07-08) — 既有 5 個分頁的 label 是既存的硬編碼中文
    // (超出本批範圍,不動),新增的這一頁走 i18n key,不重蹈覆轍。
    { id: "pendingClaims", label: t("pendingClaimsTab.tabLabel"), icon: Inbox },
    { id: "trust", label: "客人訂金", icon: Lock },
    { id: "tax", label: "報稅匯出", icon: ArrowDownToLine },
  ];
  const [view, setView] = useState<FinanceReportView>(initialView);
  // Re-sync when a deep-link lands on a specific report while the hub is
  // already mounted. Re-renders that don't change initialView (badge polls)
  // leave Jeff's current inner view untouched.
  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  return (
    <div className="space-y-4">
      {/* ── Report switcher (left edge aligns with the max-w-5xl reports) ── */}
      <div className="max-w-5xl mx-auto">
        <div className="inline-flex flex-wrap gap-1 rounded-xl border border-foreground/10 bg-white p-1">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setView(tab.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-teal-600 text-white"
                    : "text-foreground/60 hover:text-foreground/90 hover:bg-foreground/5"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<LoadingPage text="載入中…" />}>
        {view === "pl" && <ProfitLossV2 />}
        {view === "recon" && <ReconciliationTab />}
        {view === "invoices" && <InvoicesTab />}
        {view === "pendingClaims" && <PendingClaimsTab />}
        {view === "trust" && <TrustComplianceV2 />}
        {view === "tax" && <AccountingTab />}
      </Suspense>
    </div>
  );
}
