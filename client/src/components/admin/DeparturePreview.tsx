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
      toast.success(
        t("departuresCreated", { count: result.created }) ||
          `成功建立 ${result.created} 筆出發日`
      );
      utils.tours.getExtractedDepartures.invalidate({ tourId });
      onConfirmed?.();
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err.message || "建立失敗");
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
      toast.warning("請至少選擇一筆出發日期");
      return;
    }
    confirmMutation.mutate({
      tourId,
      selectedDates: selectedRows.map((r) => ({
        date: r.date,
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
          <DialogTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="h-5 w-5 text-teal-600" />
            {t("extractedDepartures") || "AI 抽取的出發日期"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">{tourTitle}</p>
        </DialogHeader>

        {/* Source info */}
        {(sourceUrl || extractedAt) && (
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/30">
            {sourceUrl && (
              <span className="flex items-center gap-1">
                <span className="font-medium">{t("extractedFrom") || "資料來源"}：</span>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 hover:underline flex items-center gap-1"
                >
                  {sourceUrl.length > 60 ? sourceUrl.slice(0, 60) + "…" : sourceUrl}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            )}
            {extractedAt && (
              <span>
                <span className="font-medium">{t("extractedAt") || "抽取時間"}：</span>
                {new Date(extractedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-teal-600" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-center py-8 text-destructive">
            載入失敗：{error.message}
          </div>
        )}

        {/* No data */}
        {!isLoading && !error && rows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <CalendarDays className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>{t("noExtractedData") || "此行程沒有 AI 抽取的出發日資料"}</p>
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
                    {t("deselectAll") || "取消全選"}
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4" />
                    {t("selectAll") || "全選"}
                  </>
                )}
              </Button>
              <Badge variant="secondary" className="rounded-md text-xs">
                已選 {selected.size} / {rows.length} 筆
              </Badge>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="w-10 px-3 py-2 text-center">
                      <Checkbox
                        checked={selected.size === rows.length && rows.length > 0}
                        onCheckedChange={handleToggleAll}
                      />
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t("departureDate") || "出發日期"}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t("returnDate") || "回程日期"}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t("availableSpots") || "團位"}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t("adultPrice") || "成人價"}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t("childPrice") || "兒童價"}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      {t("infantPrice") || "嬰兒價"}
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                      狀態
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr
                      key={idx}
                      className={`border-t border-border transition-colors ${
                        selected.has(idx) ? "bg-teal-50/50" : "opacity-50"
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
                          className="h-7 text-xs rounded-lg w-32"
                          placeholder="YYYY-MM-DD"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.returnDate || ""}
                          onChange={(e) => handleCellEdit(idx, "returnDate", e.target.value)}
                          className="h-7 text-xs rounded-lg w-32"
                          placeholder="YYYY-MM-DD"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.availableSpots ?? ""}
                          onChange={(e) => handleCellEdit(idx, "availableSpots", e.target.value)}
                          className="h-7 text-xs rounded-lg w-20"
                          placeholder="人數"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.adultPrice ?? ""}
                          onChange={(e) => handleCellEdit(idx, "adultPrice", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24"
                          placeholder="NT$"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.childWithBedPrice ?? ""}
                          onChange={(e) => handleCellEdit(idx, "childWithBedPrice", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24"
                          placeholder="NT$"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          value={row.infantPrice ?? ""}
                          onChange={(e) => handleCellEdit(idx, "infantPrice", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24"
                          placeholder="NT$"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          value={row.status || ""}
                          onChange={(e) => handleCellEdit(idx, "status", e.target.value)}
                          className="h-7 text-xs rounded-lg w-24"
                          placeholder="狀態"
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
            className="rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          {rows.length > 0 && (
            <Button
              className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white gap-2"
              onClick={handleConfirm}
              disabled={confirmMutation.isPending || selected.size === 0}
            >
              {confirmMutation.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t("confirmCreate") || "確認建立"} ({selected.size} 筆)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
