/**
 * FinanceLanding — QuickBooks-inspired finance dashboard.
 *
 * Layout:
 *   1. KPI strip (4 cards: income / expenses / net / trust)
 *   2. "For Review" uncategorized transactions preview (QuickBooks pattern)
 *   3. Spending breakdown bars + monthly trend chart
 *   4. Quick actions row
 *
 * Data sources:
 *   - plaid.financeKpi        → KPI numbers
 *   - plaid.transactionsList  → uncategorized preview
 *   - plaid.profitLossReport  → expense breakdown by category
 *   - plaid.profitLossTrend   → monthly bar chart
 *   - agent.listMessages      → #books channel sidebar
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Wallet,
  AlertTriangle,
  TrendingDown,
  DollarSign,
  Lock,
  ChevronRight,
  FileSpreadsheet,
  Receipt,
  ArrowDownToLine,
  Layers,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW, enUS } from "date-fns/locale";
import { KpiCard, SectionCard, LandingGreeting } from "./landingPrimitives";
import { useLocale } from "@/contexts/LocaleContext";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

/* ── helpers ─────────────────────────────────────────────────────────── */

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function thisMonthRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

/**
 * P&L report byCategory keys → display label.
 * These are Schedule C categories from bankPLService, NOT the BankLedger
 * agentCategory keys (travel_cost, software, etc). The P&L aggregates
 * into IRS buckets: cogs_tour, expense_marketing, expense_software, etc.
 */
const PL_CATEGORY_LABELS: Record<string, { zh: string; en: string }> = {
  cogs_tour: { zh: "供應商成本", en: "Supplier Cost" },
  cogs_other: { zh: "手續費", en: "Processing Fees" },
  expense_marketing: { zh: "行銷", en: "Advertising" },
  expense_software: { zh: "軟體", en: "Software" },
  expense_office: { zh: "辦公", en: "Office" },
  expense_travel: { zh: "差旅", en: "Travel" },
};

const BULK_CATEGORY_OPTIONS = [
  { value: "income_booking", zh: "訂單收入", en: "Booking Income" },
  { value: "cogs_tour", zh: "供應商成本", en: "Supplier Cost" },
  { value: "cogs_other", zh: "手續費", en: "Fees" },
  { value: "expense_marketing", zh: "行銷", en: "Marketing" },
  { value: "expense_software", zh: "軟體", en: "Software" },
  { value: "expense_office", zh: "辦公", en: "Office" },
  { value: "expense_travel", zh: "差旅", en: "Travel" },
  { value: "transfer", zh: "轉帳", en: "Transfer" },
  { value: "refund", zh: "退款", en: "Refund" },
  { value: "exclude", zh: "排除", en: "Exclude" },
] as const;

/* ── component ───────────────────────────────────────────────────────── */

