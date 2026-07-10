/**
 * PLCard —— 兩本帳:損益卡(F3 塊C#1,B-final 右欄第一卡)。
 *
 * 資料源:plaid.profitLossReport(LA 本月 1 日 → 今天)。選它不選 financeKpi
 * 的原因:真相列只要 income/netProfit(financeKpi 有),本卡要成本 byCategory
 * 細項 + transfer/stripePayout 中性 tiles + refunds,只有 profitLossReport 回
 * 全量 BankPLReport;兩者底層同一支 generateBankPL 摺疊,總額口徑一致(申報:
 * financeKpi 期間用 server 時鐘 UTC 切月,本卡用 LA 曆月,月界深夜短暫可能
 * 差一天資料,月中恆一致)。金額權威在 server,此處不重算。
 *
 * 版面照 B-final:topline(營收/淨利)→ 成分條(灰階,淨利段字可綠)→ legend
 * → 損益行 → 中性列(不計入損益)→ 口徑 note。$0 月顯示中性灰簡版;
 * 淨利為負時成分條隱藏(compBarSegments 回空),淨利行紅字。
 */
import { trpc } from "@/lib/trpc";
import { BarChart3, Info } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  compBarSegments,
  fmtMoney,
  fmtSignedMoney,
  laTodayClient,
  resolveTileState,
} from "./cockpitMath";
import { CLAIM_CATEGORY_LABEL_KEY, type ClaimCategory } from "./claimCategories";

/** 成分條 / legend / 行首色塊的灰階序(成本段);淨利段固定 gray-200。 */
const COST_SHADES = ["bg-gray-800", "bg-gray-600", "bg-gray-500", "bg-gray-400", "bg-gray-300"];
const COST_SHADE_TEXT = ["text-white", "text-white", "text-white", "text-gray-900", "text-gray-900"];

/** byCategory key → i18n label key(復用認領分類的同一組譯文)。 */
function catLabelKey(key: string): string {
  return CLAIM_CATEGORY_LABEL_KEY[key as ClaimCategory] ?? "financeCockpit.claim.catOtherReview";
}

