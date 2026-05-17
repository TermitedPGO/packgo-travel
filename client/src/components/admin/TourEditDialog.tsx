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

  // v70: track the snapshot of data the dialog was opened with, so we can
  // detect "dirty" state (unsaved edits) and warn before a destructive close.
  // Without this, accidentally clicking outside the dialog wipes minutes/hours
  // of itinerary editing — Jeff has lost real work to this.
  const initialDataRef = useRef<string>("");
  const isDirty = (() => {
    if (!editedData) return false;
    if (!initialDataRef.current) return false;
    try {
      return JSON.stringify(editedData) !== initialDataRef.current;
    } catch {
      return false;
    }
  })();

  const handleDialogOpenChange = useCallback(
    (next: boolean) => {
      // Allow opens through unconditionally
      if (next) {
        onOpenChange(true);
        return;
      }
      // Block close if dirty unless user confirms
      if (isDirty) {
        const confirmed = window.confirm(
          t('tourEditDialog.unsavedChangesWarning') ||
            "您有未儲存的變更，確定要關閉嗎？關閉後將無法復原。"
        );
        if (!confirmed) return;
      }
      onOpenChange(false);
    },
    [isDirty, onOpenChange, t]
  );

  // 上傳圖片到 S3
  const uploadImageFile = useCallback(async (file: File, _index?: number): Promise<string | null> => {
    if (!file.type.startsWith('image/')) {
      toast.error(t('tourEditDialog.toastImageFormatOnly'));
      return null;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('tourEditDialog.toastImageSizeMax'));
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
          toast.error(t('tourEditDialog.toastUploadFailed'));
          resolve(null);
        }
      };
      reader.readAsDataURL(file);
    });
  }, [t]);

  // 處理拖曳上傳多張圖片
  const handleDropImages = useCallback(async (files: FileList) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    toast.info(t('tourEditDialog.toastUploadingN', { n: String(imageFiles.length) }));
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
    toast.success(t('tourEditDialog.toastNUploaded', { n: String(results.filter(r => r.url).length) }));
  }, [editedData?.images, uploadImageFile, t]);

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
      // v70: snapshot baseline AFTER the parse-and-normalize step, so dirty
      // detection compares against the dialog's actual rendered state, not
      // the raw incoming JSON-string form.
      try {
        initialDataRef.current = JSON.stringify(parsed);
      } catch {
        initialDataRef.current = "";
      }
    }
  }, [tourData]);

  // 2026-05-16 React #310 fix: early return was at line 265 (before the
  // Cmd+S useEffect at line ~393), so the first render with editedData=null
  // had N hooks and the second render with editedData loaded had N+1 hooks
  // → "Rendered more hooks than during the previous render" crash when
  // opening 編輯 dialog. Now ALL hooks run unconditionally; the early
  // return moved down to just before the JSX return (~line 405).
  // The helpers below all reference editedData in closures, which is fine —
  // they only execute on user interaction, which can't happen until the
  // dialog renders, which only happens AFTER editedData is non-null.

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
    // v70: after a successful save, reset the dirty baseline so closing
    // immediately afterwards doesn't re-prompt for unsaved changes.
    try { initialDataRef.current = JSON.stringify(editedData); } catch {}
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

  // Round 80.21 — keyboard shortcuts:
  //   Cmd/Ctrl + S → save (only when dirty)
  //   Esc handled by Radix Dialog → routes to handleDialogOpenChange
  //     which already prompts on dirty close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!isSaving && isDirty) handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, isSaving, isDirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render-gate moved here from line 265 — see comment above handleSave.
  if (!editedData) return null;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden rounded-xl shadow-2xl flex flex-col">
        {/* Round 80.21 — richer dialog header:
            - Tour title preview (gold accent) so user knows which tour they're editing
            - Save-status badge (未儲存 / 儲存中 / 全部儲存) — replaces the dead
              second-line "修改 AI 生成的行程資訊..." that duplicated the section
              eyebrow inside the form. Real signal Jeff acts on. */}
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-foreground">
                <Edit className="h-5 w-5 text-[#c9a563]" />
                {t('tourEditDialog.title')}
              </DialogTitle>
              {editedData?.title ? (
                <DialogDescription className="text-foreground/65 mt-1 truncate">
                  <span className="text-[#c9a563] font-medium">·</span>{' '}
                  <span className="font-medium text-foreground/85">
                    {editedData.title}
                  </span>
                </DialogDescription>
              ) : (
                <DialogDescription className="text-foreground/55 mt-1">
                  {t('tourEditDialog.description')}
                </DialogDescription>
              )}
            </div>
            <SaveStatusBadge isDirty={isDirty} isSaving={isSaving} />
          </div>
        </DialogHeader>

        <Tabs defaultValue="basic" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-6 rounded-lg bg-foreground/5 p-1">
            <TabsTrigger value="basic" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabBasic')}</TabsTrigger>
            <TabsTrigger value="itinerary" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabItinerary')}</TabsTrigger>
            <TabsTrigger value="cost" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabCost')}</TabsTrigger>
            <TabsTrigger value="notice" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabNotice')}</TabsTrigger>
            <TabsTrigger value="transport" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabTransport')}</TabsTrigger>
            <TabsTrigger value="photos" className="rounded-lg data-[state=active]:bg-white data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:border-b-2 data-[state=active]:border-[#c9a563] focus-visible:ring-2 focus-visible:ring-foreground/20">{t('tourEditDialog.tabPhotos')}</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto py-4">
            {/* 基本資訊 Tab */}
            <TabsContent value="basic" className="mt-0 space-y-6">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 mb-4 pb-2 border-b border-foreground/5">{t('tourEditDialog.basicInfo')}</h3>
                
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

                  {/* Round 80.21 — productCode now has a clear hint instead of
                      letting user wonder what "26EC10MM02" is. Same for
                      promotionText (placeholder example). */}
                  <div>
                    <Label htmlFor="productCode" className="text-sm font-medium">
                      {t('tourEditDialog.productCode')}
                    </Label>
                    <Input
                      id="productCode"
                      value={editedData.productCode || ""}
                      onChange={(e) => setEditedData({ ...editedData, productCode: e.target.value })}
                      placeholder="例如:LION-26EC10MM02"
                      className="mt-2"
                    />
                    <p className="text-[11px] text-foreground/50 mt-1.5">
                      內部追蹤用,可保留原 OTA 的商品代碼方便對帳
                    </p>
                  </div>

                  <div>
                    <Label htmlFor="promotionText" className="text-sm font-medium">
                      {t('tourEditDialog.promotionText')}
                      <span className="text-foreground/40 font-normal ml-1">(選填)</span>
                    </Label>
                    <Input
                      id="promotionText"
                      value={editedData.promotionText || ""}
                      onChange={(e) => setEditedData({ ...editedData, promotionText: e.target.value })}
                      placeholder="早鳥優惠 / 限時 8 折 / 首發特價"
                      className="mt-2"
                    />
                    <p className="text-[11px] text-foreground/50 mt-1.5">
                      會顯示在行程卡片右上角的金色徽章上
                    </p>
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
                    {/* Auto-show nights hint to reduce mental math */}
                    <p className="text-[11px] text-foreground/50 mt-1.5">
                      {(editedData.duration ?? 0) >= 2
                        ? `共 ${editedData.duration} 天 ${Math.max(0, (editedData.duration ?? 1) - 1)} 晚`
                        : '至少 1 天'}
                    </p>
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
                      {/* Round 80.21: SelectTrigger now uses SelectValue so the
                          currency code is visible (was showing the placeholder
                          string "幣別" indefinitely). Added EUR/JPY/CNY/HKD
                          for multi-region support. */}
                      <Select
                        value={editedData.priceCurrency || 'TWD'}
                        onValueChange={(value) => setEditedData({ ...editedData, priceCurrency: value })}
                      >
                        <SelectTrigger className="w-[110px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="TWD">TWD 台幣</SelectItem>
                          <SelectItem value="USD">USD 美元</SelectItem>
                          <SelectItem value="EUR">EUR 歐元</SelectItem>
                          <SelectItem value="JPY">JPY 日圓</SelectItem>
                          <SelectItem value="CNY">CNY 人民幣</SelectItem>
                          <SelectItem value="HKD">HKD 港幣</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-foreground/50 mt-1.5">
                      每人起價,顯示在行程卡片與詳情頁
                    </p>
                  </div>

                  {/* Row: 手動修正 AI 抽取的人數與日期（修正提取錯誤） */}
                  <div className="col-span-2 grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="maxParticipants" className="text-sm font-medium">
                        {t('tourEditDialog.maxParticipantsLabel')}
                      </Label>
                      <Input
                        id="maxParticipants"
                        type="number"
                        min="0"
                        value={editedData.maxParticipants ?? ''}
                        placeholder={t('tourEditDialog.maxParticipantsPlaceholder')}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditedData({ ...editedData, maxParticipants: v === '' ? null : parseInt(v) || 0 });
                        }}
                        className="mt-2"
                      />
                      <p className="text-[11px] text-foreground/50 mt-1.5">
                        每團上限,留白代表不限制
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="startDate" className="text-sm font-medium">
                        {t('tourEditDialog.startDate')}
                      </Label>
                      <Input
                        id="startDate"
                        type="date"
                        value={editedData.startDate ? new Date(editedData.startDate).toISOString().slice(0, 10) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          // Round 80.21: when user picks a start date and no
                          // end date exists yet, auto-fill end = start + (天數-1).
                          // Saves a manual click 80% of the time. User can
                          // still override the end date afterwards.
                          const newStart = v ? new Date(v) : null;
                          let nextData: any = { ...editedData, startDate: newStart };
                          if (newStart && !editedData.endDate && (editedData.duration ?? 0) >= 1) {
                            const autoEnd = new Date(newStart);
                            autoEnd.setDate(autoEnd.getDate() + (editedData.duration - 1));
                            nextData.endDate = autoEnd;
                          }
                          setEditedData(nextData);
                        }}
                        className="mt-2"
                      />
                      <p className="text-[11px] text-foreground/50 mt-1.5">
                        首發團出發日
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="endDate" className="text-sm font-medium">
                        {t('tourEditDialog.endDate')}
                      </Label>
                      <Input
                        id="endDate"
                        type="date"
                        value={editedData.endDate ? new Date(editedData.endDate).toISOString().slice(0, 10) : ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditedData({ ...editedData, endDate: v ? new Date(v) : null });
                        }}
                        className="mt-2"
                      />
                      <p className="text-[11px] text-foreground/50 mt-1.5">
                        {editedData.startDate && (editedData.duration ?? 0) >= 1
                          ? '可由出發日 + 天數自動算出'
                          : '末團返回日(若有)'}
                      </p>
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
                      placeholder="2-3 句話介紹這個行程的特色與賣點"
                      className="mt-2"
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-[11px] text-foreground/50">
                        會顯示在 Hero 主圖下方,影響搜尋引擎收錄
                      </p>
                      <p className="text-[11px] text-foreground/50 tabular-nums">
                        {(editedData.description || '').length} 字
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 mb-4 pb-2 border-b border-foreground/5">{t('tourEditDialog.locationInfo')}</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Round 80.21 — AI placeholder cleanup:
                      The agents sometimes write 「待確認」 / 「未知」 / 「Unknown」
                      into fields they couldn't extract. The previous form
                      rendered those as actual values (Jeff: 出發機場 顯示
                      「待確認」 like data leak). Now we strip them on display
                      so the input looks empty + shows a real placeholder
                      hint, but we keep the saved value if user types into
                      another field (so we don't accidentally erase real
                      "待確認" the user genuinely wants). */}
                  <div>
                    <Label htmlFor="departureCity" className="text-sm font-medium">
                      {t('tourEditDialog.departureCity')}
                    </Label>
                    <Input
                      id="departureCity"
                      value={isAiPlaceholder(editedData.departureCity) ? '' : (editedData.departureCity || '')}
                      onChange={(e) => setEditedData({ ...editedData, departureCity: e.target.value })}
                      placeholder="例如:台北 / TPE / 加州 LA"
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="departureAirportName" className="text-sm font-medium">
                      {t('tourEditDialog.departureAirport')}
                    </Label>
                    <Input
                      id="departureAirportName"
                      value={isAiPlaceholder(editedData.departureAirportName) ? '' : (editedData.departureAirportName || '')}
                      onChange={(e) => setEditedData({ ...editedData, departureAirportName: e.target.value })}
                      placeholder="例如:桃園國際機場 TPE"
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="destinationCountry" className="text-sm font-medium">
                      {t('tourEditDialog.destinationCountry')} <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="destinationCountry"
                      value={isAiPlaceholder(editedData.destinationCountry) ? '' : (editedData.destinationCountry || '')}
                      onChange={(e) => setEditedData({ ...editedData, destinationCountry: e.target.value })}
                      placeholder="例如:瑞士 / 日本 / 美國"
                      className="mt-2"
                    />
                  </div>

                  <div>
                    <Label htmlFor="destinationCity" className="text-sm font-medium">
                      {t('tourEditDialog.destinationCity')}
                    </Label>
                    <Input
                      id="destinationCity"
                      value={isAiPlaceholder(editedData.destinationCity) ? '' : (editedData.destinationCity || '')}
                      onChange={(e) => setEditedData({ ...editedData, destinationCity: e.target.value })}
                      placeholder="例如:蘇黎世 / 東京 / 紐約"
                      className="mt-2"
                    />
                  </div>
                </div>
              </div>

              {/* Round 80.22: Packpoint per-tour multiplier + commission cost
                  calculator. Default 0.25x is the thin-margin safe rate; Jeff
                  bumps to 1x/2x for promo tours. The estimated commission
                  field is optional but unlocks the live cost-vs-margin
                  preview when filled. */}
              <div className="bg-gradient-to-br from-[#c9a563]/8 to-foreground/[0.02] border border-[#c9a563]/30 rounded-xl p-6 space-y-4">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] pb-2 border-b border-[#c9a563]/20">
                    Packpoint 設定
                  </h3>
                  <p className="text-xs text-foreground/60 mt-2">
                    控制此團發出多少 Packpoint。預設 0.25x(薄利安全)。做活動時調 1x / 2x。
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="pointsEarnRate" className="text-sm font-medium text-foreground">
                      點數倍率
                    </Label>
                    <select
                      id="pointsEarnRate"
                      value={(editedData as any).pointsEarnRate ?? 25}
                      onChange={(e) =>
                        setEditedData({
                          ...editedData,
                          pointsEarnRate: parseInt(e.target.value, 10),
                        } as any)
                      }
                      className="mt-2 w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus-visible:ring-2 focus-visible:ring-foreground/20"
                    >
                      <option value={0}>0x — 不發點數(虧本/促銷)</option>
                      <option value={25}>0.25x — 薄利團(預設)</option>
                      <option value={50}>0.5x — 標準</option>
                      <option value={100}>1x — 活動</option>
                      <option value={200}>2x — 雙倍特推</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="estimatedCommissionPct" className="text-sm font-medium text-foreground">
                      預估 Commission %(選填)
                    </Label>
                    <Input
                      id="estimatedCommissionPct"
                      type="number"
                      min={0}
                      max={100}
                      step="0.5"
                      value={
                        (editedData as any).estimatedCommissionPct != null
                          ? ((editedData as any).estimatedCommissionPct / 100).toFixed(1)
                          : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditedData({
                          ...editedData,
                          estimatedCommissionPct: v === "" ? null : Math.round(parseFloat(v) * 100),
                        } as any);
                      }}
                      placeholder="例如 15"
                      className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
                    />
                    <p className="text-[10px] text-foreground/50 mt-1">填了才能看 cost vs profit</p>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={(editedData as any).excludeFromPackpoint ?? false}
                        onChange={(e) =>
                          setEditedData({
                            ...editedData,
                            excludeFromPackpoint: e.target.checked,
                          } as any)
                        }
                        className="h-4 w-4 rounded border-foreground/30"
                      />
                      <span className="font-medium">完全排除此團</span>
                    </label>
                  </div>
                </div>
                {/* Live cost calculator — only when commission is filled */}
                {(() => {
                  const rate = ((editedData as any).pointsEarnRate ?? 25) / 100;
                  const commissionPct = (editedData as any).estimatedCommissionPct;
                  const sample = 1000; // sample $1,000 booking
                  const excluded = (editedData as any).excludeFromPackpoint;
                  if (excluded) {
                    return (
                      <div className="text-xs bg-foreground/5 rounded-lg p-3 text-foreground/70">
                        🚫 此團不發 Packpoint(commission 全保留)
                      </div>
                    );
                  }
                  const plusPoints = sample * 1 * 5 * rate;
                  const conciergePoints = sample * 1 * 10 * rate;
                  const plusCost = plusPoints / 100;
                  const conciergeCost = conciergePoints / 100;
                  const showProfit = commissionPct != null && commissionPct > 0;
                  const commissionAmt = showProfit ? (sample * commissionPct) / 10000 : null;
                  return (
                    <div className="text-xs bg-foreground/5 rounded-lg p-3 space-y-1.5">
                      <p className="font-semibold text-foreground/80">$1,000 訂單試算({rate}x):</p>
                      <div className="grid grid-cols-2 gap-2 text-foreground/70">
                        <div>Plus 客拿 <strong className="text-foreground">{plusPoints.toLocaleString()} pts</strong>(${plusCost.toFixed(2)})</div>
                        <div>Concierge 客拿 <strong className="text-foreground">{conciergePoints.toLocaleString()} pts</strong>(${conciergeCost.toFixed(2)})</div>
                      </div>
                      {showProfit && commissionAmt != null && (
                        <div className="pt-1 mt-1 border-t border-foreground/10 grid grid-cols-2 gap-2">
                          <div className={plusCost <= commissionAmt ? "text-green-700" : "text-red-700"}>
                            Plus 淨利:${(commissionAmt - plusCost).toFixed(2)} {plusCost <= commissionAmt ? "✓" : "⚠️ 虧本!"}
                          </div>
                          <div className={conciergeCost <= commissionAmt ? "text-green-700" : "text-red-700"}>
                            Concierge 淨利:${(commissionAmt - conciergeCost).toFixed(2)} {conciergeCost <= commissionAmt ? "✓" : "⚠️ 虧本!"}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* v78l Sprint 4A: Supplier contact for auto-notify on booking confirm */}
              <div className="bg-[#c9a563]/8 border border-[#c9a563]/20 rounded-xl p-6 space-y-4">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] pb-2 border-b border-[#c9a563]/20">{t('tourEditDialog.supplierSection')}</h3>
                  <p className="text-xs text-foreground/60 mt-2">
                    {t('tourEditDialog.supplierSectionHint')}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="supplierName" className="text-sm font-medium text-foreground">
                      {t('tourEditDialog.supplierName')}
                    </Label>
                    <Input
                      id="supplierName"
                      value={(editedData as any).supplierName || ""}
                      onChange={(e) => setEditedData({ ...editedData, supplierName: e.target.value } as any)}
                      placeholder={t('tourEditDialog.supplierNamePlaceholder')}
                      className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierEmail" className="text-sm font-medium text-foreground">
                      {t('tourEditDialog.supplierEmail')}
                    </Label>
                    <Input
                      id="supplierEmail"
                      type="email"
                      value={(editedData as any).supplierEmail || ""}
                      onChange={(e) => setEditedData({ ...editedData, supplierEmail: e.target.value } as any)}
                      placeholder={t('tourEditDialog.supplierEmailPlaceholder')}
                      className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierPhone" className="text-sm font-medium text-foreground">
                      {t('tourEditDialog.supplierPhone')}
                    </Label>
                    <Input
                      id="supplierPhone"
                      value={(editedData as any).supplierPhone || ""}
                      onChange={(e) => setEditedData({ ...editedData, supplierPhone: e.target.value } as any)}
                      placeholder={t('tourEditDialog.supplierPhonePlaceholder')}
                      className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
                    />
                  </div>
                  <div>
                    <Label htmlFor="supplierNotes" className="text-sm font-medium text-foreground">
                      {t('tourEditDialog.supplierNotes')}
                    </Label>
                    <Input
                      id="supplierNotes"
                      value={(editedData as any).supplierNotes || ""}
                      onChange={(e) => setEditedData({ ...editedData, supplierNotes: e.target.value } as any)}
                      placeholder={t('tourEditDialog.supplierNotesPlaceholder')}
                      className="mt-2 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-[#FAF8F2] border border-[#c9a563]/20 rounded-xl p-6 space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] mb-4 pb-2 border-b border-[#c9a563]/20">{t('tourEditDialog.heroImageSection')}</h3>
                
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
            </TabsContent>

            {/* 費用說明 Tab */}
            <TabsContent value="cost" className="mt-0 space-y-6">
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
            </TabsContent>

            {/* 注意事項 Tab */}
            <TabsContent value="notice" className="mt-0 space-y-6">
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
            </TabsContent>

            {/* 交通資訊 Tab */}
            <TabsContent value="transport" className="mt-0 space-y-6">
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 space-y-6">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 mb-4 pb-2 border-b border-foreground/5">{t('tourEditDialog.transportSettings')}</h3>
                
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
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.trainDetails')}</h4>
                    
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
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.cruiseDetails')}</h4>
                    
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
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.flightDetails')}</h4>
                    
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
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.busDetails')}</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.busCompany')}</Label>
                        <Input
                          value={editedData.flights?.busCompany || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, busCompany: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.busCompanyPlaceholder')}
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.busRoute')}</Label>
                        <Input
                          value={editedData.flights?.busRoute || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, busRoute: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.busRoutePlaceholder')}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">{t('tourEditDialog.busDesc')}</Label>
                      <Textarea
                        value={editedData.flights?.description || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, description: e.target.value }
                        })}
                        className="mt-2"
                        rows={3}
                        placeholder={t('tourEditDialog.busDescPlaceholder')}
                      />
                    </div>
                  </div>
                )}

                {/* 自駕/租車詳細資訊 */}
                {editedData.flights?.type === 'CAR' && (
                  <div className="bg-white rounded-lg p-4 space-y-4 border border-gray-200">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50 pb-2 border-b border-foreground/5">{t('tourEditDialog.carDetails')}</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.carType')}</Label>
                        <Input
                          value={editedData.flights?.carType || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, carType: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.carTypePlaceholder')}
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">{t('tourEditDialog.carCompany')}</Label>
                        <Input
                          value={editedData.flights?.carCompany || ''}
                          onChange={(e) => setEditedData({
                            ...editedData,
                            flights: { ...editedData.flights, carCompany: e.target.value }
                          })}
                          className="mt-2"
                          placeholder={t('tourEditDialog.carCompanyPlaceholder')}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">{t('tourEditDialog.carDesc')}</Label>
                      <Textarea
                        value={editedData.flights?.description || ''}
                        onChange={(e) => setEditedData({
                          ...editedData,
                          flights: { ...editedData.flights, description: e.target.value }
                        })}
                        className="mt-2"
                        rows={3}
                        placeholder={t('tourEditDialog.carDescPlaceholder')}
                      />
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* 照片管理 Tab */}
            <TabsContent value="photos" className="mt-0 space-y-6">
              <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-6">
                <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
                  <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-foreground/50">{t('tourEditDialog.tourPhotos')}</h3>
                    <p className="text-xs text-foreground/60 mt-1">{t('tourEditDialog.uploadHint')}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {t('tourEditDialog.uploadButton')}
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
                      className="rounded-lg border-gray-300 text-foreground hover:border-[#c9a563] hover:text-[#8a6f3a]"
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
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                    isDraggingOver ? 'border-[#c9a563] bg-[#FAF8F2]' : 'border-gray-300 hover:border-[#c9a563]/50 hover:bg-gray-50'
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
                  <p className="text-sm font-medium text-gray-600">{t('tourEditDialog.dragDropHint')}</p>
                  <p className="text-xs text-gray-400 mt-1">{t('tourEditDialog.dragDropSub')}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {editedData.images?.map((image: any, index: number) => (
                    <div key={index} className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium text-foreground">{t('tourEditDialog.photoLabel').replace('{n}', String(index + 1))}</Label>
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
                        <div className="w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center">
                          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                          <span className="ml-2 text-sm text-foreground/60">{t('tourEditDialog.uploading')}</span>
                        </div>
                      ) : image.url ? (
                        <div className="relative overflow-hidden rounded-lg group">
                          <img
                            src={image.url}
                            alt={image.alt || t('tourEditDialog.tourPhotoAlt')}
                            className="w-full h-32 object-cover rounded-lg"
                          />
                          {/* 替換圖片按鈕 */}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                            <label className="cursor-pointer bg-white text-foreground text-xs px-3 py-1.5 rounded-lg font-medium hover:bg-gray-100">
                              <Upload className="h-3 w-3 inline mr-1" />
                              {t('tourEditDialog.replaceImage')}
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
                        <label className="w-full h-32 bg-white border border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 hover:border-[#c9a563]/50">
                          <Upload className="h-6 w-6 text-gray-400 mb-1" />
                          <span className="text-xs text-foreground/60">{t('tourEditDialog.clickToUpload')}</span>
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
                        <Label className="text-xs font-medium text-gray-600">{t('tourEditDialog.imageUrlLabel')}</Label>
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
              <div className="bg-[#FAF8F2] border border-[#c9a563]/20 rounded-xl p-6 space-y-4">
                <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#8a6f3a] pb-2 border-b border-[#c9a563]/20">{t('tourEditDialog.heroImage')}</h3>
                
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

        {/* Round 80.21 — sticky footer with dirty-aware Save:
            - Save button greyed out when nothing changed (prevents accidental
              empty saves that silently overwrite untouched fields).
            - Cmd+S keyboard shortcut hint — surfaces a power-user feature
              that Jeff already uses unconsciously. */}
        <DialogFooter className="flex items-center justify-between gap-2 border-t border-foreground/10 pt-4 mt-0 flex-shrink-0">
          <span className="text-[11px] text-foreground/45 hidden sm:inline">
            {isDirty
              ? t('tourEditDialog.unsavedHint') || '尚未儲存的變更會在關閉時遺失'
              : t('tourEditDialog.savedHint') || '所有變更已同步'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
              className="rounded-lg border-gray-300 text-foreground hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-foreground/20"
              disabled={isSaving}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className="bg-foreground text-white hover:bg-foreground/85 rounded-lg focus-visible:ring-2 focus-visible:ring-foreground/20 disabled:opacity-50"
              title={t('tourEditDialog.saveShortcut') || 'Cmd/Ctrl + S'}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t('tourEditDialog.saving')}
                </>
              ) : (
                <>
                  {t('tourEditDialog.confirmSave')}
                  <kbd className="hidden md:inline ml-2 px-1.5 py-0.5 bg-white/15 text-white/85 text-[10px] rounded font-mono tracking-wide">
                    ⌘S
                  </kbd>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Round 80.21 — detect AI placeholder values that the agents write when
 * they couldn't extract a real value. We render those as empty in the
 * form (so the field shows its placeholder hint instead of leaking the
 * AI's "I don't know" string back to the user).
 */
function isAiPlaceholder(value: any): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Common placeholders the agents emit. Exact match only — we don't
  // want to nuke a real city named "未知" (extremely rare but possible).
  const placeholders = new Set([
    '待確認', '未知', '不明', 'TBD', 'TBC', 'N/A', 'n/a', 'NA',
    'Unknown', 'unknown', '-', '—', '?', '？',
  ]);
  return placeholders.has(trimmed);
}

/**
 * Round 80.21 — SaveStatusBadge.
 *
 * Top-right pill that surfaces save state without making the user hunt
 * for it. Three states:
 *   ● 全部儲存 — gray, calm baseline (clean editedData == initial)
 *   ● 儲存中 — gold, animated spinner (mutation pending)
 *   ● 未儲存 — black + gold dot, attention-grabbing (dirty fields)
 *
 * Replaces the silent "you might have lost work" UX where Jeff could only
 * tell something was unsaved by trying to close the dialog and waiting
 * for the confirm() prompt.
 */
function SaveStatusBadge({
  isDirty,
  isSaving,
}: {
  isDirty: boolean;
  isSaving: boolean;
}) {
  if (isSaving) {
    return (
      <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#c9a563]/15 border border-[#c9a563]/40 text-[#8a6f3a] text-xs font-semibold">
        <Loader2 className="h-3 w-3 animate-spin" />
        儲存中
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-foreground/5 border border-foreground/30 text-foreground text-xs font-semibold">
        <span
          className="h-1.5 w-1.5 rounded-full bg-[#c9a563]"
          aria-hidden
        />
        未儲存
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-500 text-xs font-medium">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      全部儲存
    </span>
  );
}
