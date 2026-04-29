import GenericPage from "@/components/GenericPage";
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
      <GenericPage
        title={t('aboutUs.title')}
        subtitle={t('aboutUs.subtitle')}
      >
      <div className="space-y-6 text-gray-700 max-w-4xl">
        <p className="text-lg">
          {t('aboutUs.intro')}
        </p>

        <h2 className="text-2xl font-bold text-black mt-8">{t('aboutUs.mission.title')}</h2>
        <p>
          {t('aboutUs.mission.content')}
        </p>

        <h2 className="text-2xl font-bold text-black mt-8">{t('aboutUs.servicesTitle')}</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>{t('aboutUs.servicesList.customTours')}</li>
          <li>{t('aboutUs.servicesList.visaServices')}</li>
          <li>{t('aboutUs.servicesList.groupPackages')}</li>
          <li>{t('aboutUs.servicesList.flightBooking')}</li>
          <li>{t('aboutUs.servicesList.airportTransfer')}</li>
          <li>{t('aboutUs.servicesList.hotelBooking')}</li>
        </ul>

        <h2 className="text-2xl font-bold text-black mt-8">
          {t('aboutUs.licencesTitle')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {t('aboutUs.legalEntityLabel')}
            </p>
            <p className="font-semibold text-black">Pack & Go, LLC</p>
            <p className="text-sm text-gray-600 mt-1">
              {t('aboutUs.legalEntityDesc')}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {t('aboutUs.cityLicenceLabel')}
            </p>
            <p className="font-semibold text-black">Newark #115594</p>
            <p className="text-sm text-gray-600 mt-1">
              {t('aboutUs.cityLicenceDesc')}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {t('aboutUs.cstLabel')}
            </p>
            <p className="font-semibold text-black">CST #2166984</p>
            <p className="text-sm text-gray-600 mt-1">
              {t('aboutUs.cstDesc')}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {t('aboutUs.consumerProtectionLabel')}
            </p>
            <p className="font-semibold text-black">
              {t('aboutUs.tcrfParticipant')}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              {t('aboutUs.consumerProtectionDesc')}
            </p>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-black mt-8">{t('aboutUs.contactTitle')}</h2>
        <p>
          <strong>{t('aboutUs.address')}：</strong>39055 Cedar Blvd #126, Newark, CA 94560, USA<br />
          <strong>{t('aboutUs.phone')}：</strong>+1 (510) 634-2307<br />
          <strong>{t('aboutUs.email')}：</strong>Jeffhsieh09@gmail.com
        </p>
      </div>
      </GenericPage>
    </>
  );
}
