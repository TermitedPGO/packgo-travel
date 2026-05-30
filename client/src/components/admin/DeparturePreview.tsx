import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarDays, ExternalLink, CheckSquare, Square } from "lucide-react";

interface ExtractedDeparture {
  date: string;
  returnDate?: string;
  availableSpots?: number;
  adultPrice?: number;
  childWithBedPrice?: number;
  childNoBedPrice?: number;
  infantPrice?: number;
  status?: string;
}

interface ExtractedData {
  departureDates?: Array<{
    date: string;
    status?: string;
    price?: number;
  }>;
  capacity?: {
    maxParticipants?: number;
    minParticipants?: number;
  };
  pricing?: {
    adultPrice?: number;
    childWithBedPrice?: number;
    childNoBedPrice?: number;
    infantPrice?: number;
    currency?: string;
    priceNote?: string;
  };
  productCode?: string;
  sourceUrl?: string;
  extractedAt?: string;
}

interface DeparturePreviewProps {
  tourId: number;
  tourTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed?: () => void;
}

export default function DeparturePreview({
  tourId,
  tourTitle,
  open,
  onOpenChange,
  onConfirmed,
}: DeparturePreviewProps) {
  const { t } = useLocale();
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.tours.getExtractedDepartures.useQuery(
    { tourId },
    { enabled: open }
  );

  const [rows, setRows] = useState<ExtractedDeparture[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Build rows from extracted data when data arrives
  useEffect(() => {
    if (!data?.extractedDepartures) return;
    const ext = data.extractedDepartures as ExtractedData;
    const pricing = ext.pricing || {};
    const capacity = ext.capacity || {};
    const dates = ext.departureDates || [];

    const built: ExtractedDeparture[] = dates.map((d) => ({
      date: d.date,
      returnDate: undefined,
      availableSpots: capacity.maxParticipants,
      adultPrice: pricing.adultPrice,
      childWithBedPrice: pricing.childWithBedPrice,
      childNoBedPrice: pricing.childNoBedPrice,
      infantPrice: pricing.infantPrice,
      status: d.status,
    }));

    setRows(built);
    setSelected(new Set(built.map((_, i) => i)));
  }, [data]);

  const confirmMutation = trpc.tours.confirmExtractedDepartures.useMutation({
    onSuccess: (result) => {
      const skipped = (result as { skipped?: number }).skipped ?? 0;
      toast.success(
        skipped > 0
          ? t("departurePreview.departuresCreatedWithSkipped", {
              count: String(result.created),
              skipped: String(skipped),
            })
          : t("departurePreview.departuresCreated", { count: String(result.created) })
      );
      utils.tours.getExtractedDepartures.invalidate({ tourId });
      onConfirmed?.();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err.message || t("departurePreview.createFailed"));
    },
  });

  const handleToggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((_, i) => i)));
    }
  };

  const handleToggleRow = (idx: number) => {
    const next = new Set(selected);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    setSelected(next);
  };

  const handleCellEdit = (
    idx: number,
    field: keyof ExtractedDeparture,
    value: string
  ) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const numFields: (keyof ExtractedDeparture)[] = [
          "availableSpots",
          "adultPrice",
          "childWithBedPrice",
          "childNoBedPrice",
          "infantPrice",
        ];
        if (numFields.includes(field)) {
          return { ...row, [field]: value === "" ? undefined : Number(value) };
        }
        return { ...row, [field]: value };
      })
    );
  };

  const handleConfirm = () => {
    const selectedRows = rows.filter((_, i) => selected.has(i));
    if (selectedRows.length === 0) {
      toast.warning(t("departurePreview.selectOne"));
      return;
    }
    confirmMutation.mutate({
      tourId,
      selectedDates: selectedRows.map((r) => ({
        date: r.date,
        // Thread the edited 回程/returnDate through; server falls back to
        // departureDate + 1 day only when this is left empty.
        returnDate: r.returnDate?.trim() ? r.returnDate.trim() : undefined,
        status: r.status || "available",
        adultPrice: r.adultPrice,
        childWithBedPrice: r.childWithBedPrice,
        childNoBedPrice: r.childNoBedPrice,
        infantPrice: r.infantPrice,
        maxParticipants: r.availableSpots,
      })),
      clearExtracted: true,
    });
  };

  const ext = data?.extractedDepartures as ExtractedData | null | undefined;
  const sourceUrl = ext?.sourceUrl;
  const extractedAt = ext?.extractedAt;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl rounded-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg text-foreground">
            <CalendarDays className="h-5 w-5 text-[#c9a563]" />
            {t("departurePreview.title")}
          </DialogTitle>
          <p className="text-sm text-foreground/60 mt-1">{tourTitle}</p>
        </DialogHeader>

        {/* Source info */}
        {(sourceUrl || extractedAt) && (
          <div className="flex flex-wrap gap-4 text-xs text-foreground/60 border border-foreground/10 rounded-lg px-3 py-2 bg-[#FAF8F2]">
            {sourceUrl && (
              <span className="flex items-center gap-1">
                <span className="font-medium">{t("departurePreview.extractedFrom")}：</span>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8a6f3a] hover:underline flex items-center gap-1"
                >
                  {sourceUrl.length > 60 ? sourceUrl.slice(0, 60) + "…" : sourceUrl}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            )}
            {extractedAt && (
              <span>
                <span className="font-medium">{t("departurePreview.extractedAt")}：</span>
                {new Date(extractedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#c9a563]" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-8 text-destructive">
            {t("departurePreview.loadError", { err: error.message })}
          </div>
        )}

        {/* No data */}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-12 text-foreground/60">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#FAF8F2] mb-3">
              <CalendarDays className="h-6 w-6 text-[#c9a563]" />
            </div>
            <p>{t("departurePreview.noExtractedData")}</p>
          </div>
        )}

        {/* Table */}
        {!isLoading && rows.length > 0 && (
          <div className="space-y-3">
            {/* Select all bar */}
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-lg text-xs gap-1"
                onClick={handleToggleAll}
              >
                {selected.size === rows.length ? (
                  <>
                    <CheckSquare className="h-4 w-4" />
                    {t("departurePreview.deselectAll")}
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4" />
                    {t("departurePreview.selectAll")}
                  </>
                )}
              </Button>
              <Badge variant="secondary" className="rounded-md text-xs">
                {t("departurePreview.selectedCount", { n: String(selected.size), total: String(rows.length) })}
              </Badge>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-foreground/15">
              <table className="w-full text-sm">
                <thead className="bg-[#FAF8F2]">
                  <tr>
                    <th className="w-10 px-3 py-2 text-center">
                      <Checkbox
                        checked={selected.size === rows.length && rows.length > 0}
                        onCheckedChange={handleToggleAll}
                      />
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">
                      {t("departurePreview.departureDate")}
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">
                      {t("departurePreview.returnDate")}
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">
                      {t("departurePreview.availableSpots")}
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">
                      {t("departurePreview.adultPrice")}
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">
                      {t("departurePreview.childPrice")}
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">
                      {t("departurePreview.infantPrice")}
                    </th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-foreground/60 uppercase tracking-wider whitespace-nowrap">
                      {t("departurePreview.colStatus")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`border-t border-foreground/10 transition-colors ${
                        selected.has(idx) ? "bg-[#FAF8F2]/60" : "opacity-50"
                      }`}
                    >
                      <td className="px-3 py-2 text-center">
                        <Checkbox
                          checked={selected.has(idx)}
                          onCheckedChange={() => handleToggleRow(idx)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.date}
                          onChange={(e) => handleCellEdit(idx, "date", e.target.value)}
                          className="h-7 text-xs rounded-lg w-32 border-foreground/20"
                          placeholder={t("departurePreview.placeholderDate")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.returnDate || ""}
                          onChange={(e) => handleCellEdit(idx, "returnDate", e.target.value)}
                          className="h-7 text-xs rounded-lg w-32 border-foreground/20"
                          placeholder={t("departurePreview.placeholderDate")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.availableSpots ?? ""}
                          onChange={(e) => handleCellEdit(idx, "availableSpots", e.target.value)}
                          className="h-7 text-xs rounded-lg w-20 border-foreground/20"
                          placeholder={t("departurePreview.placeholderSpots")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.adultPrice ?? ""}
                          onChange={(e) => handleCellEdit(idx, "adultPrice", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24 border-foreground/20"
                          placeholder={t("departurePreview.placeholderPrice")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.childWithBedPrice ?? ""}
                          onChange={(e) => handleCellEdit(idx, "childWithBedPrice", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24 border-foreground/20"
                          placeholder={t("departurePreview.placeholderPrice")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.infantPrice ?? ""}
                          onChange={(e) => handleCellEdit(idx, "infantPrice", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24 border-foreground/20"
                          placeholder={t("departurePreview.placeholderPrice")}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.status || ""}
                          onChange={(e) => handleCellEdit(idx, "status", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24 border-foreground/20"
                          placeholder={t("departurePreview.placeholderStatus")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            className="rounded-lg border-foreground/20"
            onClick={() => onOpenChange(false)}
          >
            {t("departurePreview.cancelButton")}
          </Button>
          {rows.length > 0 && (
            <Button
              className="rounded-lg bg-foreground hover:bg-foreground/85 text-white gap-2"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending || selected.size === 0}
            >
              {confirmMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t("departurePreview.confirmButtonWithCount", { n: String(selected.size) })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
