/**
 * TourDetailPeony / index.tsx — orchestrator
 *
 * Holds page-level state (route params, edit mode, expanded days, dialogs,
 * sectionRefs) and renders the composed section components.
 *
 * Refactor history (v2 Wave 2 Module 2.8):
 *   - The original 3,846 LOC monolith `client/src/pages/TourDetailPeony.tsx`
 *     was split into 9 sibling files under this directory + this entry.
 *   - Imports are resolved by App.tsx's lazy(() => import("./pages/TourDetailPeony"))
 *     which now picks up this `index.tsx` automatically.
 *
 * Design notes:
 *   - Theme color + sectionRefs are prop-drilled (only 8 sections deep, not
 *     worth the Context overhead). v3 backlog: lift to context if more
 *     sections appear.
 *   - JSX inside sections is verbatim from the source — pixel-identical render.
 */

import React, { useEffect, useState, useRef, useMemo } from "react";
import SimilarTours from "@/components/SimilarTours";
import TourDeparturesTable from "@/components/TourDeparturesTable";
import { recordTourView } from "@/components/HomeWelcomeBack";
import { useRoute, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocale } from "@/contexts/LocaleContext";
import { trackViewTour } from "@/lib/analytics";
import { EditModeToggle, EditModeBanner } from "@/components/inline-edit";

import { useTourEditMode } from "./useTourEditMode";

import {
  parseJSON,
  getThemeColorByDestination,
  MealDetailDialog,
  AttractionDetailDialog,
  type MealDetail,
  type AttractionDetail,
} from "./helpers";
import HeroSection from "./HeroSection";
import OverviewSection from "./OverviewSection";
import RouteMapSection from "./RouteMapSection";
import ItinerarySection from "./ItinerarySection";
import SupplierDetailSection from "./SupplierDetailSection";
import FeaturesSection from "./FeaturesSection";
import HotelsSection from "./HotelsSection";
import PricingSection from "./PricingSection";
import NotesSection from "./NotesSection";
import ShareDialog from "./ShareDialog";
import BottomCTA from "./BottomCTA";
import TourActionArea from "./TourActionArea";
import TourInquiryDialog from "./TourInquiryDialog";
import WeChatDialog from "./WeChatDialog";
import { type WizardAnswers, type InquiryMode } from "./actionArea.helpers";
import TourSEO from "./TourSEO";
import { LoadingSpinner, NotFoundState } from "./LoadingState";
import TourReviews from "@/components/tour-detail/TourReviews";
import Footer from "@/components/Footer";

