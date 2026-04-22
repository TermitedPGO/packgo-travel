import React, { useState, useRef, useEffect, useCallback } from "react";
import { Camera, Upload, Loader2, ImageIcon, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ImageCropper } from "@/components/ImageCropper";
import { trpc } from "@/lib/trpc";
import { useLocale } from "@/contexts/LocaleContext";

interface EditableImageProps {
  src: string;
  alt: string;
  onSave: (newSrc: string) => void;
  isEditing: boolean;
  className?: string;
  aspectRatio?: "square" | "video" | "wide" | "auto";
  tourId?: number;
  imagePath?: string;
}

// 將 aspectRatio 字串轉換為數字比例
const getAspectRatioValue = (aspectRatio: string): number | undefined => {
  switch (aspectRatio) {
    case "square":
      return 1;
    case "video":
      return 16 / 9;
    case "wide":
      return 21 / 9;
    default:
      return undefined;
  }
};

interface ImageLibraryItem {
  id: number;
  url: string;
  filename: string | null;
  mimeType: string | null;
  fileSize: number | null;
  width: number | null;
  height: number | null;
  tags: string | null;
  uploadedBy: number;
  tourId: number | null;
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export function EditableImage({
  src,
  alt,
  onSave,
  isEditing,
  className = "",
  aspectRatio = "auto",
  tourId,
  imagePath = "image",
}: EditableImageProps) {
  const { t } = useLocale();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState(src);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "library" | "crop">("upload");
  const [imageToCrop, setImageToCrop] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // 獲取圖片庫
  const { data: libraryImages, refetch: refetchLibrary } = trpc.imageLibrary.list.useQuery(
    { limit: 50 },
    { enabled: isDialogOpen && activeTab === "library" }
  );

  // 添加圖片到圖片庫的 mutation
  const addToLibrary = trpc.imageLibrary.add.useMutation({
    onSuccess: () => {
      refetchLibrary();
    },
  });

  // 當 src 變更時更新 imageUrl
  useEffect(() => {
    setImageUrl(src);
  }, [src]);

  const aspectRatioClass = {
    square: "aspect-square",
    video: "aspect-video",
    wide: "aspect-[21/9]",
    auto: "",
  }[aspectRatio];

  // 處理檔案上傳（直接上傳或進入裁切模式）
  const handleFileSelect = useCallback(async (file: File, skipCrop: boolean = false) => {
    // 驗證檔案類型
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
    if (!validTypes.includes(file.type) && !file.type.startsWith("image/")) {
      toast.error(t('tourDetail.imageInvalidType'));
      return;
    }

    // 驗證檔案大小 (最大 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t('tourDetail.imageSizeExceeded'));
      return;
    }

    // 如果跳過裁切，直接上傳
    if (skipCrop) {
      await uploadFile(file);
      return;
    }

    // 讀取檔案並進入裁切模式
    const reader = new FileReader();
    reader.onload = () => {
      setImageToCrop(reader.result as string);
      setActiveTab("crop");
    };
    reader.readAsDataURL(file);
  }, [t]);

  // 上傳檔案到伺服器並添加到圖片庫
  const uploadFile = async (fileOrBlob: File | Blob) => {
    setIsUploading(true);
    try {
      // 將 Blob 轉換為 base64
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          let uploadedUrl = "";
          
          // 如果有 tourId，使用行程圖片上傳 API
          if (tourId) {
            const response = await fetch(`/api/tours/${tourId}/upload-image`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                image: base64,
                path: imagePath,
              }),
            });

            if (!response.ok) {
              throw new Error(t('tourDetail.uploadFailed'));
            }

                  const result = await response.json();
                  const { url, optimization } = result;

