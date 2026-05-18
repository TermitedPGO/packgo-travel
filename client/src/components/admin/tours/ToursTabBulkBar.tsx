/**
 * ToursTabBulkBar — floating bottom bar shown when ≥1 tour is selected.
 *
 * Round 80.10 redesign: replaces inline batch button row with a centered
 * fixed bar at bottom-center. Provides batch activate / deactivate /
 * delete + cancel.
 */
import { useLocale } from "@/contexts/LocaleContext";
import { Eye, EyeOff, Star, StarOff, Trash2, X } from "lucide-react";

interface ToursTabBulkBarProps {
  count: number;
  onBulkActivate: () => void;
  onBulkDeactivate: () => void;
  /** Round 80.14: batch toggle featured — Jeff curates the homepage
   *  spotlight set every week, so making this 1-click is high-value. */
  onBulkFeature?: () => void;
  onBulkUnfeature?: () => void;
  onBulkDelete: () => void;
  onClear: () => void;
  bulkPending?: boolean;
}

export function ToursTabBulkBar({
  count,
  onBulkActivate,
  onBulkDeactivate,
  onBulkFeature,
  onBulkUnfeature,
  onBulkDelete,
  onClear,
  bulkPending,
}: ToursTabBulkBarProps) {
  const { t } = useLocale();
  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-foreground text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-[95vw] flex-wrap">
      <span className="text-sm font-semibold">
        {t("toursTab.bulkSelectedPrefix")}{" "}
        <span className="text-[#c9a563]">{count}</span>{" "}
        {t("toursTab.bulkSelectedSuffix")}
      </span>
      <div className="w-px h-5 bg-white/20 mx-1" />
      <button
        type="button"
        disabled={bulkPending}
        onClick={onBulkActivate}
        className="flex items-center gap-1.5 text-sm hover:text-[#c9a563] transition-colors disabled:opacity-50"
      >
        <Eye className="w-4 h-4" />
        {t("toursTab.bulkActivate")}
      </button>
      <button
        type="button"
        disabled={bulkPending}
        onClick={onBulkDeactivate}
        className="flex items-center gap-1.5 text-sm hover:text-[#c9a563] transition-colors disabled:opacity-50"
      >
        <EyeOff className="w-4 h-4" />
        {t("toursTab.bulkDeactivate")}
      </button>
      {onBulkFeature && (
        <button
          type="button"
          disabled={bulkPending}
          onClick={onBulkFeature}
          className="flex items-center gap-1.5 text-sm hover:text-[#c9a563] transition-colors disabled:opacity-50"
        >
          <Star className="w-4 h-4" />
          {t("toursTab.bulkFeature")}
        </button>
      )}
      {onBulkUnfeature && (
        <button
          type="button"
          disabled={bulkPending}
          onClick={onBulkUnfeature}
          className="flex items-center gap-1.5 text-sm hover:text-[#c9a563] transition-colors disabled:opacity-50"
        >
          <StarOff className="w-4 h-4" />
          {t("toursTab.bulkUnfeature")}
        </button>
      )}
      <button
        type="button"
        disabled={bulkPending}
        onClick={onBulkDelete}
        className="flex items-center gap-1.5 text-sm hover:text-red-400 transition-colors disabled:opacity-50"
      >
        <Trash2 className="w-4 h-4" />
        {t("toursTab.bulkDelete")}
      </button>
      <div className="w-px h-5 bg-white/20 mx-1" />
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
        {t("toursTab.bulkCancel")}
      </button>
    </div>
  );
}
