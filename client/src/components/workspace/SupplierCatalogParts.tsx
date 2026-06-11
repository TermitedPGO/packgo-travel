/**
 * SupplierCatalogParts — 批5 m3 product row + bulk-import dialog
 * (split from SupplierCatalog for the 300-line rule).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import { Download, EyeOff } from "lucide-react";
import { BtnB, BtnO, Badge, Pill } from "./ws-ui";
import { formatRelTime } from "./relTime";
import {
  type CatalogFilterState,
  buildListProductsInput,
} from "./workspaceSuppliers.helpers";

/* ───────────────────── product row + 匯入 / 隱藏 ───────────────────── */

export function ProductRow({
  product,
  supplierCode,
}: {
  product: {
    id: number;
    externalProductCode: string;
    title: string;
    days: number | null;
    departureCity: string | null;
    destinationCountry: string | null;
    destinationCity: string | null;
    imageUrl: string | null;
    lastSyncedAt: Date | string | null;
  };
  supplierCode: string | undefined;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  const importMut = trpc.suppliers.importProduct.useMutation({
    onSuccess: (res) => {
      toast.success(
        t("workspace.supCatImported", { title: res.title ?? product.title }),
      );
      utils.suppliers.listProducts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const hideMut = trpc.suppliers.setHidden.useMutation({
    onSuccess: () => {
      toast.success(t("workspace.supCatHidden"));
      utils.suppliers.listProducts.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const canImport = supplierCode === "lion" || supplierCode === "uv";

  return (
    <div className="px-3 py-2 flex items-center gap-2.5 border-b border-gray-100 last:border-b-0 min-w-0">
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt=""
          className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium truncate">
          {product.title}
        </div>
        <div className="text-[11px] text-gray-400 flex items-center gap-1.5 flex-wrap">
          {supplierCode && <Badge>{supplierCode}</Badge>}
          {product.days != null && (
            <span>{t("workspace.supCatDays", { n: product.days })}</span>
          )}
          {product.destinationCountry && (
            <span className="truncate">{product.destinationCountry}</span>
          )}
          {product.lastSyncedAt && (
            <Pill>{formatRelTime(product.lastSyncedAt, t)}</Pill>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <BtnO
          onClick={() => hideMut.mutate({ productId: product.id, hidden: true })}
          disabled={hideMut.isPending}
        >
          <span className="inline-flex items-center gap-1">
            <EyeOff className="w-3 h-3" />
            {t("workspace.supCatHide")}
          </span>
        </BtnO>
        <BtnB
          onClick={() =>
            importMut.mutate({
              supplierCode: supplierCode as "lion" | "uv",
              externalProductCode: product.externalProductCode,
              queueRewrite: true,
            })
          }
          disabled={!canImport || importMut.isPending}
        >
          <span className="inline-flex items-center gap-1">
            <Download className="w-3 h-3" />
            {importMut.isPending
              ? t("workspace.supCatImporting")
              : t("workspace.supCatImport")}
          </span>
        </BtnB>
      </div>
    </div>
  );
}

/* ───────────────────── 批量匯入 dialog ───────────────────── */

export function BulkImportDialog({
  filters,
  onClose,
}: {
  filters: CatalogFilterState;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [limit, setLimit] = useState("50");
  const [queueRewrite, setQueueRewrite] = useState(true);

  const bulkMut = trpc.suppliers.bulkImport.useMutation({
    onSuccess: (res) => {
      toast.success(
        t("workspace.supCatBulkDone", {
          imported: res.imported,
          failed: res.failed,
        }),
      );
      utils.suppliers.listProducts.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const parsedLimit = Number(limit);
  const valid =
    Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 200;
  const base = buildListProductsInput(filters, 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-md shadow-lg">
        <h3 className="text-sm font-semibold mb-1">
          {t("workspace.supCatBulkImport")}
        </h3>
        <p className="text-[11px] text-gray-500 mb-4">
          {t("workspace.supCatBulkHint")}
        </p>

        <label className="text-[11px] text-gray-500 mb-1 block">
          {t("workspace.supCatBulkLimit")}
        </label>
        <input
          type="number"
          min={1}
          max={200}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-gray-300 text-base sm:text-sm"
        />

        <label className="flex items-center gap-2 text-[11px] text-gray-600 mt-3">
          <input
            type="checkbox"
            checked={queueRewrite}
            onChange={(e) => setQueueRewrite(e.target.checked)}
          />
          {t("workspace.supCatBulkRewrite")}
        </label>

        <div className="flex justify-end gap-2 mt-5">
          <BtnO onClick={onClose}>{t("workspace.supCancel")}</BtnO>
          <BtnB
            onClick={() =>
              bulkMut.mutate({
                supplierCode: filters.supplierCode as "lion" | "uv",
                keyword: base.keyword,
                destinationCountry: base.destinationCountry,
                daysMin: base.daysMin,
                daysMax: base.daysMax,
                limit: parsedLimit,
                queueRewrite,
              })
            }
            disabled={!valid || bulkMut.isPending}
          >
            {bulkMut.isPending
              ? t("workspace.supCatImporting")
              : t("workspace.supCatBulkGo")}
          </BtnB>
        </div>
      </div>
    </div>
  );
}
