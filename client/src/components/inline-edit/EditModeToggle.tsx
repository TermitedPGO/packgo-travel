import React from "react";
import { Pencil, Eye, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";

interface EditModeToggleProps {
  isEditMode: boolean;
  onToggle: () => void;
  onSave?: () => void;
  onCancel?: () => void;
  isSaving?: boolean;
  hasChanges?: boolean;
  /** 已修改的數量（顯示在工具列） */
  modifiedCount?: number;
  /** changesCount 是 modifiedCount 的別名，兩者可互換使用 */
  changesCount?: number;
  className?: string;
}

export function EditModeToggle({
  isEditMode,
  onToggle,
  onSave,
  onCancel,
  isSaving = false,
  hasChanges = false,
  modifiedCount = 0,
  changesCount,
  className = "",
}: EditModeToggleProps) {
  const { t } = useLocale();
  // changesCount 是 modifiedCount 的別名，優先使用 changesCount
  const displayCount = changesCount ?? modifiedCount;
  return (
    <div
      className={cn(
        // v78u: TWO MODES with different positions to avoid CTA overlap.
        //
        // Edit mode (active): bottom-left toolbar with save/cancel — needs to be
        // prominent since admin is mid-edit; bottom-LEFT keeps it away from the
        // customer-style Book Now CTA in the bottom-sticky rail (right side).
        //
        // Preview mode (default): tiny pill at top-right under header, opacity 70%.
        // Out of the way of every customer CTA. Admin clicks "Edit" → toolbar slides
        // out to the prominent bottom-left position.
        isEditMode
          ? "fixed bottom-24 left-4 z-[60] flex items-center gap-2 bg-white rounded-xl shadow-xl border-2 p-2 transition-all border-yellow-400 shadow-yellow-100"
          : "fixed top-20 right-4 z-[40] flex items-center gap-2 bg-white rounded-full shadow-sm border p-1 transition-all opacity-70 hover:opacity-100 border-gray-200",
        className
      )}
    >
      {isEditMode ? (
        <>
          {/* 編輯模式標示 + 已修改數量 */}
          <div className="flex items-center gap-2 px-3 py-1 bg-yellow-100 rounded-lg text-yellow-800 text-sm font-medium">
            <Pencil className="h-4 w-4" />
            {t('tourDetail.editingLabel')}
            {displayCount > 0 && (
              <span className="bg-yellow-500 text-white text-xs px-1.5 py-0.5 rounded-full font-bold">
                {t('tourDetail.changeCountBadge', { count: displayCount })}
              </span>
            )}
          </div>

          {hasChanges && onSave && (
            <Button
              onClick={onSave}
              disabled={isSaving}
              className="rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('tourDetail.savingInProgress')}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {t('tourDetail.saveChanges')}
                  {displayCount > 0 && (
                    <span className="ml-1 text-xs opacity-80">{t('tourDetail.changeCountSuffix', { count: displayCount })}</span>
                  )}
                </>
              )}
            </Button>
          )}

          <Button
            variant="outline"
            onClick={onCancel || onToggle}
            disabled={isSaving}
            className="rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <X className="h-4 w-4 mr-2" />
            {hasChanges ? t('tourDetail.discardChanges') : t('tourDetail.exitEditMode')}
          </Button>
        </>
      ) : (
        <>
          {/* v78u: 預覽模式 — 縮小成圓型 icon button (top-right) */}
          <Button
            onClick={onToggle}
            size="sm"
            variant="ghost"
            className="rounded-full h-8 w-8 p-0 hover:bg-yellow-50 text-gray-600 hover:text-yellow-700"
            aria-label={t('tourDetail.enterEditMode')}
            title={t('tourDetail.enterEditMode')}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}

// 編輯模式提示橫幅
export function EditModeBanner({
  isEditMode,
  hasChanges,
}: {
  isEditMode: boolean;
  hasChanges: boolean;
}) {
  const { t } = useLocale();
  if (!isEditMode) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-yellow-400 text-yellow-900 py-2 px-4 text-center text-sm font-medium shadow-md">
      <div className="flex items-center justify-center gap-2">
        <Pencil className="h-4 w-4" />
        <span>{t('tourDetail.inEditModeBanner')}</span>
        {hasChanges && (
          <span className="bg-yellow-600 text-white px-2 py-0.5 rounded text-xs">
            {t('tourDetail.unsavedChangesBadge')}
          </span>
        )}
        <span className="text-yellow-700">
          {t('tourDetail.editModeHint')}
        </span>
      </div>
    </div>
  );
}

export default EditModeToggle;
