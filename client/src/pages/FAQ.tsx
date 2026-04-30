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
      <div className="space-y-8 text-gray-700">
        <div>
          <h2 className="text-xl font-bold text-black mb-2">{t('faq.questions.booking.question')}</h2>
          <p>
            {t('faq.questions.booking.answer')}
          </p>
        </div>
        
        <div>
          <h2 className="text-xl font-bold text-black mb-2">{t('faq.questions.payment.question')}</h2>
          <p>
            {t('faq.questions.payment.answer')}
          </p>
        </div>
        
        <div>
          <h2 className="text-xl font-bold text-black mb-2">{t('faq.questions.cancellation.question')}</h2>
          <p>
            {t('faq.questions.cancellation.answer')}
          </p>
        </div>
        
        <div>
          <h2 className="text-xl font-bold text-black mb-2">{t('faq.questions.visa.question')}</h2>
          <p>
            {t('faq.questions.visa.answer')}
          </p>
        </div>
        
        <div>
          <h2 className="text-xl font-bold text-black mb-2">{t('faq.questions.customization.question')}</h2>
          <p>
            {t('faq.questions.customization.answer')}
          </p>
        </div>
        
        <div>
          <h2 className="text-xl font-bold text-black mb-2">{t('faq.questions.insurance.question')}</h2>
          <p>
            {t('faq.questions.insurance.answer')}
          </p>
        </div>
      </div>
    </MarketingLayout>
  );
}
