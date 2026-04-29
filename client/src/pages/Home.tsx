import { useAuth } from "@/_core/hooks/useAuth";
import SEO, { buildOrganizationSchema, buildWebSiteSchema } from "@/components/SEO";
import EditableDestinations from "@/components/EditableDestinations";
import FeaturedTours from "@/components/FeaturedTours";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import EditableHero from "@/components/EditableHero";
import HomeHeroSpotlight from "@/components/HomeHeroSpotlight";
import HomeWelcomeBack from "@/components/HomeWelcomeBack";
import NewsletterSection from "@/components/NewsletterSection";
import CompareBar from "@/components/CompareBar";
import WhyChooseUs from "@/components/WhyChooseUs";
import TestimonialsCarousel from "@/components/TestimonialsCarousel";
import HomeFAQ from "@/components/HomeFAQ";
import { Button } from "@/components/ui/button";
import { MessageCircle, Pencil, X } from "lucide-react";
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
        {/* v78m Sprint 5C: personalized welcome for logged-in users with recent views */}
        <HomeWelcomeBack />
        {/* v78i: featured tour spotlight ABOVE the search hero (signettours pattern) —
            converts visitors who don't know what to search for. */}
        <HomeHeroSpotlight />
        <EditableHero />
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

      {/* Floating AI Advisor — v78z-z2: speech bubble removed per UX audit
          (always-on visual noise). Penguin icon alone is enough; tooltip on
          hover via aria-label/title for discoverability. */}
      <div className="fixed bottom-4 right-4 z-40">
        <button
          onClick={() => setAiDialogOpen(true)}
          className="transition-all hover:scale-105 group"
          aria-label={t('home.aiAdvisor.title')}
          title={t('home.aiAdvisor.bubble')}
        >
          <img
            src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663159191204/jeyVKrdLKJdFniJk.png"
            alt={t('home.aiAdvisor.title')}
            className="w-16 h-16 md:w-28 md:h-28 object-contain drop-shadow-lg animate-penguin-wobble"
          />
        </button>
      </div>

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
