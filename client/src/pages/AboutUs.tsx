import MarketingLayout from "@/components/layouts/MarketingLayout";
import SEO from "@/components/SEO";
import { useLocale } from "@/contexts/LocaleContext";

export default function AboutUs() {
  const { t } = useLocale();

  return (
    <>
      {/* v73: SEO meta added — was the only public page missing canonical/OG */}
      <SEO
        title={{
          zh: '關於我們 - PACK&GO 旅行社',
          en: 'About Us - PACK&GO Travel',
        }}
        description={{
          zh: 'PACK&GO 旅行社致力於提供高品質、客製化的旅遊體驗。了解我們的使命、服務範圍與專業團隊。',
          en: 'PACK&GO Travel is dedicated to delivering high-quality, customised travel experiences. Learn about our mission, services and team.',
        }}
        url="/about-us"
        type="website"
      />
      <MarketingLayout
        title={t('aboutUs.title')}
        subtitle={t('aboutUs.subtitle')}
      >
      <p className="lead">{t('aboutUs.intro')}</p>

      <h2>{t('aboutUs.mission.title')}</h2>
      <p>{t('aboutUs.mission.content')}</p>

      <h2>{t('aboutUs.servicesTitle')}</h2>
      <ul>
        <li>{t('aboutUs.servicesList.customTours')}</li>
        <li>{t('aboutUs.servicesList.visaServices')}</li>
        <li>{t('aboutUs.servicesList.groupPackages')}</li>
        <li>{t('aboutUs.servicesList.flightBooking')}</li>
        <li>{t('aboutUs.servicesList.airportTransfer')}</li>
        <li>{t('aboutUs.servicesList.hotelBooking')}</li>
      </ul>

      <h2>{t('aboutUs.licencesTitle')}</h2>
      <div className="not-prose grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
        {[
          { label: t('aboutUs.legalEntityLabel'), value: 'Pack & Go, LLC', desc: t('aboutUs.legalEntityDesc') },
          { label: t('aboutUs.cityLicenceLabel'), value: 'Newark #115594', desc: t('aboutUs.cityLicenceDesc') },
          { label: t('aboutUs.cstLabel'), value: 'CST #2166984', desc: t('aboutUs.cstDesc') },
          { label: t('aboutUs.consumerProtectionLabel'), value: t('aboutUs.tcrfParticipant'), desc: t('aboutUs.consumerProtectionDesc') },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-foreground/15 bg-white p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-foreground/55 mb-1.5">{card.label}</p>
            <p className="font-serif font-semibold text-foreground text-lg">{card.value}</p>
            <p className="text-sm text-foreground/65 mt-1.5 leading-relaxed">{card.desc}</p>
          </div>
        ))}
      </div>

      <h2>{t('aboutUs.contactTitle')}</h2>
      <p>
        <strong>{t('aboutUs.address')}：</strong>39055 Cedar Blvd #126, Newark, CA 94560, USA<br />
        <strong>{t('aboutUs.phone')}：</strong>+1 (510) 634-2307<br />
        <strong>{t('aboutUs.email')}：</strong>Jeffhsieh09@gmail.com
      </p>
      </MarketingLayout>
    </>
  );
}
