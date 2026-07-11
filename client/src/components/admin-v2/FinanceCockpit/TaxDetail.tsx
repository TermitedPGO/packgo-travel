/**
 * TaxDetail —— 報表與稅務正式頁(F3 塊D,D-細節層_月年稅.html 藍本)。
 *
 * 駕駛艙是「現在 + 要你做的事」,這頁是往下鑽的細節:期間切換 → KPI → 月度
 * 趨勢(plMonthlyTrend)→ Schedule C 對照(profitLossReport.scheduleCMap 真
 * 對映)→ Trust 對稅時點 → 已排除防雙計 → 1099-NEC(vendor1099List)→
 * 匯出(ZIP 接現成 yearEndExport)。
 * 數據全接真源;金額權威在 server(generateBankPL),此處不重算。
 *
 * F-workbench(2026-07-11):KPI strip / Trust 對稅時點 / 1099-NEC 補錯誤態
 * (query 失敗顯「讀取失敗」,不再靜默顯 $0 / 空);1040-ES 卡與 Schedule C
 * CSV 鈕整個移除(端點/算法不存在的佔位假功能違反誠實原則,見原位註解)。
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Archive,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Lock,
  TrendingUp,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  aggregateTrust,
  dateOnlyClient,
  fmtMoney,
  fmtSignedMoney,
  laTodayClient,
  profitMargin,
} from "./cockpitMath";
import { CLAIM_CATEGORY_LABEL_KEY, type ClaimCategory } from "./claimCategories";

type Scope = "month" | "ytd" | "lastYear";

const MIN_YEAR = 2020;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** scheduleCMap 值(如 "Line 4 — Cost of goods sold (供應商成本)")抽 Line 前綴。 */
function scLine(mapVal: string | undefined): string | null {
  const m = mapVal?.match(/Line [0-9a-z]+/i);
  return m ? m[0] : null;
}

function catLabelKey(key: string): string {
  return CLAIM_CATEGORY_LABEL_KEY[key as ClaimCategory] ?? "financeCockpit.claim.catOtherReview";
}

