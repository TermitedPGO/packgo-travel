/**
 * v2 Wave 2 Module 2.12 — Cost tab.
 *
 * Verbatim JSX extraction from TourEditDialog L1138-1256. State + handlers
 * pulled from the shared edit context.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useTourEdit } from "./_context";

export default function CostTab() {
  const { t } = useLocale();
  const {
    editedData,
    setEditedData,
    addCostItem,
    removeCostItem,
    updateCostItem,
  } = useTourEdit();

  return (
    <div className="mt-0 space-y-6">
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.costIncluded')}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addCostItem('included')}
            className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tourEditDialog.addItem')}
          </Button>
        </div>

        {editedData.costExplanation?.included?.map((item: string, index: number) => (
          <div key={index} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateCostItem('included', index, e.target.value)}
              placeholder={t('tourEditDialog.includedPlaceholder')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeCostItem('included', index)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.costExcluded')}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addCostItem('excluded')}
            className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tourEditDialog.addItem')}
          </Button>
        </div>

        {editedData.costExplanation?.excluded?.map((item: string, index: number) => (
          <div key={index} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateCostItem('excluded', index, e.target.value)}
              placeholder={t('tourEditDialog.excludedPlaceholder')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeCostItem('excluded', index)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.additionalCosts')}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addCostItem('additionalCosts')}
            className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
          >
            <Plus className="h-4 w-4 mr-2" />
            {t('tourEditDialog.addItem')}
          </Button>
        </div>

        {editedData.costExplanation?.additionalCosts?.map((item: string, index: number) => (
          <div key={index} className="flex gap-2">
            <Input
              value={item}
              onChange={(e) => updateCostItem('additionalCosts', index, e.target.value)}
              placeholder={t('tourEditDialog.additionalCostPlaceholder')}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeCostItem('additionalCosts', index)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.notes')}</h3>
        <Textarea
          value={editedData.costExplanation?.notes || ""}
          onChange={(e) => setEditedData({
            ...editedData,
            costExplanation: { ...editedData.costExplanation, notes: e.target.value }
          })}
          rows={4}
          placeholder={t('tourEditDialog.costNotesPlaceholder')}
        />
      </div>
    </div>
  );
}