export default function FinanceLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const { t, language } = useLocale();

  /* ---- data hooks ---- */
  const kpi = trpc.plaid.financeKpi.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const { from, to } = useMemo(thisMonthRange, []);

  // Uncategorized transactions for "For Review" section
  const txList = trpc.plaid.transactionsList.useQuery(
    { includeExcluded: true, limit: 200, dateFrom: from, dateTo: to },
    { refetchInterval: 60_000 }
  );

  // Monthly trend for chart
  const trend = trpc.plaid.profitLossTrend.useQuery(
    { months: 6 },
    { refetchInterval: 120_000 }
  );

  // Expense breakdown for this month
  const plReport = trpc.plaid.profitLossReport.useQuery(
    { startDate: from, endDate: to },
    { refetchInterval: 120_000 }
  );

  // Uncategorized groups for batch classify
  const uncatGroups = trpc.plaid.uncategorizedGroups.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  // Bulk categorize mutation
  const utils = trpc.useUtils();
  const bulkCategorize = trpc.plaid.bulkCategorize.useMutation({
    onSuccess: (_data, variables) => {
      const opt = BULK_CATEGORY_OPTIONS.find(
        (o) => o.value === variables.category
      );
      const catLabel = opt
        ? language === "en"
          ? opt.en
          : opt.zh
        : variables.category;
      // Extract merchant name from reason (format: "batch-classify: MERCHANT")
      const merchant =
        variables.reason?.replace("batch-classify: ", "") ?? "";
      toast.success(
        t("admin.financeLanding.bulkClassified", {
          count: String(variables.transactionIds.length),
          merchant: merchant || catLabel,
        }) + ` → ${catLabel}`
      );
      utils.plaid.uncategorizedGroups.invalidate();
      utils.plaid.transactionsList.invalidate();
      utils.plaid.financeKpi.invalidate();
      utils.plaid.profitLossReport.invalidate();
    },
  });

  // #books channel
  const booksMessages = trpc.agent.listMessages.useQuery(
    { agentName: "books", limit: 5 },
    { refetchInterval: 30_000 }
  );

  /* ---- derived ---- */
  const income = Number(kpi.data?.thisMonth.income ?? 0);
  const expenses = Number(kpi.data?.thisMonth.expenses ?? 0);
  const net = Number(kpi.data?.thisMonth.netProfit ?? 0);
  const growth = kpi.data?.vsLastMonthGrowthPct ?? 0;
  const trustDeferred = Number(kpi.data?.ytd.trustDeferredIncome ?? 0);
  const needsReviewCount = kpi.data?.thisMonth.needsReviewCount ?? 0;

  // Filter uncategorized transactions client-side
  const uncategorized = useMemo(() => {
    if (!txList.data?.items) return [];
    return txList.data.items.filter(
      (tx: any) =>
        !tx.jeffOverrideCategory &&
        !tx.agentCategory &&
        (tx.excludeFromAccounting ?? 0) !== 1
    );
  }, [txList.data]);

  // Expense breakdown sorted by absolute value
  const expenseBreakdown = useMemo(() => {
    const byCategory = (plReport.data as any)?.expenses?.byCategory as
      | Record<string, number>
      | undefined;
    if (!byCategory) return [];
    return Object.entries(byCategory)
      .map(([key, val]) => ({
        key,
        value: Math.abs(val),
      }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [plReport.data]);

  const maxExpense = expenseBreakdown[0]?.value ?? 1;

  // Trend chart data
  const trendData = useMemo(() => {
    if (!trend.data) return [];
    return trend.data.map((m: any) => ({
      month: m.month.slice(5), // "05" from "2026-05"
      income: Math.round(m.income),
      expenses: Math.round(m.cogs + m.operating),
      net: Math.round(m.netProfit),
    }));
  }, [trend.data]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* ── Header ── */}
      <LandingGreeting
        title={t("admin.financeLanding.title")}
        subtitle={t("admin.financeLanding.subtitle", {
          income: fmt(income),
          expenses: fmt(expenses),
          net: fmt(net),
          trust: fmt(trustDeferred),
          ytd: fmt(Number(kpi.data?.ytd.income ?? 0)),
        })}
      />

      {/* ── KPI strip (4 cards) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Wallet}
          label={t("admin.financeLanding.monthlyIncome")}
          primary={fmt(income)}
          secondary={t("admin.financeLanding.vsLastMonth", {
            pct: growth >= 0 ? `+${growth}` : `${growth}`,
          })}
          accent={growth >= 0 ? "emerald" : "rose"}
          trend={growth >= 0 ? "up" : "down"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={TrendingDown}
          label={t("admin.financeLanding.monthlyExpenses")}
          primary={fmt(expenses)}
          secondary={t("admin.financeLanding.expensesBreakdown")}
          accent="rose"
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={DollarSign}
          label={t("admin.financeLanding.monthlyNetProfit")}
          primary={fmt(net)}
          secondary={
            net >= 0
              ? t("admin.financeLanding.profitable")
              : t("admin.financeLanding.atLoss")
          }
          accent={net >= 0 ? "emerald" : "rose"}
          trend={net >= 0 ? "up" : "down"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={Lock}
          label={t("admin.financeLanding.customerDeposit")}
          primary={fmt(trustDeferred)}
          secondary={t("admin.financeLanding.depositNote")}
          accent="slate"
          onClick={() => onNavigate("reconciliation")}
          loading={kpi.isLoading}
        />
      </div>

      {/* ── Batch Classify (similar groups) ── */}
      {(uncatGroups.data?.groups?.length ?? 0) > 0 && (
        <SectionCard
          title={t("admin.financeLanding.batchClassify", {
            count: uncatGroups.data!.groups.length,
          })}
          icon={Layers}
          iconTone="text-teal-600"
        >
          <p className="text-xs text-foreground/50 -mt-1 mb-2">
            {t("admin.financeLanding.batchClassifyDesc", {
              count: String(uncatGroups.data!.groups.length),
            })}
          </p>
          <div className="divide-y divide-foreground/5">
            {uncatGroups.data!.groups.map((g) => {
              const isInflow = g.totalAmount < 0;
              return (
                <div
                  key={g.groupKey}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-2.5 px-1"
                >
                  <span className="text-sm font-medium text-foreground/80 truncate">
                    {g.groupKey}
                    <span className="ml-1.5 text-xs font-normal text-foreground/40">
                      × {g.count}
                    </span>
                  </span>
                  <span
                    className={`text-sm font-medium tabular-nums whitespace-nowrap ${
                      isInflow ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {isInflow ? "+" : "-"}${Math.abs(g.totalAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <Select
                    onValueChange={(cat) => {
                      bulkCategorize.mutate({
                        transactionIds: g.transactionIds,
                        category: cat,
                        reason: `batch-classify: ${g.groupKey}`,
                      });
                    }}
                  >
                    <SelectTrigger className="w-28 h-8 rounded-lg text-xs">
                      <SelectValue
                        placeholder={t("admin.financeLanding.batchClassifyPlaceholder")}
                      />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      {BULK_CATEGORY_OPTIONS.map((opt) => (
                        <SelectItem
                          key={opt.value}
                          value={opt.value}
                          className="text-xs rounded-lg"
                        >
                          {language === "en" ? opt.en : opt.zh}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* ── For Review (uncategorized transactions) ── */}
      {(uncategorized.length > 0 || needsReviewCount > 0) && (
        <SectionCard
          title={t("admin.financeLanding.forReview", {
            count: uncategorized.length || needsReviewCount,
          })}
          icon={AlertTriangle}
          iconTone="text-amber-600"
          action={{
            label: t("admin.financeLanding.categorizeAll"),
            onClick: () => onNavigate("bank-ledger"),
          }}
        >
          <div className="divide-y divide-foreground/5">
            {uncategorized.slice(0, 6).map((tx: any) => {
              const amt = toNumber(tx.amount);
              const isInflow = amt < 0;
              return (
                <button
                  key={tx.id}
                  onClick={() => onNavigate("bank-ledger")}
                  className="w-full flex items-center gap-3 py-2 px-1 hover:bg-foreground/[0.02] transition-colors text-left"
                >
                  <span className="text-xs text-foreground/40 w-14 flex-shrink-0">
                    {(() => {
                      const d = new Date(tx.date);
                      return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
                    })()}
                  </span>
                  <span className="flex-1 min-w-0 text-sm text-foreground/80 truncate">
                    {tx.merchantName ?? tx.description ?? "—"}
                  </span>
                  <span
                    className={`text-sm font-medium tabular-nums flex-shrink-0 ${
                      isInflow ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {isInflow ? "+" : "-"}${Math.abs(amt).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <ChevronRight className="w-3.5 h-3.5 text-foreground/20 flex-shrink-0" />
                </button>
              );
            })}
            {uncategorized.length > 6 && (
              <div className="pt-2 text-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-foreground/50"
                  onClick={() => onNavigate("bank-ledger")}
                >
                  {t("admin.financeLanding.moreUncategorized", {
                    count: uncategorized.length - 6,
                  })}
                </Button>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Two-column: Spending + Trend ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Spending breakdown */}
        <SectionCard
          title={t("admin.financeLanding.spendingBreakdown")}
          icon={Wallet}
          iconTone="text-rose-500"
          action={{
            label: t("admin.financeLanding.viewReport"),
            onClick: () => onNavigate("reconciliation"),
          }}
        >
          {plReport.isLoading ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              {t("admin.financeLanding.loading")}
            </div>
          ) : expenseBreakdown.length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              {t("admin.financeLanding.noExpenses")}
            </div>
          ) : (
            <div className="space-y-2.5">
              {expenseBreakdown.map((e) => (
                <div key={e.key} className="flex items-center gap-2">
                  <span className="text-xs text-foreground/60 w-20 flex-shrink-0 truncate">
                    {PL_CATEGORY_LABELS[e.key]?.[language === "en" ? "en" : "zh"] ?? e.key}
                  </span>
                  <div className="flex-1 h-5 bg-foreground/[0.04] rounded-md overflow-hidden">
                    <div
                      className="h-full bg-rose-400/60 rounded-md transition-all"
                      style={{
                        width: `${Math.max(4, (e.value / maxExpense) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium text-foreground/70 tabular-nums w-16 text-right flex-shrink-0">
                    {fmt(e.value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        {/* Monthly trend chart */}
        <SectionCard
          title={t("admin.financeLanding.monthlyTrend")}
          icon={DollarSign}
          iconTone="text-emerald-600"
        >
          {trend.isLoading ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              {t("admin.financeLanding.loading")}
            </div>
          ) : trendData.length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              {t("admin.financeLanding.noTrend")}
            </div>
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "#9ca3af" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                    }
                    width={50}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      fmt(value),
                      name === "income"
                        ? t("admin.financeLanding.chartIncome")
                        : name === "expenses"
                          ? t("admin.financeLanding.chartExpenses")
                          : t("admin.financeLanding.chartNet"),
                    ]}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="income"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="expenses"
                    fill="#f43f5e"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Bottom row: #books + Quick Actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent #books */}
        <SectionCard
          title={t("admin.financeLanding.recentBooksActions")}
          icon={Wallet}
          iconTone="text-emerald-600"
          action={{
            label: t("admin.financeLanding.viewBooksChannel"),
            onClick: () => onNavigate("agent-chat"),
          }}
        >
          {booksMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">
              {t("admin.financeLanding.loading")}
            </div>
          ) : (booksMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-4 text-center">
              {t("admin.financeLanding.noBooksActions")}
            </div>
          ) : (
            <div className="space-y-1">
              {(booksMessages.data ?? []).slice(0, 5).map((m: any) => {
                const ago = formatDistanceToNow(new Date(m.createdAt), {
                  addSuffix: false,
                  locale: language === "en" ? enUS : zhTW,
                });
                return (
                  <button
                    key={m.id}
                    onClick={() => onNavigate("agent-chat")}
                    className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/[0.03] transition-colors"
                  >
                    <span
                      className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        m.readByJeff === 0
                          ? "bg-emerald-500"
                          : "bg-foreground/15"
                      }`}
                    />
                    <span className="flex-1 min-w-0 text-xs text-foreground/80 line-clamp-1">
                      {(m.title ?? m.body ?? "").slice(0, 80)}
                    </span>
                    <span className="text-[10px] text-foreground/40 flex-shrink-0">
                      {ago}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* Quick actions */}
        <SectionCard
          title={t("admin.financeLanding.quickActions")}
          icon={Wallet}
          iconTone="text-emerald-600"
        >
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="justify-start rounded-lg text-xs"
              onClick={() => onNavigate("bank-ledger")}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />
              {t("admin.financeLanding.reconciliation")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="justify-start rounded-lg text-xs"
              onClick={() => onNavigate("reconciliation")}
            >
              <Receipt className="w-3.5 h-3.5 mr-1.5" />
              {t("admin.financeLanding.reconciliationReport")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="justify-start rounded-lg text-xs"
              onClick={() => onNavigate("invoices")}
            >
              <Receipt className="w-3.5 h-3.5 mr-1.5" />
              {t("admin.financeLanding.invoiceManagement")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="justify-start rounded-lg text-xs"
              onClick={() => onNavigate("accounting")}
            >
              <ArrowDownToLine className="w-3.5 h-3.5 mr-1.5" />
              {t("admin.financeLanding.annualTaxExport")}
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
