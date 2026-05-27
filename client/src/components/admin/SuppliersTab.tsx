/**
 * SuppliersTab — admin UI for the supplier-product sync subsystem.
 *
 * Phase 1E. Wires into the four adminProcedure endpoints in
 * server/routers/suppliersRouter.ts:
 *   suppliers.overview     → header cards
 *   suppliers.recentRuns   → bottom timeline
 *   suppliers.triggerSync  → "立即同步" button
 *   suppliers.listProducts → browse table with filters
 *   suppliers.bulkImport   → "批量匯入" button
 *
 * Layout:
 *   ┌────────────┐ ┌────────────┐
 *   │ 雄獅 4,522 │ │ UV  1,124  │   ← supplier cards
 *   └────────────┘ └────────────┘
 *
 *   [篩選 row] [批量匯入 button]
 *   ┌─ product grid (paginated) ───────┐
 *   │ 📷 商品名稱       天數 國家 價格  │
 *   │ 📷 ...                            │
 *   └───────────────────────────────────┘
 *
 *   [recent runs timeline (10 most recent)]
 *
 * Design follows CLAUDE.md rules: rounded-xl on cards/images, rounded-lg
 * on buttons/inputs, traditional Chinese as primary copy.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { LoadingRow } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
  Building2,
  Globe,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";

type SupplierCode = "lion" | "uv" | "";

export default function SuppliersTab() {
  const { t } = useLocale();
  /* ─────────────────────────── filter state ─────────────────────────── */
  const [supplierCode, setSupplierCode] = useState<SupplierCode>("");
  const [destinationCountry, setDestinationCountry] = useState("");
  const [keyword, setKeyword] = useState("");
  const [daysMin, setDaysMin] = useState<number | "">("");
  const [daysMax, setDaysMax] = useState<number | "">("");
  const [notYetImported, setNotYetImported] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  /* ───────────────────────────── queries ────────────────────────────── */
  const overview = trpc.suppliers.overview.useQuery(undefined, {
    refetchInterval: 15_000, // keep fresh while sync runs
  });
  const recentRuns = trpc.suppliers.recentRuns.useQuery(
    { limit: 10 },
    { refetchInterval: 10_000 }
  );
  const productsQuery = trpc.suppliers.listProducts.useQuery({
    supplierCode: supplierCode || undefined,
    destinationCountry: destinationCountry || undefined,
    keyword: keyword || undefined,
    daysMin: typeof daysMin === "number" ? daysMin : undefined,
    daysMax: typeof daysMax === "number" ? daysMax : undefined,
    notYetImported,
    page,
    pageSize,
  });

  /* ─────────────────────────── mutations ────────────────────────────── */
  const triggerSyncMut = trpc.suppliers.triggerSync.useMutation({
    onSuccess: (data) => {
      toast.success(t('admin.suppliers.syncQueued', { jobId: data.jobId.slice(-20) }));
      overview.refetch();
      recentRuns.refetch();
    },
    onError: (err) => toast.error(t('admin.suppliers.syncFailed', { msg: err.message })),
  });

  const bulkImportMut = trpc.suppliers.bulkImport.useMutation({
    onSuccess: (data) => {
      toast.success(
        t('admin.suppliers.importSuccess', { imported: data.imported, requested: data.requested, queued: data.rewriteQueued, duration: Math.round(data.durationMs / 1000) })
      );
      overview.refetch();
      productsQuery.refetch();
    },
    onError: (err) => toast.error(t('admin.suppliers.importFailed', { msg: err.message })),
  });

  const setHiddenMut = trpc.suppliers.setHidden.useMutation({
    onSuccess: () => productsQuery.refetch(),
  });

  /* ─────────────────────────── handlers ─────────────────────────────── */
  const onSync = (kind: "full" | "lion-only" | "uv-only") => {
    triggerSyncMut.mutate({ kind });
  };

  const onBulkImport = () => {
    if (!supplierCode) {
      toast.error(t('admin.suppliers.selectSupplierFirst'));
      return;
    }
    const filters = {
      supplierCode: supplierCode as "lion" | "uv",
      destinationCountry: destinationCountry || undefined,
      keyword: keyword || undefined,
      daysMin: typeof daysMin === "number" ? daysMin : undefined,
      daysMax: typeof daysMax === "number" ? daysMax : undefined,
      limit: Math.min(50, productsQuery.data?.totalCount ?? 0),
      queueRewrite: true,
    };
    const count = filters.limit;
    if (count === 0) {
      toast.error(t('admin.suppliers.noMatchingProducts'));
      return;
    }
    // 2026-05-16: dropped native confirm() because it blocks the Chrome
    // MCP automation pipeline and provides marginal value (toast already
    // surfaces the result). If admin friction becomes a problem we can
    // wire a proper shadcn AlertDialog later.
    toast.info(
      t('admin.suppliers.startImport', { count, supplier: supplierCode === "lion" ? "雄獅" : "UV" })
    );
    bulkImportMut.mutate(filters);
  };

  /* ─────────────────────────────── render ───────────────────────────── */
  const suppliers = overview.data ?? [];
  const products = productsQuery.data?.rows ?? [];
  const total = productsQuery.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6 text-teal-600" />
            {t('admin.suppliers.title')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('admin.suppliers.description')}
          </p>
        </div>
      </div>

      {/* Supplier cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {overview.isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border bg-gray-50 p-5 animate-pulse h-32"
              />
            ))
          : suppliers.map((s) => (
              <div
                key={s.id}
                className="rounded-xl border bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-gray-500">
                      {s.code === "lion" ? "TWD" : "USD"} ·{" "}
                      {s.isActive ? t('admin.suppliers.active') : t('admin.suppliers.inactive')}
                    </div>
                    <div className="text-lg font-bold mt-0.5">
                      {s.displayName}
                    </div>
                    <div className="text-3xl font-bold mt-2 text-teal-600">
                      {Number(s.counts.total ?? 0).toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Active {Number(s.counts.active ?? 0).toLocaleString()} ·
                      Inactive {Number(s.counts.inactive ?? 0).toLocaleString()}
                      {Number(s.counts.hidden ?? 0) > 0
                        ? ` · Hidden ${s.counts.hidden}`
                        : ""}
                    </div>
                    <div className="text-xs text-gray-400 mt-2">
                      {t('admin.suppliers.lastSync')}
                      {s.lastFullSyncAt
                        ? new Date(s.lastFullSyncAt).toLocaleString("zh-TW")
                        : t('admin.suppliers.notSynced')}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    disabled={triggerSyncMut.isPending}
                    onClick={() =>
                      onSync(s.code === "lion" ? "lion-only" : "uv-only")
                    }
                  >
                    <RefreshCw
                      className={`h-4 w-4 mr-1.5 ${
                        triggerSyncMut.isPending ? "animate-spin" : ""
                      }`}
                    />
                    {t('admin.suppliers.syncNow')}
                  </Button>
                </div>
              </div>
            ))}
      </div>

      {/* Filter bar */}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-gray-600 mb-1 block">{t('admin.suppliers.supplierFilter')}</label>
            <Select
              value={supplierCode || "all"}
              onValueChange={(v) =>
                setSupplierCode(v === "all" ? "" : (v as "lion" | "uv"))
              }
            >
              <SelectTrigger className="rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('admin.suppliers.all')}</SelectItem>
                <SelectItem value="lion">雄獅 (TWD)</SelectItem>
                <SelectItem value="uv">UV (USD)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-gray-600 mb-1 block">{t('admin.suppliers.destinationCountry')}</label>
            <Input
              placeholder={t('admin.suppliers.destinationPlaceholder')}
              value={destinationCountry}
              onChange={(e) => setDestinationCountry(e.target.value)}
              className="rounded-lg"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-gray-600 mb-1 block">{t('admin.suppliers.keyword')}</label>
            <Input
              placeholder={t('admin.suppliers.keywordPlaceholder')}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="rounded-lg"
            />
          </div>
          <div className="w-20">
            <label className="text-xs text-gray-600 mb-1 block">{t('admin.suppliers.minDays')}</label>
            <Input
              type="number"
              min={1}
              max={60}
              value={daysMin}
              onChange={(e) =>
                setDaysMin(e.target.value ? Number(e.target.value) : "")
              }
              className="rounded-lg"
            />
          </div>
          <div className="w-20">
            <label className="text-xs text-gray-600 mb-1 block">{t('admin.suppliers.maxDays')}</label>
            <Input
              type="number"
              min={1}
              max={60}
              value={daysMax}
              onChange={(e) =>
                setDaysMax(e.target.value ? Number(e.target.value) : "")
              }
              className="rounded-lg"
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer pb-2.5">
            <input
              type="checkbox"
              checked={notYetImported}
              onChange={(e) => setNotYetImported(e.target.checked)}
              className="rounded"
            />
            {t('admin.suppliers.notImportedOnly')}
          </label>
          <Button
            onClick={onBulkImport}
            disabled={
              bulkImportMut.isPending ||
              !supplierCode ||
              total === 0 ||
              !notYetImported /* safety — only allow bulk when filter set */
            }
            className="rounded-lg bg-teal-600 hover:bg-teal-700"
          >
            <Download
              className={`h-4 w-4 mr-1.5 ${
                bulkImportMut.isPending ? "animate-spin" : ""
              }`}
            />
            {t('admin.suppliers.bulkImport')}
          </Button>
        </div>
        <div className="text-xs text-gray-500 mt-3">
          {t('admin.suppliers.filterResults')} <span className="font-semibold">{t('admin.suppliers.productsCount', { n: total.toLocaleString() })}</span>
          {productsQuery.isFetching && ` · ${t('admin.suppliers.loadingEllipsis')}`}
        </div>
      </div>

      {/* Product grid */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        {productsQuery.isLoading ? (
          <LoadingRow />
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-gray-500 text-sm">
            {t('admin.suppliers.noProducts')}
            {notYetImported && (
              <div className="text-xs mt-2 text-gray-400">
                {t('admin.suppliers.showAllHint')}
              </div>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-600">
              <tr>
                <th className="text-left px-4 py-2.5">{t('admin.suppliers.productCol')}</th>
                <th className="text-left px-4 py-2.5 w-20">{t('admin.suppliers.daysCol')}</th>
                <th className="text-left px-4 py-2.5 w-32">{t('admin.suppliers.routeCol')}</th>
                <th className="text-left px-4 py-2.5 w-24">{t('admin.suppliers.supplierCol')}</th>
                <th className="text-right px-4 py-2.5 w-16">{t('admin.suppliers.actionCol')}</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const supplier = suppliers.find((s) => s.id === p.supplierId);
                return (
                  <tr key={p.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-start gap-2.5">
                        {p.imageUrl && (
                          <img
                            src={p.imageUrl}
                            alt=""
                            className="w-12 h-12 rounded-xl object-cover flex-shrink-0"
                            loading="lazy"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{p.title}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {p.externalProductCode}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline">{p.days}{t('admin.suppliers.daysSuffix')}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="text-gray-600">
                        {p.departureCity || "—"}
                      </div>
                      <div className="text-gray-900">
                        → {p.destinationCity || p.destinationCountry || "—"}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant="outline"
                        className={
                          supplier?.code === "lion"
                            ? "border-orange-200 text-orange-700"
                            : "border-blue-200 text-blue-700"
                        }
                      >
                        {supplier?.displayName.split(" ")[0] ?? supplier?.code}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg h-8 w-8 p-0"
                        title={t('admin.suppliers.hideShow')}
                        onClick={() =>
                          setHiddenMut.mutate({
                            productId: p.id,
                            hidden: true,
                          })
                        }
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {total > pageSize && (
          <div className="flex items-center justify-between p-3 border-t bg-gray-50 text-xs text-gray-600">
            <div>
              {t('admin.suppliers.pageInfo', { page, total: totalPages, count: total.toLocaleString() })}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg h-7"
              >
                {t('admin.suppliers.prevPage')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded-lg h-7"
              >
                {t('admin.suppliers.nextPage')}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Recent runs timeline */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <div className="font-semibold text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t('admin.suppliers.recentSyncRecords')}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg h-7 text-xs"
            onClick={() => onSync("full")}
            disabled={triggerSyncMut.isPending}
          >
            <Globe className="h-3.5 w-3.5 mr-1" />
            {t('admin.suppliers.fullSync')}
          </Button>
        </div>
        <div className="divide-y">
          {recentRuns.isLoading ? (
            <LoadingRow />
          ) : (recentRuns.data ?? []).length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-500">
              {t('admin.suppliers.noSyncRecords')}
            </div>
          ) : (
            (recentRuns.data ?? []).map((r) => (
              <div
                key={r.id}
                className="px-4 py-2.5 flex items-center gap-3 text-sm"
              >
                {r.status === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                ) : r.status === "failed" ? (
                  <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                ) : r.status === "partial" ? (
                  <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                ) : (
                  <RefreshCw className="h-4 w-4 text-blue-600 animate-spin flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.supplierName}</span>
                    <Badge variant="outline" className="text-xs">
                      {r.kind}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {new Date(r.startedAt).toLocaleString("zh-TW")}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {r.productsScanned} scanned · {r.productsAdded} added ·{" "}
                    {r.departuresScanned} departures
                    {r.durationMs &&
                      ` · ${Math.round(r.durationMs / 1000)}s`}
                  </div>
                  {r.errorMessage && (
                    <div className="text-xs text-red-600 mt-1">
                      {r.errorMessage}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
