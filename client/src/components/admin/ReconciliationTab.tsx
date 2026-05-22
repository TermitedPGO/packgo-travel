/**
 * ReconciliationTab — admin view of monthly P&L + Stripe vs DB diff (v78).
 *
 * Lets admin pick a date range, runs reconciliation, and shows:
 *   - Internal payments (count + by currency)
 *   - Stripe charges (count + fees + net)
 *   - Cost categories
 *   - Discrepancies flagged by severity
 *   - P&L summary
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { LoadingRow, Spinner } from "@/components/ui/spinner";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Receipt,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

function MonthRangeInput({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Calendar className="h-4 w-4 text-gray-500" />
        <Input
          type="date"
          value={start}
          onChange={(e) => onChange(e.target.value, end)}
          className="w-40 h-9 rounded-lg"
        />
      </div>
      <span className="text-gray-400">→</span>
      <Input
        type="date"
        value={end}
        onChange={(e) => onChange(start, e.target.value)}
        className="w-40 h-9 rounded-lg"
      />
    </div>
  );
}

function thisMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
  return { start: fmt(start), end: fmt(end) };
}

export default function ReconciliationTab() {
  const { t } = useLocale();
  const initial = thisMonthRange();
  const [range, setRange] = useState(initial);
  const [report, setReport] = useState<any>(null);

  const runReportMutation = trpc.reconciliation.runReport.useMutation({
    onSuccess: (data) => {
      setReport(data);
      toast.success(t("reconciliationTab.toastDone"));
    },
    onError: (err) => toast.error(t("reconciliationTab.toastFailed") + err.message),
  });

  const fmtMoney = (amt: number, currency = "USD") => {
    if (typeof amt !== "number" || Number.isNaN(amt)) return "—";
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }).format(amt);
    } catch {
      return `${currency} ${amt.toLocaleString()}`;
    }
  };

  const severityConfig: Record<
    string,
    { label: string; icon: any; className: string }
  > = {
    high: {
      label: t("reconciliationTab.severityHigh"),
      icon: AlertTriangle,
      className: "bg-red-50 border-red-200 text-red-900",
    },
    medium: {
      label: t("reconciliationTab.severityMedium"),
      icon: AlertTriangle,
      className: "bg-amber-50 border-amber-200 text-amber-900",
    },
    low: {
      label: t("reconciliationTab.severityLow"),
      icon: AlertTriangle,
      className: "bg-blue-50 border-blue-200 text-blue-900",
    },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{t("reconciliationTab.title")}</h2>
          <p className="text-sm text-gray-500 mt-1">
            {t("reconciliationTab.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MonthRangeInput
            start={range.start}
            end={range.end}
            onChange={(start, end) => setRange({ start, end })}
          />
          <Button
            className="rounded-lg gap-1.5"
            disabled={runReportMutation.isPending}
            onClick={() =>
              runReportMutation.mutate({
                start: range.start,
                end: range.end,
              })
            }
          >
            {runReportMutation.isPending ? (
              <>
                <Spinner className="h-4 w-4" /> {t("reconciliationTab.calculating")}
              </>
            ) : (
              <>
                <Receipt className="h-4 w-4" />
                {t("reconciliationTab.runReport")}
              </>
            )}
          </Button>
        </div>
      </div>

      {!report && !runReportMutation.isPending && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Receipt className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">{t("reconciliationTab.emptyHint")}</p>
        </div>
      )}

      {report && (
        <div className="space-y-6">
          {report.warnings && report.warnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <div className="font-medium mb-1">{t("reconciliationTab.warningsTitle")}</div>
                  <ul className="list-disc list-inside space-y-0.5">
                    {report.warnings.map((w: string, i: number) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                {t("reconciliationTab.cardIncome")}
              </div>
              <div className="text-2xl font-bold text-gray-900">
                {fmtMoney(report.pnl?.income || 0, report.pnl?.currency || "USD")}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {t("reconciliationTab.cardIncomeSub", { count: report.internalPayments?.count || 0 })}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                {t("reconciliationTab.cardStripeFees")}
              </div>
              <div className="text-2xl font-bold text-amber-600">
                {fmtMoney(report.pnl?.stripeFees || 0, "USD")}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {t("reconciliationTab.cardStripeFeesSub", { count: report.stripeCharges?.count || 0 })}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                {t("reconciliationTab.cardEstimatedCosts")}
              </div>
              <div className="text-2xl font-bold text-red-600">
                {fmtMoney(report.pnl?.estimatedCosts || 0, "USD")}
              </div>
              <div className="text-xs text-gray-500 mt-1">{t("reconciliationTab.cardEstimatedCostsSub")}</div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                {t("reconciliationTab.cardNetProfit")}
              </div>
              <div
                className={`text-2xl font-bold ${
                  (report.pnl?.netProfit || 0) >= 0
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {fmtMoney(report.pnl?.netProfit || 0, "USD")}
              </div>
              <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                {(report.pnl?.netProfit || 0) >= 0 ? (
                  <>
                    <TrendingUp className="h-3 w-3 text-green-500" /> {t("reconciliationTab.profitLabel")}
                  </>
                ) : (
                  <>
                    <TrendingDown className="h-3 w-3 text-red-500" /> {t("reconciliationTab.lossLabel")}
                  </>
                )}
              </div>
            </div>
          </div>

          {Array.isArray(report.discrepancies) && report.discrepancies.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h3 className="text-sm font-semibold text-gray-900">
                  {t("reconciliationTab.discrepanciesTitle", { count: report.discrepancies.length })}
                </h3>
              </div>
              <div className="divide-y divide-gray-100">
                {report.discrepancies.map((d: any, i: number) => {
                  const cfg = severityConfig[d.severity] || severityConfig.medium;
                  const Icon = cfg.icon;
                  return (
                    <div key={i} className={`p-4 ${cfg.className}`}>
                      <div className="flex items-start gap-3">
                        <Icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="text-xs font-bold uppercase tracking-wide mb-1">
                            {cfg.label} · {d.type}
                          </div>
                          <div className="text-sm">{d.description}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 2026-05-22 — Plaid bank ledger view. Surfaces actual money flow
              from the linked bank account, grouped by category. This is the
              answer to Jeff's "how do I go from Plaid to P&L" — the bank IS
              the cash flow source of truth. */}
          {report.bank && report.bank.enabled && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <Receipt className="h-4 w-4 text-gray-600" />
                <h3 className="text-sm font-semibold text-gray-900">
                  {t("reconciliationTab.bankLedgerTitle")}
                </h3>
                <span className="text-xs text-gray-500">
                  {report.bank.txCount} {t("reconciliationTab.bankTxCount")}
                </span>
                {report.bank.uncategorizedCount > 0 && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                    <AlertTriangle className="h-3 w-3" />
                    {t("reconciliationTab.bankUncategorized", { n: report.bank.uncategorizedCount })}
                  </span>
                )}
              </div>
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm border-b border-gray-100">
                <div>
                  <div className="text-xs text-gray-500">{t("reconciliationTab.bankInflows")}</div>
                  <div className="font-semibold text-green-600 tabular-nums">
                    +{fmtMoney(report.bank.inflowsTotal, "USD")}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t("reconciliationTab.bankOutflows")}</div>
                  <div className="font-semibold text-red-600 tabular-nums">
                    -{fmtMoney(report.bank.outflowsTotal, "USD")}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t("reconciliationTab.bankNetCashFlow")}</div>
                  <div className={`font-semibold tabular-nums ${report.bank.netCashFlow >= 0 ? "text-gray-900" : "text-red-700"}`}>
                    {report.bank.netCashFlow >= 0 ? "+" : ""}{fmtMoney(report.bank.netCashFlow, "USD")}
                  </div>
                </div>
              </div>
              {Array.isArray(report.bank.byCategory) && report.bank.byCategory.length > 0 && (
                <div className="divide-y divide-gray-50">
                  {report.bank.byCategory.map((row: any, i: number) => {
                    const isIn = row.direction === "in";
                    const sourceLabel: Record<string, string> = {
                      jeff_override: t("reconciliationTab.bankSourceJeff"),
                      agent: t("reconciliationTab.bankSourceAgent"),
                      plaid_pfc: t("reconciliationTab.bankSourcePlaid"),
                      uncategorized: t("reconciliationTab.bankSourceUncategorized"),
                    };
                    return (
                      <div key={i} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${isIn ? "bg-green-500" : "bg-red-500"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900 truncate">{row.category}</div>
                          <div className="text-[11px] text-gray-500">{sourceLabel[row.source] ?? row.source} · {row.count} {t("reconciliationTab.bankRowCount")}</div>
                        </div>
                        <div className={`text-right tabular-nums font-semibold ${isIn ? "text-green-600" : "text-red-600"}`}>
                          {isIn ? "+" : "-"}{fmtMoney(row.amount, "USD")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {report.bank.excludedCount > 0 && (
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
                  {t("reconciliationTab.bankExcluded", { n: report.bank.excludedCount })}
                </div>
              )}
            </div>
          )}

          {report.stripeCharges && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-gray-600" />
                <h3 className="text-sm font-semibold text-gray-900">{t("reconciliationTab.stripeLedgerTitle")}</h3>
              </div>
              <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-xs text-gray-500">{t("reconciliationTab.stripeTotal")}</div>
                  <div className="font-semibold">
                    {fmtMoney(report.stripeCharges.totalAmount, "USD")}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t("reconciliationTab.stripeFees")}</div>
                  <div className="font-semibold text-amber-600">
                    -{fmtMoney(report.stripeCharges.totalFees, "USD")}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t("reconciliationTab.stripeNet")}</div>
                  <div className="font-semibold text-green-600">
                    {fmtMoney(report.stripeCharges.netToBank, "USD")}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">{t("reconciliationTab.stripeCurrency")}</div>
                  <div className="font-semibold">
                    {Object.keys(report.stripeCharges.byCurrency || {}).join(", ") ||
                      "—"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {Array.isArray(report.discrepancies) && report.discrepancies.length === 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div className="text-sm text-green-900">
                {t("reconciliationTab.noDiscrepancies")}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
