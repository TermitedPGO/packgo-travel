import React, { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  GripVertical,
  Clock,
  MapPin,
  Edit2,
  Save,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EditableImage } from "./EditableImage";
import { useLocale } from "@/contexts/LocaleContext";

interface Activity {
  time?: string;
  title?: string;
  name?: string;
  description?: string;
  location?: string;
}

interface DayData {
  day?: number;
  title?: string;
  location?: string;
  description?: string;
  summary?: string;
  image?: string;
  imageUrl?: string;
  activities?: Activity[];
  accommodation?: string;
  meals?: {
    breakfast?: string;
    lunch?: string;
    dinner?: string;
  };
}

interface EditableDayCardProps {
  day: DayData;
  index: number;
  isEditMode: boolean;
  onUpdate: (updatedDay: DayData) => void;
  tourId?: number;
  themeColor: {
    primary: string;
    secondary: string;
    gradient: string;
    light: string;
  };
}

export function EditableDayCard({
  day,
  index,
  isEditMode,
  onUpdate,
  tourId,
  themeColor,
}: EditableDayCardProps) {
  const { t } = useLocale();
  const [isExpanded, setIsExpanded] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [tempValue, setTempValue] = useState("");

  const isEven = index % 2 === 0;
  const dayImage = day.image || day.imageUrl || `https://images.unsplash.com/photo-${1500000000000 + index * 1000}?w=800`;

  // 開始編輯欄位
  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setTempValue(value);
  };

  // 儲存欄位
  const saveField = (field: string) => {
    const updatedDay = { ...day };
    if (field === "title") {
      updatedDay.title = tempValue;
    } else if (field === "description") {
      updatedDay.description = tempValue;
    } else if (field === "accommodation") {
      updatedDay.accommodation = tempValue;
    }
    onUpdate(updatedDay);
    setEditingField(null);
    setTempValue("");
  };

  // 取消編輯
  const cancelEdit = () => {
    setEditingField(null);
    setTempValue("");
  };

  // 更新活動
  const updateActivity = (actIndex: number, field: keyof Activity, value: string) => {
    const updatedActivities = [...(day.activities || [])];
    updatedActivities[actIndex] = {
      ...updatedActivities[actIndex],
      [field]: value,
    };
    onUpdate({ ...day, activities: updatedActivities });
  };

  // 新增活動
  const addActivity = () => {
    const newActivity: Activity = {
      time: "",
      title: t('tourDetail.newActivityTitle'),
      description: "",
      location: "",
    };
    onUpdate({
      ...day,
      activities: [...(day.activities || []), newActivity],
    });
  };

  // 刪除活動
  const removeActivity = (actIndex: number) => {
    const updatedActivities = (day.activities || []).filter((_, i) => i !== actIndex);
    onUpdate({ ...day, activities: updatedActivities });
  };

  // 更新圖片
  const updateImage = (newSrc: string) => {
    onUpdate({ ...day, image: newSrc, imageUrl: newSrc });
  };

  // 渲染可編輯文字（與 EditableText 一致的虛線框風格）
  const renderEditableText = (
    field: string,
    value: string,
    placeholder: string,
    className: string,
    as: "h3" | "p" | "span" = "span"
  ) => {
    if (!isEditMode) {
      const Tag = as;
      return <Tag className={className}>{value || placeholder}</Tag>;
    }

    if (editingField === field) {
      return (
        <div className="flex items-start gap-2 rounded-lg p-2 border-2 border-blue-500 bg-blue-50 shadow-md">
          {as === "p" ? (
            <Textarea
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              className="flex-1 min-h-[80px] bg-transparent border-none outline-none text-gray-900"
              autoFocus
            />
          ) : (
            <Input
              value={tempValue}
              onChange={(e) => setTempValue(e.target.value)}
              className="flex-1 bg-transparent border-none outline-none text-gray-900"
              autoFocus
            />
          )}
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" className="h-8 w-8 p-0 bg-green-600 hover:bg-green-700" onClick={() => saveField(field)}>
              <Save className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="h-8 w-8 p-0" onClick={cancelEdit}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      );
    }

    const Tag = as;
    return (
      <Tag
        className={cn(
          className,
          "cursor-pointer relative group transition-all duration-150",
          "outline outline-1 outline-dashed outline-blue-300/70 rounded-sm hover:outline-blue-500 hover:outline-2",
          "hover:bg-blue-50/80 px-1 py-0.5"
        )}
        onClick={() => startEdit(field, value || "")}
        title={t('common.clickToEdit')}
      >
        {value || <span className="text-gray-400 italic">{placeholder}</span>}
        <span className="absolute -top-7 left-0 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
          <Edit2 className="inline h-3 w-3 mr-1" />
          {t('common.clickToEdit')}
        </span>
      </Tag>
    );
  };

  return (
    <div className="relative animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
      {/* Day Badge */}
      <div 
        className="absolute left-1/2 -translate-x-1/2 -top-5 z-10 px-6 py-2 text-white text-sm font-bold tracking-wider"
        style={{ backgroundColor: themeColor.secondary }}
      >
        DAY {day.day || index + 1}
      </div>
      
      {/* Content Container */}
      <div className={`flex flex-col ${isEven ? 'md:flex-row' : 'md:flex-row-reverse'} gap-0 bg-white`}>
        {/* Image Side */}
        <div className="md:w-1/2 aspect-[4/3] md:aspect-auto overflow-hidden rounded-xl">
          {isEditMode ? (
            <EditableImage
              src={dayImage}
              alt={day.title || `Day ${index + 1}`}
              onSave={updateImage}
              isEditing={isEditMode}
              className="w-full h-full"
              aspectRatio="auto"
              tourId={tourId}
              imagePath={`day-${index + 1}`}
            />
          ) : (
            <img 
              src={dayImage}
              alt={day.title || `Day ${index + 1}`}
              className="w-full h-full object-cover transition-transform duration-700 hover:scale-105 rounded-xl"
            />
          )}
        </div>
        
        {/* Content Side */}
        <div className="md:w-1/2 p-8 md:p-12 flex flex-col justify-center">
          {/* Title */}
          {renderEditableText(
            "title",
            day.title || day.location || t('tourDetail.day', { day: index + 1 }),
            t('tourDetail.editTitlePlaceholder'),
            "text-2xl md:text-3xl font-bold mb-4",
            "h3"
          )}

          {/* Description */}
          {renderEditableText(
            "description",
            day.description || day.summary || "",
            t('tourDetail.editDescPlaceholder'),
            "text-gray-600 leading-relaxed mb-6",
            "p"
          )}
          
          {/* Activities */}
          {(day.activities && day.activities.length > 0) || isEditMode ? (
            <div className="space-y-3 mb-6">
              {(day.activities || []).slice(0, isExpanded ? undefined : 3).map((activity, actIndex) => (
                <div key={actIndex} className="flex items-start gap-3 group">
                  <div 
                    className="w-2 h-2 rounded-lg mt-2 flex-shrink-0"
                    style={{ backgroundColor: themeColor.secondary }}
                  />
                  <div className="flex-1">
                    {isEditMode ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={activity.time || ""}
                            onChange={(e) => updateActivity(actIndex, "time", e.target.value)}
                            placeholder={t('tourDetail.activityTimePlaceholder')}
                            className="w-24 h-8 text-sm"
                          />
                          <Input
                            value={activity.title || ""}
                            onChange={(e) => updateActivity(actIndex, "title", e.target.value)}
                            placeholder={t('tourDetail.activityTitlePlaceholder')}
                            className="flex-1 h-8"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-red-500 opacity-0 group-hover:opacity-100"
                            onClick={() => {
                              const activityName = activity.title || activity.name || t('tourDetail.defaultActivityName');
                              if (confirm(t('tourDetail.confirmDeleteActivity', { title: activityName }))) {
                                removeActivity(actIndex);
                              }
                            }}
                            title={t('tourDetail.deleteActivity')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {isExpanded && (
                          <Textarea
                            value={activity.description || ""}
                            onChange={(e) => updateActivity(actIndex, "description", e.target.value)}
                            placeholder={t('tourDetail.activityDescPlaceholder')}
                            className="text-sm min-h-[60px]"
                          />
                        )}
                      </div>
                    ) : (
                      <>
                        <span className="font-medium">
                          {activity.time && <span className="text-gray-500 mr-2">{activity.time}</span>}
                          {activity.title || activity.name}
                        </span>
                        {activity.description && isExpanded && (
                          <p className="text-sm text-gray-500 mt-1">{activity.description}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              
              {/* Add Activity Button */}
              {isEditMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addActivity}
                  className="mt-2"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('tourDetail.addActivity')}
                </Button>
              )}
            </div>
          ) : null}
          
          {/* Expand Button - 每一日都顯示 */}
          {day.activities && day.activities.length > 0 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-2 text-sm font-bold transition-colors text-gray-900 hover:text-black"
            >
              {isExpanded ? (
                <>{t('tourDetail.collapse')} <ChevronUp className="h-4 w-4" /></>
              ) : (
                <>{t('tourDetail.readMore')} <ChevronDown className="h-4 w-4" /></>
              )}
            </button>
          )}
          
          {/* Accommodation */}
          {(day.accommodation || isEditMode) && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span className="font-medium">{t('tourDetail.todayHotel')}</span>
                {isEditMode ? (
                  <Input
                    value={day.accommodation || ""}
                    onChange={(e) => onUpdate({ ...day, accommodation: e.target.value })}
                    placeholder={t('tourDetail.accommodationPlaceholder')}
                    className="flex-1 h-8"
                  />
                ) : (
                  <span>{day.accommodation}</span>
                )}
              </div>
            </div>
          )}

          {/* Meals */}
          {(day.meals || isEditMode) && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="text-sm text-gray-600 space-y-2">
                <span className="font-medium block mb-2">{t('tourDetail.todayMeals')}</span>
                {isEditMode ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="w-12 text-gray-500">{t('tourDetail.breakfast')}</span>
                      <Input
                        value={day.meals?.breakfast || ""}
                        onChange={(e) => onUpdate({
                          ...day,
                          meals: { ...day.meals, breakfast: e.target.value }
                        })}
                        placeholder={t('tourDetail.breakfastPlaceholder')}
                        className="flex-1 h-8"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-12 text-gray-500">{t('tourDetail.lunch')}</span>
                      <Input
                        value={day.meals?.lunch || ""}
                        onChange={(e) => onUpdate({
                          ...day,
                          meals: { ...day.meals, lunch: e.target.value }
                        })}
                        placeholder={t('tourDetail.lunchPlaceholder')}
                        className="flex-1 h-8"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-12 text-gray-500">{t('tourDetail.dinner')}</span>
                      <Input
                        value={day.meals?.dinner || ""}
                        onChange={(e) => onUpdate({
                          ...day,
                          meals: { ...day.meals, dinner: e.target.value }
                        })}
                        placeholder={t('tourDetail.dinnerPlaceholder')}
                        className="flex-1 h-8"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-4">
                    {day.meals?.breakfast && (
                      <span>{t('tourDetail.breakfast')}: {day.meals.breakfast}</span>
                    )}
                    {day.meals?.lunch && (
                      <span>{t('tourDetail.lunch')}: {day.meals.lunch}</span>
                    )}
                    {day.meals?.dinner && (
                      <span>{t('tourDetail.dinner')}: {day.meals.dinner}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default EditableDayCard;
