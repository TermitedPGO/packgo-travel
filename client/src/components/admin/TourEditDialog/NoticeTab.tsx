/**
 * v2 Wave 2 Module 2.12 — Notice tab.
 *
 * Verbatim JSX extraction from TourEditDialog L1259-1399. State + handlers
 * pulled from the shared edit context.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useTourEdit } from "./_context";

export default function NoticeTab() {
  const { t } = useLocale();
  const {
    editedData,
    addNoticeItem,
    removeNoticeItem,
    updateNoticeItem,
  } = useTourEdit();

  return (
    <div className="mt-0 space-y-6">
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.preparation')}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addNoticeItem('preparation')}
            className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tourEditDialog.addItem')}
          </Button>
        </div>

        {editedData.noticeDetailed?.preparation?.map((item: string, index: number) => (
          <div key={index} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateNoticeItem('preparation', index, e.target.value)}
              placeholder={t('tourEditDialog.preparationPlaceholder')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeNoticeItem('preparation', index)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.culturalNotes')}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addNoticeItem('culturalNotes')}
            className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tourEditDialog.addItem')}
          </Button>
        </div>

        {editedData.noticeDetailed?.culturalNotes?.map((item: string, index: number) => (
          <div key={index} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateNoticeItem('culturalNotes', index, e.target.value)}
              placeholder={t('tourEditDialog.culturalNotesPlaceholder')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeNoticeItem('culturalNotes', index)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.healthSafety')}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addNoticeItem('healthSafety')}
            className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tourEditDialog.addItem')}
          </Button>
        </div>

        {editedData.noticeDetailed?.healthSafety?.map((item: string, index: number) => (
          <div key={index} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateNoticeItem('healthSafety', index, e.target.value)}
              placeholder={t('tourEditDialog.healthSafetyPlaceholder')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeNoticeItem('healthSafety', index)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.emergency')}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addNoticeItem('emergency')}
            className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tourEditDialog.addItem')}
          </Button>
        </div>

        {editedData.noticeDetailed?.emergency?.map((item: string, index: number) => (
          <div key={index} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateNoticeItem('emergency', index, e.target.value)}
              placeholder={t('tourEditDialog.emergencyPlaceholder')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeNoticeItem('emergency', index)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