export function PLCard() {
  const { t } = useLocale();
  const today = laTodayClient();
  const monthStart = `${today.slice(0, 7)}-01`;
  const report = trpc.plaid.profitLossReport.useQuery(
    { startDate: monthStart, endDate: today },
    { refetchInterval: 120_000 },
  );

  const r = report.data;
  const state = resolveTileState({
    isLoading: report.isLoading,
    isError: report.isError,
    hasData: r !== undefined,
  });

  // 成本行:cogs 兩桶 + opex 各 category(>0,值大在前)—— 與成分條同一序
  const costRows: { key: string; value: number }[] = [];
  if (r) {
    const byCat = r.expenses.byCategory ?? {};
    for (const k of ["cogs_tour", "cogs_other"]) {
      const v = Math.abs(byCat[k] ?? 0);
      if (v > 0) costRows.push({ key: k, value: v });
    }
    const opex = Object.entries(byCat)
      .filter(([k]) => k !== "cogs_tour" && k !== "cogs_other")
      .map(([k, v]) => ({ key: k, value: Math.abs(v) }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value);
    costRows.push(...opex);
  }

  const income = r?.income.total ?? 0;
  const net = r?.netProfit ?? 0;
  const segments = compBarSegments(costRows, income, net);
  const isZeroMonth = !!r && r.transactionCount === 0;
  const netTone =
    isZeroMonth || net === 0 ? "text-gray-400" : net > 0 ? "text-emerald-700" : "text-red-700";

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {/* 卡頭 */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
          <BarChart3 className="h-3.5 w-3.5 text-gray-400" />
          {t("financeCockpit.ledger.plCardTitle")}
        </div>
        <div className="text-[11px] text-gray-500">
          {state === "stale"
            ? t("financeCockpit.truth.staleHint")
            : t("financeCockpit.ledger.plCardMeta")}
        </div>
      </div>

      {state === "loading" ? (
        <div className="animate-pulse space-y-3 p-4">
          <div className="h-5 w-3/4 rounded bg-gray-100" />
          <div className="h-8 rounded bg-gray-100" />
          <div className="h-24 rounded bg-gray-50" />
        </div>
      ) : state === "error" ? (
        <div className="px-4 py-8 text-center text-xs text-gray-400">
          {t("financeCockpit.truth.loadError")}
        </div>
      ) : isZeroMonth ? (
        /* B-final 第二態:$0 月,中性灰不套綠 */
        <div className="p-4">
          <div className="flex items-center justify-between py-2 text-xs">
            <span className="font-medium text-gray-900">{t("financeCockpit.ledger.plRowNetRevenue")}</span>
            <span className="font-medium text-gray-800 tabular-nums">$0</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between border-t-2 border-gray-300 pt-3">
            <span className="text-[13px] font-bold text-gray-900">{t("financeCockpit.ledger.plRowNetProfit")}</span>
            <span className="text-[17px] font-bold text-gray-400 tabular-nums">$0</span>
          </div>
          <div className="mt-3 flex gap-1.5 text-[10px] leading-relaxed text-gray-400">
            <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
            {t("financeCockpit.ledger.plEmptyNote")}
          </div>
        </div>
      ) : (
        <div className={`p-4 ${state === "stale" ? "opacity-60" : ""}`}>
          {/* topline */}
          <div className="mb-3 flex items-baseline justify-between">
            <div className="text-xs text-gray-500">
              {t("financeCockpit.ledger.plRevenue")}
              <b className="ml-1.5 text-base font-bold text-gray-900 tabular-nums">{fmtMoney(income)}</b>
            </div>
            <div className="text-xs text-gray-500">
              {t("financeCockpit.ledger.plNet")}
              <b className={`ml-1.5 text-base font-bold tabular-nums ${netTone}`}>{fmtSignedMoney(net)}</b>
            </div>
          </div>

          {/* 成分條(灰階;淨利為負時 segments 為空 → 藏條) */}
          {segments.length > 0 && (
            <>
              <div className="flex h-8 overflow-hidden rounded-md border border-gray-200">
                {segments.map((s, i) => {
                  const isNet = s.key === "net";
                  const shade = isNet ? "bg-gray-200" : COST_SHADES[Math.min(i, COST_SHADES.length - 1)];
                  const text = isNet ? "text-emerald-700" : COST_SHADE_TEXT[Math.min(i, COST_SHADE_TEXT.length - 1)];
                  const label = isNet
                    ? t("financeCockpit.ledger.plSegNet", { pct: String(s.pct) })
                    : `${t(catLabelKey(s.key))} ${Math.round(s.pct)}%`;
                  return (
                    <div
                      key={s.key}
                      style={{ width: `${s.pct}%` }}
                      className={`flex min-w-0 items-center justify-center overflow-hidden whitespace-nowrap text-[10px] font-semibold tracking-wide ${shade} ${text}`}
                    >
                      {s.pct >= 14 ? label : ""}
                    </div>
                  );
                })}
              </div>
              {/* legend */}
              <div className="mb-1 mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {costRows.map((c, i) => (
                  <div key={c.key} className="flex items-center gap-2 text-[11px] text-gray-600">
                    <span className={`h-[9px] w-[9px] flex-shrink-0 rounded-[2px] ${COST_SHADES[Math.min(i, COST_SHADES.length - 1)]}`} />
                    {t(catLabelKey(c.key))}
                    <span className="font-semibold text-gray-900 tabular-nums">{fmtMoney(c.value)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-[11px] text-gray-600">
                  <span className="h-[9px] w-[9px] flex-shrink-0 rounded-[2px] bg-gray-200" />
                  {t("financeCockpit.ledger.plLegendNet")}
                  <span className="font-semibold text-emerald-700 tabular-nums">{fmtMoney(net)}</span>
                </div>
              </div>
            </>
          )}

          {/* 損益行 */}
          <div className="mt-2 border-t border-gray-100 pt-1">
            {r && (r.refunds !== 0 || r.trustDeferredIncome !== 0) ? (
              <>
                <div className="flex items-center justify-between py-2 text-xs">
                  <span className="font-medium text-gray-900">{t("financeCockpit.ledger.plRowGrossIncome")}</span>
                  <span className="font-medium text-gray-800 tabular-nums">
                    {fmtMoney(r.income.byCategory?.income_booking ?? 0)}
                  </span>
                </div>
                {r.refunds !== 0 && (
                  <div className="flex items-center justify-between border-t border-gray-50 py-2 text-xs">
                    <span className="text-gray-600">{t("financeCockpit.ledger.plRowRefunds")}</span>
                    <span className="text-gray-600 tabular-nums">−{fmtMoney(Math.abs(r.refunds))}</span>
                  </div>
                )}
                {r.trustDeferredIncome !== 0 && (
                  <div className="flex items-center justify-between border-t border-gray-50 py-2 text-xs">
                    <span className="text-gray-600">{t("financeCockpit.ledger.plRowTrustDeferred")}</span>
                    <span className="text-gray-600 tabular-nums">−{fmtMoney(r.trustDeferredIncome)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-gray-100 py-2 text-xs">
                  <span className="font-medium text-gray-900">{t("financeCockpit.ledger.plRowNetRevenue")}</span>
                  <span className="font-medium text-gray-800 tabular-nums">{fmtMoney(income)}</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between py-2 text-xs">
                <span className="font-medium text-gray-900">{t("financeCockpit.ledger.plRowNetRevenue")}</span>
                <span className="font-medium text-gray-800 tabular-nums">{fmtMoney(income)}</span>
              </div>
            )}
            {costRows.map((c, i) => (
              <div key={c.key} className="flex items-center justify-between border-t border-gray-50 py-2 text-xs">
                <span className="flex items-center gap-2 text-gray-600">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-[2px] ${COST_SHADES[Math.min(i, COST_SHADES.length - 1)]}`} />
                  {t(catLabelKey(c.key))}
                </span>
                <span className="text-gray-600 tabular-nums">−{fmtMoney(c.value)}</span>
              </div>
            ))}
            <div className="mt-px flex items-center justify-between border-t-[1.5px] border-gray-300 pt-3">
              <span className="text-[13px] font-bold text-gray-900">{t("financeCockpit.ledger.plRowNetProfit")}</span>
              <span className={`text-[17px] font-bold tabular-nums ${netTone}`}>{fmtSignedMoney(net)}</span>
            </div>
          </div>

          {/* 中性列:不計入損益(bankPLService transfer / stripePayout tiles) */}
          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 border-t border-dashed border-gray-200 pt-2.5">
            <span className="w-full text-[10px] text-gray-400">{t("financeCockpit.ledger.plExclTitle")}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              {t("financeCockpit.ledger.plExclTransfer")}
              <b className="font-semibold text-gray-600 tabular-nums">{fmtSignedMoney(r?.transfer.total ?? 0)}</b>
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              {t("financeCockpit.ledger.plExclStripe")}
              <b className="font-semibold text-gray-600 tabular-nums">{fmtSignedMoney(r?.stripePayout.total ?? 0)}</b>
            </span>
          </div>
        </div>
      )}

      {/* 口徑 note(B-final 修訂版文案;退款 0 摺疊成一句) */}
      {state !== "loading" && state !== "error" && !isZeroMonth && (
        <div className="flex gap-1.5 px-4 pb-3 text-[10px] leading-relaxed text-gray-400">
          <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
          <span>
            {t("financeCockpit.ledger.plNote")}
            {r?.refunds === 0 && <> {t("financeCockpit.ledger.plNoteRefundZero")}</>}
          </span>
        </div>
      )}
    </div>
  );
}
