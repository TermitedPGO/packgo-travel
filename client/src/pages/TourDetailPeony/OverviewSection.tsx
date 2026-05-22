/**
 * TourDetailPeony / OverviewSection.tsx
 *
 * Overview: description + key features grid + AI highlights gallery +
 * poetic content + Quick Info Cards.
 * Extracted from TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import {
  Clock,
  MapPin,
  Users,
  Sailboat,
  TreePine,
  Coffee,
  Mountain,
  Waves,
  Sunrise,
  Compass,
  Footprints,
  Bike,
  Landmark,
  UtensilsCrossed,
  Wine,
  Sparkles,
  Award,
  Calendar,
} from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { EditableText, EditableImage } from "@/components/inline-edit";
import type { getThemeColorByDestination } from "./helpers";

export type OverviewSectionProps = {
  tour: any;
  displayTour: any;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  sectionRef: React.RefObject<HTMLElement | null>;
  language: string;
  isEditMode: boolean;
  displayDescription: string | null | undefined;
  keyFeatures: any[];
  tourHighlights: any[];
  poeticContent: any;
  hasConfirmedDeparture: boolean;
  updateField: (field: string, value: any) => void;
  setEditedTour: React.Dispatch<React.SetStateAction<any>>;
  setHasChanges: (b: boolean) => void;
  setDirtyFields: React.Dispatch<React.SetStateAction<Set<string>>>;
};

export default function OverviewSection({
  tour,
  displayTour,
  themeColor,
  sectionRef,
  language,
  isEditMode,
  displayDescription,
  keyFeatures,
  tourHighlights,
  poeticContent,
  hasConfirmedDeparture,
  updateField,
  setEditedTour,
  setHasChanges,
  setDirtyFields,
}: OverviewSectionProps) {
  const { t } = useLocale();

  return (
    <section ref={sectionRef} id="overview" className="py-16 lg:py-24">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-serif font-bold tracking-tight text-center mb-12" style={{ color: themeColor.primary }}>
          {t('tourDetail.description')}
        </h2>

        {/* Description — v80.23: parse bullet-formatted descriptions into a
            styled list. LLM often returns "• 第一點\n• 第二點\n• 第三點" as a
            single string; rendering as <p> showed everything on one line which
            looked plain. We now detect bullets/line-breaks and render them as
            an elegant card-style list. */}
        <div className="max-w-none text-gray-700 leading-relaxed mb-12">
          {isEditMode ? (
            <div className="prose prose-xl max-w-none text-gray-600 leading-relaxed text-center text-lg md:text-xl">
              <EditableText
                value={displayTour.description || ""}
                onSave={(value) => updateField("description", value)}
                isEditing={isEditMode}
                className="text-gray-600 leading-relaxed"
                placeholder={t('tourDetail.editDescPlaceholder')}
                multiline={true}
                as="p"
              />
            </div>
          ) : (() => {
            const desc = displayDescription || "";
            // Detect lines that start with a bullet marker (•, ‧, -, *, ・, ●, ◆)
            // OR descriptions where multiple newlines suggest list-style content.
            const lines = desc.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
            const hasBullets = lines.some((l: string) => /^[•‧\-*・●◆▪►▸✦]\s+/.test(l));
            const isMultiLine = lines.length >= 3;

            if (hasBullets || isMultiLine) {
              // Strip leading bullet markers and render as styled list cards
              const items = lines.map((l: string) => l.replace(/^[•‧\-*・●◆▪►▸✦]\s+/, ""));
              // Pull out a leading non-bullet line as an intro paragraph if the
              // first line wasn't bulleted but later lines were.
              const firstWasBullet = /^[•‧\-*・●◆▪►▸✦]\s+/.test(lines[0]);
              const intro = !firstWasBullet && hasBullets ? items.shift() : null;

              return (
                <div className="max-w-3xl mx-auto">
                  {intro && (
                    <p className="text-center text-lg md:text-xl text-gray-700 leading-relaxed mb-8">
                      {intro}
                    </p>
                  )}
                  <ul className="grid gap-3 md:grid-cols-2">
                    {items.map((item: string, idx: number) => (
                      <li
                        key={idx}
                        className="flex items-start gap-3 px-4 py-3 bg-[#FAF8F2] border-l-4 rounded-lg text-gray-800"
                        style={{ borderLeftColor: themeColor.secondary }}
                      >
                        <Sparkles
                          className="h-4 w-4 mt-1 flex-shrink-0"
                          style={{ color: themeColor.secondary }}
                        />
                        <span className="text-sm md:text-base leading-relaxed">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            }

            // Plain prose description — keep the elegant centered look
            return (
              <div className="prose prose-xl max-w-none text-gray-600 leading-relaxed text-center text-lg md:text-xl">
                <p>{desc}</p>
              </div>
            );
          })()}
        </div>

        {/* Key Features Grid — v78r: 2-col grid; v78t: dynamic for sparse cases.
            1 feature → single centered card (avoids half-empty row).
            2+ features → 2-col grid. */}
        {keyFeatures.length > 0 && (
          <div className={`grid gap-5 mt-12 ${
            keyFeatures.length === 1
              ? 'grid-cols-1 max-w-2xl mx-auto'
              : 'md:grid-cols-2'
          }`}>
            {keyFeatures.map((feature: any, index: number) => {
              // Round 79: per Jeff's B&W brand rule (tour photos exception only),
              // dropped the 12-color rainbow icon palette. Visual variety now comes
              // purely from the icon shape; styling stays neutral foreground/5.
              const featureIcons = [
                Sailboat, TreePine, Coffee, Mountain, Waves, Sunrise,
                Compass, Footprints, Bike, Landmark, UtensilsCrossed, Wine,
              ];
              const IconComponent = featureIcons[index % featureIcons.length];

              // 檢查 feature 是否有圖片
              const featureImage = typeof feature !== 'string' ? (feature.image || feature.imageUrl || feature.photo) : null;
              const featureTitle = typeof feature === 'string' ? feature : (feature.title || feature.name || '');
              const featureDescription = typeof feature !== 'string' ? (feature.description || '') : '';

              // 編輯模式下更新特色卡片
              const handleFeatureUpdate = (field: 'title' | 'description' | 'image', newValue: string) => {
                const updatedFeatures = [...keyFeatures];
                if (typeof updatedFeatures[index] === 'string') {
                  // 將字串轉換為物件
                  updatedFeatures[index] = { title: updatedFeatures[index], description: '', image: '' };
                }
                updatedFeatures[index] = { ...updatedFeatures[index], [field]: newValue };
                setEditedTour((prev: any) => ({
                  ...prev,
                  keyFeatures: updatedFeatures
                }));
                // 標記有未儲存的變更（修復 BUG-1：換圖片後儲存按鈕不顯示）
                setHasChanges(true);
                setDirtyFields((prev) => new Set(prev).add('keyFeatures'));
              };

              return (
                <div
                  key={index}
                  className={`group rounded-xl border border-gray-100 hover:shadow-lg transition-all duration-300 bg-white hover:-translate-y-1 overflow-hidden ${isEditMode ? 'ring-2 ring-yellow-200' : ''}`}
                >
                  {/* 圖片區域 - 支援編輯 */}
                  {isEditMode ? (
                    <EditableImage
                      src={featureImage || ''}
                      alt={featureTitle}
                      onSave={(newSrc) => handleFeatureUpdate('image', newSrc)}
                      isEditing={isEditMode}
                      className="h-40 w-full"
                      tourId={tour.id}
                      imagePath={`keyFeatures.${index}.image`}
                    />
                  ) : featureImage ? (
                    <div className="relative h-40 overflow-hidden rounded-xl">
                      <img
                        src={featureImage}
                        alt={featureTitle}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
                    </div>
                  ) : (
                    <div className="h-40 flex items-center justify-center bg-foreground/[0.04] transition-transform duration-300">
                      <IconComponent className="h-16 w-16 text-foreground/70 transition-transform duration-300 group-hover:scale-110" />
                    </div>
                  )}
                  {/* 文字區域 - 支援編輯 */}
                  <div className="p-5 flex flex-col">
                    {isEditMode ? (
                      <>
                        <EditableText
                          value={featureTitle}
                          onSave={(newValue) => handleFeatureUpdate('title', newValue)}
                          isEditing={isEditMode}
                          className="font-bold text-base text-gray-800 mb-2 leading-snug block min-h-[3rem]"
                          placeholder={t('tourDetail.editFeatureTitlePlaceholder')}
                          as="h3"
                        />
                        <EditableText
                          value={featureDescription}
                          onSave={(newValue) => handleFeatureUpdate('description', newValue)}
                          isEditing={isEditMode}
                          className="text-sm text-gray-600 leading-relaxed line-clamp-2 block"
                          placeholder={t('tourDetail.editFeatureDescPlaceholder')}
                          multiline
                          as="p"
                        />
                      </>
                    ) : (
                      <>
                        {/* v78r: removed min-h-3rem (was forcing artificial card height even when title is short)
                            and line-clamp-2 (was hiding 60% of LLM-generated descriptions) */}
                        <h3 className="font-bold text-base md:text-lg text-gray-800 mb-2 leading-snug">
                          {featureTitle}
                        </h3>
                        {featureDescription && (
                          <p className="text-sm text-gray-600 leading-relaxed">{featureDescription}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Round 80.25 — AI-generated rich highlights gallery. Each item is
            {title, subtitle, description, image} pulled from
            ContentAnalyzerAgent. Was being saved to tour.highlights but
            never rendered (Jeff: "AI 系統一字不落呈現到詳情頁面"). */}
        {tourHighlights.length > 0 && (
          <div className="mt-16">
            <h3 className="text-2xl font-serif font-bold text-center mb-2 text-gray-900">
              {t("tourDetail.signatureMoments")}
            </h3>
            <span
              className="inline-block h-px w-12 bg-[#c9a563] mx-auto mb-10"
              aria-hidden
              style={{ display: "block" }}
            />
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {tourHighlights.map((h: any, idx: number) => {
                const title = h.title || h.name || "";
                const subtitle = h.subtitle || "";
                const description = h.description || "";
                const image = h.image || h.imageUrl || "";
                if (!title && !description) return null;
                return (
                  <article
                    key={idx}
                    className="group bg-white rounded-xl border border-gray-100 overflow-hidden hover:shadow-lg transition-all duration-300 hover:-translate-y-1"
                  >
                    {image && (
                      <div className="relative h-48 overflow-hidden rounded-xl">
                        <img
                          src={image}
                          alt={h.imageAlt || title}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                        {subtitle && (
                          <span className="absolute bottom-3 left-3 text-xs text-white/90 italic font-serif">
                            {subtitle}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="p-5">
                      <h4 className="font-bold text-base md:text-lg text-gray-900 mb-2 leading-snug">
                        {title}
                      </h4>
                      {description && (
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {description}
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* Round 80.25 — Poetic content blocks. 5-section AI-generated
            elegant prose: intro / accommodation / dining / experience /
            closing. Was saved to tour.poeticContent but never rendered. */}
        {poeticContent && typeof poeticContent === "object" && (
          <div className="mt-16 max-w-3xl mx-auto">
            {(() => {
              const sections: Array<[string, string, string]> = [
                ["intro", t("tourDetail.poeticIntro"), poeticContent.intro || ""],
                ["accommodation", t("tourDetail.poeticStay"), poeticContent.accommodation || ""],
                ["dining", t("tourDetail.poeticDining"), poeticContent.dining || ""],
                ["experience", t("tourDetail.poeticExperience"), poeticContent.experience || ""],
                ["closing", t("tourDetail.poeticClosing"), poeticContent.closing || ""],
              ];
              const filled = sections.filter(([, , text]) => text);
              if (filled.length === 0) return null;
              return (
                <div className="space-y-8">
                  {filled.map(([key, label, text]) => (
                    <div key={key} className="text-center">
                      <h4
                        className="text-xs tracking-[0.3em] uppercase mb-3 font-medium"
                        style={{ color: "#c9a563" }}
                      >
                        {label}
                      </h4>
                      <p className="text-base md:text-lg text-gray-700 leading-relaxed font-serif italic">
                        {text}
                      </p>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Round 80.25 — REMOVED 行程影像 (Tour Gallery) per Jeff: 38-image
            mosaic was redundant. The 行程亮點 section above already shows
            the curated images with title + subtitle + description context;
            additional image-grid added clutter without information. The
            `featureImages` data is still saved by masterAgent and used
            by the highlights section's image lookup pool. */}

        {/* v80.24 Quick Info Cards — now consistent rounded-xl + brand cream
            + only render Group Size if admin has set min/max (no more fake
            "10-25 人" fallback). */}
        <div className="grid md:grid-cols-4 gap-4 mt-12">
          <div className="text-center p-6 bg-[#FAF8F2] border border-foreground/8 rounded-xl">
            <Clock className="h-10 w-10 mx-auto mb-3" style={{ color: themeColor.secondary }} />
            <p className="text-base text-gray-700 mb-1">{t('tourDetail.duration')}</p>
            <p className="font-bold text-xl">{tour.duration || t('tourDetail.multiDayTour')}</p>
          </div>
          <div className="text-center p-6 bg-[#FAF8F2] border border-foreground/8 rounded-xl">
            <MapPin className="h-10 w-10 mx-auto mb-3" style={{ color: themeColor.secondary }} />
            <p className="text-base text-gray-700 mb-1">{t('tourDetail.destination')}</p>
            <p className="font-bold text-xl">{(() => {
              const cities = (tour.destinationCity || tour.destinationCountry || '').split(/[,、]/).map((c: string) => c.trim()).filter(Boolean);
              // v78p: translate each city + use locale-appropriate separator
              const translated = cities.map((c: string) => translateDestination(c, language));
              const sep = language === 'zh-TW' ? '、' : ', ';
              if (translated.length <= 4) return translated.join(sep);
              return translated.slice(0, 4).join(sep) + '…';
            })()}</p>
          </div>
          {/* v80.24: only render group size when admin populated it. Old code
              fabricated "10-25" which exposes us to consumer complaints.
              Now prefers maxParticipants (real schema column) — derived
              from Lion departure totalSlots. */}
          {((tour as any).maxParticipants || (tour as any).minGroupSize || (tour as any).maxGroupSize) ? (
            <div className="text-center p-6 bg-[#FAF8F2] border border-foreground/8 rounded-xl">
              <Users className="h-10 w-10 mx-auto mb-3" style={{ color: themeColor.secondary }} />
              <p className="text-base text-gray-700 mb-1">{t('tourDetail.groupSize')}</p>
              <p className="font-bold text-xl">
                {(tour as any).maxParticipants
                  ? `≤ ${(tour as any).maxParticipants} 人`
                  : (t('tourDetail.groupPeople'))
                      .replace('{min}', String((tour as any).minGroupSize || (tour as any).maxGroupSize || ''))
                      .replace('{max}', String((tour as any).maxGroupSize || (tour as any).minGroupSize || ''))}
              </p>
            </div>
          ) : (
            <div className="text-center p-6 bg-[#FAF8F2] border border-foreground/8 rounded-xl">
              <Award className="h-10 w-10 mx-auto mb-3" style={{ color: themeColor.secondary }} />
              <p className="text-base text-gray-700 mb-1">{t('tourDetail.guaranteedDeparture') || '確定出團'}</p>
              <p className="font-bold text-xl">
                {hasConfirmedDeparture
                  ? (t('tourDetail.confirmed') || '已確認')
                  : (t('tourDetail.pendingConfirmation') || '報名中')}
              </p>
            </div>
          )}
          <div className="text-center p-6 bg-[#FAF8F2] border border-foreground/8 rounded-xl">
            <Calendar className="h-10 w-10 mx-auto mb-3" style={{ color: themeColor.secondary }} />
            <p className="text-base text-gray-700 mb-1">{t('tourDetail.departureDate')}</p>
            <p className="font-bold text-xl">{t('tourDetail.multipleDates')}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
