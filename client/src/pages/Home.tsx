import { useAuth } from "@/_core/hooks/useAuth";
import SEO, { buildOrganizationSchema, buildWebSiteSchema } from "@/components/SEO";
import EditableDestinations from "@/components/EditableDestinations";
import FeaturedTours from "@/components/FeaturedTours";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import HomeHero from "@/components/home/HomeHero";
import HomeWelcomeBack from "@/components/HomeWelcomeBack";
import NewsletterSection from "@/components/NewsletterSection";
import CompareBar from "@/components/CompareBar";
import WhyChooseUs from "@/components/WhyChooseUs";
import TestimonialsCarousel from "@/components/TestimonialsCarousel";
import HomeFAQ from "@/components/HomeFAQ";
import { Button } from "@/components/ui/button";
import { Pencil, X } from "lucide-react";
import { useState } from "react";
import AITravelAdvisorDialog from "@/components/AITravelAdvisorDialog";
import { HomeEditProvider, useHomeEdit } from "@/contexts/HomeEditContext";
import { useLocale } from "@/contexts/LocaleContext";

function HomeContent() {
  const { user } = useAuth();
  const { isEditMode, toggleEditMode, canEdit } = useHomeEdit();
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const { t } = useLocale();

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <SEO
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
        <HomeHero />
        {/* Personalized welcome for logged-in users with recent views — moved
            below the hero so first-time visitors still see the brand promise
            first. */}
        <HomeWelcomeBack />
        <EditableDestinations />
        <FeaturedTours />

        {/* Why Choose Us Section */}
        <WhyChooseUs />
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
        <span aria-hidden>✨</span>
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

      {/* AI Travel Advisor Dialog */}
      <AITravelAdvisorDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen} />
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
