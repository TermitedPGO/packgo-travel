import MarketingLayout from "@/components/layouts/MarketingLayout";
import SEO from "@/components/SEO";
import { useLocale } from "@/contexts/LocaleContext";

export default function FAQ() {
  const { t } = useLocale();
  
  return (
    <MarketingLayout
      title={t('faq.title')}
      subtitle={t('faq.subtitle')}
      ctaText={t('faq.moreQuestions')}
      ctaLink="/inquiry"
    >
      {[
        'booking',
        'payment',
        'cancellation',
        'visa',
        'customization',
        'insurance',
      ].map((key) => (
        <div key={key}>
          <h2>{t(`faq.questions.${key}.question`)}</h2>
          <p>{t(`faq.questions.${key}.answer`)}</p>
        </div>
      ))}
    </MarketingLayout>
  );
}