                  // 顯示壓縮資訊
                  if (optimization) {
                    const savedKB = ((optimization.originalSize - optimization.optimizedSize) / 1024).toFixed(1);
                    toast.success(t('tourDetail.imageCompressed', { savedKB, ratio: optimization.compressionRatio }));
                  }
                  uploadedUrl = url;
          } else {
            // 使用通用圖片上傳 API
            const formData = new FormData();
            formData.append("image", fileOrBlob);

            const response = await fetch("/api/upload/image", {
              method: "POST",
              body: formData,
            });

            if (!response.ok) {
              throw new Error(t('tourDetail.uploadFailed'));
            }

            const { url } = await response.json();
            uploadedUrl = url;
          }

          // 上傳成功後，添加到圖片庫
          try {
            await addToLibrary.mutateAsync({
              url: uploadedUrl,
              filename: fileOrBlob instanceof File ? fileOrBlob.name : "cropped-image.jpg",
              mimeType: fileOrBlob instanceof File ? fileOrBlob.type : "image/jpeg",
              fileSize: fileOrBlob.size,
              tourId: tourId,
            });
          } catch (libraryError) {
            // 圖片庫添加失敗不影響主流程
            console.warn("Failed to add image to library:", libraryError);
          }

          setImageUrl(uploadedUrl);
          onSave(uploadedUrl);
          toast.success(t('tourDetail.imageUploadSuccess'));
          setIsDialogOpen(false);
          setImageToCrop(null);
          setActiveTab("upload");
        } catch (error) {
          toast.error(t('tourDetail.imageUploadFailedRetry'));
        } finally {
          setIsUploading(false);
        }
      };
      reader.onerror = () => {
        toast.error(t('tourDetail.fileReadFailed'));
        setIsUploading(false);
      };
      reader.readAsDataURL(fileOrBlob);
    } catch (error) {
      toast.error(t('tourDetail.imageUploadFailedRetry'));
      setIsUploading(false);
    }
  };

  // 處理裁切完成
  const handleCropComplete = async (croppedBlob: Blob) => {
    await uploadFile(croppedBlob);
  };

  // 處理從圖片庫選擇圖片
  const handleSelectFromLibrary = (url: string) => {
    setImageUrl(url);
    onSave(url);
    toast.success(t('tourDetail.imageSelected'));
    setIsDialogOpen(false);
  };

  // 處理檔案選擇
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // 處理拖放事件
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  // 取消裁切
  const handleCancelCrop = () => {
    setImageToCrop(null);
    setActiveTab("upload");
  };

  // 非編輯模式：直接顯示圖片
  if (!isEditing) {
    return (
      <img
        src={src}
        alt={alt}
        className={cn(aspectRatioClass, "object-cover rounded-xl", className)}
      />
    );
  }

  // 編輯模式：顯示可點擊的圖片
  return (
    <>
      <div
        className={cn(
          "relative group cursor-pointer",
          aspectRatioClass,
          className
        )}
        onClick={() => setIsDialogOpen(true)}
      >
        <img
          src={src}
          alt={alt}
          className={cn("w-full h-full object-cover rounded-xl", aspectRatioClass)}
        />
        {/* 編輯覆蓋層 */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="text-white text-center">
            <Camera className="h-8 w-8 mx-auto mb-2" />
            <span className="text-sm font-medium">{t('tourDetail.clickToReplaceImage')}</span>
          </div>
        </div>
        {/* 編輯標記 */}
        <div className="absolute top-2 right-2 bg-yellow-400 text-yellow-900 px-2 py-1 rounded text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity">
          {t('tourDetail.editableBadge')}
        </div>
      </div>

      {/* 圖片編輯對話框 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              {t('tourDetail.replaceImage')}
            </DialogTitle>
          </DialogHeader>

          {/* 如果正在裁切，顯示裁切器 */}
          {imageToCrop && activeTab === "crop" ? (
            <ImageCropper
              imageSrc={imageToCrop}
              aspectRatio={getAspectRatioValue(aspectRatio)}
              onCropComplete={handleCropComplete}
              onCancel={handleCancelCrop}
              isUploading={isUploading}
            />
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "upload" | "library")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  {t('tourDetail.uploadImage')}
                </TabsTrigger>
                <TabsTrigger value="library" className="flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" />
                  {t('tourDetail.imageLibrary')}
                </TabsTrigger>
              </TabsList>

              {/* 上傳標籤頁 */}
              <TabsContent value="upload" className="space-y-4">
                {/* 拖放上傳區域 */}
                <div
                  ref={dropZoneRef}
                  className={cn(
                    "relative border-2 border-dashed rounded-lg transition-all duration-200",
                    isDragging 
                      ? "border-primary bg-primary/10" 
                      : "border-gray-300 hover:border-gray-400",
                    "cursor-pointer"
                  )}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => !isUploading && fileInputRef.current?.click()}
                >
                  {/* 預覽圖片 */}
                  <div className="aspect-video bg-gray-50 rounded-lg overflow-hidden">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={t('tourDetail.imagePreviewAlt')}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-gray-400 py-12">
                        <ImageIcon className="h-16 w-16 mb-4" />
                        <p className="text-sm">{t('tourDetail.noImageSelected')}</p>
                      </div>
                    )}
                  </div>

                  {/* 拖放覆蓋層 */}
                  {(isDragging || isUploading) && (
                    <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center rounded-lg">
                      {isUploading ? (
                        <>
                          <Loader2 className="h-12 w-12 text-primary animate-spin mb-3" />
                          <p className="text-gray-600 font-medium">{t('tourDetail.uploadingImage')}</p>
                        </>
                      ) : (
                        <>
                          <Upload className="h-12 w-12 text-primary mb-3" />
                          <p className="text-gray-600 font-medium">{t('tourDetail.releaseToUpload')}</p>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* 上傳按鈕 */}
                <div className="text-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/jpg"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-full"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {t('tourDetail.uploadingImage')}
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        {t('tourDetail.selectAndCrop')}
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-gray-500 mt-2">
                    {t('tourDetail.imageFormatsWithOptimize')}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {t('tourDetail.dragDropWithCropHint')}
                  </p>
                </div>
              </TabsContent>

              {/* 圖片庫標籤頁 */}
              <TabsContent value="library" className="space-y-4">
                {libraryImages && libraryImages.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
                    {libraryImages.map((image: ImageLibraryItem) => (
                      <div
                        key={image.id}
                        className="relative aspect-video bg-gray-100 rounded-lg overflow-hidden cursor-pointer group hover:ring-2 hover:ring-primary transition-all"
                        onClick={() => handleSelectFromLibrary(image.url)}
                      >
                        <img
                          src={image.url}
                          alt={image.filename || t('tourDetail.imageAltFallback')}
                          className="w-full h-full object-cover rounded-lg"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                          <span className="text-white text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                            {t('tourDetail.selectImage')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                    <FolderOpen className="h-16 w-16 mb-4" />
                    <p className="text-sm">{t('tourDetail.libraryEmpty')}</p>
                    <p className="text-xs mt-1">{t('tourDetail.libraryAutoAddHint')}</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default EditableImage;
