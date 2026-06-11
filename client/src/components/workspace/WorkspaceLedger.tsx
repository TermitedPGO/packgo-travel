/**
 * WorkspaceLedger — 批3 財務 shell (記帳 sub-tab of WorkspaceCompany).
 *
 * 4 sub-views: 待分類 (m1 triage cards) / 信託 (m2) / 催款唯讀 (m3) /
 * 全部交易 (existing BankLedgerV2 power table, untouched).
 * 碰錢批拍板:只 reuse 既有 mutation,零新自動流程。
 */
import { useState, lazy, Suspense } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { Inbox, Lock, BellRing, Table } from "lucide-react";

const LedgerTriage = lazy(() => import("./LedgerTriage"));
const LedgerTrust = lazy(() => import("./LedgerTrust"));
const LedgerReceivables = lazy(() => import("./LedgerReceivables"));
const BankLedgerV2 = lazy(() => import("@/components/admin-v2/BankLedgerV2"));

type LedgerView = "triage" | "trust" | "receivables" | "all";

export default function WorkspaceLedger() {
  const { t } = useLocale();
  const [view, setView] = useState<LedgerView>("triage");

  const VIEWS: { id: LedgerView; label: string; icon: typeof Inbox }[] = [
    { id: "triage", label: t("workspace.ldgTriage"), icon: Inbox },
    { id: "trust", label: t("workspace.ldgTrust"), icon: Lock },
    { id: "receivables", label: t("workspace.ldgReceivables"), icon: BellRing },
    { id: "all", label: t("workspace.ldgAll"), icon: Table },
  ];

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

      <Suspense
        fallback={
          <p className="text-xs text-gray-400 py-4">{t("workspace.loading")}</p>
        }
      >
        {view === "triage" && <LedgerTriage />}
        {view === "trust" && <LedgerTrust />}
        {view === "receivables" && <LedgerReceivables />}
        {view === "all" && <BankLedgerV2 />}
      </Suspense>
    </div>
  );
}
