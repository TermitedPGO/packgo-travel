/**
 * ProfitLossV2 — M4 (記帳強化) P&L 報表 + 年度報稅 ZIP 匯出。
 *
 * 一鍵年度/月度損益表，分區清楚：營收 → 退款/信託遞延 → 淨營收 → COGS →
 * 毛利 → 營運費用 → 淨利。業主資金 (transfer) 永遠獨立顯示、絕不計入淨利
 * (Jeff:「我自己拿出 不代表公司賺」)。信託遞延 (CST §17550) 沿用後端既有
 * 扣除並獨立成 tile。
 *
 * 後端全已存在：
 *   - plaid.profitLossReport({ startDate, endDate }) → BankPLReport
 *   - plaid.yearEndExport({ year }) → { url } (R2 ZIP)
 *
 * 損益計算的權威在 server/services/bankPLService.ts 的 foldBankPLRows
 * （已單測 8/8）；此處只負責呈現後端回傳的數字，不重算。
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Wallet,
  TrendingUp,
  DollarSign,
  Landmark,
  ArrowLeftRight,
  Lock,
  AlertTriangle,
  EyeOff,
} from "lucide-react";
import { KpiCard, SectionCard, LandingGreeting } from "@/components/admin/landings/landingPrimitives";
import { useLocale } from "@/contexts/LocaleContext";

/* ── helpers ─────────────────────────────────────────────────────────── */

const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** Signed formatter for the owner-capital tile (inflow-positive convention). */
const fmtSigned = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/**
 * Schedule-C category code → display label. Keyed by stable category codes,
 * localized at render. cogs_* land in the COGS line; the rest are OpEx sub-rows.
 * (F1 塊D 2026-07-09:原註解引用的 FinanceLanding 已刪除死碼,拿掉這條參照。)
 */
const CAT_LABEL: Record<string, { zh: string; en: string }> = {
  cogs_tour: { zh: "供應商成本", en: "Supplier Cost" },
  cogs_other: { zh: "手續費", en: "Processing Fees" },
  expense_marketing: { zh: "行銷", en: "Advertising" },
  expense_software: { zh: "軟體", en: "Software" },
  expense_office: { zh: "辦公", en: "Office" },
  expense_travel: { zh: "差旅", en: "Travel" },
};

const MIN_YEAR = 2020;

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return { startDate: `${year}-${mm}-01`, endDate: `${year}-${mm}-${lastDay}` };
}

/* ── P&L statement rows ──────────────────────────────────────────────── */

type RowKind = "add" | "less" | "subtotal" | "total";

