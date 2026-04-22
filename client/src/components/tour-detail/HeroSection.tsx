/**
 * HeroSection Component (Sipincollection Style)
 * 第一屏：大圖背景 + 標題疊加 - 支援 Inline Editing
 */

import React from "react";
import { EditableText } from "./EditableText";
import { EditableImage } from "./EditableImage";
import { useEditMode } from "@/contexts/EditModeContext";
import { useLocale } from "@/contexts/LocaleContext";

export interface HeroSectionProps {
  title: string;
  subtitle?: string;
  keywords?: string[];
  heroImage: string;
  colorTheme: {
    primary: string;
    secondary: string;
    accent: string;
  };
  tourId?: number;
  onUpdate?: (field: string, value: string) => Promise<void>;
  onImageUpload?: (file: File, path: string) => Promise<string>;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  title,
  subtitle,
  keywords,
  heroImage,
  colorTheme,
  tourId,
  onUpdate,
  onImageUpload,
}) => {
  const { isEditMode } = useEditMode();
  const { t } = useLocale();

  return (
    <section className="relative w-full">
      {/* Hero Image - Full Width */}
      <div className="relative w-full aspect-[21/9] lg:aspect-[21/7] overflow-hidden rounded-xl">
        {isEditMode && onImageUpload ? (
          <EditableImage
            src={heroImage}
            alt={title}
            onUpload={async (file) => {
              const url = await onImageUpload(file, "hero");
              await onUpdate?.("heroImage", url);
              return url;
            }}
            isEditable={isEditMode}
            aspectRatio="16/9"
            className="w-full h-full"
          />
        ) : (
          <img
            src={heroImage}
            alt={title}
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent" />
        
        {/* Content Overlay */}
        <div className="absolute inset-0 flex flex-col justify-end p-6 lg:p-12">
          <div className="container mx-auto">
            {/* Keywords */}
            {keywords && keywords.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {keywords.map((keyword, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 text-sm font-medium rounded-lg bg-black/40 text-white backdrop-blur-sm border border-white/30"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            )}
            
            {/* Title */}
            <div className="max-w-4xl">
              {isEditMode && onUpdate ? (
                <EditableText
                  value={title}
                  onSave={async (newValue) => {
                    await onUpdate("title", newValue);
                  }}
                  isEditable={isEditMode}
                  className="text-3xl lg:text-5xl xl:text-6xl font-serif font-bold text-white drop-shadow-lg"
                  as="h1"
                />
              ) : (
                <h1 className="text-3xl lg:text-5xl xl:text-6xl font-serif font-bold text-white drop-shadow-lg">
                  {title}
                </h1>
              )}
              
              {/* Subtitle */}
              {(subtitle || isEditMode) && (
                <div className="mt-4">
                  {isEditMode && onUpdate ? (
                    <EditableText
                      value={subtitle || ""}
                      onSave={async (newValue) => {
                        await onUpdate("heroSubtitle", newValue);
                      }}
                      isEditable={isEditMode}
                      placeholder={t('tourDetail.editSubtitlePlaceholder')}
                      className="text-lg lg:text-xl text-white/90"
                      as="p"
                    />
                  ) : subtitle ? (
                    <p className="text-lg lg:text-xl text-white/90">
                      {subtitle}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