export function TaxDetail() {
  const { t } = useLocale();
  const today = laTodayClient();
  const curYear = Number(today.slice(0, 4));
  const [scope, setScope] = useState<Scope>("ytd");
  const [trendYear, setTrendYear] = useState(curYear);

  // 期間:本月 / 今年 YTD / 去年全年;對照期 = 去年同期
  const range = useMemo(() => {
    if (scope === "month") {
      const start = `${today.slice(0, 7)}-01`;
      const prevStart = `${curYear - 1}${start.slice(4)}`;
      const prevEnd = `${curYear - 1}${today.slice(4)}`;
      return { start, end: today, prevStart, prevEnd };
    }
    if (scope === "lastYear") {
      return {
        start: `${curYear - 1}-01-01`,
        end: `${curYear - 1}-12-31`,
        prevStart: `${curYear - 2}-01-01`,
        prevEnd: `${curYear - 2}-12-31`,
      };
    }
    return {
      start: `${curYear}-01-01`,
      end: today,
      prevStart: `${curYear - 1}-01-01`,
      prevEnd: `${curYear - 1}${today.slice(4)}`,
    };
  }, [scope, today, curYear]);

  const cur = trpc.plaid.profitLossReport.useQuery(
    { startDate: range.start, endDate: range.end },
    { refetchInterval: 300_000 },
  );
  const prev = trpc.plaid.profitLossReport.useQuery({
    startDate: range.prevStart,
    endDate: range.prevEnd,
  });
  const trend = trpc.plaid.plMonthlyTrend.useQuery({ year: trendYear });
  const trustRecon = trpc.plaid.trustReconciliation.useQuery(undefined, {
    refetchInterval: 300_000,
  });
  const recognized = trpc.plaid.trustDeferredList.useQuery({ status: "recognized", limit: 200 });
  const vendors = trpc.plaid.vendor1099List.useQuery({ year: trendYear });

  const exportZip = trpc.plaid.yearEndExport.useMutation({
    onSuccess: (data) => {
      toast.success(
        t("financeCockpit.tax.exportZipDone", {
          year: String(data.year),
          count: String(data.fileCounts.transactions),
        }),
      );
      window.open(data.url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => toast.error(t("financeCockpit.tax.exportZipFailed") + err.message),
  });

  const r = cur.data;
  const p = prev.data;
  const trustAgg = aggregateTrust(trustRecon.data);

  // 本年已認列(recognizedAt 落在本年;limit 200,截斷誠實標注)
  const recognizedThisYear = useMemo(() => {
    let total = 0;
    for (const row of (recognized.data ?? []) as any[]) {
      const rec = dateOnlyClient(row.recognizedAt);
      if (rec && rec.slice(0, 4) === String(curYear)) {
        total += parseFloat(String(row.amount)) || 0;
      }
    }
    return total;
  }, [recognized.data, curYear]);

  const income = r?.income.total ?? 0;
  const net = r?.netProfit ?? 0;
  // F3 塊D 回爐 #4(指揮裁決):營收 KPI 主值 = 毛收入(Line 1 gross receipts,
  // 對齊 D 藍本與稅表語意);退款 ≠0 時副行「退款 −$X · 淨 $Y」。growth 同以
  // gross 對 gross。
  const grossReceipts = r?.income.byCategory?.income_booking ?? 0;
  const prevGross = p?.income.byCategory?.income_booking ?? 0;
  const refunds = r?.refunds ?? 0;
  const growth =
    prevGross > 0 ? Math.round(((grossReceipts - prevGross) / prevGross) * 100) : null;

  // 費用行(Schedule C Part II):cogs 兩桶 + opex,照 SCHEDULE_C_MAP 順序
  const expenseRows = useMemo(() => {
    const order: ClaimCategory[] = ["cogs_tour", "cogs_other", "expense_marketing", "expense_software", "expense_office", "expense_travel"];
    return order
      .map((key) => ({
        key,
        cur: Math.abs(r?.expenses.byCategory?.[key] ?? 0),
        prev: Math.abs(p?.expenses.byCategory?.[key] ?? 0),
      }))
      .filter((e) => e.cur > 0 || e.prev > 0);
  }, [r, p]);
  const expenseTotalCur = expenseRows.reduce((s, e) => s + e.cur, 0);
  const expenseTotalPrev = expenseRows.reduce((s, e) => s + e.prev, 0);

  const months = trend.data?.months ?? [];
  const maxNet = Math.max(1, ...months.map((m) => m.netProfit));
  const bestMonth = months.reduce(
    (best, m) => (m.netProfit > (best?.netProfit ?? -Infinity) ? m : best),
    null as null | (typeof months)[number],
  );
  const trendTotal = {
    income: months.reduce((s, m) => s + m.income, 0),
    cogs: months.reduce((s, m) => s + m.cogs, 0),
    opex: months.reduce((s, m) => s + m.opex, 0),
    net: months.reduce((s, m) => s + m.netProfit, 0),
  };

  const yearOptions = useMemo(() => {
    const out: number[] = [];
    for (let y = curYear; y >= MIN_YEAR; y--) out.push(y);
    return out;
  }, [curYear]);

  const scopeLabel =
    scope === "month"
      ? t("financeCockpit.tax.scopeMonth")
      : scope === "lastYear"
        ? t("financeCockpit.tax.scopeLastYear")
        : t("financeCockpit.tax.scopeYtd");

  const cardH = "flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3";
  const cardT = "flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500";
  const noteCls = "flex gap-1.5 border-t border-gray-100 px-4 py-3 text-[10px] leading-relaxed text-gray-400";

  return (
    <div>
      {/* 期間切換列 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          {(["month", "ytd", "lastYear"] as Scope[]).map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-3 py-2 text-xs transition-colors ${i > 0 ? "border-l border-gray-100" : ""} ${
                scope === s ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s === "month"
                ? t("financeCockpit.tax.scopeMonth")
                : s === "ytd"
                  ? t("financeCockpit.tax.scopeYtd")
                  : t("financeCockpit.tax.scopeLastYear")}
            </button>
          ))}
        </div>
        <select
          value={trendYear}
          onChange={(e) => setTrendYear(Number(e.target.value))}
          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-700"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {t("financeCockpit.tax.yearLabel", { year: String(y) })}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <span className="text-[11px] text-gray-400">
          {t("financeCockpit.tax.rangeHint", { start: range.start, end: range.end })}
        </span>
      </div>

      {/* KPI strip(4 格)—— F-workbench:query 失敗顯示錯誤態,不再靜默顯 $0
          (錯當空會讓 Jeff 誤信「沒有」;checkup 第三節)。前三格與待複查格
          吃 profitLossReport(cur),Trust 格吃 trustReconciliation。 */}
      <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200 bg-white lg:grid-cols-4">
        <div className="border-l border-gray-100 p-3 first:border-l-0 sm:px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("financeCockpit.tax.kpiRevenue", { scope: scopeLabel })}
          </div>
          {cur.isError ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <>
              <div className="mt-2 text-[21px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
                {fmtMoney(grossReceipts)}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {refunds !== 0 ? (
                  t("financeCockpit.tax.kpiRevenueRefundHint", {
                    refund: fmtSignedMoney(-refunds),
                    net: fmtMoney(income),
                  })
                ) : growth !== null ? (
                  <>
                    <span className="font-semibold text-emerald-700">
                      {growth >= 0 ? "↑" : "↓"} {Math.abs(growth)}%
                    </span>{" "}
                    {t("financeCockpit.tax.kpiVsPrev")}
                  </>
                ) : (
                  t("financeCockpit.tax.kpiNoPrev")
                )}
              </div>
            </>
          )}
        </div>
        <div className="border-l border-gray-100 p-3 sm:px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("financeCockpit.tax.kpiNet")}
          </div>
          {cur.isError ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <>
              <div
                className={`mt-2 text-[21px] font-bold leading-none tracking-tight tabular-nums ${
                  net > 0 ? "text-emerald-700" : net < 0 ? "text-red-700" : "text-gray-400"
                }`}
              >
                {fmtMoney(net)}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {t("financeCockpit.tax.kpiNetHint", { pct: String(profitMargin(income, net)) })}
              </div>
            </>
          )}
        </div>
        <div className="border-l border-gray-100 p-3 sm:px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("financeCockpit.tax.kpiTrust")}
          </div>
          {trustRecon.isError ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <>
              <div className="mt-2 text-[21px] font-bold leading-none tracking-tight text-amber-600 tabular-nums">
                {fmtMoney(trustAgg.outstanding)}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {t("financeCockpit.tax.kpiTrustHint")}
              </div>
            </>
          )}
        </div>
        <div className="border-l border-gray-100 p-3 sm:px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("financeCockpit.tax.kpiReview")}
          </div>
          {cur.isError ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <>
              <div className="mt-2 text-[21px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
                {t("financeCockpit.tax.kpiReviewValue", { count: String(r?.needsReviewCount ?? 0) })}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {t("financeCockpit.tax.kpiReviewHint")}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── 月度趨勢 ── */}
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-bold text-gray-900">{t("financeCockpit.tax.trendSection")}</h2>
        <span className="text-[11px] text-gray-500">
          {t("financeCockpit.tax.trendSectionSub", { year: String(trendYear) })}
        </span>
        <div className="h-px flex-1 bg-gray-100" />
      </div>
      <div className="mb-7 overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className={cardH}>
          <div className={cardT}>
            <TrendingUp className="h-3.5 w-3.5 text-gray-400" />
            {t("financeCockpit.tax.trendTitle")}
          </div>
          <div className="text-[11px] text-gray-500">
            {bestMonth
              ? t("financeCockpit.tax.trendMeta", {
                  month: String(bestMonth.month),
                  amount: fmtMoney(bestMonth.netProfit),
                  total: fmtMoney(trendTotal.net),
                })
              : t("financeCockpit.tax.trendMetaEmpty")}
          </div>
        </div>
        {trend.isLoading ? (
          <div className="animate-pulse p-4">
            <div className="h-32 rounded bg-gray-50" />
          </div>
        ) : trend.isError ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            {t("financeCockpit.truth.loadError")}
          </div>
        ) : months.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400">
            {t("financeCockpit.tax.trendMetaEmpty")}
          </div>
        ) : (
          <>
            {/* bar 圖 */}
            <div className="px-4 pb-2 pt-4">
              <div className="flex h-32 items-end gap-3 border-b border-gray-100">
                {months.map((m) => (
                  <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end">
                    <div
                      className={`mb-1.5 text-[11px] font-semibold tabular-nums ${
                        m.month === Number(today.slice(5, 7)) && trendYear === curYear
                          ? "text-emerald-700"
                          : "text-gray-600"
                      }`}
                    >
                      {Math.round(m.netProfit).toLocaleString("en-US")}
                    </div>
                    <div
                      className={`w-full max-w-[38px] rounded-t-md ${
                        m.month === Number(today.slice(5, 7)) && trendYear === curYear
                          ? "bg-gray-900"
                          : "bg-gray-700"
                      }`}
                      style={{
                        height: `${m.netProfit > 0 ? Math.max(3, Math.round((m.netProfit / maxNet) * 100)) : 3}%`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                {months.map((m) => (
                  <div
                    key={m.month}
                    className={`flex-1 text-center text-[11px] ${
                      m.month === Number(today.slice(5, 7)) && trendYear === curYear
                        ? "font-semibold text-gray-900"
                        : "text-gray-400"
                    }`}
                  >
                    {t("financeCockpit.tax.trendMonthLabel", { month: String(m.month) })}
                  </div>
                ))}
              </div>
            </div>
            {/* 表 */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead className="border-b border-gray-200 bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      {t("financeCockpit.tax.trendColMonth")}
                    </th>
                    {[
                      t("financeCockpit.tax.trendColRevenue"),
                      t("financeCockpit.tax.trendColCogs"),
                      t("financeCockpit.tax.trendColOpex"),
                      t("financeCockpit.tax.trendColNet"),
                      t("financeCockpit.tax.trendColMargin"),
                    ].map((h) => (
                      <th key={h} className="whitespace-nowrap px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-gray-500">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {months.map((m) => {
                    const isCur = m.month === Number(today.slice(5, 7)) && trendYear === curYear;
                    return (
                      <tr key={m.month} className={`border-t border-gray-100 ${isCur ? "bg-gray-50" : "hover:bg-gray-50"}`}>
                        <td className={`px-4 py-2 text-left font-medium ${isCur ? "text-amber-700 font-semibold" : "text-gray-800"}`}>
                          {isCur
                            ? t("financeCockpit.tax.trendMonthCurrent", { year: String(trendYear), month: pad(m.month) })
                            : t("financeCockpit.tax.trendMonthCell", { year: String(trendYear), month: pad(m.month) })}
                        </td>
                        <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{fmtMoney(m.income)}</td>
                        <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{fmtMoney(m.cogs)}</td>
                        <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{fmtMoney(m.opex)}</td>
                        <td className="px-4 py-2 text-right font-semibold text-gray-900 tabular-nums">{fmtMoney(m.netProfit)}</td>
                        <td className="px-4 py-2 text-right text-[11px] text-gray-500 tabular-nums">{m.profitMargin.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-[1.5px] border-gray-300 bg-gray-50">
                    <td className="px-4 py-2 text-left font-bold text-gray-900">{t("financeCockpit.tax.trendTotalRow")}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 tabular-nums">{fmtMoney(trendTotal.income)}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 tabular-nums">{fmtMoney(trendTotal.cogs)}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 tabular-nums">{fmtMoney(trendTotal.opex)}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 tabular-nums">{fmtMoney(trendTotal.net)}</td>
                    <td className="px-4 py-2 text-right font-bold text-gray-900 tabular-nums">
                      {profitMargin(trendTotal.income, trendTotal.net).toFixed(1)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={noteCls}>
              <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
              {t("financeCockpit.tax.trendNote")}
            </div>
          </>
        )}
      </div>

      {/* ── 年度損益 · Schedule C ── */}
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-bold text-gray-900">{t("financeCockpit.tax.scSection")}</h2>
        <span className="text-[11px] text-gray-500">{t("financeCockpit.tax.scSectionSub", { scope: scopeLabel })}</span>
        <div className="h-px flex-1 bg-gray-100" />
      </div>
      <div className="mb-7 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* Schedule C 對照 */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className={cardH}>
            <div className={cardT}>
              <FileText className="h-3.5 w-3.5 text-gray-400" />
              {t("financeCockpit.tax.scTitle")}
            </div>
            <div className="text-[11px] text-gray-500">{t("financeCockpit.tax.scMeta", { scope: scopeLabel })}</div>
          </div>
          {cur.isLoading ? (
            <div className="animate-pulse p-4">
              <div className="h-48 rounded bg-gray-50" />
            </div>
          ) : cur.isError ? (
            <div className="px-4 py-8 text-center text-xs text-gray-400">{t("financeCockpit.truth.loadError")}</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto] gap-3.5 border-b border-gray-100 px-4 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {t("financeCockpit.tax.scColSubject")}
                </span>
                <span className="min-w-[64px] text-right text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {t("financeCockpit.tax.scColPrev")}
                </span>
                <span className="min-w-[78px] text-right text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  {t("financeCockpit.tax.scColCur")}
                </span>
              </div>
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {t("financeCockpit.tax.scPartIncome")}
              </div>
              <ScRow
                name={t("financeCockpit.tax.scGross")}
                line={scLine(r?.scheduleCMap?.income_booking)}
                prev={p?.income.byCategory?.income_booking ?? 0}
                cur={r?.income.byCategory?.income_booking ?? 0}
              />
              <ScRow
                name={t("financeCockpit.tax.scReturns")}
                line={scLine(r?.scheduleCMap?.refund)}
                prev={-(p?.refunds ?? 0)}
                cur={-(r?.refunds ?? 0)}
                signed
              />
              <ScRow name={t("financeCockpit.tax.scNetRevenue")} prev={p?.income.total ?? 0} cur={income} sub />
              <div className="border-b border-t border-gray-100 bg-gray-50 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {t("financeCockpit.tax.scPartExpense")}
              </div>
              {expenseRows.map((e) => (
                <ScRow
                  key={e.key}
                  name={t(catLabelKey(e.key))}
                  line={scLine(r?.scheduleCMap?.[e.key])}
                  prev={e.prev}
                  cur={e.cur}
                />
              ))}
              <ScRow name={t("financeCockpit.tax.scExpenseSubtotal")} prev={expenseTotalPrev} cur={expenseTotalCur} sub />
              <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3.5 border-t-[1.5px] border-gray-300 bg-gray-50 px-4 py-2.5">
                <span className="text-[13px] font-bold text-gray-900">
                  {t("financeCockpit.tax.scNetProfit")}
                  <span className="ml-2 text-[10px] font-normal text-gray-400 tabular-nums">Line 31</span>
                </span>
                <span className="min-w-[64px] text-right text-[11px] text-gray-400 tabular-nums">
                  {fmtMoney(p?.netProfit ?? 0)}
                </span>
                <span
                  className={`min-w-[78px] text-right text-base font-bold tabular-nums ${
                    net > 0 ? "text-emerald-700" : net < 0 ? "text-red-700" : "text-gray-400"
                  }`}
                >
                  {fmtMoney(net)}
                </span>
              </div>
              <div className={noteCls}>
                <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
                {t("financeCockpit.tax.scNote")}
              </div>
            </>
          )}
        </div>

        {/* 右欄:Trust 時點 / 已排除 / 1099 / 1040-ES */}
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className={cardH}>
              <div className={cardT}>
                <Lock className="h-3.5 w-3.5 text-gray-400" />
                {t("financeCockpit.tax.trustTitle")}
              </div>
              <div className="text-[11px] text-gray-500">CST §17550</div>
            </div>
            {/* F-workbench:兩行各自的資料源(recognized / trustRecon)失敗時
                顯示錯誤態,不再把錯誤靜默蓋成 $0(現況本就全 $0,錯誤會被
                永久性 $0 蓋掉;checkup 第三節)。 */}
            <div className="px-4 py-1">
              <div className="flex items-baseline justify-between py-2 text-xs">
                <span className="text-gray-600">
                  {t("financeCockpit.tax.trustRecognized")}
                  <span className="mt-px block text-[10px] text-gray-400">
                    {t("financeCockpit.tax.trustRecognizedSub")}
                  </span>
                </span>
                {recognized.isError ? (
                  <InlineError label={t("financeCockpit.truth.loadError")} />
                ) : (
                  <span className="font-semibold text-gray-900 tabular-nums">{fmtMoney(recognizedThisYear)}</span>
                )}
              </div>
              <div className="flex items-baseline justify-between border-t border-gray-50 py-2 text-xs">
                <span className="text-gray-600">
                  {t("financeCockpit.tax.trustDeferred")}
                  <span className="mt-px block text-[10px] text-gray-400">
                    {t("financeCockpit.tax.trustDeferredSub")}
                  </span>
                </span>
                {trustRecon.isError ? (
                  <InlineError label={t("financeCockpit.truth.loadError")} />
                ) : (
                  <span className="font-semibold text-amber-700 tabular-nums">{fmtMoney(trustAgg.outstanding)}</span>
                )}
              </div>
            </div>
            <div className={noteCls}>
              <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
              <span>
                {t("financeCockpit.tax.trustNote")}
                {(recognized.data?.length ?? 0) >= 200 && <> {t("financeCockpit.tax.recognizedTruncated")}</>}
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className={cardH}>
              <div className={cardT}>
                <CheckCircle2 className="h-3.5 w-3.5 text-gray-400" />
                {t("financeCockpit.tax.exclTitle")}
              </div>
              <div className="text-[11px] text-gray-500">{t("financeCockpit.tax.exclMeta")}</div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 text-xs text-gray-600">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              <span className="flex-1">
                <b className="font-semibold text-gray-800">{t("financeCockpit.tax.exclStripe")}</b>{" "}
                {t("financeCockpit.tax.exclStripeDesc")}
              </span>
              <span className="text-gray-400 tabular-nums">{fmtSignedMoney(r?.stripePayout.total ?? 0)}</span>
            </div>
            {/* F2 塊D 回令(2026-07-10):square_payout 排除列,照 stripe 模式 $0 恆顯 */}
            <div className="flex items-center gap-2 border-t border-gray-50 px-4 py-2 text-xs text-gray-600">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              <span className="flex-1">
                <b className="font-semibold text-gray-800">{t("financeCockpit.tax.exclSquare")}</b>{" "}
                {t("financeCockpit.tax.exclSquareDesc")}
              </span>
              <span className="text-gray-400 tabular-nums">{fmtSignedMoney(r?.squarePayout?.total ?? 0)}</span>
            </div>
            <div className="flex items-center gap-2 border-t border-gray-50 px-4 py-2 pb-3 text-xs text-gray-600">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              <span className="flex-1">
                <b className="font-semibold text-gray-800">{t("financeCockpit.tax.exclTransfer")}</b>{" "}
                {t("financeCockpit.tax.exclTransferDesc")}
              </span>
              <span className="text-gray-400 tabular-nums">{fmtSignedMoney(r?.transfer.total ?? 0)}</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className={cardH}>
              <div className={cardT}>
                <FileText className="h-3.5 w-3.5 text-gray-400" />
                1099-NEC
              </div>
              <div className="text-[11px] text-gray-500">{t("financeCockpit.tax.ten99Meta")}</div>
            </div>
            {vendors.isLoading ? (
              <div className="animate-pulse p-4">
                <div className="h-16 rounded bg-gray-50" />
              </div>
            ) : vendors.isError ? (
              /* F-workbench:錯誤態不再被 `?? []` 吃成「無 1099 廠商」空態
                 (把錯當空會讓 Jeff 誤信不用開 1099;checkup 第三節)。 */
              <div className="px-4 py-5 text-center text-xs text-gray-400">
                {t("financeCockpit.truth.loadError")}
              </div>
            ) : (vendors.data?.vendors ?? []).length === 0 ? (
              <div className="px-4 py-5 text-center text-xs text-gray-400">
                {t("financeCockpit.tax.ten99Empty")}
              </div>
            ) : (
              (vendors.data?.vendors ?? []).map((v, i) => (
                <div
                  key={v.counterparty}
                  className={`flex items-center gap-2 px-4 py-2 text-xs text-gray-600 ${i > 0 ? "border-t border-gray-50" : ""}`}
                >
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
                  <span className="min-w-0 flex-1 truncate text-gray-800">{v.counterparty}</span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap text-[9px] font-semibold text-gray-500">
                    <span className="h-[5px] w-[5px] rounded-full bg-current" />
                    {t("financeCockpit.tax.ten99Pill")}
                  </span>
                  <span className="text-gray-400 tabular-nums">{fmtMoney(v.total)}</span>
                </div>
              ))
            )}
            <div className={noteCls}>
              <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
              {t("financeCockpit.tax.ten99Note")}
            </div>
          </div>

          {/* F-workbench 移除「1040-ES 季繳」卡:後端無預估稅算法,Q1–Q4 永遠
              hardcode「待建」——佔位假功能違反誠實原則(每天佔一塊版面顯示空殼)。
              等後端真有 1040-ES 計算(需聯邦+加州有效稅率設定)再帶著真資料回來。 */}
        </div>
      </div>

      {/* ── 匯出給會計師 ── */}
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-bold text-gray-900">{t("financeCockpit.tax.exportSection")}</h2>
        <span className="text-[11px] text-gray-500">{t("financeCockpit.tax.exportSectionSub")}</span>
        <div className="h-px flex-1 bg-gray-100" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* F-workbench 移除「Schedule C CSV」匯出鈕:端點不存在,永久 disabled
            的死控制項 = 佔位假功能,違反誠實原則。年度報稅包 ZIP(下方)已含
            Schedule C 摘要;等 CSV 端點真的存在再帶著可按的鈕回來。 */}
        {/* 年度報稅包 ZIP:接現成 yearEndExport */}
        <button
          type="button"
          disabled={exportZip.isPending}
          onClick={() => exportZip.mutate({ year: Math.min(trendYear, curYear) })}
          className="inline-flex items-center gap-2.5 rounded-lg border border-gray-900 bg-gray-900 px-4 py-3 text-left transition-colors hover:bg-gray-800 disabled:opacity-60"
        >
          {exportZip.isPending ? (
            <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-white" />
          ) : (
            <Archive className="h-4 w-4 flex-shrink-0 text-white" />
          )}
          <span>
            <span className="block text-[13px] font-medium text-white">
              {t("financeCockpit.tax.exportZipTitle", { year: String(Math.min(trendYear, curYear)) })}
            </span>
            <span className="mt-px block text-[10px] text-gray-400">{t("financeCockpit.tax.exportZipDesc")}</span>
          </span>
        </button>
        <span className="text-[11px] text-gray-400">{t("financeCockpit.tax.exportHint")}</span>
      </div>
    </div>
  );
}

/** KPI 格錯誤態(dot + 文字,不填底 —— 設計裁決同狀態色規範)。 */
function KpiError({ label }: { label: string }) {
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
      <span className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-red-500" />
      {label}
    </div>
  );
}

/** 行內金額位置的錯誤態(取代金額,dot + 文字)。 */
function InlineError({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700">
      <span className="h-[5px] w-[5px] flex-shrink-0 rounded-full bg-red-500" />
      {label}
    </span>
  );
}

/** Schedule C 一行(科目 / 去年同期 / 本期)。 */
function ScRow({
  name,
  line,
  prev,
  cur,
  sub = false,
  signed = false,
}: {
  name: string;
  line?: string | null;
  prev: number;
  cur: number;
  sub?: boolean;
  signed?: boolean;
}) {
  const fmt = signed ? fmtSignedMoney : fmtMoney;
  return (
    <div
      className={`grid grid-cols-[1fr_auto_auto] items-center gap-3.5 px-4 py-2 text-xs ${
        sub ? "bg-gray-50" : "border-t border-gray-50 first:border-t-0"
      }`}
    >
      <span className={sub ? "font-medium text-gray-600" : "text-gray-700"}>
        {name}
        {line && <span className="ml-2 text-[10px] text-gray-400 tabular-nums">{line}</span>}
      </span>
      <span className="min-w-[64px] text-right text-[11px] text-gray-400 tabular-nums">{fmt(prev)}</span>
      <span className={`min-w-[78px] text-right tabular-nums ${sub ? "font-semibold text-gray-800" : "font-medium text-gray-800"}`}>
        {fmt(cur)}
      </span>
    </div>
  );
}
