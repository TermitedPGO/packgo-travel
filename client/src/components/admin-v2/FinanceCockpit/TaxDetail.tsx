/**
 * TaxDetail —— 報表與稅務頁(F3 塊D,D-細節層_月年稅.html 藍本)。
 *
 * 1A0a(plan v4.3 §3.2.5):未經 CPA 裁定的稅務產品全部撤下 —— 月度趨勢
 * (plMonthlyTrend)、Schedule C 對照、1099-NEC(vendor1099List)、ZIP 匯出
 * (yearEndExport)移除,原位改「口徑收斂前停用」卡;對應 procedures 由 1A0b
 * 封鎖。保留:期間 KPI(profitLossReport 管理視圖)、Trust 對稅時點、已排除
 * 防雙計(誠實現況視圖)。數據全接真源;金額權威在 server,此處不重算。
 *
 * F-workbench(2026-07-11):KPI strip / Trust 對稅時點補錯誤態(query 失敗
 * 顯「讀取失敗」,不再靜默顯 $0 / 空)。
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Info, Lock } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import {
  aggregateTrust,
  dateOnlyClient,
  fmtMoney,
  fmtSignedMoney,
  laTodayClient,
  profitMargin,
  resolveTileState,
  toNum,
} from "./cockpitMath";

type Scope = "month" | "ytd" | "lastYear";

export function TaxDetail() {
  const { t } = useLocale();
  const today = laTodayClient();
  const curYear = Number(today.slice(0, 4));
  const [scope, setScope] = useState<Scope>("ytd");

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
  const trustRecon = trpc.plaid.trustReconciliation.useQuery(undefined, {
    refetchInterval: 300_000,
  });
  const recognized = trpc.plaid.trustDeferredList.useQuery({ status: "recognized", limit: 200 });
  // 1A0a:plMonthlyTrend / vendor1099List / yearEndExport 呼叫移除(§3.2.5)。

  const r = cur.data;
  const p = prev.data;
  const trustAgg = aggregateTrust(trustRecon.data);

  // 1A0a(Codex 7-18 P1-3):四源逐一 loading/transport-error/stale/ready gate,
  // 冷載與切換期間不得把「尚未取得」畫成 $0;prev 失敗 ≠ 無前期資料。
  const curState = resolveTileState({ isLoading: cur.isLoading, isError: cur.isError, hasData: r !== undefined });
  const prevState = resolveTileState({ isLoading: prev.isLoading, isError: prev.isError, hasData: p !== undefined });
  const reconState = resolveTileState({
    isLoading: trustRecon.isLoading,
    isError: trustRecon.isError,
    hasData: trustRecon.data !== undefined,
  });
  const recogState = resolveTileState({
    isLoading: recognized.isLoading,
    isError: recognized.isError,
    hasData: recognized.data !== undefined,
  });

  // 本年已認列(recognizedAt 落在本年;limit 200,截斷誠實標注)
  const recognizedThisYear = useMemo(() => {
    let total = 0;
    for (const row of (recognized.data ?? []) as any[]) {
      const rec = dateOnlyClient(row.recognizedAt);
      if (rec && rec.slice(0, 4) === String(curYear)) {
        const a = toNum(row.amount);
        if (a === null) continue; // 1A0a U8:爛值不折 0
        total += a;
      }
    }
    return total;
  }, [recognized.data, curYear]);

  // 1A0a:值只在 r/p 存在時取用(各 tile 有 isError 分支;此處 ternary 供 loading 期形狀)
  const income = r ? r.income.total : 0;
  const net = r ? r.netProfit : 0;
  // F3 塊D 回爐 #4(指揮裁決):營收 KPI 主值 = 毛收入(Line 1 gross receipts,
  // 對齊 D 藍本與稅表語意);退款 ≠0 時副行「退款 −$X · 淨 $Y」。growth 同以
  // gross 對 gross。
  const grossReceipts = r ? (r.income.byCategory?.income_booking ?? 0) : 0;
  const prevGross = p ? (p.income.byCategory?.income_booking ?? 0) : 0;
  const refunds = r ? r.refunds : 0;
  const growth =
    prevGross > 0 ? Math.round(((grossReceipts - prevGross) / prevGross) * 100) : null;

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
          {curState === "loading" ? (
            <KpiSkeleton />
          ) : curState === "transport-error" ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <div className={curState === "stale" ? "opacity-60" : ""}>
              <div className="mt-2 text-[21px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
                {fmtMoney(grossReceipts)}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {curState === "stale" ? (
                  t("financeCockpit.truth.staleHint")
                ) : refunds !== 0 ? (
                  t("financeCockpit.tax.kpiRevenueRefundHint", {
                    refund: fmtSignedMoney(-refunds),
                    net: fmtMoney(income),
                  })
                ) : prevState === "transport-error" || prevState === "loading" || prevState === "stale" ? (
                  /* prev 失敗/未到/stale ≠ 可信前期(Codex 7-18 P1-3/P2-2):
                     不得把 stale 前期數字當 current 算 growth 正常顯示 */
                  t("financeCockpit.tax.prevUnverifiable")
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
            </div>
          )}
        </div>
        <div className="border-l border-gray-100 p-3 sm:px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("financeCockpit.tax.kpiNet")}
          </div>
          {curState === "loading" ? (
            <KpiSkeleton />
          ) : curState === "transport-error" ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <div className={curState === "stale" ? "opacity-60" : ""}>
              <div
                className={`mt-2 text-[21px] font-bold leading-none tracking-tight tabular-nums ${
                  net > 0 ? "text-emerald-700" : net < 0 ? "text-red-700" : "text-gray-400"
                }`}
              >
                {fmtMoney(net)}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {curState === "stale"
                  ? t("financeCockpit.truth.staleHint")
                  : t("financeCockpit.tax.kpiNetHint", { pct: String(profitMargin(income, net)) })}
              </div>
            </div>
          )}
        </div>
        <div className="border-l border-gray-100 p-3 sm:px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("financeCockpit.tax.kpiTrust")}
          </div>
          {reconState === "loading" ? (
            <KpiSkeleton />
          ) : reconState === "transport-error" ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <div className={reconState === "stale" ? "opacity-60" : ""}>
              <div className="mt-2 text-[21px] font-bold leading-none tracking-tight text-amber-600 tabular-nums">
                {fmtMoney(trustAgg.outstanding)}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {reconState === "stale"
                  ? t("financeCockpit.truth.staleHint")
                  : t("financeCockpit.tax.kpiTrustHint")}
              </div>
            </div>
          )}
        </div>
        <div className="border-l border-gray-100 p-3 sm:px-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {t("financeCockpit.tax.kpiReview")}
          </div>
          {curState === "loading" ? (
            <KpiSkeleton />
          ) : curState === "transport-error" ? (
            <KpiError label={t("financeCockpit.truth.loadError")} />
          ) : (
            <div className={curState === "stale" ? "opacity-60" : ""}>
              <div className="mt-2 text-[21px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
                {t("financeCockpit.tax.kpiReviewValue", { count: r ? String(r.needsReviewCount) : "—" })}
              </div>
              <div className="mt-1.5 truncate text-[10px] text-gray-400">
                {curState === "stale"
                  ? t("financeCockpit.truth.staleHint")
                  : t("financeCockpit.tax.kpiReviewHint")}
              </div>
            </div>
          )}
        </div>
      </div>


      <div className="mb-7 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
        {/* 1A0a:Schedule C 對照 / 1099-NEC / ZIP 匯出 —— 口徑收斂前停用(plan v4.3
            §3.2.5:三出口未收斂+CPA 矩陣未定,未裁稅務產品不得渲染;server 端
            1A0b 封 procedure,此處 client 先撤 UI)。 */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className={cardH}>
            <div className={cardT}>
              <Lock className="h-3.5 w-3.5 text-gray-400" />
              {t("financeCockpit.tax.blockedTitle")}
            </div>
          </div>
          <div className="px-4 py-8 text-center text-xs leading-relaxed text-gray-400">
            {t("financeCockpit.tax.blockedDesc")}
          </div>
        </div>

        {/* 右欄:Trust 時點 / 已排除 / 1099 */}
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
                {recogState === "loading" ? (
                  <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-gray-100" />
                ) : recogState === "transport-error" ? (
                  <InlineError label={t("financeCockpit.truth.loadError")} />
                ) : (
                  <span className={`font-semibold text-gray-900 tabular-nums ${recogState === "stale" ? "opacity-60" : ""}`}>
                    {fmtMoney(recognizedThisYear)}
                  </span>
                )}
              </div>
              <div className="flex items-baseline justify-between border-t border-gray-50 py-2 text-xs">
                <span className="text-gray-600">
                  {t("financeCockpit.tax.trustDeferred")}
                  <span className="mt-px block text-[10px] text-gray-400">
                    {t("financeCockpit.tax.trustDeferredSub")}
                  </span>
                </span>
                {reconState === "loading" ? (
                  <span className="inline-block h-3.5 w-14 animate-pulse rounded bg-gray-100" />
                ) : reconState === "transport-error" ? (
                  <InlineError label={t("financeCockpit.truth.loadError")} />
                ) : (
                  <span className={`font-semibold text-amber-700 tabular-nums ${reconState === "stale" ? "opacity-60" : ""}`}>
                    {fmtMoney(trustAgg.outstanding)}
                  </span>
                )}
              </div>
            </div>
            <div className={noteCls}>
              <Info className="mt-0.5 h-3 w-3 flex-shrink-0 text-gray-300" />
              <span>
                {t("financeCockpit.tax.trustNote")}
                {(recognized.data ? recognized.data.length : 0) >= 200 && <> {t("financeCockpit.tax.recognizedTruncated")}</>}
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className={cardH}>
              <div className={cardT}>
                <CheckCircle2 className="h-3.5 w-3.5 text-gray-400" />
                {t("financeCockpit.tax.exclTitle")}
              </div>
              <div className="text-[11px] text-gray-500">
                {/* 1A0a(Codex 7-18 P2-2):排除金額源自 cur;stale 時卡內標記,不當 current */}
                {curState === "stale" ? t("financeCockpit.truth.staleHint") : t("financeCockpit.tax.exclMeta")}
              </div>
            </div>
            <div className={`flex items-center gap-2 px-4 py-2 text-xs text-gray-600 ${curState === "stale" ? "opacity-60" : ""}`}>
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              <span className="flex-1">
                <b className="font-semibold text-gray-800">{t("financeCockpit.tax.exclStripe")}</b>{" "}
                {t("financeCockpit.tax.exclStripeDesc")}
              </span>
              <span className="text-gray-400 tabular-nums">{r ? fmtSignedMoney(r.stripePayout.total) : "—"}</span>
            </div>
            {/* F2 塊D 回令(2026-07-10):square_payout 排除列,照 stripe 模式 $0 恆顯 */}
            <div className="flex items-center gap-2 border-t border-gray-50 px-4 py-2 text-xs text-gray-600">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              <span className="flex-1">
                <b className="font-semibold text-gray-800">{t("financeCockpit.tax.exclSquare")}</b>{" "}
                {t("financeCockpit.tax.exclSquareDesc")}
              </span>
              <span className="text-gray-400 tabular-nums">{r ? fmtSignedMoney(r.squarePayout ? r.squarePayout.total : 0) : "—"}</span>
            </div>
            <div className="flex items-center gap-2 border-t border-gray-50 px-4 py-2 pb-3 text-xs text-gray-600">
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300" />
              <span className="flex-1">
                <b className="font-semibold text-gray-800">{t("financeCockpit.tax.exclTransfer")}</b>{" "}
                {t("financeCockpit.tax.exclTransferDesc")}
              </span>
              <span className="text-gray-400 tabular-nums">{r ? fmtSignedMoney(r.transfer.total) : "—"}</span>
            </div>
          </div>


          {/* F-workbench 移除「1040-ES 季繳」卡:後端無預估稅算法,Q1–Q4 永遠
              hardcode「待建」——佔位假功能違反誠實原則(每天佔一塊版面顯示空殼)。
              等後端真有 1040-ES 計算(需聯邦+加州有效稅率設定)再帶著真資料回來。 */}
        </div>
      </div>

    </div>
  );
}

/** KPI 格 loading 骨架(1A0a:冷載不得顯 $0)。 */
function KpiSkeleton() {
  return (
    <>
      <div className="mt-2 h-6 w-20 animate-pulse rounded bg-gray-100" />
      <div className="mt-2 h-2.5 w-24 animate-pulse rounded bg-gray-50" />
    </>
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
