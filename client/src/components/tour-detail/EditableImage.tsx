/**
 * EditableImage Component
 * 可編輯圖片組件 - 支援點擊上傳和拖放上傳
 */

import React, { useState, useRef, useCallback } from "react";
import { Camera, Upload, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useLocale } from "@/contexts/LocaleContext";

export interface EditableImageProps {
  src: string;
  alt: string;
  onUpload: (file: File) => Promise<string>; // 返回新的圖片 URL
  isEditable?: boolean;
  className?: string;
  aspectRatio?: "16/9" | "4/3" | "1/1" | "3/4" | "21/9";
  placeholder?: string;
}

export const EditableImage: React.FC<EditableImageProps> = ({
  src,
  alt,
  onUpload,
  isEditable = false,
  className = "",
  aspectRatio = "16/9",
  placeholder,
}) => {
  const { t } = useLocale();
  const resolvedPlaceholder = placeholder ?? t('tourDetail.clickToUploadImage');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const aspectRatioClass = {
    "16/9": "aspect-[16/9]",
    "4/3": "aspect-[4/3]",
    "1/1": "aspect-square",
    "3/4": "aspect-[3/4]",
    "21/9": "aspect-[21/9]",
  }[aspectRatio];

  // 處理檔案上傳
  const handleFileUpload = useCallback(async (file: File) => {
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

    // 顯示預覽
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setIsUploading(true);

    try {
      await onUpload(file);
      toast.success(t('tourDetail.imageUploadSuccess'));
      setIsDialogOpen(false);
      setPreviewUrl(null);
    } catch (error) {
      console.error("圖片上傳失敗:", error);
      toast.error(t('tourDetail.imageUploadFailedRetry'));
      setPreviewUrl(null);
    } finally {
      setIsUploading(false);
      // 清除 input 值，允許重複選擇同一檔案
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }

    // 清理 object URL
    URL.revokeObjectURL(objectUrl);
  }, [onUpload, t]);

  // 處理檔案選擇
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileUpload(file);
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
      handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const displaySrc = previewUrl || src;

  // 非編輯模式
  if (!isEditable) {
    return (
      <div className={cn("relative overflow-hidden rounded-lg", aspectRatioClass, className)}>
        {src ? (
          <img src={src} alt={alt} className="w-full h-full object-cover rounded-lg" />
        ) : (
          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
            <span className="text-gray-400">{resolvedPlaceholder}</span>
          </div>
        )}
      </div>
    );
  }

  // 編輯模式
  return (
    <>
      <div
        className={cn(
          "relative overflow-hidden rounded-lg cursor-pointer group",
          aspectRatioClass,
          className
        )}
        onClick={() => setIsDialogOpen(true)}
      >
        {/* 圖片 */}
        {displaySrc ? (
          <img src={displaySrc} alt={alt} className="w-full h-full object-cover rounded-lg" />
        ) : (
          <div className="w-full h-full bg-gray-200 flex items-center justify-center">
            <span className="text-gray-400">{resolvedPlaceholder}</span>
          </div>
        )}

        {/* 編輯覆蓋層 */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center">
          {isUploading ? (
            <>
              <Loader2 className="h-8 w-8 text-white animate-spin mb-2" />
              <span className="text-white text-sm">{t('tourDetail.uploadingImage')}</span>
            </>
          ) : (
            <>
              <Camera className="h-8 w-8 text-white mb-2" />
              <span className="text-white text-sm">{t('tourDetail.clickToReplaceImage')}</span>
            </>
          )}
        </div>
      </div>

      {/* 圖片編輯對話框 */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-5 w-5" />
              {t('tourDetail.replaceImage')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
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
                {displaySrc ? (
                  <img
                    src={displaySrc}
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
                      <p className="text-gray-400 text-sm">{t('tourDetail.imageAutoResize')}</p>
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
                    {t('tourDetail.uploadImage')}
                  </>
                )}
              </Button>
              <p className="text-xs text-gray-500 mt-2">
                {t('tourDetail.imageFormatsSupport')}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {t('tourDetail.dragDropHint')}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
