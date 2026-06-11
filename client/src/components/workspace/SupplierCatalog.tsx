/**
 * SupplierCatalog — 批5 m3 商品庫 sub-view.
 *
 * Enrichment progress on top (absorbs SupplierEnrichmentTabV2), then the
 * supplier product mirror: filter / paginate / single import / hide /
 * bulk import. All mutations are existing suppliersRouter procedures.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { Layers } from "lucide-react";
import { BtnO } from "./ws-ui";
import {
  type CatalogFilterState,
  EMPTY_CATALOG_FILTERS,
  buildListProductsInput,
} from "./workspaceSuppliers.helpers";
import EnrichmentCard from "./SupplierEnrichmentCard";
import { ProductRow, BulkImportDialog } from "./SupplierCatalogParts";

export default function SupplierCatalog() {
  const { t } = useLocale();
  const [filters, setFilters] = useState<CatalogFilterState>(
    EMPTY_CATALOG_FILTERS,
  );
  const [page, setPage] = useState(1);
  const [showBulk, setShowBulk] = useState(false);

  const input = useMemo(
    () => buildListProductsInput(filters, page),
    [filters, page],
  );
  const productsQ = trpc.suppliers.listProducts.useQuery(input);
  const overviewQ = trpc.suppliers.overview.useQuery();

  // listProducts rows carry supplierId only; resolve code via overview.
  const codeById = useMemo(() => {
    const m: Record<number, string> = {};
    for (const s of overviewQ.data ?? []) m[s.id] = s.code;
    return m;
  }, [overviewQ.data]);

  const data = productsQ.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / data.pageSize)) : 1;

  const set = (patch: Partial<CatalogFilterState>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  return (
    <div className="space-y-4">
      <EnrichmentCard />

      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2.5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <select
            value={filters.supplierCode}
            onChange={(e) =>
              set({ supplierCode: e.target.value as CatalogFilterState["supplierCode"] })
            }
            className="px-2.5 py-2 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0"
          >
            <option value="">{t("workspace.supCatAllSuppliers")}</option>
            <option value="lion">Lion</option>
            <option value="uv">UV</option>
          </select>
          <input
            value={filters.keyword}
            onChange={(e) => set({ keyword: e.target.value })}
            placeholder={t("workspace.supCatKeyword")}
            className="px-2.5 py-2 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0"
          />
          <input
            value={filters.destinationCountry}
            onChange={(e) => set({ destinationCountry: e.target.value })}
            placeholder={t("workspace.supCatCountry")}
            className="px-2.5 py-2 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0"
          />
          <input
            value={filters.daysMin}
            onChange={(e) => set({ daysMin: e.target.value })}
            placeholder={t("workspace.supCatDaysMin")}
            inputMode="numeric"
            className="px-2.5 py-2 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0"
          />
          <input
            value={filters.daysMax}
            onChange={(e) => set({ daysMax: e.target.value })}
            placeholder={t("workspace.supCatDaysMax")}
            inputMode="numeric"
            className="px-2.5 py-2 rounded-lg border border-gray-300 text-base sm:text-xs min-w-0"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600 px-1 min-h-[44px] sm:min-h-0">
            <input
              type="checkbox"
              checked={filters.notYetImported}
              onChange={(e) => set({ notYetImported: e.target.checked })}
            />
            {t("workspace.supCatNotImported")}
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-gray-400">
            {data
              ? t("workspace.supCatCount", { n: data.totalCount })
              : t("workspace.loading")}
          </span>
          <BtnO
            onClick={() => setShowBulk(true)}
            disabled={!filters.supplierCode}
          >
            <span className="inline-flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              {t("workspace.supCatBulkImport")}
            </span>
          </BtnO>
        </div>
        {!filters.supplierCode && (
          <p className="text-[10px] text-gray-400">
            {t("workspace.supCatBulkNeedsSupplier")}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {(data?.rows ?? []).map((p) => (
          <ProductRow
            key={p.id}
            product={p}
            supplierCode={codeById[p.supplierId]}
          />
        ))}
        {data && data.rows.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">
            {t("workspace.supCatEmpty")}
          </p>
        )}
      </div>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <BtnO onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
            {t("workspace.supCatPrev")}
          </BtnO>
          <span className="text-[11px] text-gray-500">
            {page} / {totalPages}
          </span>
          <BtnO
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages}
          >
            {t("workspace.supCatNext")}
          </BtnO>
        </div>
      )}

      {showBulk && (
        <BulkImportDialog
          filters={filters}
          onClose={() => setShowBulk(false)}
        />
      )}
    </div>
  );
}
