import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Edit, Loader2, Plus, Trash2, GripVertical, Plane, Train, Ship, Bus, Car, Upload, Image, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocale } from "@/contexts/LocaleContext";
import { toast } from "sonner";

interface TourEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tourData: any;
  onSave: (editedData: any) => void;
  isSaving: boolean;
}

export function TourEditDialog({
  open,
  onOpenChange,
  tourData,
  onSave,
  isSaving,
}: TourEditDialogProps) {
  const { t } = useLocale();
  const [editedData, setEditedData] = useState<any>(null);
  const [uploadingImages, setUploadingImages] = useState<Record<number, boolean>>({});
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 上傳圖片到 S3
  const uploadImageFile = useCallback(async (file: File, index?: number): Promise<string | null> => {
    if (!file.type.startsWith('image/')) {
      toast.error('只支援圖片格式（JPG、PNG、WebP）');
      return null;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('圖片大小不能超過 10MB');
      return null;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        try {
          const response = await fetch('/api/upload/tour-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, path: 'gallery' }),
          });
          if (!response.ok) throw new Error('Upload failed');
          const { url } = await response.json();
          resolve(url);
        } catch (err) {
          toast.error('圖片上傳失敗，請重試');
          resolve(null);
        }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // 處理拖曳上傳多張圖片
  const handleDropImages = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    toast.info(`正在上傳 ${imageFiles.length} 張圖片...`);
    const newImages = [...(editedData?.images || [])];
    const startIndex = newImages.length;
    // 先加入佔位符
    imageFiles.forEach(() => newImages.push({ url: '', alt: '', caption: '' }));
    setEditedData((prev: any) => ({ ...prev, images: newImages }));
    // 並行上傳
    const uploadPromises = imageFiles.map(async (file, i) => {
      const idx = startIndex + i;
      setUploadingImages(prev => ({ ...prev, [idx]: true }));
      const url = await uploadImageFile(file, idx);
      setUploadingImages(prev => ({ ...prev, [idx]: false }));
      return { idx, url };
    });
    const results = await Promise.all(uploadPromises);
    setEditedData((prev: any) => {
      const updated = [...(prev?.images || [])];
      results.forEach(({ idx, url }) => {
        if (url) updated[idx] = { ...updated[idx], url };
        else updated.splice(idx, 1);
      });
      return { ...prev, images: updated.filter((img: any) => img.url !== '' || updated.indexOf(img) < startIndex) };
    });
    toast.success(`${results.filter(r => r.url).length} 張圖片上傳成功`);
  }, [editedData?.images, uploadImageFile]);

  // 當 tourData 變化時，更新 editedData
  useEffect(() => {
    if (tourData) {
      // 解析 JSON 欄位
      const parsed = { ...tourData };
      
      // 解析 itineraryDetailed
      if (typeof parsed.itineraryDetailed === 'string') {
        try {
          parsed.itineraryDetailed = JSON.parse(parsed.itineraryDetailed);
        } catch {
          parsed.itineraryDetailed = [];
        }
      }
      if (!Array.isArray(parsed.itineraryDetailed)) {
        parsed.itineraryDetailed = [];
      }
      
      // 解析 costExplanation
      if (typeof parsed.costExplanation === 'string') {
        try {
          parsed.costExplanation = JSON.parse(parsed.costExplanation);
        } catch {
          parsed.costExplanation = { included: [], excluded: [], additionalCosts: [], notes: "" };
        }
      }
      if (!parsed.costExplanation || typeof parsed.costExplanation !== 'object') {
        parsed.costExplanation = { included: [], excluded: [], additionalCosts: [], notes: "" };
      }
      
      // 解析 noticeDetailed
      if (typeof parsed.noticeDetailed === 'string') {
        try {
          parsed.noticeDetailed = JSON.parse(parsed.noticeDetailed);
        } catch {
          parsed.noticeDetailed = { preparation: [], culturalNotes: [], healthSafety: [], emergency: [] };
        }
      }
      if (!parsed.noticeDetailed || typeof parsed.noticeDetailed !== 'object') {
        parsed.noticeDetailed = { preparation: [], culturalNotes: [], healthSafety: [], emergency: [] };
      }
      // 確保所有欄位都是陣列
      const ensureArray = (val: any) => {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        if (typeof val === 'string') return [val];
        return [];
      };
      parsed.noticeDetailed = {
        preparation: ensureArray(parsed.noticeDetailed.preparation),
        culturalNotes: ensureArray(parsed.noticeDetailed.culturalNotes),
        healthSafety: ensureArray(parsed.noticeDetailed.healthSafety),
        emergency: ensureArray(parsed.noticeDetailed.emergency),
      };
      
      // 解析 flights (交通資訊)
      if (typeof parsed.flights === 'string') {
        try {
          parsed.flights = JSON.parse(parsed.flights);
        } catch {
          parsed.flights = { type: 'FLIGHT', typeName: '' };
        }
      }
      if (!parsed.flights || typeof parsed.flights !== 'object') {
        parsed.flights = { type: 'FLIGHT', typeName: '' };
      }
      // 修復：根據 typeName 推斷正確的 type（解決 AI 生成時 type/typeName 不一致的問題）
      const flightTypeNameLower = (parsed.flights.typeName || '').toLowerCase();
      if (
        flightTypeNameLower.includes('飛機') ||
        flightTypeNameLower.includes('flight') ||
        flightTypeNameLower.includes('airline') ||
        flightTypeNameLower.includes('air')
      ) {
        parsed.flights.type = 'FLIGHT';
      } else if (
        flightTypeNameLower.includes('郵輪') ||
        flightTypeNameLower.includes('cruise') ||
        flightTypeNameLower.includes('ship')
      ) {
        parsed.flights.type = 'CRUISE';
      } else if (
        flightTypeNameLower.includes('巴士') ||
        flightTypeNameLower.includes('bus') ||
        flightTypeNameLower.includes('客車')
      ) {
        parsed.flights.type = 'BUS';
      } else if (
        flightTypeNameLower.includes('自駕') ||
        flightTypeNameLower.includes('租車') ||
        flightTypeNameLower.includes('car') ||
        flightTypeNameLower.includes('drive')
      ) {
        parsed.flights.type = 'CAR';
      }
      // 如果 type 不是已知類型，保持原有值（防止覆蓋正確設定）
      
      // 解析 images (照片陣列)
      if (typeof parsed.images === 'string') {
        try {
          parsed.images = JSON.parse(parsed.images);
        } catch {
          parsed.images = [];
        }
      }
      if (!Array.isArray(parsed.images)) {
        parsed.images = [];
      }
      
      setEditedData(parsed);
    }
  }, [tourData]);

  if (!editedData) return null;

  const handleSave = () => {
    // 將 JSON 欄位轉換為字串
    const dataToSave = {
      ...editedData,
      itineraryDetailed: JSON.stringify(editedData.itineraryDetailed || []),
      costExplanation: JSON.stringify(editedData.costExplanation || {}),
      noticeDetailed: JSON.stringify(editedData.noticeDetailed || {}),
      flights: JSON.stringify(editedData.flights || {}),
      images: JSON.stringify(editedData.images || []),
    };
    onSave(dataToSave);
  };

  // 每日行程操作
  const addDailyItinerary = () => {
    const newDay = {
      day: (editedData.itineraryDetailed?.length || 0) + 1,
      title: "",
      activities: [],
      meals: { breakfast: "", lunch: "", dinner: "" },
      accommodation: "",
    };
    setEditedData({
      ...editedData,
      itineraryDetailed: [...(editedData.itineraryDetailed || []), newDay],
    });
  };

  const removeDailyItinerary = (index: number) => {
    const updated = [...(editedData.itineraryDetailed || [])];
    updated.splice(index, 1);
    // 重新編號
    updated.forEach((item, idx) => {
      item.day = idx + 1;
    });
    setEditedData({ ...editedData, itineraryDetailed: updated });
  };

  const updateDailyItinerary = (index: number, field: string, value: any) => {
    const updated = [...(editedData.itineraryDetailed || [])];
    updated[index] = { ...updated[index], [field]: value };
    setEditedData({ ...editedData, itineraryDetailed: updated });
  };

  // 活動操作
  const addActivity = (dayIndex: number) => {
    const updated = [...(editedData.itineraryDetailed || [])];
    if (!updated[dayIndex].activities) {
      updated[dayIndex].activities = [];
    }
    updated[dayIndex].activities.push({
      time: "",
      title: "",
      description: "",
      transportation: "",
      location: "",
    });
    setEditedData({ ...editedData, itineraryDetailed: updated });
  };

  const removeActivity = (dayIndex: number, activityIndex: number) => {
    const updated = [...(editedData.itineraryDetailed || [])];
    updated[dayIndex].activities.splice(activityIndex, 1);
    setEditedData({ ...editedData, itineraryDetailed: updated });
  };

  const updateActivity = (dayIndex: number, activityIndex: number, field: string, value: string) => {
    const updated = [...(editedData.itineraryDetailed || [])];
    updated[dayIndex].activities[activityIndex] = {
      ...updated[dayIndex].activities[activityIndex],
      [field]: value,
    };
    setEditedData({ ...editedData, itineraryDetailed: updated });
  };

  // 費用項目操作
  const addCostItem = (type: 'included' | 'excluded' | 'additionalCosts') => {
    const updated = { ...editedData.costExplanation };
    if (!updated[type]) {
      updated[type] = [];
    }
    updated[type].push("");
    setEditedData({ ...editedData, costExplanation: updated });
  };

  const removeCostItem = (type: 'included' | 'excluded' | 'additionalCosts', index: number) => {
    const updated = { ...editedData.costExplanation };
    updated[type].splice(index, 1);
    setEditedData({ ...editedData, costExplanation: updated });
  };

  const updateCostItem = (type: 'included' | 'excluded' | 'additionalCosts', index: number, value: string) => {
    const updated = { ...editedData.costExplanation };
    updated[type][index] = value;
    setEditedData({ ...editedData, costExplanation: updated });
  };

  // 注意事項操作
  const addNoticeItem = (type: 'preparation' | 'culturalNotes' | 'healthSafety' | 'emergency') => {
    const updated = { ...editedData.noticeDetailed };
    if (!updated[type]) {
      updated[type] = [];
    }
    updated[type].push("");
    setEditedData({ ...editedData, noticeDetailed: updated });
  };

  const removeNoticeItem = (type: 'preparation' | 'culturalNotes' | 'healthSafety' | 'emergency', index: number) => {
    const updated = { ...editedData.noticeDetailed };
    updated[type].splice(index, 1);
    setEditedData({ ...editedData, noticeDetailed: updated });
  };

  const updateNoticeItem = (type: 'preparation' | 'culturalNotes' | 'healthSafety' | 'emergency', index: number, value: string) => {
    const updated = { ...editedData.noticeDetailed };
    updated[type][index] = value;
    setEditedData({ ...editedData, noticeDetailed: updated });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden rounded-lg flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5 text-purple-600" />
            {t('tourEditDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('tourEditDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="basic">{t('tourEditDialog.tabBasic')}</TabsTrigger>
            <TabsTrigger value="itinerary">{t('tourEditDialog.tabItinerary')}</TabsTrigger>
            <TabsTrigger value="cost">{t('tourEditDialog.tabCost')}</TabsTrigger>
            <TabsTrigger value="notice">{t('tourEditDialog.tabNotice')}</TabsTrigger>
            <TabsTrigger value="transport">{t('tourEditDialog.tabTransport')}</TabsTrigger>
            <TabsTrigger value="photos">{t('tourEditDialog.tabPhotos')}</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto py-4">
            {/* 基本資訊 Tab */}
            <TabsContent value="basic" className="mt-0 space-y-6">
              <div className="bg-purple-50 rounded-lg p-6 space-y-4">
                <h3 className="font-semibold text-purple-900 mb-4">{t('tourEditDialog.basicInfo')}</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label htmlFor="title" className="text-sm font-medium">
                      {t('tourEditDialog.tourTitle')} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="title"
                      value={editedData.title || ""}
                      onChange={(e) => setEditedData({ ...editedData, title: e.target.value })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="productCode" className="text-sm font-medium">
                      {t('tourEditDialog.productCode')}
                    </Label>
                    <Input
                      id="productCode"
                      value={editedData.productCode || ""}
                      onChange={(e) => setEditedData({ ...editedData, productCode: e.target.value })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="promotionText" className="text-sm font-medium">
                      {t('tourEditDialog.promotionText')}
                    </Label>
                    <Input
                      id="promotionText"
                      value={editedData.promotionText || ""}
                      onChange={(e) => setEditedData({ ...editedData, promotionText: e.target.value })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="duration" className="text-sm font-medium">
                      {t('tourEditDialog.duration')} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="duration"
                      type="number"
                      min="1"
                      value={editedData.duration ?? 1}
                      onChange={(e) => setEditedData({ ...editedData, duration: parseInt(e.target.value) || 1 })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="price" className="text-sm font-medium">
                      {t('tourEditDialog.price')} <span className="text-red-500">*</span>
                    </Label>
                    <div className="flex gap-2 mt-2">
                      <Input
                        id="price"
                        type="number"
                        min="0"
                        value={editedData.price ?? 0}
                        onChange={(e) => setEditedData({ ...editedData, price: parseInt(e.target.value) || 0 })}
                        className="flex-1 min-w-[140px]"
                      />
                      <Select
                        value={editedData.priceCurrency || 'TWD'}
                        onValueChange={(value) => setEditedData({ ...editedData, priceCurrency: value })}
                      >
                        <SelectTrigger className="w-[100px]">
                          {t('tourEditDialog.currency')}
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TWD">NT$ TWD</SelectItem>
                          <SelectItem value="USD">$ USD</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="col-span-2">
                    <Label htmlFor="description" className="text-sm font-medium">
                      {t('tourEditDialog.description')}
                    </Label>
                    <Textarea
                      id="description"
                      value={editedData.description || ""}
                      onChange={(e) => setEditedData({ ...editedData, description: e.target.value })}
                      rows={4}
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-blue-50 rounded-lg p-6 space-y-4">
                <h3 className="font-semibold text-blue-900 mb-4">{t('tourEditDialog.locationInfo')}</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="departureCity" className="text-sm font-medium">
                      {t('tourEditDialog.departureCity')}
                    </Label>
                    <Input
                      id="departureCity"
                      value={editedData.departureCity || ""}
                      onChange={(e) => setEditedData({ ...editedData, departureCity: e.target.value })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="departureAirportName" className="text-sm font-medium">
                      {t('tourEditDialog.departureAirport')}
                    </Label>
                    <Input
                      id="departureAirportName"
                      value={editedData.departureAirportName || ""}
                      onChange={(e) => setEditedData({ ...editedData, departureAirportName: e.target.value })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="destinationCountry" className="text-sm font-medium">
                      {t('tourEditDialog.destinationCountry')}
                    </Label>
                    <Input
                      id="destinationCountry"
                      value={editedData.destinationCountry || ""}
                      onChange={(e) => setEditedData({ ...editedData, destinationCountry: e.target.value })}
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="destinationCity" className="text-sm font-medium">
                      {t('tourEditDialog.destinationCity')}
                    </Label>
                    <Input
                      id="destinationCity"
                      value={editedData.destinationCity || ""}
                      onChange={(e) => setEditedData({ ...editedData, destinationCity: e.target.value })}
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-amber-50 rounded-lg p-6 space-y-4">
                <h3 className="font-semibold text-amber-900 mb-4">{t('tourEditDialog.heroImageSection')}</h3>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="heroImage" className="text-sm font-medium">
                      {t('tourEditDialog.imageUrl')}
                    </Label>
                    <Input
                      id="heroImage"
                      value={editedData.heroImage || ""}
                      onChange={(e) => setEditedData({ ...editedData, heroImage: e.target.value })}
                      className="mt-2"
                      placeholder="https://..."
                    />
                  </div>

                  {editedData.heroImage && (
                    <div className="relative rounded-lg overflow-hidden">
                      <img 
                        src={editedData.heroImage} 
                        alt="Hero Preview" 
                        className="w-full h-48 object-cover rounded-lg"
                      />
                    </div>
                  )}

                  <div>
                    <Label htmlFor="heroSubtitle" className="text-sm font-medium">
                      {t('tourEditDialog.heroSubtitle')}
                    </Label>
                    <Input
                      id="heroSubtitle"
                      value={editedData.heroSubtitle || ""}
                      onChange={(e) => setEditedData({ ...editedData, heroSubtitle: e.target.value })}
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* 每日行程 Tab */}
            <TabsContent value="itinerary" className="mt-0 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">{t('tourEditDialog.dailyItinerary')}</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addDailyItinerary}
                  className="rounded-lg"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('tourEditDialog.addDay')}
                </Button>
              </div>

              {editedData.itineraryDetailed?.map((day: any, dayIndex: number) => (
                <div key={dayIndex} className="bg-green-50 rounded-lg p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-green-900">{t('tourEditDialog.dayLabel').replace('{day}', String(day.day))}</h4>
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
                      <Label className="text-sm font-medium">{t('tourEditDialog.activities')}</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => addActivity(dayIndex)}
                        className="rounded-full"
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        {t('tourEditDialog.addActivity')}
                      </Button>
                    </div>

                    {day.activities?.map((activity: any, activityIndex: number) => (
                      <div key={activityIndex} className="bg-white rounded-lg p-4 space-y-3 border border-green-200">
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
            </TabsContent>

            {/* 費用說明 Tab */}
            <TabsContent value="cost" className="mt-0 space-y-6">
              <div className="bg-orange-50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-orange-900">{t('tourEditDialog.costIncluded')}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addCostItem('included')}
                    className="rounded-full"
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

              <div className="bg-red-50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-red-900">{t('tourEditDialog.costExcluded')}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addCostItem('excluded')}
                    className="rounded-full"
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

              <div className="bg-yellow-50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-yellow-900">{t('tourEditDialog.additionalCosts')}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addCostItem('additionalCosts')}
                    className="rounded-full"
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

              <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                <h3 className="font-semibold text-gray-900">{t('tourEditDialog.notes')}</h3>
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
            </TabsContent>

            {/* 注意事項 Tab */}
            <TabsContent value="notice" className="mt-0 space-y-6">
              <div className="bg-blue-50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-blue-900">{t('tourEditDialog.preparation')}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addNoticeItem('preparation')}
                    className="rounded-full"
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

              <div className="bg-purple-50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-purple-900">{t('tourEditDialog.culturalNotes')}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addNoticeItem('culturalNotes')}
                    className="rounded-full"
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

              <div className="bg-green-50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-green-900">{t('tourEditDialog.healthSafety')}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addNoticeItem('healthSafety')}
                    className="rounded-full"
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

              <div className="bg-red-50 rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-red-900">{t('tourEditDialog.emergency')}</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addNoticeItem('emergency')}
                    className="rounded-full"
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
            </TabsContent>

            {/* 交通資訊 Tab */}
            <TabsContent value="transport" className="mt-0 space-y-6">
              <div className="bg-sky-50 rounded-lg p-6 space-y-6">
                <h3 className="font-semibold text-sky-900 mb-4">{t('tourEditDialog.transportSettings')}</h3>
                
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label className="text-sm font-medium">{t('tourEditDialog.transportType')}</Label>
                    <Select
                      value={editedData.flights?.type || 'FLIGHT'}
                      onValueChange={(value) => setEditedData({
                        ...editedData,
                        flights: { ...editedData.flights, type: value }
                      })}
                    >
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder={t('tourEditDialog.selectTransportType')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FLIGHT">
                          <div className="flex items-center gap-2">
                            <Plane className="h-4 w-4" />
                            {t('tourEditDialog.transportFlight')}
                          </div>
                        </SelectItem>
                        <SelectItem value="TRAIN">
                          <div className="flex items-center gap-2">
                            <Train className="h-4 w-4" />
                            {t('tourEditDialog.transportTrain')}
                          </div>
                        </SelectItem>
                        <SelectItem value="CRUISE">
                          <div className="flex items-center gap-2">
                            <Ship className="h-4 w-4" />
                            {t('tourEditDialog.transportCruise')}
                          </div>
                        </SelectItem>
                        <SelectItem value="BUS">
                          <div className="flex items-center gap-2">
                            <Bus className="h-4 w-4" />
                            {t('tourEditDialog.transportBus')}
                          </div>
                        </SelectItem>
                        <SelectItem value="CAR">
                          <div className="flex items-center gap-2">
                            <Car className="h-4 w-4" />
                            {t('tourEditDialog.transportCar')}
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-sm font-medium">{t('tourEditDialog.transportName')}</Label>
                    <Input
                      value={editedData.flights?.typeName || ''}
                      onChange={(e) => setEditedData({
                        ...editedData,
                        flights: { ...editedData.flights, typeName: e.target.value }
                      })}
                      className="mt-2"
                      placeholder={t('tourEditDialog.transportNamePlaceholder')}
                    />
                  </div>
                </div>

                {/* 火車詳細資訊 */}
                {editedData.flights?.type === 'TRAIN' && (
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-sky-200">
                    <h4 className="font-medium text-sky-800">{t('tourEditDialog.trainDetails')}</h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.trainName')}</Label>
                        <Input
                          value={editedData.flights?.trainName || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, trainName: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.trainNamePlaceholder')}
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.trainType')}</Label>
                        <Input
                          value={editedData.flights?.trainType || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, trainType: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.trainTypePlaceholder')}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium">{t('tourEditDialog.trainDesc')}</Label>
                      <Textarea
                        value={editedData.flights?.description || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, description: e.target.value }
                        })}
                        className="mt-2"
                        rows={3}
                        placeholder={t('tourEditDialog.trainDescPlaceholder')}
                      />
                    </div>

                    <div>
                      <Label className="text-sm font-medium">{t('tourEditDialog.trainFeatures')}</Label>
                      <Textarea
                        value={editedData.flights?.features?.join('\n') || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, features: e.target.value.split('\n').filter((f: string) => f.trim()) }
                        })}
                        className="mt-2"
                        rows={4}
                        placeholder={t('tourEditDialog.trainFeaturesPlaceholder')}
                      />
                    </div>

                    <div>
                      <Label className="text-sm font-medium">{t('tourEditDialog.trainRoute')}</Label>
                      <Textarea
                        value={editedData.flights?.route?.join('\n') || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, route: e.target.value.split('\n').filter((r: string) => r.trim()) }
                        })}
                        className="mt-2"
                        rows={4}
                        placeholder={t('tourEditDialog.trainRoutePlaceholder')}
                      />
                    </div>
                  </div>
                )}

                {/* 郵輪詳細資訊 */}
                {editedData.flights?.type === 'CRUISE' && (
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-sky-200">
                    <h4 className="font-medium text-sky-800">{t('tourEditDialog.cruiseDetails')}</h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.shipName')}</Label>
                        <Input
                          value={editedData.flights?.shipName || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, shipName: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.shipNamePlaceholder')}
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.cruiseRoute')}</Label>
                        <Input
                          value={editedData.flights?.cruiseRoute || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, cruiseRoute: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.cruiseRoutePlaceholder')}
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm font-medium">{t('tourEditDialog.cruiseDesc')}</Label>
                      <Textarea
                        value={editedData.flights?.description || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, description: e.target.value }
                        })}
                        className="mt-2"
                        rows={3}
                        placeholder={t('tourEditDialog.cruiseDescPlaceholder')}
                      />
                    </div>

                    <div>
                      <Label className="text-sm font-medium">{t('tourEditDialog.cruiseFacilities')}</Label>
                      <Textarea
                        value={editedData.flights?.features?.join('\n') || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, features: e.target.value.split('\n').filter((f: string) => f.trim()) }
                        })}
                        className="mt-2"
                        rows={4}
                        placeholder={t('tourEditDialog.cruiseFacilitiesPlaceholder')}
                      />
                    </div>
                  </div>
                )}

                {/* 飛機詳細資訊 */}
                {editedData.flights?.type === 'FLIGHT' && (
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-sky-200">
                    <h4 className="font-medium text-sky-800">{t('tourEditDialog.flightDetails')}</h4>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.airline')}</Label>
                        <Input
                          value={editedData.flights?.airline || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, airline: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.airlinePlaceholder')}
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.flightNumber')}</Label>
                        <Input
                          value={editedData.flights?.flightNumber || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, flightNumber: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.flightNumberPlaceholder')}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.outboundDeparture')}</Label>
                        <Input
                          value={editedData.flights?.outbound?.departureTime || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { 
                              ...editedData.flights, 
                              outbound: { ...editedData.flights?.outbound, departureTime: e.target.value }
                            }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.outboundDeparturePlaceholder')}
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.outboundArrival')}</Label>
                        <Input
                          value={editedData.flights?.outbound?.arrivalTime || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { 
                              ...editedData.flights, 
                              outbound: { ...editedData.flights?.outbound, arrivalTime: e.target.value }
                            }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.outboundArrivalPlaceholder')}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.inboundDeparture')}</Label>
                        <Input
                          value={editedData.flights?.inbound?.departureTime || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { 
                              ...editedData.flights, 
                              inbound: { ...editedData.flights?.inbound, departureTime: e.target.value }
                            }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.inboundDeparturePlaceholder')}
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.inboundArrival')}</Label>
                        <Input
                          value={editedData.flights?.inbound?.arrivalTime || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { 
                              ...editedData.flights, 
                              inbound: { ...editedData.flights?.inbound, arrivalTime: e.target.value }
                            }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.inboundArrivalPlaceholder')}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 巴士詳細資訊 */}
                {editedData.flights?.type === 'BUS' && (
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-sky-200">
                    <h4 className="font-medium text-sky-800">巴士詳細資訊</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">巴士公司</Label>
                        <Input
                          value={editedData.flights?.busCompany || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, busCompany: e.target.value }
                          })}
                          className="mt-2"
                          placeholder="例：山峰巴士"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">路線說明</Label>
                        <Input
                          value={editedData.flights?.busRoute || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, busRoute: e.target.value }
                          })}
                          className="mt-2"
                          placeholder="例：台北 → 花蓮"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">巴士說明</Label>
                      <Textarea
                        value={editedData.flights?.description || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, description: e.target.value }
                        })}
                        className="mt-2"
                        rows={3}
                        placeholder="巴士相關說明或注意事項"
                      />
                    </div>
                  </div>
                )}

                {/* 自駕/租車詳細資訊 */}
                {editedData.flights?.type === 'CAR' && (
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-sky-200">
                    <h4 className="font-medium text-sky-800">自駕/租車詳細資訊</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">車輛類型</Label>
                        <Input
                          value={editedData.flights?.carType || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, carType: e.target.value }
                          })}
                          className="mt-2"
                          placeholder="例： SUV / 轎車 / 小客車"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">租車公司</Label>
                        <Input
                          value={editedData.flights?.carCompany || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, carCompany: e.target.value }
                          })}
                          className="mt-2"
                          placeholder="例： Hertz / 區域租車"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">說明與注意事項</Label>
                      <Textarea
                        value={editedData.flights?.description || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, description: e.target.value }
                        })}
                        className="mt-2"
                        rows={3}
                        placeholder="自駕或租車相關說明"
                      />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* 照片管理 Tab */}
            <TabsContent value="photos" className="mt-0 space-y-6">
              <div className="bg-white border border-gray-200 p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{t('tourEditDialog.tourPhotos')}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">支援拖曳上傳、點擊選擇或輸入圖片 URL（JPG/PNG/WebP，最大 10MB）</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      上傳圖片
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const newImage = { url: '', alt: '', caption: '' };
                        setEditedData({
                          ...editedData,
                          images: [...(editedData.images || []), newImage]
                        });
                      }}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      {t('tourEditDialog.addPhoto')}
                    </Button>
                  </div>
                </div>

                {/* 隱藏的 file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      await handleDropImages(e.target.files);
                      e.target.value = '';
                    }
                  }}
                />

                {/* 拖曳上傳區域 */}
                <div
                  className={`border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
                    isDraggingOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                  }`}
                  onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                  onDragLeave={() => setIsDraggingOver(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setIsDraggingOver(false);
                    if (e.dataTransfer.files.length > 0) {
                      await handleDropImages(e.dataTransfer.files);
                    }
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                  <p className="text-sm font-medium text-gray-600">拖曳圖片到此處，或點擊選擇檔案</p>
                  <p className="text-xs text-gray-400 mt-1">支援批量上傳，每張最大 10MB</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {editedData.images?.map((image: any, index: number) => (
                    <div key={index} className="bg-gray-50 p-4 space-y-3 border border-gray-200">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-gray-700">{t('tourEditDialog.photoLabel').replace('{n}', String(index + 1))}</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const updated = [...editedData.images];
                            updated.splice(index, 1);
                            setEditedData({ ...editedData, images: updated });
                          }}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 h-6 w-6 p-0"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>

                      {/* 圖片預覽或上傳中狀態 */}
                      {uploadingImages[index] ? (
                        <div className="w-full h-32 bg-gray-100 flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-gray-500">上傳中...</span>
                        </div>
                      ) : image.url ? (
                        <div className="relative overflow-hidden rounded-lg group">
                          <img 
                            src={image.url} 
                            alt={image.alt || t('tourEditDialog.tourPhotoAlt')} 
                            className="w-full h-32 object-cover rounded-lg"
                          />
                          {/* 替換圖片按鈕 */}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <label className="cursor-pointer bg-white text-gray-800 text-xs px-3 py-1.5 font-medium hover:bg-gray-100">
                              <Upload className="h-3 w-3 inline mr-1" />
                              替換圖片
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  if (e.target.files?.[0]) {
                                    setUploadingImages(prev => ({ ...prev, [index]: true }));
                                    const url = await uploadImageFile(e.target.files![0], index);
                                    setUploadingImages(prev => ({ ...prev, [index]: false }));
                                    if (url) {
                                      const updated = [...editedData.images];
                                      updated[index] = { ...updated[index], url };
                                      setEditedData({ ...editedData, images: updated });
                                    }
                                    e.target.value = '';
                                  }
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      ) : (
                        <label className="w-full h-32 bg-white border border-dashed border-gray-300 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50">
                          <Upload className="h-6 w-6 text-gray-400 mb-1" />
                          <span className="text-xs text-gray-500">點擊上傳圖片</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              if (e.target.files?.[0]) {
                                setUploadingImages(prev => ({ ...prev, [index]: true }));
                                const url = await uploadImageFile(e.target.files![0], index);
                                setUploadingImages(prev => ({ ...prev, [index]: false }));
                                if (url) {
                                  const updated = [...editedData.images];
                                  updated[index] = { ...updated[index], url };
                                  setEditedData({ ...editedData, images: updated });
                                }
                                e.target.value = '';
                              }
                            }}
                          />
                        </label>
                      )}

                      <div>
                        <Label className="text-xs font-medium text-gray-600">圖片 URL（或上傳後自動填入）</Label>
                        <Input
                          value={image.url || ''}
                          onChange={(e) => {
                            const updated = [...editedData.images];
                            updated[index] = { ...updated[index], url: e.target.value };
                            setEditedData({ ...editedData, images: updated });
                          }}
                          className="mt-1 h-8 text-sm"
                          placeholder="https://..."
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600">{t('tourEditDialog.photoAlt')}</Label>
                        <Input
                          value={image.alt || ''}
                          onChange={(e) => {
                            const updated = [...editedData.images];
                            updated[index] = { ...updated[index], alt: e.target.value };
                            setEditedData({ ...editedData, images: updated });
                          }}
                          className="mt-1 h-8 text-sm"
                          placeholder={t('tourEditDialog.photoAltPlaceholder')}
                        />
                      </div>

                      <div>
                        <Label className="text-xs font-medium text-gray-600">{t('tourEditDialog.photoCaption')}</Label>
                        <Input
                          value={image.caption || ''}
                          onChange={(e) => {
                            const updated = [...editedData.images];
                            updated[index] = { ...updated[index], caption: e.target.value };
                            setEditedData({ ...editedData, images: updated });
                          }}
                          className="mt-1 h-8 text-sm"
                          placeholder={t('tourEditDialog.photoCaptionPlaceholder')}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {(!editedData.images || editedData.images.length === 0) && (
                  <div className="text-center py-8 text-gray-400">
                    <Image className="h-10 w-10 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm">{t('tourEditDialog.noPhotos')}</p>
                    <p className="text-xs mt-1">{t('tourEditDialog.noPhotosHint')}</p>
                  </div>
                )}
              </div>

              {/* Hero 圖片設定 */}
              <div className="bg-amber-50 rounded-lg p-6 space-y-4">
                <h3 className="font-semibold text-amber-900">{t('tourEditDialog.heroImage')}</h3>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="heroImage" className="text-sm font-medium">
                      {t('tourEditDialog.heroImageUrl')}
                    </Label>
                    <Input
                      id="heroImage"
                      value={editedData.heroImage || ''}
                      onChange={(e) => setEditedData({ ...editedData, heroImage: e.target.value })}
                      className="mt-2"
                      placeholder="https://..."
                    />
                  </div>

                  {editedData.heroImage && (
                    <div className="relative rounded-lg overflow-hidden">
                      <img 
                        src={editedData.heroImage} 
                        alt="Hero Preview" 
                        className="w-full h-48 object-cover rounded-lg"
                      />
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="flex gap-2 border-t pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-full"
            disabled={isSaving}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-purple-600 text-white hover:bg-purple-700 rounded-full"
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {t('tourEditDialog.saving')}
              </>
            ) : (
              t('tourEditDialog.confirmSave')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
