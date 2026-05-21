/**
 * v2 Wave 2 Module 2.12 — TourEditDialog shared editing context.
 *
 * The original 2,156 LOC monolith carried `editedData` + `setEditedData` plus
 * a half-dozen list-mutation helpers (addDailyItinerary, addCostItem, etc.)
 * in one closure. This context exposes the same handles to the per-tab
 * sub-components so each tab is self-contained — no prop drilling, no
 * cross-tab JSX in any single file.
 *
 * Behaviour-preserving: every handler below mirrors the pre-split logic byte
 * for byte. The image upload helpers (uploadImageFile, handleDropImages) and
 * the file-input ref also live here because PhotosTab needs them in two
 * different render branches (drop zone + replace button).
 */
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

type CostKey = "included" | "excluded" | "additionalCosts";
type NoticeKey = "preparation" | "culturalNotes" | "healthSafety" | "emergency";

interface TourEditContextValue {
  editedData: any;
  setEditedData: Dispatch<SetStateAction<any>>;
  isDirty: boolean;

  uploadingImages: Record<number, boolean>;
  setUploadingImages: Dispatch<SetStateAction<Record<number, boolean>>>;
  isDraggingOver: boolean;
  setIsDraggingOver: Dispatch<SetStateAction<boolean>>;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;

  uploadImageFile: (file: File, _index?: number) => Promise<string | null>;
  handleDropImages: (files: FileList) => Promise<void>;

  addDailyItinerary: () => void;
  removeDailyItinerary: (index: number) => void;
  updateDailyItinerary: (index: number, field: string, value: any) => void;
  addActivity: (dayIndex: number) => void;
  removeActivity: (dayIndex: number, activityIndex: number) => void;
  updateActivity: (
    dayIndex: number,
    activityIndex: number,
    field: string,
    value: string,
  ) => void;

  addCostItem: (type: CostKey) => void;
  removeCostItem: (type: CostKey, index: number) => void;
  updateCostItem: (type: CostKey, index: number, value: string) => void;

  addNoticeItem: (type: NoticeKey) => void;
  removeNoticeItem: (type: NoticeKey, index: number) => void;
  updateNoticeItem: (type: NoticeKey, index: number, value: string) => void;
}

const TourEditContext = createContext<TourEditContextValue | null>(null);

export function useTourEdit(): TourEditContextValue {
  const ctx = useContext(TourEditContext);
  if (!ctx) {
    throw new Error("useTourEdit must be used inside <TourEditProvider>");
  }
  return ctx;
}

interface TourEditProviderProps {
  tourData: any;
  children: ReactNode;
  /** Exposed to parent so it can wire keyboard shortcuts / dirty-aware close. */
  onEditedDataReady?: (data: any) => void;
  /** Exposed so the parent can reset the initial baseline after a save. */
  initialDataRef: MutableRefObject<string>;
}