function PLRow({
  label,
  value,
  kind,
  indent,
}: {
  label: string;
  value: number;
  kind: RowKind;
  indent?: boolean;
}) {
  const isLess = kind === "less";
  const isSubtotal = kind === "subtotal";
  const isTotal = kind === "total";
  const display = isLess ? `−${fmt(Math.abs(value))}` : fmt(value);
  const valueTone = isTotal
    ? value >= 0
      ? "text-emerald-700"
      : "text-rose-600"
    : isLess
      ? "text-rose-600"
      : "text-foreground/80";
  return (
    <div
      className={[
        "flex items-center justify-between py-1.5",
        indent ? "pl-4" : "",
        isSubtotal ? "border-t border-foreground/10 mt-1 pt-2" : "",
        isTotal ? "border-t-2 border-foreground/20 mt-1 pt-2.5" : "",
      ].join(" ")}
    >
      <span
        className={[
          isTotal ? "text-sm font-bold text-foreground" : "",
          isSubtotal ? "text-sm font-semibold text-foreground/90" : "",
          !isTotal && !isSubtotal
            ? indent
              ? "text-xs text-foreground/55"
              : "text-sm text-foreground/70"
            : "",
        ].join(" ")}
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${valueTone} ${
          isTotal ? "text-base font-bold" : isSubtotal ? "text-sm font-semibold" : "text-sm"
        }`}
      >
        {display}
      </span>
    </div>
  );
}

/* ── component ───────────────────────────────────────────────────────── */

export default function ProfitLossV2() {
  const { t, language } = useLocale();
  const now = new Date();
  const [mode, setMode] = useState<"annual" | "monthly">("annual");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12

  const { startDate, endDate } = useMemo(() => {
    if (mode === "annual") {
      return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
    }
    return monthRange(year, month);
  }, [mode, year, month]);

  const report = trpc.plaid.profitLossReport.useQuery(
    { startDate, endDate },
    { refetchInterval: 120_000 },
  );

  // 1A0a(plan v4.3 §4.2 E1):yearEndExport mutation 與下載鈕撤除 —— 年終 ZIP
  // 口徑未收斂(payout 雙計/零遞延/userId 漏 trust 帳),CPA-ready 宣稱不成立;
  // server procedure 由 1A0b 封鎖。

  const r = report.data;

  // OpEx sub-rows: expenses.byCategory minus the COGS buckets, sorted desc.
  const opexRows = useMemo(() => {
    const byCat = r?.expenses.byCategory ?? {};
    return Object.entries(byCat)
      .filter(([k]) => k !== "cogs_tour" && k !== "cogs_other")
      .map(([k, v]) => ({ key: k, value: Math.abs(v) }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [r]);

  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = now.getFullYear(); y >= MIN_YEAR; y--) out.push(y);
    return out;
  }, [now]);

  // 1A0a:無 data 一律 null(顯示「—」/錯誤態),不折 0
  const net = r !== undefined ? r.netProfit : null;
  const loadFailed = report.isError && r === undefined;
  // cached refetch 失敗 = stale(顯舊值+標記,Codex 7-18 P1-6)
  const stale = report.isError && r !== undefined;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* ── Header ── */}
      <LandingGreeting
        title={t("admin.profitLoss.title")}
        subtitle={t("admin.profitLoss.subtitle", {
          period: `${startDate} → ${endDate}`,
          net: net !== null ? fmt(net) : "—",
        })}
      />

      {/* ── Controls: mode toggle + period select + download ── */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-foreground/10 bg-white p-3">
        {/* mode toggle */}
        <div className="inline-flex rounded-lg border border-foreground/15 p-0.5">
          <button
            onClick={() => setMode("annual")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "annual"
                ? "bg-teal-600 text-white"
                : "text-foreground/60 hover:text-foreground/90"
            }`}
          >
            {t("admin.profitLoss.modeAnnual")}
          </button>
          <button
            onClick={() => setMode("monthly")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === "monthly"
                ? "bg-teal-600 text-white"
                : "text-foreground/60 hover:text-foreground/90"
            }`}
          >
            {t("admin.profitLoss.modeMonthly")}
          </button>
        </div>

        {/* year select */}
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28 h-9 rounded-lg text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            {yearOptions.map((y) => (
              <SelectItem key={y} value={String(y)} className="rounded-lg text-sm">
                {t("admin.profitLoss.yearLabel", { year: String(y) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* month select (monthly only) */}
        {mode === "monthly" && (
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-28 h-9 rounded-lg text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)} className="rounded-lg text-sm">
                  {t("admin.profitLoss.monthLabel", { month: String(m) })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* 1A0a:年度報稅包 ZIP 下載鈕撤除(口徑收斂前停用,§4.2 E1) */}
        <div className="ml-auto text-[11px] text-foreground/40">
          {t("admin.profitLoss.exportBlocked")}
        </div>
      </div>

      {/* 1A0a:讀取失敗且無快取值 → 顯性錯誤,不渲染 $0 KPI(U4);stale 標記 */}
      {loadFailed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-700">
          {t("admin.profitLoss.loadFailed")}
        </div>
      )}
      {stale && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          {t("financeCockpit.truth.staleHint")}
        </div>
      )}

      {/* ── KPI strip ── */}
      {!loadFailed && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={Wallet}
          label={t("admin.profitLoss.netRevenue")}
          primary={r !== undefined ? fmt(r.income.total) : "—"}
          secondary={t("admin.profitLoss.netRevenueNote")}
          accent="emerald"
          loading={report.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label={t("admin.profitLoss.grossProfit")}
          primary={r !== undefined ? fmt(r.grossProfit) : "—"}
          secondary={t("admin.profitLoss.grossProfitNote")}
          accent="sky"
          loading={report.isLoading}
        />
        <KpiCard
          icon={DollarSign}
          label={t("admin.profitLoss.netProfit")}
          primary={net !== null ? fmt(net) : "—"}
          secondary={
            net === null
              ? "—"
              : net >= 0
                ? t("admin.profitLoss.marginLabel", {
                    pct: String(Math.round(r !== undefined ? r.profitMargin : 0)),
                  })
                : t("admin.profitLoss.atLoss")
          }
          accent={net !== null && net < 0 ? "rose" : "emerald"}
          trend={net !== null && net < 0 ? "down" : "up"}
          loading={report.isLoading}
        />
        <KpiCard
          icon={Landmark}
          label={t("admin.profitLoss.ownerCapital")}
          primary={r !== undefined ? fmtSigned(r.transfer.total) : "—"}
          secondary={t("admin.profitLoss.ownerCapitalNote", {
            count: r !== undefined ? String(r.transfer.count) : "—",
          })}
          accent="slate"
          loading={report.isLoading}
        />
      </div>
      )}

      {/* ── P&L statement ── */}
      {!loadFailed && (
      <SectionCard
        title={t("admin.profitLoss.statementTitle")}
        icon={DollarSign}
        iconTone="text-teal-600"
      >
        {report.isLoading ? (
          <div className="py-8 text-center text-xs text-foreground/40">
            {t("admin.profitLoss.loading")}
          </div>
        ) : !r || r.transactionCount === 0 ? (
          <div className="py-8 text-center text-xs text-foreground/40">
            {t("admin.profitLoss.empty")}
          </div>
        ) : (
          <div className="divide-y-0">
            <PLRow label={t("admin.profitLoss.bookingIncome")} value={r.income.byCategory.income_booking} kind="add" />
            {r.refunds !== 0 && (
              <PLRow label={t("admin.profitLoss.refundsLine")} value={r.refunds} kind="less" />
            )}
            {r.trustDeferredIncome !== 0 && (
              <PLRow
                label={t("admin.profitLoss.trustDeferredLine")}
                value={r.trustDeferredIncome}
                kind="less"
              />
            )}
            <PLRow label={t("admin.profitLoss.netRevenueLine")} value={r.income.total} kind="subtotal" />

            <PLRow label={t("admin.profitLoss.cogsLine")} value={r.expenses.cogs} kind="less" />
            <PLRow label={t("admin.profitLoss.grossProfitLine")} value={r.grossProfit} kind="subtotal" />

            <PLRow label={t("admin.profitLoss.opexLine")} value={r.expenses.operating} kind="less" />
            {opexRows.map((e) => (
              <PLRow
                key={e.key}
                label={CAT_LABEL[e.key]?.[language === "en" ? "en" : "zh"] ?? e.key}
                value={e.value}
                kind="less"
                indent
              />
            ))}

            <PLRow label={t("admin.profitLoss.netProfitLine")} value={r.netProfit} kind="total" />
          </div>
        )}
      </SectionCard>
      )}

      {/* ── Excluded-from-profit callout (transfer / trust / review / excluded) ── */}
      {r && (
        <SectionCard
          title={t("admin.profitLoss.auditTitle")}
          icon={Lock}
          iconTone="text-slate-500"
        >
          <p className="text-xs text-foreground/50 -mt-1 mb-3">
            {t("admin.profitLoss.auditDesc")}
          </p>
          {/* F2 塊D 回爐 P2(2026-07-10):本 grid 實有 6 個 tile(owner/stripe/
              square/trustDeferred/needsReview/excluded)。xl 用 3 欄(6=3+3
              乾淨兩排);sm 用 2 欄(6=2×3)—— 無殘行,密度節奏紅線。 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            <div className="rounded-lg border border-foreground/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <Landmark className="w-3.5 h-3.5 text-slate-500" />
                {t("admin.profitLoss.ownerCapitalTile")}
              </div>
              <div className="mt-1 text-base font-bold tabular-nums text-foreground">
                {fmtSigned(r.transfer.total)}
              </div>
              <div className="text-[11px] text-foreground/45">
                {t("admin.profitLoss.ownerCapitalDesc", { count: String(r.transfer.count) })}
              </div>
            </div>

            <div className="rounded-lg border border-foreground/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <ArrowLeftRight className="w-3.5 h-3.5 text-violet-500" />
                {t("admin.profitLoss.stripePayoutTile")}
              </div>
              <div className="mt-1 text-base font-bold tabular-nums text-foreground">
                {fmtSigned(r.stripePayout.total)}
              </div>
              <div className="text-[11px] text-foreground/45">
                {t("admin.profitLoss.stripePayoutDesc", { count: String(r.stripePayout.count) })}
              </div>
            </div>

            <div className="rounded-lg border border-foreground/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-600" />
                {t("admin.profitLoss.squarePayoutTile")}
              </div>
              <div className="mt-1 text-base font-bold tabular-nums text-foreground">
                {fmtSigned(r.squarePayout ? r.squarePayout.total : 0)}
              </div>
              <div className="text-[11px] text-foreground/45">
                {/* squarePayout 欄位缺席=真零(成功回應的 optional bucket),非錯誤折疊 */}
                {t("admin.profitLoss.squarePayoutDesc", { count: String(r.squarePayout ? r.squarePayout.count : 0) })}
              </div>
            </div>

            <div className="rounded-lg border border-foreground/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <Lock className="w-3.5 h-3.5 text-indigo-500" />
                {t("admin.profitLoss.trustDeferredTile")}
              </div>
              <div className="mt-1 text-base font-bold tabular-nums text-foreground">
                {fmt(r.trustDeferredIncome)}
              </div>
              <div className="text-[11px] text-foreground/45">
                {t("admin.profitLoss.trustDeferredDesc")}
              </div>
            </div>

            <div className="rounded-lg border border-foreground/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                {t("admin.profitLoss.needsReviewTile")}
              </div>
              <div className="mt-1 text-base font-bold tabular-nums text-foreground">
                {fmt(r.needsReviewAmount)}
              </div>
              <div className="text-[11px] text-foreground/45">
                {t("admin.profitLoss.needsReviewDesc", { count: String(r.needsReviewCount) })}
              </div>
            </div>

            <div className="rounded-lg border border-foreground/10 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
                <EyeOff className="w-3.5 h-3.5 text-foreground/40" />
                {t("admin.profitLoss.excludedTile")}
              </div>
              <div className="mt-1 text-base font-bold tabular-nums text-foreground">
                {r.excludedFromAccounting}
              </div>
              <div className="text-[11px] text-foreground/45">
                {t("admin.profitLoss.excludedDesc")}
              </div>
            </div>
          </div>
        </SectionCard>
      )}
    </div>
  );
}
