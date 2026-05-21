/**
 * v2 Wave 2 Module 2.12 — Itinerary tab.
 *
 * Verbatim JSX extraction from TourEditDialog L962-1135. State + handlers
 * pulled from the shared edit context.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useTourEdit } from "./_context";

export default function ItineraryTab() {
  const { t } = useLocale();
  const {
    editedData,
    addDailyItinerary,
    removeDailyItinerary,
    updateDailyItinerary,
    addActivity,
    removeActivity,
    updateActivity,
  } = useTourEdit();

  return (
    <div className="mt-0 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.dailyItinerary')}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addDailyItinerary}
          className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('tourEditDialog.addDay')}
        </Button>
      </div>

      {editedData.itineraryDetailed?.map((day: any, dayIndex: number) => (
        <div key={dayIndex} className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground"><span className="inline-block w-1 h-4 bg-[#c9a563] mr-2 align-middle" />{t('tourEditDialog.dayLabel').replace('{day}', String(day.day))}</h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeDailyItinerary(dayIndex)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div>
            <Label className="text-sm font-medium">{t('tourEditDialog.dayTitle')}</Label>
            <Input
              value={day.title || ""}
              onChange={(e) => updateDailyItinerary(dayIndex, 'title', e.target.value)}
              className="mt-2"
              placeholder={t('tourEditDialog.dayTitlePlaceholder')}
            />
          </div>

          <div>
            <Label className="text-sm font-medium">{t('tourEditDialog.accommodation')}</Label>
            <Input
              value={day.accommodation || ""}
              onChange={(e) => updateDailyItinerary(dayIndex, 'accommodation', e.target.value)}
              className="mt-2"
              placeholder={t('tourEditDialog.accommodationPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.breakfast')}</Label>
              <Input
                value={day.meals?.breakfast || ""}
                onChange={(e) => updateDailyItinerary(dayIndex, 'meals', { ...day.meals, breakfast: e.target.value })}
                className="mt-2"
                placeholder={t('tourEditDialog.breakfastPlaceholder')}
              />
            </div>
            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.lunch')}</Label>
              <Input
                value={day.meals?.lunch || ""}
                onChange={(e) => updateDailyItinerary(dayIndex, 'meals', { ...day.meals, lunch: e.target.value })}
                className="mt-2"
                placeholder={t('tourEditDialog.lunchPlaceholder')}
              />
            </div>
            <div>
              <Label className="text-sm font-medium">{t('tourEditDialog.dinner')}</Label>
              <Input
                value={day.meals?.dinner || ""}
                onChange={(e) => updateDailyItinerary(dayIndex, 'meals', { ...day.meals, dinner: e.target.value })}
                className="mt-2"
                placeholder={t('tourEditDialog.dinnerPlaceholder')}
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-foreground">{t('tourEditDialog.activities')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addActivity(dayIndex)}
                className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
              >
                <Plus className="h-3 w-3 mr-1" />
                {t('tourEditDialog.addActivity')}
              </Button>
            </div>

            {day.activities?.map((activity: any, activityIndex: number) => (
              <div key={activityIndex} className="bg-white rounded-lg p-4 space-y-3 border border-gray-200">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-gray-600">{t('tourEditDialog.activityLabel').replace('{n}', String(activityIndex + 1))}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeActivity(dayIndex, activityIndex)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 h-6 w-6 p-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs font-medium">{t('tourEditDialog.activityTime')}</Label>
                    <Input
                      value={activity.time || ""}
                      onChange={(e) => updateActivity(dayIndex, activityIndex, 'time', e.target.value)}
                      className="mt-1 h-8 text-sm"
                      placeholder={t('tourEditDialog.activityTimePlaceholder')}
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">{t('tourEditDialog.activityLocation')}</Label>
                    <Input
                      value={activity.location || ""}
                      onChange={(e) => updateActivity(dayIndex, activityIndex, 'location', e.target.value)}
                      className="mt-1 h-8 text-sm"
                      placeholder={t('tourEditDialog.activityLocationPlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-xs font-medium">{t('tourEditDialog.activityTitle')}</Label>
                  <Input
                    value={activity.title || ""}
                    onChange={(e) => updateActivity(dayIndex, activityIndex, 'title', e.target.value)}
                    className="mt-1 h-8 text-sm"
                    placeholder={t('tourEditDialog.activityTitlePlaceholder')}
                  />
                </div>

                <div>
                  <Label className="text-xs font-medium">{t('tourEditDialog.activityDesc')}</Label>
                  <Textarea
                    value={activity.description || ""}
                    onChange={(e) => updateActivity(dayIndex, activityIndex, 'description', e.target.value)}
                    className="mt-1 text-sm"
                    rows={2}
                    placeholder={t('tourEditDialog.activityDescPlaceholder')}
                  />
                </div>

                <div>
                  <Label className="text-xs font-medium">{t('tourEditDialog.transportation')}</Label>
                  <Input
                    value={activity.transportation || ""}
                    onChange={(e) => updateActivity(dayIndex, activityIndex, 'transportation', e.target.value)}
                    className="mt-1 h-8 text-sm"
                    placeholder={t('tourEditDialog.transportationPlaceholder')}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {(!editedData.itineraryDetailed || editedData.itineraryDetailed.length === 0) && (
        <div className="text-center py-12 text-gray-500">
          <p>{t('tourEditDialog.noItinerary')}</p>
          <p className="text-sm mt-2">{t('tourEditDialog.noItineraryHint')}</p>
        </div>
      )}
    </div>
  );
}
