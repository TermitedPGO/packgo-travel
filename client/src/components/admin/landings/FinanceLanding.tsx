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

const fmt = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

export default function FinanceLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
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
        title="💰 財務"
        subtitle={`本月 賺 ${fmt(income)} · 付 ${fmt(expenses)} · 淨 ${fmt(net)} · 訂金待 recognize ${fmt(trustDeferred)} · YTD ${fmt(ytdIncome)}`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={Wallet}
          label="本月賺多少"
          primary={fmt(income)}
          secondary={growth >= 0 ? `+${growth}% vs 上月` : `${growth}% vs 上月`}
          accent={growth >= 0 ? "emerald" : "rose"}
          trend={growth >= 0 ? "up" : "down"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={TrendingDown}
          label="本月付多少"
          primary={fmt(expenses)}
          secondary="COGS + 營運 + 軟體"
          accent="rose"
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={DollarSign}
          label="本月淨利"
          primary={fmt(net)}
          secondary={net >= 0 ? "獲利" : "虧損"}
          accent={net >= 0 ? "emerald" : "rose"}
          trend={net >= 0 ? "up" : "down"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        {/* 信託訂金 — CST §17550 negative liability. Not yours yet. */}
        <KpiCard
          icon={Lock}
          label="客人訂金 (trust)"
          primary={fmt(trustDeferred)}
          secondary="出發後才轉成收入"
          accent="slate"
          onClick={() => onNavigate("reconciliation")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={AlertTriangle}
          label="本月待 Jeff 確認"
          primary={needsReviewCount}
          secondary={needsReviewCount > 0 ? `共 ${fmt(needsReviewAmount)} 金額` : "沒有未確認筆"}
          accent={needsReviewCount > 0 ? "amber" : "slate"}
          onClick={() => onNavigate("bank-ledger")}
          loading={kpi.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label="YTD 淨利"
          primary={fmt(ytdNet)}
          secondary={`賺 ${fmt(ytdIncome)} · 2026 累計`}
          accent="indigo"
          loading={kpi.isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-2">
        <SectionCard
          title="#books channel 最近動作"
          icon={Wallet}
          iconTone="text-emerald-600"
          action={{ label: "看 #books", onClick: () => onNavigate("office-chat") }}
        >
          {booksMessages.isLoading ? (
            <div className="text-xs text-foreground/40 py-3">載入中⋯</div>
          ) : (booksMessages.data ?? []).length === 0 ? (
            <div className="text-xs text-foreground/40 py-6 text-center">
              還沒有 BooksAgent 動作。下次有 Stripe 付款或退款會自動 post。
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
                    onClick={() => onNavigate("office-chat")}
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

        <SectionCard title="快速動作" icon={Wallet} iconTone="text-emerald-600">
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("bank-ledger")}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              對帳 / Plaid Transactions
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("reconciliation")}
            >
              <Receipt className="w-4 h-4 mr-2" />
              對帳報表
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("invoices")}
            >
              <Receipt className="w-4 h-4 mr-2" />
              發票管理
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start rounded-lg"
              onClick={() => onNavigate("finance")}
            >
              <ArrowDownToLine className="w-4 h-4 mr-2" />
              年度稅務匯出 (Schedule C)
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
