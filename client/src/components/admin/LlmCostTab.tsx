/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 80.15-G — Admin → AI 成本 tab.
//
// Reads `admin.llmCostReport` (Redis-backed, no DB) and renders:
//   - Header with 7d/14d/30d toggle + manual refresh
//   - 4 stat tiles: total $, total calls, cache hit %, circuit opens
//   - Per-day table (newest first)
//   - Auto-surfaced recommendations (cache-low / circuit / no-data / healthy)
//
// Visual constraints (from CLAUDE.md):
//   rounded-xl on tiles/cards, rounded-lg on buttons, B&W + Gold ONLY.
//   No charts — table is enough for a one-person operator.
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { RefreshCw, DollarSign, Activity, Database, AlertTriangle, Lightbulb } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

const GOLD = "#c9a563";
const GOLD_DARK = "#8a6f3a";

type Range = 7 | 14 | 30;

function fmtUSD(n: number, digits: number = 4): string {
  if (!Number.isFinite(n)) return "$0";
  // Show meaningful precision for tiny daily spend.
  return `$${n.toFixed(digits)}`;
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatTile({
  title,
  value,
  sub,
  icon: Icon,
  highlight = false,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: any;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl p-5 border transition-colors " +
        (highlight
          ? "bg-black text-white border-black"
          : "bg-white border-gray-200")
      }
    >
      <div className="flex items-start justify-between mb-3">
        <span
          className={
            "text-sm font-medium " +
            (highlight ? "text-gray-300" : "text-gray-500")
          }
        >
          {title}
        </span>
        <Icon
          className="h-4 w-4"
          style={{ color: highlight ? GOLD : GOLD_DARK }}
        />
      </div>
      <div className={"text-2xl font-bold " + (highlight ? "text-white" : "text-gray-900")}>
        {value}
      </div>
      {sub && (
        <div
          className={
            "text-xs mt-1 " + (highlight ? "text-gray-400" : "text-gray-500")
          }
        >
          {sub}
        </div>
      )}
    </div>
  );
}

function tokensForModelTier(
  perModel: Array<{ model: string; inputTokens: number; outputTokens: number }>,
  tier: "haiku" | "sonnet"
): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const m of perModel) {
    const lower = (m.model || "").toLowerCase();
    if (lower.includes(tier)) {
      input += m.inputTokens || 0;
      output += m.outputTokens || 0;
    }
  }
  return { input, output };
}