export default function TourDetailPeony() {
  const { t, language, formatPrice } = useLocale();
  const [matchSipin, paramsSipin] = useRoute("/tours-sipin/:id");
  const [matchTours, paramsTours] = useRoute("/tours/:id");
  const [matchMinimal, paramsMinimal] = useRoute("/tours-minimal/:id");
  const [matchPeony, paramsPeony] = useRoute("/tours-peony/:id");
  const params = paramsSipin || paramsTours || paramsMinimal || paramsPeony;
  const [, navigate] = useLocation();
  const tourId = params?.id ? parseInt(params.id) : undefined;

  const { data: tour, isLoading, error, refetch } = trpc.tours.getById.useQuery(
    { id: tourId! },
    { enabled: !!tourId }
  );

  // v78m Sprint 5C: record this view in localStorage for the "Recently viewed"
  // section on the homepage (only fires when we successfully load a tour)
  useEffect(() => {
    if (tourId) recordTourView(tourId);
  }, [tourId]);

  // 多語言翻譯查詢：語系非 zh-TW 時自動載入翻譯
  const { data: tourTranslations } = trpc.translation.getTourTranslations.useQuery(
    { tourId: tourId!, targetLanguage: language as 'zh-TW' | 'en' },
    { enabled: !!tourId && language !== 'zh-TW' }
  );

  // v80.24: top-level departures for hero badge + Quick Info Cards. The
  // child DeparturePriceCalendar already fetches its own copy; React Query
  // dedupes the request so this is effectively free.
  const { data: heroDepartures } = trpc.departures.list.useQuery(
    { tourId: tourId! },
    { enabled: !!tourId, staleTime: 5 * 60 * 1000 }
  );
  const hasConfirmedDeparture = (heroDepartures || []).some(
    (d: any) => d.status === 'confirmed'
  );

  // 取得翻譯後的欄位值（優雅降級到原始中文）
  // API 回傳格式為 Record<string, string>，例如 { title: "...", description: "..." }
  const getTranslated = (fieldName: string, fallback: string | null | undefined): string | null | undefined => {
    if (language === 'zh-TW' || !tourTranslations) return fallback;
    const translationMap = tourTranslations as Record<string, string>;
    const translated = translationMap[fieldName];
    return translated ?? fallback;
  };

  // 編輯模式狀態 — admin edit-mode + mutations + dirty tracking
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [showShareDialog, setShowShareDialog] = useState(false);
  const editMode = useTourEditMode(tour, tourId, refetch);
  const {
    isEditMode, setIsEditMode,
    editedTour, setEditedTour,
    isSaving, hasChanges, setHasChanges,
    dirtyFields, setDirtyFields,
    updateField, handleSave, handleCancelEdit,
    generatePdfMutation,
  } = editMode;

  // GA4: 行程詳情頁瀏覽事件
  useEffect(() => {
    if (tour) {
      trackViewTour({
        tourId: tour.id,
        tourName: getTranslated('title', tour.title) ?? tour.title,
        destination: (tour as any).destinationCountry ?? (tour as any).destination ?? "",
        price: (tour as any).price ?? 0,
        currency: "TWD",
      });
    }
  }, [tour?.id]);

  // 取得當前顯示的資料（編輯模式下使用編輯中的資料）
  const displayTour = isEditMode && editedTour ? editedTour : tour;

  const [activeTab, setActiveTab] = useState("overview");
  // v80.24: Jeff feedback — 預設要全部展開，使用者要才自己收合。
  // (was: only Day 1 open by default — too many "查看更多" clicks needed)
  const [expandedDays, setExpandedDays] = useState<Set<number>>(() => new Set([0]));
  const expandInitRef = useRef(false);
  const [selectedMealDetail, setSelectedMealDetail] = useState<MealDetail | null>(null);
  const [isMealDetailOpen, setIsMealDetailOpen] = useState(false);
  const [selectedAttractionDetail, setSelectedAttractionDetail] = useState<AttractionDetail | null>(null);
  const [isAttractionDetailOpen, setIsAttractionDetailOpen] = useState(false);

  // 行程頁「決策 + 行動區」狀態（tour-page-redesign）：小精靈答案 + 詢問/微信彈窗。
  // 單一來源在此，供 TourActionArea / BottomCTA / PricingSection 與兩個 Dialog 共用。
  const [wizard, setWizard] = useState<WizardAnswers>({});
  const [inquiryOpen, setInquiryOpen] = useState(false);
  const [inquiryMode, setInquiryMode] = useState<InquiryMode>("quote");
  const [wechatOpen, setWechatOpen] = useState(false);
  const openInquiry = (mode: InquiryMode) => {
    setInquiryMode(mode);
    setInquiryOpen(true);
  };

  // 景點詳情彈窗處理
  const handleShowAttractionDetail = (activity: any) => {
    // 將 activity 轉換為 AttractionDetail 格式
    const detail: AttractionDetail = {
      name: activity.title || activity.name || t('tourDetail.attraction'),
      description: activity.description || activity.summary,
      address: activity.address || activity.location,
      phone: activity.phone,
      openingHours: activity.openingHours || activity.hours,
      ticketPrice: activity.ticketPrice || activity.price,
      ticketInfo: activity.ticketInfo,
      images: activity.images || (activity.image ? [activity.image] : []),
      rating: activity.rating,
      website: activity.website || activity.url,
      tips: activity.tips,
      highlights: activity.highlights || activity.features,
      duration: activity.duration || activity.visitTime,
    };
    setSelectedAttractionDetail(detail);
    setIsAttractionDetailOpen(true);
  };

  // 餐廠詳情彈窗處理
  const handleShowMealDetail = (detail: MealDetail) => {
    setSelectedMealDetail(detail);
    setIsMealDetailOpen(true);
  };

  // Section refs for scroll tracking
  // Round 80.20: added `routemap` so the 行程路線 (Tour Route Map) section
  // is part of sticky-nav scroll tracking — previously the section rendered
  // but had no anchor, so the active-section indicator skipped from
  // overview straight to itinerary while the user was actually looking at
  // the map.
  const sectionRefs = {
    overview: useRef<HTMLElement>(null),
    routemap: useRef<HTMLElement>(null),
    itinerary: useRef<HTMLElement>(null),
    features: useRef<HTMLElement>(null),
    hotels: useRef<HTMLElement>(null),
    pricing: useRef<HTMLElement>(null),
    notes: useRef<HTMLElement>(null),
  };

  // Round 80.8: theme is now ALWAYS the unified B&W + Gold brand theme.
  // The previous logic read `tour.colorTheme` from the DB (an AI-generated
  // per-country palette with reds/blues/greens) which directly overrode the
  // brand baseline — Canada tours rendered red, Japan rendered pink, etc.
  // We intentionally ignore the DB field here. If a tour record needs a
  // brand-aligned variation in the future, surface it through a different
  // mechanism (e.g. opt-in 'season' theme) rather than a free-form colour
  // override that breaks the brand on every page load.
  const themeColor = useMemo(
    () => getThemeColorByDestination(tour?.destinationCountry),
    [tour]
  );

  // Scroll tracking
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 200;

      for (const [key, ref] of Object.entries(sectionRefs)) {
        if (ref.current) {
          const { offsetTop, offsetHeight } = ref.current;
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveTab(key);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (sectionId: string) => {
    const ref = sectionRefs[sectionId as keyof typeof sectionRefs];
    if (ref?.current) {
      const yOffset = -150;
      const y = ref.current.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  const toggleDay = (dayNum: number) => {
    setExpandedDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(dayNum)) {
        newSet.delete(dayNum);
      } else {
        newSet.add(dayNum);
      }
      return newSet;
    });
  };

  // ====== JSON 欄位 useMemo 快取（必須在所有條件 return 之前，避免 React Error #310）======
  // keyFeatures: 編輯模式下從 editedTour 讀取，非中文模式使用翻譯
  const keyFeatures = useMemo(() => {
    if (isEditMode && editedTour?.keyFeatures != null) {
      const src = editedTour.keyFeatures;
      return typeof src === 'string' ? parseJSON(src, []) : (src || []);
    }
    const source = getTranslated('keyFeatures', tour?.keyFeatures) ?? tour?.keyFeatures;
    return typeof source === 'string' ? parseJSON(source, []) : (source || []);
  }, [isEditMode, editedTour?.keyFeatures, tour?.keyFeatures, language, tourTranslations]);

  // Round 80.25 — filter out placeholder attractions ("景點 1", "景點 2",
  // "Attraction 3", etc.) that the AI / admin templates leave when they
  // can't extract real attraction names. Tour 990012 (Alishan) had 9 of
  // these rendering as a generic 景點 1...景點 9 grid.
  const attractions = useMemo(() => {
    const raw = parseJSON(tour?.attractions, []);
    if (!Array.isArray(raw)) return [];
    const isPlaceholder = (name: string) =>
      /^\s*(?:景點|Attraction|景点)\s*\d+\s*$/i.test(name) ||
      /^\s*Place\s*\d+\s*$/i.test(name);
    return raw.filter((a: any) => {
      const name = typeof a === "string" ? a : (a?.name || a?.title || "");
      const desc = typeof a === "string" ? "" : (a?.description || "");
      // Drop if name is empty/placeholder AND description is empty.
      if (!name || isPlaceholder(name)) {
        return desc.trim().length > 0; // keep only if real description
      }
      return true;
    });
  }, [tour?.attractions]);
  const hotels = useMemo(() => {
    const source = getTranslated('hotels', tour?.hotels) ?? tour?.hotels;
    return parseJSON(source, []);
  }, [tour?.hotels, language, tourTranslations]);
  const meals = useMemo(() => {
    const source = getTranslated('meals', tour?.meals) ?? tour?.meals;
    return parseJSON(source, {});
  }, [tour?.meals, language, tourTranslations]);
  // v78p: Add `tourTranslations` to deps — was missing, causing stale memos
  // when async translation data loaded AFTER initial render. Symptom: pages
  // showed Chinese until next state change.
  const itineraryDetailed = useMemo(() => {
    const source = getTranslated('itineraryDetailed', tour?.itineraryDetailed) ?? tour?.itineraryDetailed;
    return parseJSON(source, []);
  }, [tour?.itineraryDetailed, language, tourTranslations]);
  const costExplanation = useMemo(() => parseJSON(
    getTranslated('costExplanation', tour?.costExplanation) ?? tour?.costExplanation, null
  ), [tour?.costExplanation, language, tourTranslations]);
  const transportationInfo = useMemo(() => parseJSON(
    getTranslated('flights', tour?.flights) ?? tour?.flights, null
  ), [tour?.flights, language, tourTranslations]);
  const noticeDetailed = useMemo(() => parseJSON(
    getTranslated('noticeDetailed', tour?.noticeDetailed) ?? tour?.noticeDetailed, null
  ), [tour?.noticeDetailed, language, tourTranslations]);

  // Round 80.25 — these AI fields were silently dropped from the rendered
  // detail page even though masterAgent generates them. Per Jeff's request
  // "AI 系統一字不落呈現到詳情頁面", they now have explicit memos + render
  // sections. tour.highlights = rich gallery items {title, subtitle,
  // description, image}; tour.poeticContent = 5 paragraph poetic descriptions.
  // (featureImages was a 38-image mosaic — removed per Jeff feedback as
  // redundant with the highlights gallery's curated images.)
  const tourHighlights = useMemo(() => {
    const source = getTranslated('highlights', tour?.highlights) ?? tour?.highlights;
    return parseJSON(source, []);
  }, [tour?.highlights, language, tourTranslations]);
  const poeticContent = useMemo(() => {
    const source = getTranslated('poeticContent', tour?.poeticContent) ?? tour?.poeticContent;
    return parseJSON(source, null);
  }, [tour?.poeticContent, language, tourTranslations]);

  // displayItinerary: 編輯模式下從 editedTour 讀取，消除 JSX 中重複 parse
  const displayItinerary = useMemo(() => {
    if (isEditMode && editedTour?.itineraryDetailed != null) {
      return typeof editedTour.itineraryDetailed === 'string'
        ? parseJSON(editedTour.itineraryDetailed, [])
        : editedTour.itineraryDetailed;
    }
    return itineraryDetailed;
  }, [isEditMode, editedTour?.itineraryDetailed, itineraryDetailed]);
  // ====== 結束 JSON 欄位 useMemo 快取 ======

  // v80.24: auto-expand all days on first load (Jeff: 預設要全展開).
  // Only fires once per page mount; user can still collapse individual days.
  useEffect(() => {
    if (!expandInitRef.current && displayItinerary.length > 0) {
      expandInitRef.current = true;
      setExpandedDays(new Set(displayItinerary.map((_: any, i: number) => i)));
    }
  }, [displayItinerary.length]);

  if (isLoading) return <LoadingSpinner />;
  if (error || !tour) return <NotFoundState navigate={navigate} />;

  // 解析資料（多語言翻譯覆蓋）
  // 編輯模式下使用 editedTour，否則使用原始 tour
  const heroImage = (isEditMode && editedTour?.heroImage)
    ? editedTour.heroImage
    : (tour.heroImage || tour.imageUrl || "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200");
  // 翻譯覆蓋：文字欄位
  const displayTitle = getTranslated('title', tour.title) ?? tour.title;
  // v78j: split long titles into clean primary headline + subtitle chips.
  // Heuristic: if first segment is < 6 chars (likely a marketing prefix like
  // "好運發發發"), skip it and use the second segment as primary.
  const _segments = (displayTitle || "").split(/[|｜]/).map(s => s.trim()).filter(Boolean);
  const _isMarketingPrefix = (s: string) => s.length < 6 && !/[0-9]|day|night|天|夜/i.test(s);
  const _primaryIdx = _segments.length > 1 && _isMarketingPrefix(_segments[0]) ? 1 : 0;
  const primaryTitle = _segments[_primaryIdx] || displayTitle || "";
  const titleChips = _segments.filter((_, i) => i !== _primaryIdx);
  const displayDescription = getTranslated('description', tour.description) ?? tour.description;
  const displayHeroSubtitle = getTranslated('heroSubtitle', (tour as any).heroSubtitle) ?? (tour as any).heroSubtitle;
  // 導覽項目
  // Round 80.20: surface "行程路線" (Route Map) in sticky nav between
  // overview and itinerary so users can jump straight to the map. Hidden
  // when itinerary is empty (the map section also doesn't render then).
  const navItems = [
    // BUG-005 fix: removed duplicate 'features' tab (same section as 'overview')
    { id: "overview", label: t('tourDetail.tabs.overview') },
    ...(displayItinerary && displayItinerary.length > 0
      ? [{ id: "routemap", label: t('tourDetail.tabs.routeMap') }]
      : []),
    { id: "itinerary", label: t('tourDetail.tabs.itinerary') },
    { id: "hotels", label: t('tourDetail.tabs.hotel') },
    { id: "pricing", label: t('tourDetail.tabs.pricing') },
    { id: "notes", label: t('tourDetail.tabs.notes') },
  ];

  // 確保陣列類型
  const ensureArray = (val: any) => Array.isArray(val) ? val : [];

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 動態 SEO meta 標籤 */}
      <TourSEO
        tour={tour}
        tourTranslations={tourTranslations}
        displayTitle={displayTitle}
        displayDescription={displayDescription}
        language={language}
        noticeDetailed={noticeDetailed}
      />
      {/* 編輯模式標題橫幅 */}
      {isAdmin && <EditModeBanner isEditMode={isEditMode} hasChanges={hasChanges} />}

      {/* 編輯模式切換按鈕 */}
      {isAdmin && (
        <EditModeToggle
          isEditMode={isEditMode}
          onToggle={() => setIsEditMode(!isEditMode)}
          onSave={handleSave}
          onCancel={handleCancelEdit}
          isSaving={isSaving}
          hasChanges={hasChanges}
          changesCount={dirtyFields.size}
        />
      )}

      <HeroSection
        tour={tour}
        tourId={tourId}
        displayTour={displayTour}
        themeColor={themeColor}
        language={language}
        heroImage={heroImage}
        displayTitle={displayTitle}
        primaryTitle={primaryTitle}
        titleChips={titleChips}
        displayDescription={displayDescription}
        displayHeroSubtitle={displayHeroSubtitle}
        hasConfirmedDeparture={hasConfirmedDeparture}
        transportationInfo={transportationInfo}
        navItems={navItems}
        activeTab={activeTab}
        scrollToSection={scrollToSection}
        navigate={navigate}
        setShowShareDialog={setShowShareDialog}
        generatePdfMutation={generatePdfMutation}
        isEditMode={isEditMode}
        updateField={updateField}
        getTranslated={getTranslated}
        formatPrice={formatPrice}
        t={t}
      />

      {/* 決策 + 行動區（tour-page-redesign）：事實條 + 小精靈 + CTA。置於 Hero 後、
          概覽前，讓決策早出現。 */}
      <TourActionArea
        tour={tour}
        departures={heroDepartures}
        themeColor={themeColor}
        wizard={wizard}
        onWizardChange={setWizard}
        onInquire={openInquiry}
        onWeChat={() => setWechatOpen(true)}
        navigate={navigate}
      />

      <OverviewSection
        tour={tour}
        displayTour={displayTour}
        themeColor={themeColor}
        sectionRef={sectionRefs.overview}
        language={language}
        isEditMode={isEditMode}
        displayDescription={displayDescription}
        keyFeatures={keyFeatures}
        tourHighlights={tourHighlights}
        poeticContent={poeticContent}
        hasConfirmedDeparture={hasConfirmedDeparture}
        updateField={updateField}
        setEditedTour={setEditedTour}
        setHasChanges={setHasChanges}
        setDirtyFields={setDirtyFields}
      />

      <RouteMapSection
        tour={tour}
        displayItinerary={displayItinerary}
        themeColor={themeColor}
        sectionRef={sectionRefs.routemap}
      />

      <ItinerarySection
        tour={tour}
        tourId={tourId}
        displayItinerary={displayItinerary}
        themeColor={themeColor}
        sectionRef={sectionRefs.itinerary}
        isEditMode={isEditMode}
        expandedDays={expandedDays}
        language={language}
        toggleDay={toggleDay}
        setExpandedDays={setExpandedDays}
        handleShowMealDetail={handleShowMealDetail}
        handleShowAttractionDetail={handleShowAttractionDetail}
        updateField={updateField}
      />

      <FeaturesSection
        attractions={attractions}
        meals={meals}
        costExplanation={costExplanation}
        themeColor={themeColor}
        sectionRef={sectionRefs.features}
        ensureArray={ensureArray}
      />

      <HotelsSection
        hotels={hotels}
        themeColor={themeColor}
        sectionRef={sectionRefs.hotels}
      />

      {/* v80.24: Verified customer reviews block — between Hotels and Pricing.
          Soft empty state when no reviews yet (don't hide the section). */}
      {tour.id && <TourReviews tourId={tour.id} themeColor={themeColor} />}

      <PricingSection
        tour={tour}
        themeColor={themeColor}
        sectionRef={sectionRefs.pricing}
        costExplanation={costExplanation}
        language={language}
        navigate={navigate}
        ensureArray={ensureArray}
        onInquire={openInquiry}
      />

      <NotesSection
        noticeDetailed={noticeDetailed}
        themeColor={themeColor}
        sectionRef={sectionRefs.notes}
        ensureArray={ensureArray}
        sourceUrl={tour?.sourceUrl}
      />

      {/* M6 of supplier deep sync (2026-05-24): render rich content from
          supplierProductDetails if the tour is linked to a Lion/UV product
          and the backfill has processed it. Falls back silently if no data. */}
      {tour?.id && <SupplierDetailSection tourId={tour.id} />}

      {/* v78m Sprint 5B: Departures + pricing table (signettours pattern) */}
      {tour?.id && (
        <TourDeparturesTable
          tourId={tour.id}
          basePrice={tour.price || 0}
          baseCurrency={tour.priceCurrency || "TWD"}
          themeColor={themeColor}
        />
      )}

      {/* Similar Tours Recommendation */}
      {tour?.id && <SimilarTours tourId={tour.id} />}

      <BottomCTA tour={tour} themeColor={themeColor} navigate={navigate} onInquire={openInquiry} />

      {/* 餐廠詳情彈窗 */}
      <MealDetailDialog
        isOpen={isMealDetailOpen}
        onClose={() => setIsMealDetailOpen(false)}
        detail={selectedMealDetail}
        themeColor={themeColor}
      />

      {/* 景點詳情彈窗 */}
      <AttractionDetailDialog
        isOpen={isAttractionDetailOpen}
        onClose={() => setIsAttractionDetailOpen(false)}
        detail={selectedAttractionDetail}
        themeColor={themeColor}
      />

      {/* 分享對話框 */}
      <ShareDialog
        open={showShareDialog}
        onOpenChange={setShowShareDialog}
        displayTitle={displayTitle}
        themeColor={themeColor}
      />

      {/* 行程頁詢問表單 + 微信彈窗（tour-page-redesign） */}
      <TourInquiryDialog
        open={inquiryOpen}
        onOpenChange={setInquiryOpen}
        tour={tour}
        wizard={wizard}
        mode={inquiryMode}
        themeColor={themeColor}
      />
      <WeChatDialog open={wechatOpen} onOpenChange={setWechatOpen} themeColor={themeColor} />

      <Footer />
    </div>
  );
}
