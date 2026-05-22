import MarketingLayout from "@/components/layouts/MarketingLayout";
import SEO from "@/components/SEO";
import { useLocale } from "@/contexts/LocaleContext";

export default function FAQ() {
  const { t } = useLocale();
  const FAQ_KEYS = [
    'booking',
    'payment',
    'cancellation',
    'visa',
    'customization',
    'insurance',
    'mandarinSupport',
    'tipping',
    'groupSize',
    'luggage',
    'kids',
    'dietary',
    'passport',
    'jetLag',
    'shopping',
  ];
  // Round 80.25 — FAQPage Schema.org JSON-LD for rich result eligibility.
  // Google may surface accordion-style FAQ snippets directly in SERPs when
  // this schema is present and matches the on-page content.
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_KEYS.map((key) => ({
      "@type": "Question",
      name: t(`faq.questions.${key}.question`),
      acceptedAnswer: {
        "@type": "Answer",
        text: t(`faq.questions.${key}.answer`),
      },
    })),
  };

  return (
    <MarketingLayout
      title={t('faq.title')}
      subtitle={t('faq.subtitle')}
      ctaText={t('faq.moreQuestions')}
      ctaLink="/inquiry"
    >
      <SEO
        title={{
          zh: "常見問題｜付款、退改、保險、簽證｜PACK&GO 旅行社",
          en: "FAQ | Payments, Refunds, Insurance, Visas | PACK&GO Travel",
        }}
        description={{
          zh: "PACK&GO 完整 FAQ：付款方式、行程改期、旅遊保險、簽證問題、領隊、小費、行李、團型、CST 合法性。15 題一次解答華人家庭最常問的疑慮。",
          en: "Complete FAQ: payments, rescheduling, travel insurance, visas, tour leaders, tipping, luggage, group size, CST licensing. 15 answers covering top questions from Asian-American families.",
        }}
        image="/images/hero-sakura.webp"
        url="/faq"
        schema={faqSchema}
      />
      {/* 2026-05-22: structured list with explicit spacing and serif headings.
          Was rendering as a wall of unstyled <h2>/<p> pairs at 6 items; now
          15 items need clearer visual hierarchy. */}
      <div className="space-y-8 max-w-3xl mx-auto">
        {FAQ_KEYS.map((key, idx) => (
          <div key={key} className="border-b border-gray-100 pb-6 last:border-0">
            <h2 className="font-serif text-xl md:text-2xl font-bold text-gray-900 mb-3 flex items-start gap-3">
              <span className="text-[#c9a563] font-sans text-sm font-semibold mt-1 tracking-wider tabular-nums">
                {String(idx + 1).padStart(2, "0")}
              </span>
              <span className="flex-1">{t(`faq.questions.${key}.question`)}</span>
            </h2>
            <p className="text-gray-600 leading-relaxed ml-10">
              {t(`faq.questions.${key}.answer`)}
            </p>
          </div>
        ))}
      </div>
    </MarketingLayout>
  );
}
