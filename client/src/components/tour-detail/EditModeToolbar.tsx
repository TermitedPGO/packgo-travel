/**
 * EditModeToolbar Component
 * 編輯模式工具列 - 顯示在頁面頂部，提供編輯模式切換和儲存功能
 */

import React from "react";
import { Pencil, X, Save, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEditMode } from "@/contexts/EditModeContext";
import { cn } from "@/lib/utils";
import { useLocale } from "@/contexts/LocaleContext";

interface EditModeToolbarProps {
  colorTheme?: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

export const EditModeToolbar: React.FC<EditModeToolbarProps> = ({ colorTheme }) => {
  const { isEditMode, canEdit, hasUnsavedChanges, toggleEditMode } = useEditMode();
  const { t } = useLocale();

  if (!canEdit) return null;

  return (
    <div
      className={cn(
        "fixed top-16 left-0 right-0 z-50 transition-all duration-300",
        isEditMode ? "translate-y-0" : "-translate-y-full pointer-events-none"
      )}
    >
      {/* 編輯模式提示條 */}
      <div
        className="bg-yellow-400 text-yellow-900 py-2 px-4 flex items-center justify-between shadow-lg"
      >
        <div className="flex items-center gap-3">
          <Pencil className="h-5 w-5" />
          <span className="font-medium">{t('tourDetail.sections.editMode')}</span>
          <span className="text-sm opacity-80">
            {t('tourDetail.sections.editModeDesc')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {hasUnsavedChanges && (
            <div className="flex items-center gap-2 text-sm bg-yellow-500 px-3 py-1 rounded-lg">
              <AlertCircle className="h-4 w-4" />
              {t('tourDetail.sections.unsavedChanges')}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={toggleEditMode}
            className="bg-white hover:bg-gray-100 text-yellow-900 border-yellow-600"
          >
            <X className="h-4 w-4 mr-1" />
            {t('tourDetail.sections.exitEdit')}
          </Button>
        </div>
      </div>
    </div>
  );
};

/**
 * EditModeButton Component
 * 浮動編輯按鈕 - 顯示在頁面右下角，點擊進入編輯模式
 */
export const EditModeButton: React.FC<EditModeToolbarProps> = ({ colorTheme }) => {
  const { isEditMode, canEdit, toggleEditMode } = useEditMode();

  if (!canEdit || isEditMode) return null;

  // v78r: position bottom-LEFT (not right) to avoid overlap with the Book Now CTA
  // in the bottom sticky rail, and use lower opacity + smaller size — it's an
  // admin-only utility, shouldn't compete visually with the customer flow.
  return (
    <Button
      onClick={toggleEditMode}
      className="fixed bottom-24 left-4 z-50 rounded-full w-11 h-11 shadow-md hover:shadow-lg opacity-60 hover:opacity-100 transition-all"
      style={{
        backgroundColor: colorTheme?.accent || "#1f2937",
      }}
      aria-label="Enter Edit Mode"
      title="Enter Edit Mode"
    >
      <Pencil className="h-4 w-4 text-white" />
    </Button>
  );
};
