/**
 * FinanceTab — v78z-z3 Sprint 9: unified parent for the 3 financial views.
 *
 * Per UX audit: Invoices + Reconciliation + Accounting all operate on the
 * same financial truth (Stripe + bookings + manual entries). Solo founder
 * was context-switching between 3 tabs to answer "did I make money this
 * month?" — now one tab, with Reconcile (P&L) as default landing view.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { Calculator, Receipt, DollarSign } from "lucide-react";
import ReconciliationTab from "./ReconciliationTab";
import InvoicesTab from "./InvoicesTab";
import AccountingTab from "./AccountingTab";
import { useLocale } from "@/contexts/LocaleContext";

type FinanceSubTab = "reconcile" | "invoices" | "accounting";

export default function FinanceTab() {
  const { t } = useLocale();
  // Reconcile P&L is default per UX audit — most common question
  // ("did I make money this month?") is answered there.
  const [activeTab, setActiveTab] = useState<FinanceSubTab>("reconcile");

  const tabs: { id: FinanceSubTab; icon: any; label: string; desc: string }[] = [
    { id: "reconcile",  icon: Calculator,  label: t("financeTab.reconcileLabel"),  desc: t("financeTab.reconcileDesc") },
    { id: "invoices",   icon: Receipt,     label: t("financeTab.invoicesLabel"),   desc: t("financeTab.invoicesDesc") },
    { id: "accounting", icon: DollarSign,  label: t("financeTab.accountingLabel"), desc: t("financeTab.accountingDesc") },
  ];

  return (
    <div className="space-y-0">
      {/* Page Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900">{t("financeTab.title")}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{t("financeTab.subtitle")}</p>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors relative
                ${isActive
                  ? "text-gray-900 border-b-2 border-black -mb-px"
                  : "text-gray-500 hover:text-gray-700 border-b-2 border-transparent -mb-px"
                }
              `}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
              {isActive && (
                <span className="hidden sm:inline text-xs text-gray-400 font-normal ml-1">
                  — {tab.desc}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "reconcile"  && <ReconciliationTab />}
        {activeTab === "invoices"   && <InvoicesTab />}
        {activeTab === "accounting" && <AccountingTab />}
      </div>
    </div>
  );
}
