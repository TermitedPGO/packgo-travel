/**
 * TourDetailPeony / useTourEditMode.ts
 *
 * Admin edit-mode coordinator. Holds the `editedTour` snapshot, dirty-field
 * tracking, and the save / cancel mutations. Returned values plug straight
 * into <EditModeToggle> and downstream section components.
 *
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

export function useTourEditMode(
  tour: any,
  tourId: number | undefined,
  refetch: () => void,
) {
  const { t } = useLocale();
  const utils = trpc.useUtils();
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTour, setEditedTour] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  // 追蹤已修改的欄位（用於顯示修改數量）
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(new Set());

  // 更新行程 mutation
  const updateTourMutation = trpc.tours.update.useMutation({
    onSuccess: () => {
      toast.success(t('tourDetail.tourUpdated'));
      utils.tours.getById.invalidate({ id: tourId! });
      refetch();
      setHasChanges(false);
      setIsEditMode(false);
      setEditedTour(null);
      setDirtyFields(new Set());
    },
    onError: (error) => {
      toast.error(`${t('tourDetail.updateFailed')}${error.message}`);
    },
  });

  // PDF 下載 mutation — calls server-side Puppeteer, returns S3 URL
  const generatePdfMutation = trpc.tours.generatePdf.useMutation({
    onSuccess: (data) => {
      toast.success(t('tourDetail.pdfGenerated'));
      // Open the signed PDF URL in a new tab so the browser downloads / previews it
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (error) => {
      toast.error(`${t('tourDetail.pdfFailed')}${error.message}`);
    },
  });

  // 進入編輯模式時複製資料
  // 修復：依賴只放 isEditMode，避免 tRPC 每次 render 回傳新物件參考造成無限迴圈
  // 使用 useRef 快照 tour，確保切換時只執行一次深拷貝
  const tourRef = useRef(tour);
  useEffect(() => {
    tourRef.current = tour;
  });

  useEffect(() => {
    if (isEditMode && tourRef.current) {
      // 用 requestAnimationFrame 避免阻塞 UI thread，讓瀏覽器先渲染編輯模式 UI
      // 再用 structuredClone 進行深拷貝（效能優於 JSON.parse/stringify）
      const snapshot = tourRef.current;
      requestAnimationFrame(() => {
        setEditedTour(structuredClone(snapshot));
      });
    } else if (!isEditMode) {
      // 退出編輯模式時清空，避免殘留舊資料
      setEditedTour(null);
    }
  }, [isEditMode]);

  // 更新欄位
  const updateField = (field: string, value: any) => {
    setEditedTour((prev: any) => {
      if (!prev) return prev;
      const updated = { ...prev, [field]: value };
      setHasChanges(true);
      return updated;
    });
    // 記錄已修改的欄位
    setDirtyFields((prev) => new Set(prev).add(field));
  };

  // 儲存變更
  const handleSave = async () => {
    if (!editedTour || !hasChanges) return;
    setIsSaving(true);
    try {
      const toJsonStr = (val: any) =>
        typeof val === 'string' ? val : val != null ? JSON.stringify(val) : undefined;

      await updateTourMutation.mutateAsync({
        id: editedTour.id,
        // 基本欄位
        title: editedTour.title,
        poeticTitle: editedTour.poeticTitle,
        description: editedTour.description,
        heroSubtitle: editedTour.heroSubtitle,
        heroImage: editedTour.heroImage,
        price: editedTour.price,
        duration: editedTour.duration,
        departureCity: editedTour.departureCity,
        promotionText: editedTour.promotionText,
        notes: editedTour.notes,
        // JSON 內容欄位
        itineraryDetailed: toJsonStr(editedTour.itineraryDetailed),
        keyFeatures: toJsonStr(editedTour.keyFeatures),
        hotels: toJsonStr(editedTour.hotels),
        meals: toJsonStr(editedTour.meals),
        flights: toJsonStr(editedTour.flights),
        highlights: toJsonStr(editedTour.highlights),
        includes: toJsonStr(editedTour.includes),
        excludes: toJsonStr(editedTour.excludes),
        // 費用說明與注意事項（新增可編輯欄位）
        costExplanation: toJsonStr(editedTour.costExplanation),
        noticeDetailed: toJsonStr(editedTour.noticeDetailed),
        attractions: toJsonStr(editedTour.attractions),
      });
    } finally {
      setIsSaving(false);
    }
  };

  // 取消編輯
  const handleCancelEdit = () => {
    if (hasChanges) {
      if (confirm(t('tourDetail.unsavedChanges'))) {
        setIsEditMode(false);
        setEditedTour(null);
        setHasChanges(false);
        setDirtyFields(new Set());
      }
    } else {
      setIsEditMode(false);
      setEditedTour(null);
      setDirtyFields(new Set());
    }
  };

  return {
    isEditMode,
    setIsEditMode,
    editedTour,
    setEditedTour,
    isSaving,
    hasChanges,
    setHasChanges,
    dirtyFields,
    setDirtyFields,
    updateField,
    handleSave,
    handleCancelEdit,
    generatePdfMutation,
  };
}
