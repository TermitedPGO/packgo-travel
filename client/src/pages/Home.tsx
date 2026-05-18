import { useAuth } from "@/_core/hooks/useAuth";
import SEO, { buildOrganizationSchema, buildWebSiteSchema } from "@/components/SEO";
import EditableDestinations from "@/components/EditableDestinations";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import HomeHero from "@/components/home/HomeHero";
import HomeSearchBar from "@/components/home/HomeSearchBar";
import HomeFounderStory from "@/components/home/HomeFounderStory";
import HomeFeaturedSpotlight from "@/components/home/HomeFeaturedSpotlight";
import HomeMembershipPromo from "@/components/home/HomeMembershipPromo";
// Round 80.6: HomeMomentsStrip removed — was redundant with FeaturedSpotlight
// + EditableDestinations (both showcase tour photography). Component kept on
// disk in case we want to revive it for a different placement.
import HomeWelcomeBack from "@/components/HomeWelcomeBack";
import NewsletterSection from "@/components/NewsletterSection";
import CompareBar from "@/components/CompareBar";
import WhyChooseUs from "@/components/WhyChooseUs";
import TestimonialsCarousel from "@/components/TestimonialsCarousel";
import HomeFAQ from "@/components/HomeFAQ";
import { Button } from "@/components/ui/button";
import { Pencil, Sparkles, X } from "lucide-react";
import { lazy, Suspense, useState } from "react";
// Lazy load: pulls in `streamdown` + Shiki syntax highlighters (~600KB+),
// which we don't want in the eagerly-loaded Home chunk.
const AITravelAdvisorDialog = lazy(() => import("@/components/AITravelAdvisorDialog"));
import { HomeEditProvider, useHomeEdit } from "@/contexts/HomeEditContext";
import { useLocale } from "@/contexts/LocaleContext";

function HomeContent() {
  const { user } = useAuth();
  const { isEditMode, toggleEditMode, canEdit } = useHomeEdit();
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const { t } = useLocale();

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      {/* Round 80.7: per-page SEO meta (was using default fallback). */}
      <SEO
        title={{
          zh: "PACK&GO 旅行社｜華人家庭精品客製美西旅遊 (CST #2166984)",
          en: "PACK&GO Travel | Mandarin Custom Tours from Bay Area (CST #2166984)",
        }}
        description={{
          zh: "灣區華人家庭信賴的精品客製旅行社。創辦人 Jeff 親自規劃，全程司導、私人行程、零跟團壓力。CST #2166984 合法登記，免費諮詢。",
          en: "Trusted Mandarin-speaking travel agency for busy Asian families in the Bay Area. Founder-led custom itineraries, private guides, no group hassle. CST #2166984. Free consult.",
        }}
        image="/images/hero-sakura.webp"
        schema={[buildOrganizationSchema(), buildWebSiteSchema()]}
      />
      <Header />
      
      {/* Edit Mode Banner */}
      {isEditMode && (
        <div className="bg-yellow-500 text-black py-2 px-4 text-center font-medium flex items-center justify-center gap-2">
          <Pencil className="h-4 w-4" />
          {t('home.editMode.banner')}
          <Button
            onClick={toggleEditMode}
            variant="outline"
            size="sm"
            className="ml-4 bg-white hover:bg-gray-100"
          >
            <X className="h-4 w-4 mr-1" />
            {t('home.editMode.exit')}
          </Button>
        </div>
      )}
      
      <main className="flex-grow">
        {/* Round 79: anchor hero replaces the previous Spotlight + EditableHero
            duo. Single fixed-copy serif headline gives every visitor the same
            brand impression instead of a rotating ESG roulette. */}
        {/* Round 79.1 — photographic hero with rotating tour photos. */}
        <HomeHero />
        {/* Search bar overlaps the bottom of the hero (negative margin in the
            component itself). */}
        <HomeSearchBar />
        {/* Round 80.5: Founder story + trust strip — sits high on the page so
            first-time visitors see who's behind PACK&GO and that we're a
            CST-licensed CA travel agency before they evaluate any tour. */}
        <HomeFounderStory />
        {/* Personalised welcome for returning visitors. */}
        <HomeWelcomeBack />
        {/* Editorial 1+2 magazine layout — primary tour showcase, replaces
            the old FeaturedTours grid (was redundant alongside this section
            per Jeff's feedback). */}
        <HomeFeaturedSpotlight />
        {/* 6-card region grid. */}
        <EditableDestinations />

        {/* Why Choose Us Section — operational trust (insurance / 24h support
            / professional tour leaders). Complements FounderStory (which is
            license + emotional anchor). Different angle, both kept. */}
        <WhyChooseUs />
        {/* Round 80.21: Membership promo — sits between trust block and social
            proof so visitors see the recurring-value proposition once they've
            warmed up to the brand. Highlights Plus tier (most-popular). */}
        <HomeMembershipPromo />
        {/* Testimonials Carousel */}
        <TestimonialsCarousel />
        {/* FAQ Section */}
        <HomeFAQ />
        {/* Newsletter Section */}
        <NewsletterSection />

        {/* Trustpilot section removed per FTC 16 CFR §465 (eff. 2024-10-21).
            Hardcoded reviews (Melody / Ming Kuang / Ruixin Lanwu) and
            "Based on 1,200+ reviews" claim violated the rule against
            fabricated consumer reviews. Verified reviews are handled by
            <TestimonialsCarousel /> above, which only shows reviews linked
            to actual completed bookings via trpc.reviews.listVerified. */}
      </main>

      <Footer />
      <CompareBar />

      {/* Round 79: penguin mascot dropped — cartoon vibe didn't match the
          B&W premium brand baseline. AI advisor is now a discreet
          bottom-right pill, lower visual weight than the brand. */}
      <button
        onClick={() => setAiDialogOpen(true)}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-foreground text-white px-5 h-11 text-sm font-medium tracking-wide shadow-lg hover:bg-foreground/90 transition-colors"
        aria-label={t('home.aiAdvisor.title')}
        title={t('home.aiAdvisor.bubble')}
      >
        <Sparkles className="h-4 w-4" aria-hidden />
        <span>{t('home.aiAdvisor.title')}</span>
      </button>

      {/* v78o: Admin Edit Mode Button — icon-only on mobile to free up screen real estate */}
      {canEdit && !isEditMode && (
        <button
          onClick={toggleEditMode}
          className="fixed bottom-4 left-4 md:bottom-8 md:left-8 bg-black hover:bg-gray-800 text-white p-3 md:px-4 md:py-3 shadow-2xl flex items-center gap-0 md:gap-2 transition-all hover:scale-105 z-40 rounded-full md:rounded-lg opacity-60 hover:opacity-100"
          aria-label={t('home.editMode.enter')}
          title={t('home.editMode.button')}
        >
          <Pencil className="h-4 w-4 md:h-5 md:w-5" />
          <span className="hidden md:inline font-medium">{t('home.editMode.button')}</span>
        </button>
      )}

      {/* AI Travel Advisor Dialog (lazy: only loaded when user opens it) */}
      {aiDialogOpen && (
        <Suspense fallback={null}>
          <AITravelAdvisorDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen} />
        </Suspense>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <HomeEditProvider>
      <HomeContent />
    </HomeEditProvider>
  );
}
