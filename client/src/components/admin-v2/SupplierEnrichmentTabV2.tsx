/**
 * SupplierEnrichmentTabV2 — admin observability for the supplier deep
 * sync pipeline (M8 of Stage 1, 2026-05-24).
 *
 * Shows per-supplier matrix:
 *   - total active products
 *   - itinerary parsed / parse_failed / missing
 *   - last enriched timestamp
 *
 * Plus a "Re-enrich now" button per supplier (and "All") that triggers
 * the backfill mutation. The worker (concurrency 5) consumes jobs over
 * 1-2 hours for the full 5728-product catalog.
 *
 * The table auto-refreshes every 10 seconds while a backfill is active.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, RefreshCw, CheckCircle2, AlertTriangle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { zhTW } from "date-fns/locale";

export default function SupplierEnrichmentTabV2() {
  const [refreshKey, setRefreshKey] = useState(0);

  const overview = trpc.suppliers.enrichmentOverview.useQuery(undefined, {
    refetchInterval: 10_000, // refresh every 10s
  });
  const triggerBackfill = trpc.suppliers.triggerFullBackfill.useMutation({
    onSuccess: () => {
      setRefreshKey((k) => k + 1);
      overview.refetch();
    },
  });

  const handleTrigger = (supplierCode: "lion" | "uv" | "all") => {
    if (!confirm(`確定要重跑 ${supplierCode === "all" ? "全部" : supplierCode} 供應商的 detail 同步嗎? (背景跑 1-2 小時)`)) return;
    triggerBackfill.mutate({ supplierCode });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">🌏 供應商深度同步</h1>
          <p className="text-sm text-gray-500 mt-1">
            Lion + UV 每個產品抓全部 detail (itinerary / hotels / meals / policy / notice)。
            Worker concurrency 5,每天 03:00 UTC 自動跑;低於 7 天的不重抓。
          </p>
        </div>
        <Button
          onClick={() => overview.refetch()}
          variant="outline"
          size="sm"
          className="rounded-lg gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重整
        </Button>
      </div>

      {overview.isLoading && (
        <div className="text-center py-12 text-gray-400">載入中…</div>
      )}

      {overview.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          載入失敗: {overview.error.message}
        </div>
      )}

      {overview.data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {overview.data.map((row) => {
            const parsedPct = row.total > 0 ? Math.round((row.itineraryParsed / row.total) * 100) : 0;
            const failedPct = row.total > 0 ? Math.round((row.itineraryParseFailed / row.total) * 100) : 0;
            const missingPct = 100 - parsedPct - failedPct;

            return (
              <Card key={row.code} className="rounded-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{row.name}</span>
                    <span className="text-sm font-normal text-gray-500 tabular-nums">
                      {row.itineraryParsed.toLocaleString()} / {row.total.toLocaleString()}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Progress bar */}
                  <div className="space-y-1.5">
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
                      <div
                        className="bg-green-500 h-full transition-all"
                        style={{ width: `${parsedPct}%` }}
                      />
                      <div
                        className="bg-amber-400 h-full transition-all"
                        style={{ width: `${failedPct}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 tabular-nums">
                      {parsedPct}% 完成
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="rounded-lg bg-green-50 p-3 text-center">
                      <CheckCircle2 className="h-4 w-4 mx-auto text-green-600 mb-1" />
                      <div className="tabular-nums font-medium">{row.itineraryParsed.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">parsed</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-3 text-center">
                      <AlertTriangle className="h-4 w-4 mx-auto text-amber-600 mb-1" />
                      <div className="tabular-nums font-medium">{row.itineraryParseFailed.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">parse fail</div>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 text-center">
                      <Clock className="h-4 w-4 mx-auto text-gray-500 mb-1" />
                      <div className="tabular-nums font-medium">{row.itineraryMissing.toLocaleString()}</div>
                      <div className="text-xs text-gray-500">missing</div>
                    </div>
                  </div>

                  {/* Last enriched */}
                  <div className="text-xs text-gray-500">
                    最後同步:{" "}
                    {row.lastEnrichedAt ? (
                      <span className="tabular-nums">
                        {formatDistanceToNow(new Date(row.lastEnrichedAt), {
                          addSuffix: true,
                          locale: zhTW,
                        })}
                      </span>
                    ) : (
                      <span className="text-gray-400">尚未開始</span>
                    )}
                  </div>

                  {/* Action */}
                  <Button
                    onClick={() => handleTrigger(row.code as "lion" | "uv")}
                    disabled={triggerBackfill.isPending}
                    className="w-full rounded-lg gap-1.5 bg-[#c9a563] hover:bg-[#b8924d] text-white"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    重跑 {row.name} detail (missing + 7天 stale)
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Global re-enrich */}
      <div className="flex justify-center pt-2">
        <Button
          onClick={() => handleTrigger("all")}
          disabled={triggerBackfill.isPending}
          variant="outline"
          size="lg"
          className="rounded-lg gap-2"
        >
          <Sparkles className="h-4 w-4" />
          全部供應商 一起重跑
        </Button>
      </div>

      {triggerBackfill.isSuccess && triggerBackfill.data && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-sm">
          ✅ 已 enqueue {triggerBackfill.data.total.toLocaleString()} 個 jobs
          (Lion {triggerBackfill.data.enqueued.lion.toLocaleString()} · UV {triggerBackfill.data.enqueued.uv.toLocaleString()})。
          Worker concurrency 5,約 1-2 小時跑完。Table 每 10 秒自動 refresh。
        </div>
      )}
    </div>
  );
}
