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
  FileSpreadsheet,
  Receipt,
  ArrowDownToLine,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";
import { KpiCard, SectionCard, LandingGreeting } from "./landingPrimitives";

export default function FinanceLanding({
  onNavigate,
}: {
  onNavigate: (pageId: string) => void;
}) {
  const stats = trpc.admin.getStats.useQuery(undefined, { refetchInterval: 60_000 });
  const booksMessages = trpc.agent.listMessages.useQuery(
    { agentName: "books" as any, limit: 8 },
    { refetchInterval: 30_000 }
  );

  const thisMonth = Number(stats.data?.thisMonthRevenue ?? 0);
  const growth = stats.data?.revenueGrowth ?? 0;
  const ytd = Number(stats.data?.totalRevenue ?? 0);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <LandingGreeting
        title="💰 財務"
        subtitle={`本月 $${thisMonth.toLocaleString()} · YTD $${ytd.toLocaleString()} · BofA 對帳待處理`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={Wallet}
          label="本月營收"
          primary={`$${thisMonth.toLocaleString()}`}
          secondary={
            growth >= 0
              ? `+${growth}% vs 上月`
              : `${growth}% vs 上月`
          }
          accent={growth >= 0 ? "emerald" : "rose"}
          trend={growth >= 0 ? "up" : "down"}
          onClick={() => onNavigate("accounting")}
          loading={stats.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label="YTD 營收"
          primary={`$${ytd.toLocaleString()}`}
          secondary="2026 累計"
          accent="indigo"
          loading={stats.isLoading}
        />
        <KpiCard
          icon={AlertTriangle}
          label="BofA 待分類"
          primary="–"
          secondary="Plaid 同步, 待 classify"
          accent="amber"
          onClick={() => onNavigate("accounting")}
        />
        <KpiCard
          icon={CreditCard}
          label="本月 Bookings"
          primary={stats.data?.totalBookings ?? 0}
          secondary={`今日 ${stats.data?.todayBookings ?? 0} 個新訂單`}
          accent="violet"
          loading={stats.isLoading}
        />
        <KpiCard
          icon={Receipt}
          label="應收尾款"
          primary="–"
          secondary="待 query (deposit 已收、balance 未收)"
          accent="slate"
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
              onClick={() => onNavigate("accounting")}
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
