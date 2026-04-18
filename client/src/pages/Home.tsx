import { useAuth } from "@/_core/hooks/useAuth";
import SEO, { buildOrganizationSchema, buildWebSiteSchema } from "@/components/SEO";
import EditableDestinations from "@/components/EditableDestinations";
import FeaturedTours from "@/components/FeaturedTours";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import EditableHero from "@/components/EditableHero";
import NewsletterSection from "@/components/NewsletterSection";
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

      {/* Floating AI Advisor Button with Penguin Character */}
      <div className="fixed bottom-4 right-4 z-40">
        <button
          onClick={() => setAiDialogOpen(true)}
          className="flex flex-col items-end transition-all hover:scale-105 group"
          aria-label={t('home.aiAdvisor.title')}
        >
          {/* Speech Bubble - Rounded Design */}
          <div className="mb-1 mr-4 px-4 py-2 bg-white border border-gray-200 text-black text-sm font-medium shadow-md rounded-xl">
            {t('home.aiAdvisor.bubble')}
          </div>
          {/* Penguin Image - Original Design */}
          <img
            src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663159191204/jeyVKrdLKJdFniJk.png"
            alt={t('home.aiAdvisor.title')}
            className="w-28 h-28 object-contain drop-shadow-lg animate-penguin-wobble"
          />
        </button>
      </div>

      {/* Admin Edit Mode Button - positioned on left side to avoid overlap with penguin */}
      {canEdit && !isEditMode && (
        <button
          onClick={toggleEditMode}
          className="fixed bottom-8 left-8 bg-black hover:bg-gray-800 text-white px-4 py-3 shadow-2xl flex items-center gap-2 transition-all hover:scale-105 z-50 rounded-lg"
          aria-label={t('home.editMode.enter')}
        >
          <Pencil className="h-5 w-5" />
          <span className="font-medium">{t('home.editMode.button')}</span>
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
