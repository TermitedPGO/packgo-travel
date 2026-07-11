/**
 * TourDetailPeony / HeroSection.tsx
 *
 * Hero region: header, breadcrumb, hero image, trust badges, quick-facts
 * strip, sticky nav with price + CTAs, promotion banner. Extracted from
 * TourDetailPeony.tsx v2 Wave 2 Module 2.8.
 */

import React from "react";
import {
  Download,
  Calendar,
  MapPin,
  Clock,
  Share2,
  Printer,
  Globe,
  DollarSign,
  ShieldCheck,
  Lock,
  Heart,
  PhoneCall,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Header from "@/components/Header";
import { useLocale } from "@/contexts/LocaleContext";
import { translateDestination } from "@/utils/locationMapping";
import { EditableText, EditableImage } from "@/components/inline-edit";
import { toast } from "sonner";
import {
  TRANSPORT_TYPE_EN,
  TransportIcon,
  NavTabs,
  formatDualPrice,
  type getThemeColorByDestination,
} from "./helpers";
import {
  parseHeroImageCredit,
  withUnsplashUtm,
  UNSPLASH_HOME_URL,
} from "./heroCredit";

export type HeroSectionProps = {
  tour: any;
  tourId?: number;
  displayTour: any;
  themeColor: ReturnType<typeof getThemeColorByDestination>;
  language: string;
  heroImage: string;
  displayTitle: string;
  primaryTitle: string;
  titleChips: string[];
  displayDescription: string | null | undefined;
  displayHeroSubtitle: string | null | undefined;
  hasConfirmedDeparture: boolean;
  transportationInfo: any;
  navItems: { id: string; label: string }[];
  activeTab: string;
  scrollToSection: (sectionId: string) => void;
  navigate: (path: string) => void;
  setShowShareDialog: (open: boolean) => void;
  generatePdfMutation: any;
  isEditMode: boolean;
  updateField: (field: string, value: any) => void;
  getTranslated: (fieldName: string, fallback: string | null | undefined) => string | null | undefined;
  formatPrice: (value: number, currency?: any) => string;
  t: (key: string, params?: Record<string, string | number>) => string;
};

export default function HeroSection({
  tour,
  tourId,
  displayTour,
  themeColor,
  language,
  heroImage,
  displayTitle,
  primaryTitle,
  titleChips,
  displayHeroSubtitle,
  hasConfirmedDeparture,
  transportationInfo,
  navItems,
  activeTab,
  scrollToSection,
  navigate,
  setShowShareDialog,
  generatePdfMutation,
  isEditMode,
  updateField,
  getTranslated,
  formatPrice,
  t,
}: HeroSectionProps) {
  // Use prop t for parity with original to maximise i18n parity; useLocale just to anchor unused imports for now.
  useLocale();
  // Stock-photo attribution (Unsplash API terms). Written by the catalog
  // rebuild alongside tours.heroImage; only rendered when (a) it parses and
  // (b) the tour's own heroImage is what's displayed (credit was stored with
  // it). No credit → no line. English literal is the Unsplash-standard format.
  const heroCredit = (tour as any)?.heroImage
    ? parseHeroImageCredit((tour as any)?.heroImageCredit)
    : null;
  return (
    <>
      <Header />

      {/* Breadcrumb */}
      <div className="bg-gray-50 py-3 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-2 text-sm text-gray-700">
            <button onClick={() => navigate("/")} className="hover:text-black transition-colors">{t('nav.home')}</button>
            <span>&gt;</span>
            <button onClick={() => navigate("/tours")} className="hover:text-black transition-colors">{t('nav.allTours')}</button>
            <span>&gt;</span>
            <span className="text-black">{displayTitle}</span>
          </div>
        </div>
      </div>

      {/* Hero Section — v80.24: bumped to 55vh / 70vh for cinematic feel
          (was 35-45vh — title was cramped, photo barely showed).
          Hero now uses real <img> with fetchpriority="high" instead of
          background-image — Google can crawl it and LCP optimization works. */}
      <section className="relative h-[55vh] md:h-[70vh] min-h-[420px] max-h-[680px]">
        {isEditMode ? (
          <div className="absolute inset-0">
            <EditableImage
              src={displayTour.heroImage || heroImage}
              alt={displayTour.title || t('tourDetail.tourImageAlt')}
              onSave={(newSrc) => updateField('heroImage', newSrc)}
              isEditing={isEditMode}
              className="w-full h-full"
              aspectRatio="auto"
              tourId={tourId}
              imagePath="hero"
            />
            <div className={`absolute inset-0 bg-gradient-to-t ${themeColor.gradient} opacity-60 pointer-events-none`} />
          </div>
        ) : (
          <div className="absolute inset-0">
            <img
              src={heroImage}
              alt={displayTitle || t('tourDetail.tourImageAlt')}
              fetchPriority="high"
              loading="eager"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className={`absolute inset-0 bg-gradient-to-t ${themeColor.gradient} opacity-60`} />
          </div>
        )}

        <div className="relative h-full max-w-7xl mx-auto px-6 flex flex-col justify-center items-center text-center">
          {/* Public reference only. We show our own T-ref (or a curated
              tourCode), NEVER the supplier's internal product code (e.g.
              26CC401BRC) — that is their back-office code, not for customers. */}
          <div className="mb-3 inline-flex items-center gap-3 text-[11px] md:text-xs tracking-[3px] uppercase text-white/75">
            {(tour as any).tourCode || `T${tour.id}`}
            {hasConfirmedDeparture && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-[#c9a563]/95 text-[#1a1a1a] rounded-full text-[10px] md:text-[11px] font-bold tracking-wide">
                <Award className="h-3 w-3" />
                {t('tourDetail.guaranteedDeparture')}
              </span>
            )}
          </div>

          {/* Title */}
          {isEditMode ? (
            <EditableText
              value={displayTour.title || ""}
              onSave={(value) => updateField("title", value)}
              isEditing={isEditMode}
              className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-3 max-w-4xl leading-tight drop-shadow-lg"
              placeholder={t('tourDetail.editTitlePlaceholder')}
              as="h1"
              darkBackground
            />
          ) : (
            <>
              {/* Round 80.8: gold accent line above title — anchors brand baseline */}
              <span
                className="inline-block h-px w-12 bg-[#c9a563] mb-5"
                aria-hidden
              />
              <h1
                className="text-3xl md:text-4xl lg:text-5xl font-serif font-bold tracking-tight text-white mb-3 max-w-4xl leading-tight drop-shadow-lg"
                title={displayTitle}
              >
                {primaryTitle}
              </h1>
              {/* v78j: highlight chips from secondary title segments */}
              {/* v78r: keep only short, punchy chips (≤ 24 chars) max 2; the long
                  marketing copy was duplicating the main title and crowding the hero */}
              {titleChips.length > 0 && (() => {
                const punchy = titleChips.filter((c) => c.length <= 24).slice(0, 2);
                if (punchy.length === 0) return null;
                return (
                  <div className="flex flex-wrap items-center gap-2 mb-4 max-w-3xl">
                    {punchy.map((chip, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center px-2.5 py-1 rounded-md bg-white/15 backdrop-blur-sm border border-white/20 text-xs md:text-sm text-white font-medium"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                );
              })()}
            </>
          )}

          {/* Subtitle / Poetic Title — Round 80.25: render BOTH AI-generated
              fields when present so neither poeticTitle (e.g. "馬特宏峰下的
              冰雪奇蹟", 8-12 chars) nor heroSubtitle (richer 30-50 char
              descriptive line) is dropped. They convey different things —
              poeticTitle is the artistic eyebrow theme, heroSubtitle is the
              descriptive subtitle. Previously the UI showed only one. */}
          {isEditMode ? (
            <EditableText
              value={displayTour.poeticTitle || ""}
              onSave={(value) => updateField("poeticTitle", value)}
              isEditing={isEditMode}
              className="text-xl md:text-2xl text-white/90 mb-6 max-w-2xl"
              placeholder={t('tourDetail.editSubtitlePlaceholder')}
              as="p"
              darkBackground
            />
          ) : (
            <>
              {(getTranslated('poeticTitle', displayTour.poeticTitle) || displayTour.poeticTitle) && (
                <p
                  className="text-base md:text-lg text-white/85 italic font-serif tracking-wide mb-2 max-w-2xl"
                >
                  {getTranslated('poeticTitle', displayTour.poeticTitle) || displayTour.poeticTitle}
                </p>
              )}
              {displayHeroSubtitle && (
                <p className="text-xl md:text-2xl text-white/90 mb-6 max-w-2xl">
                  {displayHeroSubtitle}
                </p>
              )}
            </>
          )}

          {/* Meta info */}
          <div className="flex flex-wrap items-center justify-center gap-2 md:gap-4 text-white/90 text-xs sm:text-sm md:text-base px-4">
            {/* Destination Country Badge */}
            {tour.destinationCountry && (
              <div
                className="flex items-center gap-2 px-3 py-1 rounded-lg text-sm bg-white/95 backdrop-blur-sm shadow-md"
                style={{ color: themeColor.primary }}
              >
                <Globe className="h-4 w-4" />
                <span>{translateDestination(tour.destinationCountry, language)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              <span>{tour.duration || t('tourDetail.multiDayTour')}</span>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              <span>{(() => {
                const rawCities = (tour.destinationCity || tour.destinationCountry || '').split(/[,、]/).map((c: string) => c.trim()).filter(Boolean);
                const translatedCities = rawCities.map((c: string) => translateDestination(c, language));
                const sep = language === 'zh-TW' ? '、' : ', ';
                if (translatedCities.length <= 4) return translatedCities.join(sep);
                return translatedCities.slice(0, 4).join(sep) + '…';
              })()}</span>
            </div>
            {transportationInfo?.type && transportationInfo.typeName && transportationInfo.typeName !== '待確認' && (
              <div className="flex items-center gap-2">
                <TransportIcon type={transportationInfo.type} className="h-5 w-5" />
                <span>{language === 'en'
                  ? (TRANSPORT_TYPE_EN[transportationInfo.typeName] || transportationInfo.typeName)
                  : transportationInfo.typeName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Stock-photo attribution — Unsplash API terms: visible credit with
            links back (utm params per official guideline). Renders ONLY when
            heroImageCredit parsed (no credit → no line). English literal is
            the Unsplash-standard format, not hardcoded UI copy. */}
        {!isEditMode && heroCredit && (
          <div className="absolute bottom-2 right-3 z-10 px-2 py-0.5 rounded-md bg-black/40 backdrop-blur-sm text-[10px] text-white/75">
            Photo by{" "}
            <a
              href={withUnsplashUtm(heroCredit.profileUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-white transition-colors"
            >
              {heroCredit.name}
            </a>{" "}
            on{" "}
            <a
              href={UNSPLASH_HOME_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-white transition-colors"
            >
              Unsplash
            </a>
          </div>
        )}
      </section>

      {/* v78t: Trust badges strip — under hero, above Quick Facts.
          Reinforces decision with visible legal credentials before the user even
          reaches the price + Book CTA. CST + TCRF are California Seller of Travel
          law requirements; Stripe + 24h support are competitive differentiators. */}
      <section className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-2.5">
          <div className="flex items-center justify-center md:justify-between gap-3 md:gap-6 flex-wrap text-[11px] md:text-xs text-gray-600">
            {/* Round 80.8: trust badge icons normalised to gold (was pink/blue/amber). */}
            <div className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#c9a563] flex-shrink-0" />
              <span className="hidden sm:inline">{t('tourDetail.trustCST')} </span>
              <span className="font-semibold text-gray-800">CST #2166984</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 text-[#c9a563] flex-shrink-0" />
              <span>{t('tourDetail.trustTCRF')}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-[#c9a563] flex-shrink-0" />
              <span>{t('tourDetail.trustStripe')}</span>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <PhoneCall className="h-3.5 w-3.5 text-[#c9a563] flex-shrink-0" />
              <span>{t('tourDetail.trustSupport24h')}</span>
            </div>
          </div>
        </div>
      </section>

      {/* v78o: Quick Facts Strip — 切入主題 — 讓使用者 3 秒看到核心資訊 */}
      <section className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
            {/* 天數 */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
              <Clock className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{t('tourDetail.duration')}</p>
                <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">{tour.duration || t('tourDetail.multiDayTour')}</p>
              </div>
            </div>

            {/* 城市數 */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
              <MapPin className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{t('tourDetail.citiesLabel')}</p>
                <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">
                  {(() => {
                    const rawCities = (tour.destinationCity || tour.destinationCountry || '').split(/[,、]/).map((c: string) => c.trim()).filter(Boolean);
                    const n = rawCities.length;
                    if (n === 0) return tour.destinationCountry ? translateDestination(tour.destinationCountry, language) : '—';
                    return n === 1 ? t('tourDetail.citiesCountSingle') : t('tourDetail.citiesCount', { n });
                  })()}
                </p>
              </div>
            </div>

            {/* 交通 */}
            {transportationInfo?.type && (
              <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <TransportIcon type={transportationInfo.type} className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{t('tourDetail.transportLabel')}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5 truncate">
                    {language === 'en'
                      ? (TRANSPORT_TYPE_EN[transportationInfo.typeName || ''] || transportationInfo.typeName || '—')
                      : (transportationInfo.typeName || '—')}
                  </p>
                </div>
              </div>
            )}

            {/* 起價 */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border" style={{ backgroundColor: `${themeColor.primary}08`, borderColor: `${themeColor.primary}30` }}>
              <DollarSign className="h-4 w-4 flex-shrink-0" style={{ color: themeColor.primary }} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 leading-none">{t('tourDetail.priceFromLabel')}</p>
                {tour.price && (tour.priceCurrency || 'TWD') === 'TWD' ? (() => {
                  const dual = formatDualPrice(Number(tour.price));
                  return (
                    <>
                      <p className="text-sm font-bold mt-0.5 truncate" style={{ color: themeColor.primary }}>
                        {dual.twd}
                      </p>
                      <p className="text-[10px] text-gray-400 leading-none mt-0.5 truncate">
                        ≈ US${dual.usd}
                      </p>
                    </>
                  );
                })() : (
                  <p className="text-sm font-bold mt-0.5 truncate" style={{ color: themeColor.primary }}>
                    {tour.price ? formatPrice(Number(tour.price), (tour.priceCurrency as any) || "TWD") : t('tourDetail.inquirePrice')}
                  </p>
                )}
              </div>
            </div>

            {/* 立即預訂 CTA — 隱藏在手機，桌面顯示 */}
            <button
              onClick={() => navigate(`/book/${tour.id}`)}
              className="hidden lg:flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
              style={{ backgroundColor: themeColor.primary }}
            >
              <Calendar className="h-4 w-4" />
              {t('tourDetail.bookNowBtn')}
            </button>
          </div>
        </div>
      </section>

      {/* Sticky Navigation Tabs — v78r: Lion-Travel pattern: nav + price + Book CTA all in
          one row, always visible. Print/PDF/Share demoted to icon-only secondary actions. */}
      {/* v80.24: top offset matches Header's actual height. On desktop the
          Header is utility-bar (36px) + main (80px) = 116px; on mobile only
          the main bar shows so 80px is correct. Old `top-[80px]` overlapped
          the bottom of the utility bar on desktop. */}
      <nav className="sticky top-[80px] lg:top-[116px] z-40 bg-white shadow-sm border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-2 md:px-6">
          <div className="flex items-center justify-between gap-2 md:gap-4">
            {/* Left: section nav */}
            <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
              <NavTabs
                items={navItems}
                activeTab={activeTab}
                onTabClick={scrollToSection}
                themeColor={themeColor}
              />
            </div>

            {/* Right: price + Book CTA + secondary actions (icon-only) */}
            <div className="flex items-center gap-2 md:gap-3 shrink-0">
              {/* Price label — desktop only, very prominent */}
              <div className="hidden lg:flex flex-col items-end leading-tight">
                {tour.price && (tour.priceCurrency || 'TWD') === 'TWD' ? (() => {
                  const dual = formatDualPrice(Number(tour.price));
                  return (
                    <>
                      <span className="text-[10px] uppercase tracking-wide text-gray-400">
                        {t('tourDetail.supplierRefPrice')}
                      </span>
                      <span className="text-base font-bold" style={{ color: themeColor.primary }}>
                        {dual.twd}
                      </span>
                      <span className="text-[10px] text-gray-400">
                        ≈ US${dual.usd}
                      </span>
                    </>
                  );
                })() : (
                  <>
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">
                      {t('tourDetail.pricePerPersonFrom') || 'From / person'}
                    </span>
                    <span className="text-base font-bold" style={{ color: themeColor.primary }}>
                      {tour.price
                        ? formatPrice(Number(tour.price), (tour.priceCurrency as any) || 'TWD')
                        : t('tourDetail.inquirePrice')}
                    </span>
                  </>
                )}
              </div>

              {/* Book Now CTA — always visible (desktop + mobile) */}
              <Button
                onClick={() => navigate(`/book/${tour.id}`)}
                className="px-3 md:px-5 py-2 text-white text-sm md:text-base font-semibold shadow-sm rounded-lg"
                style={{ backgroundColor: themeColor.primary }}
              >
                {t('tourDetail.bookNowBtn')}
              </Button>

              {/* Print / PDF / Share — icon-only on hover, hidden on mobile */}
              <div className="hidden md:flex items-center gap-1 ml-1">
                <button
                  onClick={() => window.open(`/tours/${tourId}/print`, '_blank')}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  aria-label={t('tourDetail.print')}
                  title={t('tourDetail.print')}
                >
                  <Printer className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    if (!tourId) return;
                    toast.info(t('tourDetail.pdfGenerating'));
                    generatePdfMutation.mutate({ id: tourId });
                  }}
                  disabled={generatePdfMutation.isPending}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors disabled:opacity-50"
                  aria-label={t('tourDetail.downloadPdf')}
                  title={t('tourDetail.downloadPdf')}
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setShowShareDialog(true)}
                  className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  aria-label={t('tourDetail.share')}
                  title={t('tourDetail.share')}
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* Promotion Banner */}
      {tour.promotionText && (
        <div
          className="py-3 text-center text-white text-sm"
          style={{ backgroundColor: themeColor.secondary }}
        >
          <span className="font-medium">{tour.promotionText}</span>
        </div>
      )}
    </>
  );
}
