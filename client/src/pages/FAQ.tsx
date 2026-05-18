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
          zh: "PACK&GO 完整 FAQ：付款方式、行程改期、旅遊保險、簽證問題、CST 合法性。30+ 題一次解答華人家庭最常問的疑慮。",
          en: "Complete FAQ: payments, rescheduling, travel insurance, visas, CST licensing. 30+ answers covering top questions from Asian-American families.",
        }}
        image="/images/hero-sakura.webp"
        url="/faq"
        schema={faqSchema}
      />
      {FAQ_KEYS.map((key) => (
        <div key={key}>
          <h2>{t(`faq.questions.${key}.question`)}</h2>
          <p>{t(`faq.questions.${key}.answer`)}</p>
        </div>
      ))}
    </MarketingLayout>
  );
}
