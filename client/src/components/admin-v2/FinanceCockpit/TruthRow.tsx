/**
 * TruthRow —— F3 財務駕駛艙塊A 真相列(四格 1:1)。
 *
 * 對齊 B-final 的 .kpis:圓角外框 + 左分隔線、label 10px 粗體 uppercase、
 * 值 24px 粗體 tabular-nums、hint 10px gray-400。狀態色一律用文字色(不做背景
 * 填色 —— admin 設計系統 anti-pattern):損益綠/紅、待認領琥珀。
 *
 * 每格獨立 loading / error(fail-open):某個資料源掛了只有那格顯示「讀取失敗」,
 * 其它三格照常,不整條白屏。數字全部來自 useCockpitData(不在此重算)。
 */
import { useLocale } from "@/contexts/LocaleContext";
import { fmtMoney, fmtSignedMoney } from "./cockpitMath";
import type { TruthRowData, TileState } from "./types";

type Tone = "default" | "pos" | "neg" | "amber";

function toneClass(tone: Tone): string {
  switch (tone) {
    case "pos":
      return "text-emerald-700";
    case "neg":
      return "text-rose-700";
    case "amber":
      return "text-amber-600"; // 大號金額用 amber-600;小字 hint 才用 amber-700(對比)
    default:
      return "text-gray-900";
  }
}

function Tile({
  label,
  state,
  value,
  hint,
  tone = "default",
  errorText,
}: {
  label: string;
  state: TileState;
  value: string;
  hint: string;
  tone?: Tone;
  errorText: string;
}) {
  return (
    <div className="p-3 sm:px-4 border-l border-gray-100 first:border-l-0">
      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 truncate">
        {label}
      </div>
      {state === "loading" ? (
        <>
          <div className="mt-2 h-6 w-20 rounded bg-gray-100 animate-pulse" />
          <div className="mt-2 h-2.5 w-28 rounded bg-gray-50 animate-pulse" />
        </>
      ) : state === "error" ? (
        <>
          <div className="mt-2 text-sm font-semibold leading-none text-gray-400">
            {errorText}
          </div>
          <div className="mt-1.5 text-[10px] text-gray-400 truncate">&nbsp;</div>
        </>
      ) : (
        <>
          <div
            className={`mt-2 text-2xl font-bold leading-none tracking-tight tabular-nums ${toneClass(
              tone,
            )}`}
          >
            {value}
          </div>
          <div className="mt-1.5 text-[10px] text-gray-400 truncate">{hint}</div>
        </>
      )}
    </div>
  );
}

export function TruthRow({ truth }: { truth: TruthRowData }) {
  const { t } = useLocale();
  const errText = t("financeCockpit.truth.loadError");

  const { cash, pl, pending, trust } = truth;

  // 現金部位
  const cashValue = cash.balance !== null ? fmtMoney(cash.balance) : "—";
  const cashHint =
    cash.balance !== null
      ? t("financeCockpit.truth.cashHint", { mask: cash.mask })
      : t("financeCockpit.truth.cashNotLinked");

  // 本月損益
  const plTone: Tone = pl.netProfit >= 0 ? "pos" : "neg";
  const plHint =
    pl.income > 0
      ? t("financeCockpit.truth.plHint", {
          income: fmtMoney(pl.income),
          margin: String(pl.margin),
        })
      : t("financeCockpit.truth.plHintNoIncome");

  // 待認領
  const pendingTone: Tone = pending.count > 0 ? "amber" : "default";
  const pendingHint =
    pending.count > 0
      ? t("financeCockpit.truth.pendingHint", { amount: fmtMoney(pending.total) })
      : t("financeCockpit.truth.pendingHintEmpty");

  // Trust 未認列
  const trustHint = trust.enabled
    ? t("financeCockpit.truth.trustHint", {
        unmatched: fmtMoney(trust.unmatchedTotal),
        balance: fmtMoney(trust.balance),
      })
    : t("financeCockpit.truth.trustDisabled");

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 rounded-xl border border-gray-200 bg-white overflow-hidden mb-5">
      <Tile
        label={t("financeCockpit.truth.cashLabel")}
        state={cash.state}
        value={cashValue}
        hint={cashHint}
        errorText={errText}
      />
      <Tile
        label={t("financeCockpit.truth.plLabel")}
        state={pl.state}
        value={fmtSignedMoney(pl.netProfit)}
        hint={plHint}
        tone={plTone}
        errorText={errText}
      />
      <Tile
        label={t("financeCockpit.truth.pendingLabel")}
        state={pending.state}
        value={t("financeCockpit.truth.pendingValue", { count: String(pending.count) })}
        hint={pendingHint}
        tone={pendingTone}
        errorText={errText}
      />
      <Tile
        label={t("financeCockpit.truth.trustLabel")}
        state={trust.state}
        value={fmtMoney(trust.outstanding)}
        hint={trustHint}
        errorText={errText}
      />
    </div>
  );
}