export default function LlmCostTab() {
  const { t } = useLocale();
  const [days, setDays] = useState<Range>(7);

  const { data, isLoading, refetch, isFetching } =
    trpc.admin.llmCostReport.useQuery(
      { days },
      { staleTime: 1000 * 60 * 2 }
    );

  const tips = useMemo(() => {
    if (!data) return [];
    const out: { kind: "warn" | "info" | "ok"; text: string }[] = [];
    const hadAnyCall = data.totalCalls > 0;

    if (!hadAnyCall) {
      out.push({
        kind: "warn",
        text: t("admin.llmCost.tipNoData", { days: String(days) }),
      });
      return out;
    }

    const cacheLookups = data.totalCacheHits + (data.days.reduce((acc, d) => acc + d.cacheMisses, 0));
    if (cacheLookups > 0 && data.cacheHitRate < 0.3) {
      out.push({
        kind: "warn",
        text: t("admin.llmCost.tipCacheLow", {
          pct: String(Math.round(data.cacheHitRate * 100)),
        }),
      });
    }

    const circuitTotal = data.days.reduce((acc, d) => acc + d.circuitOpened, 0);
    if (circuitTotal > 0) {
      out.push({
        kind: "warn",
        text: t("admin.llmCost.tipCircuitOpen", { n: String(circuitTotal) }),
      });
    }

    if (out.length === 0) {
      out.push({ kind: "ok", text: t("admin.llmCost.tipHealthy") });
    }
    return out;
  }, [data, days, t]);

  const cacheHitPct = data ? Math.round((data.cacheHitRate || 0) * 100) : 0;
  const circuitTotal =
    data?.days.reduce((acc, d) => acc + d.circuitOpened, 0) ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">
            {t("admin.llmCost.title")}
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {t("admin.llmCost.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border border-gray-200 rounded-lg overflow-hidden">
            {([7, 14, 30] as Range[]).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={
                  "px-3 py-1.5 text-sm font-medium transition-colors " +
                  (days === d
                    ? "bg-black text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50")
                }
              >
                {d === 7
                  ? t("admin.llmCost.range7")
                  : d === 14
                  ? t("admin.llmCost.range14")
                  : t("admin.llmCost.range30")}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => refetch()}
            disabled={isFetching}
            title={t("admin.llmCost.refresh")}
          >
            <RefreshCw className={"h-4 w-4 " + (isFetching ? "animate-spin" : "")} />
          </Button>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          title={t("admin.llmCost.statTotalCost")}
          value={fmtUSD(data?.totalUSD ?? 0, 4)}
          sub={t("admin.llmCost.statTotalCostSub", { days: String(days) })}
          icon={DollarSign}
          highlight
        />
        <StatTile
          title={t("admin.llmCost.statTotalCalls")}
          value={(data?.totalCalls ?? 0).toLocaleString()}
          sub={t("admin.llmCost.statTotalCallsSub")}
          icon={Activity}
        />
        <StatTile
          title={t("admin.llmCost.statCacheHit")}
          value={`${cacheHitPct}%`}
          sub={t("admin.llmCost.statCacheHitSub")}
          icon={Database}
        />
        <StatTile
          title={t("admin.llmCost.statCircuit")}
          value={String(circuitTotal)}
          sub={t("admin.llmCost.statCircuitSub")}
          icon={AlertTriangle}
        />
      </div>

      {/* Per-day table */}
      <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            {t("admin.llmCost.tableTitle")}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colDate")}
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colCalls")}
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colCacheHit")}
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colHaikuIn")}
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colHaikuOut")}
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colSonnetIn")}
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colSonnetOut")}
                </th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500 uppercase">
                  {t("admin.llmCost.colTotalUsd")}
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400">
                    {t("admin.llmCost.loading")}
                  </td>
                </tr>
              ) : !data || data.days.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-gray-400">
                    {t("admin.llmCost.empty")}
                  </td>
                </tr>
              ) : (
                data.days.map((d) => {
                  const haiku = tokensForModelTier(d.perModel, "haiku");
                  const sonnet = tokensForModelTier(d.perModel, "sonnet");
                  const isHottest = d.totalUSD === Math.max(...data.days.map(x => x.totalUSD)) && d.totalUSD > 0;
                  return (
                    <tr
                      key={d.date}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="px-4 py-2 text-gray-700 whitespace-nowrap">
                        {d.date}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {d.callsTotal.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {d.cacheHits.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {fmtTokens(haiku.input)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {fmtTokens(haiku.output)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {fmtTokens(sonnet.input)}
                      </td>
                      <td className="px-4 py-2 text-right text-gray-600">
                        {fmtTokens(sonnet.output)}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-semibold whitespace-nowrap"
                        style={{ color: isHottest ? GOLD_DARK : "#111827" }}
                      >
                        {fmtUSD(d.totalUSD, 4)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recommendations */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: GOLD, background: "#fdfaf2" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="h-4 w-4" style={{ color: GOLD_DARK }} />
          <h3 className="text-sm font-semibold" style={{ color: GOLD_DARK }}>
            {t("admin.llmCost.tipsTitle")}
          </h3>
        </div>
        <ul className="space-y-1.5">
          {tips.map((tip, i) => (
            <li
              key={i}
              className="text-sm leading-snug"
              style={{
                color: tip.kind === "warn" ? "#8a6f3a" : "#374151",
              }}
            >
              {tip.kind === "warn" ? "• " : tip.kind === "ok" ? "✓ " : "• "}
              {tip.text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
