/**
 * Round 81 / 2026-05-17 — Finance domain landing page.
 *
 * Jeff's books-and-cash dashboard:
 *   • This month revenue + delta vs last
 *   • YTD revenue
 *   • Unclassified BofA transactions (high-priority backlog)
 *   • Outstanding balances (booking deposits not yet paid full)
 *   • Recent Stripe activity (#books channel)
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  CreditCard,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  FileSpreadsheet,
  Receipt,
  ArrowDownToLine,
  DollarSign,
  Lock,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { KpiCard, SectionCard, LandingGreeting } from "./landingPrimitives";
import { useLocale } from "@/contexts/LocaleContext";

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

export default function FinanceLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const { t } = useLocale();
  const stats = trpc.admin.getStats.useQuery(undefined, { refetchInterval: 60_000 });
  // 2026-05-22 — Plaid-derived P&L. Previously this page read revenue from
  // bookings table only ($0 because direct Zelle / ACH inflows never land
  // in bookings). The financeKpi query sums bankTransactions classified by
  // the AccountingAgent — gives real "賺多少 / 付多少" totals.
  const kpi = trpc.plaid.financeKpi.useQuery(undefined, { refetchInterval: 60_000 });
  const booksMessages = trpc.agent.listMessages.useQuery(
    { agentName: "books" as any, limit: 8 },
    { refetchInterval: 30_000 }
  );

  const income = Number(kpi.data?.thisMonth.income ?? 0);
  const expenses = Number(kpi.data?.thisMonth.expenses ?? 0);
  const net = Number(kpi.data?.thisMonth.netProfit ?? 0);
  const growth = kpi.data?.vsLastMonthGrowthPct ?? 0;
  const ytdIncome = Number(kpi.data?.ytd.income ?? 0);
  const ytdNet = Number(kpi.data?.ytd.netProfit ?? 0);
  const needsReviewCount = kpi.data?.thisMonth.needsReviewCount ?? 0;
  const needsReviewAmount = Number(kpi.data?.thisMonth.needsReviewAmount ?? 0);
  // CST §17550 trust deferred — Jeff:「放在trust account 是客人訂金 不能算
  // 我的, 除非真的跑到我的checking」. Already subtracted from `income` +
  // `net` above; this is the standalone "客人訂金待 recognize" figure.
  const trustDeferred = Number(kpi.data?.ytd.trustDeferredIncome ?? 0);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <LandingGreeting
        title={t('admin.financeLanding.title')}
        subtitle={t('admin.financeLanding.subtitle', { income: fmt(income), expenses: fmt(expenses), net: fmt(net), trust: fmt(trustDeferred), ytd: fmt(ytdIncome) })}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={Wallet}
          label={t('admin.financeLanding.monthlyIncome')}
          primary={fmt(income)}
          secondary={t('admin.financeLanding.vsLastMonth', { pct: growth >= 0 ? `+${growth}` : `${growth}` })}
          accent={growth >= 0 ? "emerald" : "rose"}
          trend={growth >= 0 ? "up" : "down"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={TrendingDown}
          label={t('admin.financeLanding.monthlyExpenses')}
          primary={fmt(expenses)}
          secondary={t('admin.financeLanding.expensesBreakdown')}
          accent="rose"
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={DollarSign}
          label={t('admin.financeLanding.monthlyNetProfit')}
          primary={fmt(net)}
          secondary={net >= 0 ? t('admin.financeLanding.profitable') : t('admin.financeLanding.atLoss')}
          accent={net >= 0 ? "emerald" : "rose"}
          trend={net >= 0 ? "up" : "down"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        {/* 信託訂金 — CST §17550 negative liability. Not yours yet. */}
        <KpiCard
          icon={Lock}
          label={t('admin.financeLanding.customerDeposit')}
          primary={fmt(trustDeferred)}
          secondary={t('admin.financeLanding.depositNote')}
          accent="slate"
          onClick={() => onNavigate("reconciliation")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={AlertTriangle}
          label={t('admin.financeLanding.pendingReview')}
          primary={needsReviewCount}
          secondary={needsReviewCount > 0 ? t('admin.financeLanding.pendingAmount', { amount: fmt(needsReviewAmount) }) : t('admin.financeLanding.noPending')}
          accent={needsReviewCount > 0 ? "amber" : "slate"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label={t('admin.financeLanding.ytdNetProfit')}
          primary={fmt(ytdNet)}
          secondary={t('admin.financeLanding.ytdEarned', { amount: fmt(ytdIncome) })}
          accent="indigo"
          loading={kpi.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        <SectionCard
          title={t('admin.financeLanding.recentBooksActions')}
          icon={Wallet}
          iconTone="text-emerald-600"
          action={{ label: t('admin.financeLanding.viewBooksChannel'), onClick: () => onNavigate("agent-chat") }}
        >
          {booksMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">{t('admin.financeLanding.loading')}</div>
          ) : (booksMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              {t('admin.financeLanding.noBooksActions')}
            </div>
          ) : (
            <div className="space-y-1.5">
              {(booksMessages.data ?? []).slice(0, 8).map((m: any) => {
                const ago = formatDistanceToNow(new Date(m.createdAt), {
                  addSuffix: false,
                  locale: zhTW,
                });
                return (
                  <button
                    key={m.id}
                    onClick={() => onNavigate("agent-chat")}
                    className="w-full text-left flex items-start gap-2 px-1.5 py-1 rounded-md hover:bg-foreground/[0.03] transition-colors"
                  >
                    <span
                      className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        m.readByJeff === 0 ? "bg-emerald-500" : "bg-foreground/15"
                      }`}
                    />
                    <span className="flex-1 min-w-0 text-xs text-foreground/80">
                      {(m.title ?? m.body ?? "").slice(0, 80)}
                    </span>
                    <span className="text-[10px] text-foreground/40 flex-shrink-0">{ago}</span>
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title={t('admin.financeLanding.quickActions')} icon={Wallet} iconTone="text-emerald-600">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("bank-ledger")}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              {t('admin.financeLanding.reconciliation')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("reconciliation")}
            >
              <Receipt className="w-4 h-4 mr-2" />
              {t('admin.financeLanding.reconciliationReport')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("invoices")}
            >
              <Receipt className="w-4 h-4 mr-2" />
              {t('admin.financeLanding.invoiceManagement')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("finance")}
            >
              <ArrowDownToLine className="w-4 h-4 mr-2" />
              {t('admin.financeLanding.annualTaxExport')}
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