export function TourEditProvider({
  tourData,
  children,
  initialDataRef,
}: TourEditProviderProps) {
  const { t } = useLocale();
  const [editedData, setEditedData] = useState<any>(null);
  const [uploadingImages, setUploadingImages] = useState<Record<number, boolean>>({});
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // v70: dirty detection — compare JSON.stringify(editedData) against the
  // baseline snapshot captured when the dialog opened.
  const isDirty = (() => {
    if (!editedData) return false;
    if (!initialDataRef.current) return false;
    try {
      return JSON.stringify(editedData) !== initialDataRef.current;
    } catch {
      return false;
    }
  })();

  // 上傳圖片到 S3
  const uploadImageFile = useCallback(
    async (file: File, _index?: number): Promise<string | null> => {
      if (!file.type.startsWith("image/")) {
        toast.error(t("tourEditDialog.toastImageFormatOnly"));
        return null;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(t("tourEditDialog.toastImageSizeMax"));
        return null;
      }
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const base64 = e.target?.result as string;
          try {
            const response = await fetch("/api/upload/tour-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image: base64, path: "gallery" }),
            });
            if (!response.ok) throw new Error("Upload failed");
            const { url } = await response.json();
            resolve(url);
          } catch (err) {
            toast.error(t("tourEditDialog.toastUploadFailed"));
            resolve(null);
          }
        };
        reader.readAsDataURL(file);
      });
    },
    [t],
  );

  // 處理拖曳上傳多張圖片
  const handleDropImages = useCallback(
    async (files: FileList) => {
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFiles.length === 0) return;
      toast.info(
        t("tourEditDialog.toastUploadingN", { n: String(imageFiles.length) }),
      );
      const newImages = [...(editedData?.images || [])];
      const startIndex = newImages.length;
      // 先加入佔位符
      imageFiles.forEach(() => newImages.push({ url: "", alt: "", caption: "" }));
      setEditedData((prev: any) => ({ ...prev, images: newImages }));
      // 並行上傳
      const uploadPromises = imageFiles.map(async (file, i) => {
        const idx = startIndex + i;
        setUploadingImages((prev) => ({ ...prev, [idx]: true }));
        const url = await uploadImageFile(file, idx);
        setUploadingImages((prev) => ({ ...prev, [idx]: false }));
        return { idx, url };
      });
      const results = await Promise.all(uploadPromises);
      setEditedData((prev: any) => {
        const updated = [...(prev?.images || [])];
        results.forEach(({ idx, url }) => {
          if (url) updated[idx] = { ...updated[idx], url };
          else updated.splice(idx, 1);
        });
        return {
          ...prev,
          images: updated.filter(
            (img: any) => img.url !== "" || updated.indexOf(img) < startIndex,
          ),
        };
      });
      toast.success(
        t("tourEditDialog.toastNUploaded", {
          n: String(results.filter((r) => r.url).length),
        }),
      );
    },
    [editedData?.images, uploadImageFile, t],
  );

  // 當 tourData 變化時，更新 editedData
  useEffect(() => {
    if (tourData) {
      // 解析 JSON 欄位
      const parsed = { ...tourData };

      // 解析 itineraryDetailed
      if (typeof parsed.itineraryDetailed === "string") {
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
      if (typeof parsed.costExplanation === "string") {
        try {
          parsed.costExplanation = JSON.parse(parsed.costExplanation);
        } catch {
          parsed.costExplanation = {
            included: [],
            excluded: [],
            additionalCosts: [],
            notes: "",
          };
        }
      }
      if (!parsed.costExplanation || typeof parsed.costExplanation !== "object") {
        parsed.costExplanation = {
          included: [],
          excluded: [],
          additionalCosts: [],
          notes: "",
        };
      }

      // 解析 noticeDetailed
      if (typeof parsed.noticeDetailed === "string") {
        try {
          parsed.noticeDetailed = JSON.parse(parsed.noticeDetailed);
        } catch {
          parsed.noticeDetailed = {
            preparation: [],
            culturalNotes: [],
            healthSafety: [],
            emergency: [],
          };
        }
      }
      if (!parsed.noticeDetailed || typeof parsed.noticeDetailed !== "object") {
        parsed.noticeDetailed = {
          preparation: [],
          culturalNotes: [],
          healthSafety: [],
          emergency: [],
        };
      }
      // 確保所有欄位都是陣列
      const ensureArray = (val: any) => {
        if (!val) return [];
        if (Array.isArray(val)) return val;
        if (typeof val === "string") return [val];
        return [];
      };
      parsed.noticeDetailed = {
        preparation: ensureArray(parsed.noticeDetailed.preparation),
        culturalNotes: ensureArray(parsed.noticeDetailed.culturalNotes),
        healthSafety: ensureArray(parsed.noticeDetailed.healthSafety),
        emergency: ensureArray(parsed.noticeDetailed.emergency),
      };

      // 解析 flights (交通資訊)
      if (typeof parsed.flights === "string") {
        try {
          parsed.flights = JSON.parse(parsed.flights);
        } catch {
          parsed.flights = { type: "FLIGHT", typeName: "" };
        }
      }
      if (!parsed.flights || typeof parsed.flights !== "object") {
        parsed.flights = { type: "FLIGHT", typeName: "" };
      }
      // 修復：根據 typeName 推斷正確的 type（解決 AI 生成時 type/typeName 不一致的問題）
      const flightTypeNameLower = (parsed.flights.typeName || "").toLowerCase();
      if (
        flightTypeNameLower.includes("飛機") ||
        flightTypeNameLower.includes("flight") ||
        flightTypeNameLower.includes("airline") ||
        flightTypeNameLower.includes("air")
      ) {
        parsed.flights.type = "FLIGHT";
      } else if (
        flightTypeNameLower.includes("郵輪") ||
        flightTypeNameLower.includes("cruise") ||
        flightTypeNameLower.includes("ship")
      ) {
        parsed.flights.type = "CRUISE";
      } else if (
        flightTypeNameLower.includes("巴士") ||
        flightTypeNameLower.includes("bus") ||
        flightTypeNameLower.includes("客車")
      ) {
        parsed.flights.type = "BUS";
      } else if (
        flightTypeNameLower.includes("自駕") ||
        flightTypeNameLower.includes("租車") ||
        flightTypeNameLower.includes("car") ||
        flightTypeNameLower.includes("drive")
      ) {
        parsed.flights.type = "CAR";
      }
      // 如果 type 不是已知類型，保持原有值（防止覆蓋正確設定）

      // 解析 images (照片陣列)
      if (typeof parsed.images === "string") {
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
  }, [tourData, initialDataRef]);

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

  const updateActivity = (
    dayIndex: number,
    activityIndex: number,
    field: string,
    value: string,
  ) => {
    const updated = [...(editedData.itineraryDetailed || [])];
    updated[dayIndex].activities[activityIndex] = {
      ...updated[dayIndex].activities[activityIndex],
      [field]: value,
    };
    setEditedData({ ...editedData, itineraryDetailed: updated });
  };

  // 費用項目操作
  const addCostItem = (type: CostKey) => {
    const updated = { ...editedData.costExplanation };
    if (!updated[type]) {
      updated[type] = [];
    }
    updated[type].push("");
    setEditedData({ ...editedData, costExplanation: updated });
  };

  const removeCostItem = (type: CostKey, index: number) => {
    const updated = { ...editedData.costExplanation };
    updated[type].splice(index, 1);
    setEditedData({ ...editedData, costExplanation: updated });
  };

  const updateCostItem = (type: CostKey, index: number, value: string) => {
    const updated = { ...editedData.costExplanation };
    updated[type][index] = value;
    setEditedData({ ...editedData, costExplanation: updated });
  };

  // 注意事項操作
  const addNoticeItem = (type: NoticeKey) => {
    const updated = { ...editedData.noticeDetailed };
    if (!updated[type]) {
      updated[type] = [];
    }
    updated[type].push("");
    setEditedData({ ...editedData, noticeDetailed: updated });
  };

  const removeNoticeItem = (type: NoticeKey, index: number) => {
    const updated = { ...editedData.noticeDetailed };
    updated[type].splice(index, 1);
    setEditedData({ ...editedData, noticeDetailed: updated });
  };

  const updateNoticeItem = (type: NoticeKey, index: number, value: string) => {
    const updated = { ...editedData.noticeDetailed };
    updated[type][index] = value;
    setEditedData({ ...editedData, noticeDetailed: updated });
  };

  const value: TourEditContextValue = {
    editedData,
    setEditedData,
    isDirty,
    uploadingImages,
    setUploadingImages,
    isDraggingOver,
    setIsDraggingOver,
    fileInputRef,
    uploadImageFile,
    handleDropImages,
    addDailyItinerary,
    removeDailyItinerary,
    updateDailyItinerary,
    addActivity,
    removeActivity,
    updateActivity,
    addCostItem,
    removeCostItem,
    updateCostItem,
    addNoticeItem,
    removeNoticeItem,
    updateNoticeItem,
  };

  return (
    <TourEditContext.Provider value={value}>{children}</TourEditContext.Provider>
  );
}
