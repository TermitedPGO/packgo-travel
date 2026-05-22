/**
 * LlmCostTabV2 — Trip.com-style LLM cost admin (Round 81 v2 redesign).
 *
 * Reads `admin.llmCostReport` (Redis-backed) and renders:
 *   - KPIStrip with 4 KPIs: total cost, total calls, cache hit %, circuit opens
 *   - Range picker (7d / 14d / 30d) via shadcn Select (single-choice)
 *   - Dense DataTable of per-day rows: date, calls, cache hits, model token
 *     splits, daily $ — same data as v1 but in the unified 36px row layout
 *
 * The v1 LlmCostTab also surfaces "recommendations" in a gold card; the V2
 * keeps them as an inline footer block since they're useful actionable hints
 * but shouldn't dominate the visual.
 *
 * Backend wire: trpc.admin.llmCostReport — no changes.
 *
 * Phase E tab #6 (Bookings #1, Inquiries #2, Reviews #3, Packpoint #4,
 * Vouchers #5, LlmCost #6).
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import {
  DataTable,
  StatusDot,
  EmptyState,
  KPIStrip,
  type Column,
  type KPI,
} from "@/components/admin/primitives";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, RefreshCw, Lightbulb } from "lucide-react";

type Range = 7 | 14 | 30;

type ModelRow = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUSD: number;
};

type DayRow = {
  date: string;
  callsTotal: number;
  cacheHits: number;
  cacheMisses: number;
  circuitOpened: number;
  perModel: ModelRow[];
  totalUSD: number;
  id: string; // alias of date for DataTable's required id
};

function fmtUSD(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return "$0";
  return `$${n.toFixed(digits)}`;
}

function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function tokensForModelTier(
  perModel: ModelRow[],
  tier: "haiku" | "sonnet",
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

export default function LlmCostTabV2() {
  const { t } = useLocale();
  const [days, setDays] = useState<Range>(7);

  const { data, isLoading, isFetching, refetch } =
    trpc.admin.llmCostReport.useQuery(
      { days },
      { staleTime: 1000 * 60 * 2 },
    );

  const rows: DayRow[] = useMemo(() => {
    if (!data) return [];
    return data.days.map((d) => ({ ...d, id: d.date }));
  }, [data]);

  const cacheHitPct = data ? Math.round((data.cacheHitRate || 0) * 100) : 0;
  const circuitTotal =
    data?.days.reduce((acc, d) => acc + d.circuitOpened, 0) ?? 0;

  // Auto-surfaced recommendations
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
    const cacheLookups =
      data.totalCacheHits +
      data.days.reduce((acc, d) => acc + d.cacheMisses, 0);
    if (cacheLookups > 0 && data.cacheHitRate < 0.3) {
      out.push({
        kind: "warn",
        text: t("admin.llmCost.tipCacheLow", {
          pct: String(Math.round(data.cacheHitRate * 100)),
        }),
      });
    }
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
  }, [data, days, t, circuitTotal]);

  const kpis: KPI[] = [
    {
      label: t("admin.llmCost.statTotalCost"),
      value: fmtUSD(data?.totalUSD ?? 0, 4),
      hint: t("admin.llmCost.statTotalCostSub", { days: String(days) }),
    },
    {
      label: t("admin.llmCost.statTotalCalls"),
      value: (data?.totalCalls ?? 0).toLocaleString(),
      hint: t("admin.llmCost.statTotalCallsSub"),
    },
    {
      label: t("admin.llmCost.statCacheHit"),
      value: `${cacheHitPct}%`,
      hint: t("admin.llmCost.statCacheHitSub"),
      tone: cacheHitPct < 30 && data && data.totalCalls > 0 ? "warn" : undefined,
    },
    {
      label: t("admin.llmCost.statCircuit"),
      value: String(circuitTotal),
      hint: t("admin.llmCost.statCircuitSub"),
      tone: circuitTotal > 0 ? "danger" : undefined,
    },
  ];

  const columns: Column<DayRow>[] = [
    {
      key: "date",
      header: t("admin.llmCost.colDate"),
      width: "w-28",
      sortable: true,
      sortValue: (r) => r.date,
      render: (r) => (
        <span className="text-gray-700 tabular-nums">{r.date}</span>
      ),
    },
    {
      key: "status",
      header: t("admin.bookingsTab.columnStatus"),
      width: "w-20",
      render: (r) => (
        <StatusDot
          tone={
            r.circuitOpened > 0
              ? "danger"
              : r.callsTotal > 0
                ? "success"
                : "muted"
          }
          label={
            r.circuitOpened > 0
              ? t("admin.llmCostV2.statusErr")
              : r.callsTotal > 0
                ? t("admin.llmCostV2.statusOk")
                : t("admin.llmCostV2.statusIdle")
          }
        />
      ),
    },
    {
      key: "calls",
      header: t("admin.llmCost.colCalls"),
      width: "w-20",
      align: "right",
      sortable: true,
      sortValue: (r) => r.callsTotal,
      render: (r) => (
        <span className="tabular-nums">{r.callsTotal.toLocaleString()}</span>
      ),
    },
    {
      key: "cache",
      header: t("admin.llmCost.colCacheHit"),
      width: "w-20",
      align: "right",
      sortable: true,
      sortValue: (r) => r.cacheHits,
      render: (r) => (
        <span className="tabular-nums text-gray-700">
          {r.cacheHits.toLocaleString()}
        </span>
      ),
    },
    {
      key: "haikuIn",
      header: t("admin.llmCost.colHaikuIn"),
      width: "w-20",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-gray-600">
          {fmtTokens(tokensForModelTier(r.perModel, "haiku").input)}
        </span>
      ),
    },
    {
      key: "haikuOut",
      header: t("admin.llmCost.colHaikuOut"),
      width: "w-20",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-gray-600">
          {fmtTokens(tokensForModelTier(r.perModel, "haiku").output)}
        </span>
      ),
    },
    {
      key: "sonnetIn",
      header: t("admin.llmCost.colSonnetIn"),
      width: "w-20",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-gray-600">
          {fmtTokens(tokensForModelTier(r.perModel, "sonnet").input)}
        </span>
      ),
    },
    {
      key: "sonnetOut",
      header: t("admin.llmCost.colSonnetOut"),
      width: "w-20",
      align: "right",
      render: (r) => (
        <span className="tabular-nums text-gray-600">
          {fmtTokens(tokensForModelTier(r.perModel, "sonnet").output)}
        </span>
      ),
    },
    {
      key: "totalUsd",
      header: t("admin.llmCost.colTotalUsd"),
      width: "w-24",
      align: "right",
      sortable: true,
      sortValue: (r) => r.totalUSD,
      render: (r) => (
        <span className="tabular-nums font-semibold text-gray-900">
          {fmtUSD(r.totalUSD, 4)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Header row: range picker + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400 font-semibold">
            {t("admin.llmCost.rangeLabel")}
          </span>
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(Number(v) as Range)}
          >
            <SelectTrigger className="h-8 rounded-lg text-xs w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t("admin.llmCost.range7")}</SelectItem>
              <SelectItem value="14">{t("admin.llmCost.range14")}</SelectItem>
              <SelectItem value="30">{t("admin.llmCost.range30")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="h-8 rounded-lg gap-1.5"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          {t("common.refresh")}
        </Button>
      </div>

      {/* KPI strip */}
      <KPIStrip items={kpis} />

      {/* Per-day table */}
      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" />}
          title={t("admin.llmCost.empty")}
          description={t("admin.llmCost.tipNoData", { days: String(days) })}
        />
      ) : (
        <DataTable
          data={rows}
          columns={columns}
          loading={isLoading}
          emptyText={t("admin.llmCost.empty")}
        />
      )}

      {/* Recommendations footer */}
      {tips.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-gray-500 font-semibold">
              {t("admin.llmCost.tipsTitle")}
            </span>
          </div>
          <ul className="space-y-1">
            {tips.map((tip, i) => (
              <li
                key={i}
                className={`text-xs leading-snug ${
                  tip.kind === "warn"
                    ? "text-amber-700"
                    : tip.kind === "ok"
                      ? "text-emerald-700"
                      : "text-gray-600"
                }`}
              >
                {tip.kind === "ok" ? "✓ " : "• "}
                {tip.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
